import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export function registerPromptCleanupTests({harness}){
 test('interactive peer can still send an optional result through native adjacent-session authorization',async t=>{
  let teacherId,sent=false;
  const {ctx,create}=await harness(t,{respond:function*(request){
   if(request.sessionId!==teacherId&&!sent){sent=true;const args=JSON.stringify({agent_id:teacherId,message:'学生希望把这个结论带回老师。'});yield {type:'block-start',index:0,blockType:'tool-call'};yield {type:'tool-call-delta',index:0,id:'peer-report',name:'send_message',argumentsDelta:args};yield {type:'block-end',index:0,block:{type:'tool-call',id:'peer-report',name:'send_message',arguments:args}};yield {type:'finish',reason:{kind:'tool-calls'}};}
   else{yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text:'我们接着讨论。'};yield {type:'block-end',index:0,block:{type:'text',text:'我们接着讨论。'}};yield {type:'finish',reason:{kind:'stop'}};}
  }});
  const teacher=await create('notara-teacher');teacherId=teacher.id;
  const result=await ctx.tools.execute({name:'subagent',callId:'peer-invite',arguments:{preset:'companion-claude',description:'学生邀请的讨论',prompt:'学生希望与你讨论，并把结论带回老师。'},agent:teacher,signal:new AbortController().signal});assert.equal(result.isError,false,JSON.stringify(result));
  await ctx.subagents.waitForChildren(teacher);await teacher.whenIdle();
  assert.ok(teacher.session.snapshotEvents().some(e=>e.type==='user/message'&&e.data.source?.kind==='agent-message'&&e.data.source.senderSessionId===result.value.id));
  const child=await ctx.sessionQuery.readSession(result.value.id);assert.ok(child.events.some(e=>e.type==='tool/result'&&e.data.message?.toolCallId==='peer-report'&&!e.data.message.isError));
 });
 for(const preset of ['notara-coordinator','worker-problem','worker-review','worker-exercise','worker-general','worker-lesson'])test(`native Bash Jobs finish and stay owner-scoped for ${preset}`,async t=>{
  const {ctx,create}=await harness(t,{withBash:true}),owner=await create(preset),other=await create('notara-teacher'),signal=new AbortController().signal;
  const call=(agent,name,args={})=>ctx.tools.execute({callId:randomUUID(),name,arguments:args,agent,signal});
  const started=await call(owner,'bash',{description:'Isolated Jobs output',command:"printf 'jobs-ok:42\\n'; printf 'jobs-err\\n' >&2",run_in_background:true});
  assert.equal(started.isError,false,JSON.stringify(started));assert.equal(started.value.kind,'background');const job_id=started.value.jobId;
  const foreignList=await call(other,'job_list');assert.equal(foreignList.isError,false);assert.ok(!foreignList.value.some(job=>job.id===job_id));
  for(const [name,args]of [['job_output',{job_id}],['job_kill',{job_id,reason:'foreign-session probe'}]]){
   const denied=await call(other,name,args);assert.equal(denied.isError,true);assert.match(JSON.stringify(denied),/belongs to another session/);
  }
  const output=await call(owner,'job_output',{job_id,wait:true,timeout_ms:5000});assert.equal(output.isError,false,JSON.stringify(output));assert.equal(output.value.job.status,'completed');assert.equal(output.value.job.detail,'exit code: 0');assert.match(output.value.text,/jobs-ok:42/);assert.match(output.value.text,/\[stderr\]\njobs-err/);
  assert.equal((await call(owner,'job_output',{job_id})).value.text,'');assert.equal((await call(owner,'job_kill',{job_id})).value.outcome,'already-finished');
 });
 test('native child teacher advertises only delegation targets that it can start',async t=>{
  const {ctx,create}=await harness(t),teacher=await create('notara-teacher'),signal=new AbortController().signal;
  const targets=agent=>ctx.tools.schemas(agent).find(tool=>tool.name==='subagent').parameters.properties.preset.enum;
  assert.ok(targets(teacher).includes('notara-material-organizer'));
  const created=await ctx.tools.execute({callId:'child-teacher',name:'subagent',arguments:{preset:'notara-teacher',description:'局部问题',prompt:'请解释这一步。'},agent:teacher,signal});assert.equal(created.isError,false,JSON.stringify(created));
  const child=ctx.agents.get(created.value.id);assert.ok(!targets(child).includes('notara-material-organizer'));assert.ok(targets(child).includes('worker-review'));
  const invalid=await ctx.tools.execute({callId:'child-organizer',name:'subagent',arguments:{preset:'notara-material-organizer',description:'整理材料',prompt:'整理这批资料。'},agent:child,signal});assert.equal(invalid.isError,true);
  await ctx.subagents.waitForChildren(teacher);
 });
}
