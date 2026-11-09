import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createVaultStore} from '../vault-indexer.js';
import {parseReference,referenceFragment,referenceMarkdown,sourceText,sourceStatus} from '../file-reference.js';
import {markdownFacts} from '../markdown-projection.js';
import {DatabaseSync} from 'node:sqlite';

test('versioned PDF and text locators round trip and reject ambiguous coordinates',()=>{
  for(const ref of [{path:'来源/a.pdf',page:2,rect:[.1,.2,.3,.4],revision:'abc123'}, {path:'笔记.md',range:[3,19],revision:'abc123'}]){
    const parsed=parseReference(`![[${ref.path}${referenceFragment(ref)}]]`);
    for(const [key,value] of Object.entries(ref))assert.deepEqual(parsed?.[key],value);
  }
  for(const token of ['[[a.md#text=5,2&revision=x]]','[[a.md#text=0,2&text=4,8]]','[[a.pdf#page=2&revision=x&revision=y]]'])assert.equal(parseReference(token),null);
});

test('encoded Markdown links preserve special filenames and regions; text offsets use LF UTF16 and enforce byte revision',()=>{
  const ref={path:'来源/中文 %23+&.md',range:[3,8],revision:'r1',label:'原文'};
  const links=markdownFacts(referenceMarkdown(ref)).links;assert.equal(links.length,1);assert.equal(links[0].target,ref.path);assert.deepEqual(links[0].reference.range,ref.range);assert.equal(links[0].reference.revision,'r1');
  const hashPath='来源/中文 #号.md';assert.equal(markdownFacts(referenceMarkdown({...ref,path:hashPath})).links[0].target,hashPath);
  assert.equal(markdownFacts('[来源](来源/中文%20%23号.md)').links[0].target,hashPath);
  assert.equal(markdownFacts('[来源](来源/中文%20%23号.md#text=0,2&revision=r1)').links[0].reference.path,hashPath);
  const content='---\r\ntitle: 测试\r\n---\r\n甲😀乙\r\n下一段';const from=content.replace(/\r\n/g,'\n').indexOf('乙');
  assert.equal(sourceText({content,revision:'r1'},{range:[from,from+1],revision:'r1'}),'乙');
  assert.throws(()=>sourceText({content,revision:'r2'},{range:[from,from+1],revision:'r1'}),/来源已更新/);
  assert.equal(sourceStatus({revision:'r2'},{}),'unverified');
});

test('region backlinks survive cache rebuild, distinguish regions and remove corrected or deleted references',async()=>{
  const root=mkdtempSync(join(tmpdir(),'source-regions-')),cache=join(root,'index.sqlite');let store;
  try{
    mkdirSync(join(root,'卡片'));writeFileSync(join(root,'讲义.pdf'),'%PDF-1.4');writeFileSync(join(root,'笔记.md'),'第一段\n第二段');
    const card='卡片/甲.md';writeFileSync(join(root,card),'# 甲\n\n![[讲义.pdf#page=1&rect=0,0,0.5,0.5&revision=old]]\n\n![[讲义.pdf#page=2&rect=0,0,1,1&revision=old]]\n\n```md\n![[讲义.pdf#page=9&rect=0,0,1,1]]\n```');
    store=createVaultStore({root,cachePath:cache});
    let refs=store.query({referencesTo:'讲义.pdf'}).references;assert.equal(refs.length,2);assert.deepEqual(refs.map(r=>r.reference.page),[1,2]);assert.ok(refs.every(r=>r.path===card&&r.reference.revision==='old'));assert.ok(store.graph({}).edges.some(e=>e.source===card&&e.target==='讲义.pdf'));
    await store.close();store=null;rmSync(cache);store=createVaultStore({root,cachePath:cache});assert.equal(store.query({referencesTo:'讲义.pdf'}).references.length,2,'deleting the cache reconstructs regions from Markdown');
    await store.close();store=null;const old=new DatabaseSync(cache);old.exec('DELETE FROM source_regions; UPDATE cache_meta SET projection_version=8');old.close();store=createVaultStore({root,cachePath:cache});assert.equal(store.query({referencesTo:'讲义.pdf'}).references.length,2,'v8 cache upgrade reparses unchanged Markdown');
    const first=store.query({referencesTo:'讲义.pdf',limit:1});const second=store.query({referencesTo:'讲义.pdf',limit:1,offset:1});assert.equal(first.total,2);assert.notDeepEqual(first.references,second.references);
    store.save({path:card,expectedRevision:store.read({path:card}).revision,content:'# 甲\n![[笔记.md#text=0,3&revision=text-v1]]'});
    assert.equal(store.query({referencesTo:'讲义.pdf'}).references.length,0);assert.deepEqual(store.query({referencesTo:'笔记.md'}).references[0].reference.range,[0,3]);
    unlinkSync(join(root,card));store.scan();assert.equal(store.query({referencesTo:'笔记.md'}).references.length,0);
    assert.throws(()=>store.query({referencesTo:'../private.pdf'}));
  }finally{await store?.close();rmSync(root,{recursive:true,force:true});}
});
