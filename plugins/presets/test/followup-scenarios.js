import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {parseMarkdown} from '../../vault-sqlite/frontmatter.js';

export function registerFollowUpTests({harness,mountSummaryVault}){
 test('native learning followup binds workspace and role, preserves facts, rejects stale plans and replays a lost receipt',async t=>{
  const h=await harness(t,{withController:true});
  await mkdir(join(h.root,'日记'),{recursive:true});const path='日记/当前.md';
  await writeFile(join(h.root,path),'---\ntype: diary\n---\n## 编程讨论\n老师提醒循环起点，学生修正后自己验证空输入。\n');
  await mountSummaryVault(h);const signal=new AbortController().signal;
  const home=await h.create('notara-coordinator'),teacher=await h.create('notara-teacher');
  const invoke=(agent,args,callId='request')=>h.ctx.tools.execute({name:'learning_followup',arguments:args,callId,agent,signal});
  const value=r=>{assert.equal(r.isError,false,JSON.stringify(r));return JSON.parse(r.value.result);};
  const before=value(await invoke(teacher,{action:'read',path}));
  const plan={action:'plan',path,heading:'编程讨论',expectedRevision:before.revision,afterDays:4,question:'换成只有一个元素的列表，边界有什么不同？',reason:'已经修正起点，隔几天再比较边界'};
  const saved=value(await invoke(teacher,plan));assert.equal(saved.plans[0].intervalDays,4);assert.equal(saved.plans[0].question,plan.question);
  assert.deepEqual(value(await invoke(teacher,plan)),saved);
  assert.equal((await invoke(home,plan,'stale')).isError,true);
  assert.equal((await invoke(teacher,{...plan,result:'done'},'mixed')).isError,true);
  const workspace=await h.ctx.workspaceRegistry.resolveByPath(h.root),doc=await h.ctx.notaraVault.read({workspaceId:workspace.id,path});
  const history=parseMarkdown(doc.content).fields.review_history;assert.equal(history.length,1);assert.equal(history[0].kind,'continuation');assert.equal(history[0].result,undefined);
  assert.match(doc.content,/老师提醒循环起点，学生修正后自己验证空输入/);
  const current=value(await invoke(home,{action:'read',path}));
  const cleared=value(await invoke(home,{action:'clear',path,heading:'编程讨论',expectedRevision:current.revision},'clear'));assert.deepEqual(cleared.plans,[]);
  for(const preset of ['worker-general','companion-claude','notara-material-organizer']){const agent=await h.create(preset);assert.equal(h.ctx.tools.get('learning_followup',agent),undefined);}
  await h.ctx.agentPresets.select(teacher,'companion-claude');assert.equal((await invoke(teacher,{action:'read',path})).isError,true);
 });
}
