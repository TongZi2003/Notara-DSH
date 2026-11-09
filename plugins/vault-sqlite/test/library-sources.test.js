import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVaultStore } from '../vault-indexer.js';
import { defaultLibraryBase, serializeBase } from '../bases.js';

test('library sources reuse graph provenance, intersect filters before paging, and refresh membership', async t => {
  const root=mkdtempSync(join(tmpdir(),'notara-library-sources-')), store=createVaultStore({root});
  t.after(async()=>{await store.close();rmSync(root,{recursive:true,force:true});});
  const files={
    '书.md':'---\ntype: source\ntags: [数学]\n---\n# 书',
    '笔记.md':'# 学校笔记',
    '空讲义.md':'---\ntype: source\n---\n# 空讲义',
    '导读.md':'---\ntype: guide\n---\n[[书.md]]',
    '日记/今天.md':'## 来源\n[[书.md]]',
    '卡片/甲.md':'---\ntype: concept\ntags: [数学]\n---\n# 甲\n## 来源\n[[书.md]]\n[[书.md]]\n[[笔记.md]]',
    '卡片/乙.md':'---\ntype: exercise\ntags: [练习]\n---\n# 乙\n## 来源\n[[书.md]]',
    '卡片/丙.md':'---\ntype: concept\n---\n# 丙\n## 参考理解\n[[书.md]]',
  };
  for(const [path,content] of Object.entries(files))store.save({path,content,expectedRevision:null});
  const sources=store.query({view:'sources'});
  assert.deepEqual(sources.documents.map(d=>d.path).sort(),store.graph().nodes.filter(n=>n.isSource).map(n=>n.path).sort());
  assert.equal(sources.total,3);
  assert.deepEqual(store.query({view:'sources',sort:'title',sortDirection:'DESC',limit:1,offset:1}).documents.map(d=>d.path),sources.documents.toReversed().slice(1,2).map(d=>d.path));
  assert.throws(()=>store.query({view:'sources',sortDirection:'DROP'}));
  assert.equal(store.query({view:'sources',tags:['数学']}).total,1);
  const cards=store.query({sourcePath:'书.md',limit:1,offset:1});
  assert.equal(cards.total,2);assert.equal(cards.documents.length,1);
  assert.equal(store.query({sourcePath:'书.md',type:'concept'}).documents[0].path,'卡片/甲.md');
  assert.equal(store.query({sourcePath:'书.md',tags:['练习']}).total,1);
  assert.equal(store.query({sourcePath:'笔记.md'}).total,1);
  assert.equal(store.query({sourcePath:'空讲义.md'}).total,0);
  assert.equal(store.query({sourcePath:'不存在.md'}).total,0);
  assert.deepEqual(store.query({sourcePath:'书.md',type:'concept'}).documents[0].properties['note.tags'],['数学']);
  assert.throws(()=>store.query({sourcePath:'../书.md'}));
  const config=defaultLibraryBase();config.views[0].notara.sourcePath='书.md';
  store.save({path:'资料库.base',content:serializeBase(config),expectedRevision:null});
  assert.equal(store.query({base:{path:'资料库.base',view:0}}).total,2);
  assert.equal(store.query({base:{path:'资料库.base',view:0},sourcePath:'笔记.md'}).total,1);
  config.views.push({name:'原文清单',type:'table',notara:{scope:'sources'},order:['file.name','note.tags']});
  const baseRecord=store.read({path:'资料库.base'});
  store.save({path:'资料库.base',content:serializeBase(config),expectedRevision:baseRecord.revision});
  assert.equal(store.query({base:{path:'资料库.base',view:3}}).total,3);
  assert.equal(store.query({base:{path:'资料库.base',view:3},tags:['数学']}).total,1);
  assert.equal(store.query({base:{path:'资料库.base',view:3},sourcePath:'书.md'}).total,2);
  const current=store.read({path:'卡片/甲.md'});
  store.save({...current,content:files[current.path].replace('## 来源','## 参考理解'),expectedRevision:current.revision});
  assert.equal(store.query({sourcePath:'书.md'}).total,1);
  assert.equal(store.query({view:'sources'}).total,2);
});
