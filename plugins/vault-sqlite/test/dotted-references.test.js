import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {parseReference,resolveReferencePath} from '../file-reference.js';
import {createRelationResolver} from '../knowledge-relations.js';
import {createVaultStore} from '../vault-indexer.js';
import {extractLineLinks,routeContextReferences} from '../route-projection.js';

test('decimal and chapter dots are note names, while actual attachment extensions stay intact',()=>{
 for(const target of ['卡片/第01章-1.1-例01-性质','卡片/例06-ln1.1','计算0.02']){
  const ref=parseReference(`[[${target}#解法|原题]]`,{paths:new Set([target+'.md'])});
  assert.equal(ref.path,target+'.md');assert.equal(ref.subpath,'#解法');assert.equal(ref.label,'原题');
 }
 for(const target of ['来源/讲义.1.PDF','图.1.png','实验.py','数据.csv','说明.customext'])assert.equal(parseReference(`[[${target}]]`).path,target);
 for(const target of ['model.123','data.xyz'])assert.equal(resolveReferencePath(target,new Set([target,target+'.md'])),target);
 assert.equal(parseReference('[[../不能越界1.1]]'),null);
});

test('dotted ordinary links and knowledge declarations resolve without becoming each other',async t=>{
 const root=mkdtempSync(join(tmpdir(),'notara-dot-links-'));let store;t.after(async()=>{await store?.close();rmSync(root,{recursive:true,force:true});});
 const docs={
  '卡片/第01章-1.1-例01-性质.md':'---\ntype: exercise\n---\n原题',
  '卡片/例06-ln1.1.md':'---\ntype: exercise\n---\n原题',
  '知识/ln1.1.md':'---\ntype: concept\n---\n基本对象',
  '方法.md':'---\ntype: method\n---\n## 前序依赖\n- [[知识/ln1.1]]：先理解定义。',
  '练习.md':'---\ntype: exercise\ntags: ["[[知识/ln1.1]]"]\n---\n题目',
  '导读.md':'---\ntype: guide\n---\n[[卡片/第01章-1.1-例01-性质]]\n[[卡片/例06-ln1.1|原题]]\n[[附件.xyz]]',
  '附件.xyz':'not a note',
 };
 for(const [path,text]of Object.entries(docs)){mkdirSync(join(root,path,'..'),{recursive:true});writeFileSync(join(root,path),text);}
 store=createVaultStore({root});const graph=store.graph();
 for(const target of ['卡片/第01章-1.1-例01-性质.md','卡片/例06-ln1.1.md','附件.xyz'])assert.ok(graph.edges.some(e=>e.kind==='reference'&&[e.source,e.target].includes('导读.md')&&[e.source,e.target].includes(target)),target);
 assert.ok(graph.edges.some(e=>e.kind==='prerequisite'&&e.source==='知识/ln1.1.md'&&e.target==='方法.md'));
 assert.ok(graph.edges.some(e=>e.kind==='example'&&e.source==='知识/ln1.1.md'&&e.target==='练习.md'));
 assert.equal(graph.edges.filter(e=>e.kind==='example').length,1);
});

test('numeric note names keep explicit-path and ambiguous-short-name boundaries',()=>{
 const resolver=createRelationResolver(['甲/ln1.1.md','乙/ln1.1.md','根1.1.md','别处/缺失1.1.md'].map(path=>({path,type:'concept'})));
 assert.equal(resolver.resolvePath('甲/ln1.1').target,'甲/ln1.1.md');
 assert.equal(resolver.resolvePath('ln1.1').reason,'ambiguous');
 assert.equal(resolver.resolvePath('根1.1.md').target,'根1.1.md');
 assert.equal(resolver.resolvePath('缺失1.1.md').reason,'missing');
 assert.equal(resolver.resolvePath('错误/ln1.1').reason,'missing');
});

test('route links resolve decimal names against their catalog, retaining relative paths and literal files',()=>{
 const paths=new Map([['课堂/备课1.1.md',{type:'lesson'}],['课堂/model.123',{type:'file'}],['课堂/model.123.md',{type:'lesson'}]]);
 assert.deepEqual(extractLineLinks('[[课堂/备课1.1]] [备课](./备课1.1) [附件](./model.123)','课堂/路线.md',paths).references.map(r=>r.path),['课堂/备课1.1.md','课堂/model.123']);
 assert.deepEqual([...routeContextReferences('[[课堂/备课1.1]]',{path:'路线.md',documentsByPath:paths}).lessons],['课堂/备课1.1.md']);
 assert.equal(extractLineLinks('[越界](../../备课1.1)','路线.md',paths).references.length,0);
});

test('cached numeric text-region references resolve without deleting the existing cache',async t=>{
 const root=mkdtempSync(join(tmpdir(),'notara-dot-cache-')),cache=join(root,'cache.sqlite');let store;t.after(async()=>{await store?.close();rmSync(root,{recursive:true,force:true});});
 writeFileSync(join(root,'ln1.1.md'),'定义');writeFileSync(join(root,'摘录.md'),'![[ln1.1#text=0,2&revision=old]]');
 store=createVaultStore({root,cachePath:cache});await store.close();store=null;
 const db=new DatabaseSync(cache);db.exec("DELETE FROM source_regions;");db.prepare('INSERT INTO source_regions VALUES(?,?,?)').run('摘录.md','ln1.1',JSON.stringify({path:'ln1.1',range:[0,2],revision:'old',label:'ln1.1'}));db.close();
 store=createVaultStore({root,cachePath:cache});const refs=store.query({referencesTo:'ln1.1.md'}).references;assert.equal(refs.length,1);assert.equal(refs[0].reference.path,'ln1.1.md');assert.deepEqual(refs[0].reference.range,[0,2]);
});
