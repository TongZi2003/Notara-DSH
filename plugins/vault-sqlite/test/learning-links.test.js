import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {markdownFacts} from '../markdown-projection.js';
import {createVaultStore} from '../vault-indexer.js';

const card=body=>'---\ntype: concept\n---\n'+body;
test('only current explicit primary links become established, including aided understanding',()=>{
  const text='## 学生理解\n还没弄清 [[A]]。\n\n### 已建立的联系\n- [[B]]：经老师提示后，学生用投影解释了数量积，来源 [[日记/今天]]。\n\n<details><summary>演进记录</summary>\n\n### 已建立的联系\n- [[OLD]]：旧说法。\n\n</details>\n\n> - [[QUOTE]]：引用他人的说明。\n\n- [[C]]\n\n### 下次探讨\n- [[NEXT]]：尚未探索。';
  const facts=markdownFacts(text);
  assert.deepEqual(facts.links.filter(link=>link.style==='solid').map(link=>link.target),['B']);
  assert.ok(facts.links.some(link=>link.target==='日记/今天'&&link.style==='dashed'));
  const pending=markdownFacts('## 学生理解\n### 待探索的联系\n- [[B]]：之前照抄了总结，现在还不能解释。').links[0];
  assert.equal(pending.section,'学生理解/待探索的联系');assert.equal(pending.style,'dashed');
  const nested='## 学生理解\n### 待探索的联系\n\n- 格式示例：\n  ### 已建立的联系\n- [[B]]：仍然是待探索的说法。';
  assert.equal(markdownFacts(nested).links.some(link=>link.style==='solid'),false);
  assert.equal(markdownFacts('## 学生理解\n#### 已建立的联系\n- [[B]]：不是合同中的三级小节。').links.some(link=>link.style==='solid'),false);
});
test('knowledge-only edges, reciprocal retraction, source membership and cache copying',async t=>{
  const root=mkdtempSync(join(tmpdir(),'notara-links-'));
  mkdirSync(join(root,'来源'));mkdirSync(join(root,'卡片'));mkdirSync(join(root,'日记'));
  const files={
    '来源/讲义.md':'---\ntype: source\n---\n# 讲义',
    '来源/第二份.md':'---\ntype: source\n---\n# 第二份',
    '00-导读.md':'---\ntype: source\n---\n# 导读',
    '日记/今天.md':'# 今天',
    '卡片/A.md':card('## 内容\n[[来源/讲义.md]] 与 [[来源/第二份.md]]\n## 学生理解\n### 已建立的联系\n- [[B]]：经提示理解二者的关系。\n- [[来源/讲义.md]]：原始资料的引用不能成为理解实线。\n- [[日记/今天.md]]：记录出处。'),
    '卡片/B.md':card('## 内容\n[[来源/讲义.md]]\n## 学生理解\n### 已建立的联系\n- [[A]]：另一端的旧联系。'),
    '卡片/无来源.md':card('## 内容\n独立笔记。'),
  };
  for(const [path,content]of Object.entries(files))writeFileSync(join(root,path),content);
  const store=createVaultStore({root});t.after(async()=>{await store.close();rmSync(root,{recursive:true,force:true});});
  let graph=store.graph();
  assert.equal(graph.nodes.find(n=>n.path==='00-导读.md').isSource,false);
  assert.equal(graph.nodes.find(n=>n.path==='来源/讲义.md').isSource,true);
  assert.deepEqual(graph.nodes.find(n=>n.path==='卡片/A.md').sourcePaths.sort(),['来源/第二份.md','来源/讲义.md'].sort());
  assert.equal(graph.edges.filter(edge=>edge.style==='solid').length,1);
  assert.ok(graph.edges.filter(edge=>edge.style==='solid').every(edge=>edge.knowledge===true));
  assert.ok(graph.edges.filter(edge=>[edge.source,edge.target].some(path=>path==='来源/讲义.md'||path==='日记/今天.md')).every(edge=>edge.knowledge===false));
  graph.nodes.find(n=>n.path==='卡片/A.md').sourcePaths.push('FAKE.md');
  assert.equal(store.graph().nodes.find(n=>n.path==='卡片/A.md').sourcePaths.includes('FAKE.md'),false);
  const old=store.read({path:'卡片/A.md'});
  store.save({path:'卡片/A.md',expectedRevision:old.revision,content:files['卡片/A.md'].replace('### 已建立的联系','### 待探索的联系')});
  graph=store.graph();
  assert.equal(graph.edges.filter(edge=>edge.style==='solid').length,0,'one current retraction must override the other end’s old assertion');
  assert.deepEqual(graph.nodes.find(n=>n.path==='卡片/无来源.md').sourcePaths,[]);
});
test('graph role metadata excludes legacy card-typed guides, diaries and templates',async t=>{
  const root=mkdtempSync(join(tmpdir(),'notara-edge-role-'));mkdirSync(join(root,'日记'));mkdirSync(join(root,'模板'));
  const files={'A.md':card('# 概念 A'),'B.md':card('## 学生理解\n### 已建立的联系\n- [[A]]：能解释二者。'),'导读.md':card('## 参考理解\n[[A]]'),'日记/今天.md':card('## 参考理解\n[[A]]'),'模板/卡片.md':card('## 参考理解\n[[A]]')};
  for(const [path,content] of Object.entries(files))writeFileSync(join(root,path),content);
  const store=createVaultStore({root});t.after(async()=>{await store.close();rmSync(root,{recursive:true,force:true});});
  const graph=store.graph();assert.equal(graph.edges.length,4);
  assert.equal(graph.edges.find(edge=>edge.source==='B.md'||edge.target==='B.md').knowledge,true);
  for(const path of ['导读.md','日记/今天.md','模板/卡片.md'])assert.equal(graph.edges.find(edge=>edge.source===path||edge.target===path).knowledge,false);
});
