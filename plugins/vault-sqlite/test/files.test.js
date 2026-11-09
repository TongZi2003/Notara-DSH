import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, unlinkSync, renameSync, rmSync, symlinkSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVaultStore } from '../vault-indexer.js';
import * as paths from '../vault-path.js';
import {defaultLibraryBase} from '../bases.js';
import {DatabaseSync} from 'node:sqlite';

test('workspace file paths are independent from the editable Vault format allowlist', () => {
  for (const path of ['代码/阶段0/train.py', '结果.json', '说明.txt', 'Makefile']) {
    assert.equal(paths.safeWorkspaceRelativePath(path), path);
    assert.throws(() => paths.safeRelativePath(path), /vault_path_invalid/);
  }
  for (const path of ['../private.py', '/tmp/private.py', '.env', 'node_modules/code.py', 'a\\b.py', 'a/CON.py']) assert.throws(() => paths.safeWorkspaceRelativePath(path), /vault_path_invalid/);
});

test('generic files are metadata-only nodes; ordinary wiki and Markdown references connect them', async t => {
  const root = mkdtempSync(join(tmpdir(), 'notara-files-'));
  mkdirSync(join(root, '代码'));
  writeFileSync(join(root, '代码/train.py'), '# SECRET_CODE_BODY\n# tags: [伪标签]\n[[不存在]]');
  writeFileSync(join(root, '结果.json'), '{"secret":"SECRET_JSON_BODY"}');
  writeFileSync(join(root, 'Makefile'), 'SECRET_MAKE_BODY');
  writeFileSync(join(root, '笔记.md'), '# 实验\n[[代码/train.py|训练代码]]\n[结果](结果.json)\n`[[不存在.py]]`\n');
  const store = createVaultStore({ root, cachePath: join(root, 'index.sqlite') });
  t.after(async () => { await store.close(); rmSync(root, { recursive: true, force: true }); });
  const files = store.query({ type: 'file' }).documents;
  assert.deepEqual(files.map(file => file.path).sort(), ['Makefile', '代码/train.py', '结果.json'].sort());
  assert.equal(store.metrics.fileReads, 1, 'Only Markdown is read; generic/binary files and cache are not');
  assert.equal(store.query({ q: 'SECRET_CODE_BODY' }).total, 0);
  assert.equal(store.query({ q: 'train', type: 'file' }).total, 1);
  assert.ok(files.every(file => file.summary === '' && file.tags.length === 0 && file.reviewDue === null));
  assert.deepEqual(store.graph({ focusPath: '代码/train.py' }).nodes.map(file => file.path).sort(), ['代码/train.py', '笔记.md'].sort());
  assert.equal(store.graph({}).edges.length, 2);
  assert.ok(store.graph({}).edges.every(edge => edge.style === 'dashed'));
  assert.throws(() => store.read({ path: '代码/train.py' }), /vault_path_invalid/);
  assert.throws(() => store.save({ path: '代码/train.py', content: 'overwrite', expectedRevision: files.find(file => file.path.endsWith('.py')).revision }), /vault_path_invalid/);
  const before = { ...store.metrics }; store.query({}); store.graph({}); store.scan();
  assert.equal(store.metrics.fileReads, before.fileReads);
  symlinkSync(join(root, '代码/train.py'), join(root, 'link.py')); store.scan();
  assert.equal(store.query({ q: 'link.py' }).total, 0);
});

test('watcher adds, renames and removes generic nodes and invalidates graph links without rescanning', async t => {
  const root = mkdtempSync(join(tmpdir(), 'notara-files-watch-'));
  writeFileSync(join(root, '笔记.md'), '[[train.py]]\n');
  const store = createVaultStore({ root });
  t.after(async () => { await store.close(); rmSync(root, { recursive: true, force: true }); });
  await store.startWatching(); const scans = store.metrics.scans;
  async function until(check) { const deadline = Date.now() + 4000; while (!check()) { assert.ok(Date.now() < deadline, 'watcher timeout: ' + JSON.stringify({metrics:store.metrics,paths:store.query({}).documents.map(doc=>doc.path),edges:store.graph({}).edges,errors:[...store.errors]})); await new Promise(resolve => setTimeout(resolve, 25)); } }
  writeFileSync(join(root, 'train.py'), 'print(1)');
  await until(() => store.graph({}).edges.length === 1);
  renameSync(join(root, 'train.py'), join(root, 'renamed.py'));
  await until(() => store.graph({}).edges.length === 0 && store.query({ q: 'renamed.py' }).total === 1);
  unlinkSync(join(root, 'renamed.py'));
  await until(() => store.query({}).total === 1);
  assert.equal(store.metrics.scans, scans);
  assert.equal(store.metrics.fileReads, 1);
});

test('relative Markdown links resolve from their source without escaping the workspace', async t => {
  const root = mkdtempSync(join(tmpdir(),'notara-relative-'));
  mkdirSync(join(root,'notes'));
  for (const path of ['train.py','notes/train.py','Makefile']) writeFileSync(join(root,path),'code');
  writeFileSync(join(root,'note.md'),'[代码](./train.py)\n[[Makefile]]');
  writeFileSync(join(root,'notes/note.md'),'[上层代码](../train.py)\n[本层代码](./train.py)\n[越界](../../private.py)\n$\\text{[[train.py]]}$');
  const store=createVaultStore({root}); t.after(async()=>{await store.close();rmSync(root,{recursive:true,force:true});});
  assert.deepEqual(store.graph({}).edges.map(edge=>[edge.source,edge.target]).sort(), [['note.md','Makefile'],['note.md','train.py'],['notes/note.md','train.py'],['notes/note.md','notes/train.py']].sort());
});

test('metadata revisions notice same-size replacements with preserved mtime without reading contents', async t => {
  const root=mkdtempSync(join(tmpdir(),'notara-revision-')), path=join(root,'state.bin'), time=new Date('2026-01-01');
  writeFileSync(path,'aaaa');utimesSync(path,time,time);
  const store=createVaultStore({root});t.after(async()=>{await store.close();rmSync(root,{recursive:true,force:true});});
  const before=store.query({paths:['state.bin']}).documents[0].revision;
  writeFileSync(join(root,'.replacement'),'bbbb');utimesSync(join(root,'.replacement'),time,time);renameSync(join(root,'.replacement'),path);
  assert.equal(store.update('state.bin'),true);
  assert.notEqual(store.query({paths:['state.bin']}).documents[0].revision,before);
  assert.equal(store.metrics.fileReads,0);
});

test('the three approved card types retain review eligibility alongside ordinary file nodes and legacy cards', async t => {
  const root=mkdtempSync(join(tmpdir(),'notara-card-types-'));
  for(const type of ['card','concept','method','exercise']) writeFileSync(join(root,type+'.md'),`---\ntype: ${type}\nlearned: true\nmastery: 1\ninterval: 1\nlast_review: 2026-10-23\nnext_review: 2026-10-24\n---\n# ${type}\n[[train.py]]\n`);
  writeFileSync(join(root,'train.py'),'print(1)');writeFileSync(join(root,'资料库.base'),JSON.stringify(defaultLibraryBase()));
  const store=createVaultStore({root,now:()=>new Date('2026-10-24T12:00:00+08:00')});t.after(async()=>{await store.close();rmSync(root,{recursive:true,force:true});});
  assert.equal(store.query({type:'card'}).total,4);
  assert.equal(store.query({view:'review',reviewStatus:'due'}).total,4);
  assert.equal(store.query({base:{path:'资料库.base',view:2}}).total,4);
  assert.equal(store.homeRecommendations().due.total,4);
  for(const type of ['concept','method','exercise']) {
    const path=type+'.md';assert.equal(store.query({type}).total,1);
    store.recordReview({path,result:'done',support:'independent',keyStep:'真实关键步',note:'隔离回归'});
    assert.equal(store.query({type}).documents[0].independentReviewCount,1);
    store.undoReview({path});assert.equal(store.query({type}).documents[0].type,type);
    assert.equal(store.query({type}).documents[0].independentReviewCount,0);
  }
  const code=store.graph({}).nodes.find(node=>node.path==='train.py');assert.equal(code.type,'file');assert.equal(code.reviewDue,null);
  assert.equal(store.graph({}).edges.length,4);
});

test('an old cached concept card gets its real review schedule rebuilt once', async t => {
  const root=mkdtempSync(join(tmpdir(),'notara-type-cache-')),cachePath=join(root,'cache.sqlite'),now=()=>new Date('2026-10-24T12:00:00+08:00');
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  writeFileSync(join(root,'concept.md'),'---\ntype: concept\nlearned: true\nmastery: 1\ninterval: 1\nlast_review: 2026-10-23\nnext_review: 2026-10-24\n---\n概念\n');
  const first=createVaultStore({root,cachePath,now});await first.close();
  const db=new DatabaseSync(cachePath);db.exec('UPDATE cache_meta SET projection_version=5; UPDATE documents SET review_due=NULL');db.close();
  const rebuilt=createVaultStore({root,cachePath,now});assert.equal(rebuilt.query({reviewStatus:'due'}).total,1);assert.equal(rebuilt.metrics.fileReads,1);await rebuilt.close();
  const warm=createVaultStore({root,cachePath,now});assert.equal(warm.query({reviewStatus:'due'}).total,1);assert.equal(warm.metrics.fileReads,0);await warm.close();
});
