import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createVaultStore} from '../vault-indexer.js';

const route=(body,extra='')=>`---\ntype: route\nstatus: active\n${extra}---\n# 路线\n${body}`;
function fixture(t, files) {
  const root=mkdtempSync(join(tmpdir(),'notara-route-context-'));
  for(const [path,content] of Object.entries(files)) { mkdirSync(join(root,path,'..'),{recursive:true});writeFileSync(join(root,path),content); }
  const store=createVaultStore({root,cachePath:':memory:'});store.scan();
  t.after(async()=>{await store.close();rmSync(root,{recursive:true,force:true});});
  return {root,store};
}
test('learning context selects its actual classroom route, not a newer unrelated route',t=>{
  const {root,store}=fixture(t,{
    '数学.md':route('- [ ] 本课\n  - 关联课堂：[[session:math-class|数学课堂]]\n'),
    '化学.md':route('- [ ] 化学课\n'),
  });
  utimesSync(join(root,'数学.md'),new Date('2020-01-01'),new Date('2020-01-01'));store.scan();
  assert.equal(store.homeRecommendations().route.path,'化学.md','existing homepage callers retain their contract');
  const result=store.homeRecommendations({routeContext:{sessionId:'math-class'}});
  assert.equal(result.route.path,'数学.md');
  assert.equal(result.routeSelection,'associated');
});
test('current lesson association and explicit handoff route select independently of mtime',t=>{
  const {store}=fixture(t,{
    '数学.md':route('- [ ] 数学\n','lessons: ["备课/本课.md"]\n'),
    '化学.md':route('- [ ] 化学\n'),
    '备课/本课.md':'---\ntype: lesson\n---\n- [ ] 讨论\n',
  });
  const bindings=[{sessionId:'class',path:'备课/本课.md',counts:{total:1,completed:0}}];
  assert.equal(store.homeRecommendations({bindings,routeContext:{sessionId:'class'}}).route.path,'数学.md');
  assert.equal(store.homeRecommendations({routeContext:{sessionId:'other',path:'化学.md'}}).route.path,'化学.md');
});
test('ambiguous, hidden and unrelated route references do not silently bind a classroom',t=>{
  const {store}=fixture(t,{
    '数学.md':route('```md\n[[session:class|示例]]\n```\n<details><summary>旧记录</summary>\n\n[[session:class|旧课]]\n</details>\n'),
    '化学.md':route('- [ ] 化学\n'),
  });
  const result=store.homeRecommendations({routeContext:{sessionId:'class'}});
  assert.equal(result.route,null);
  assert.equal(result.routeSelection,'ambiguous');
  assert.deepEqual(result.routeCandidates.map(x=>x.path).sort(),['化学.md','数学.md']);
});
test('missing or inactive explicit route never falls back to another active route',t=>{
  const {store}=fixture(t,{'数学.md':route('- [ ] 数学\n'),'旧.md':route('- [ ] 旧\n').replace('status: active','status: archived')});
  for(const path of ['不存在.md','旧.md']){
    const result=store.homeRecommendations({routeContext:{sessionId:'class',path}});
    assert.equal(result.route,null);assert.equal(result.routeSelection,'unavailable');
  }
  assert.equal(store.homeRecommendations({routeContext:{sessionId:'class'}}).route.path,'数学.md','one active route remains usable');
});

test('inline code examples are not route associations, including multiline and longer backticks',t=>{
  const {store}=fixture(t,{
    '数学.md':route('示例：`[[session:class|课堂]]`\n``示例含 ` 与\n[[session:class|课堂]]``\n`[课堂](session:class)`\n`[[备课/本课]]`\n真实链接：[[session:real|本课]]'),
    '化学.md':route('- [ ] 化学'),
    '备课/本课.md':'---\ntype: lesson\n---\n# 本课',
  });
  const result=store.homeRecommendations({bindings:[{sessionId:'class',path:'备课/本课.md'}],routeContext:{sessionId:'class'}});
  assert.equal(result.route,null);assert.equal(result.routeSelection,'ambiguous');
  assert.equal(store.homeRecommendations({routeContext:{sessionId:'real'}}).route.path,'数学.md');
});

test('native remote forwards the exact session route context without changing other callers',async t=>{
  const {NotaraVaultRemote}=await import('../index.js');
  const {root,store}=fixture(t,{'数学.md':route('[[session:class|本课]]'),'化学.md':route('- [ ] 化学')});
  const remote={ctx:{get:()=>null},forWorkspace:()=>({root,store,ready:Promise.resolve()}),lessons:{lessonBindings:async()=>({bindings:[]})},registry:()=>({get:()=>({path:root,sessionIds:['class']})})};
  const result=await NotaraVaultRemote.prototype.homeRecommendations.call(remote,{workspaceId:'ws',routeContext:{sessionId:'class'}});
  assert.equal(result.route.path,'数学.md');assert.equal(result.routeSelection,'associated');
});
