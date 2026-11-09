import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createUserMessage} from '@deepseek-ai/dsh-llm';

export function registerWhiteboardTests({harness}){
 test('native whiteboard activation loads teaching Skill, appends context once and preserves full learner state',{timeout:60000},async t=>{
  let command;
  const h=await harness(t,{withController:true,respond:function*(request){
   if(command){const args=command;command=null;yield {type:'block-start',index:0,blockType:'tool-call'};yield {type:'tool-call-delta',index:0,id:'board-write',name:'canvas',argumentsDelta:JSON.stringify(args)};yield {type:'block-end',index:0,block:{type:'tool-call',id:'board-write',name:'canvas',arguments:JSON.stringify(args)}};yield {type:'finish',reason:{kind:'tool-calls'}};}
   else{yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text:'我们接着看这个问题。'};yield {type:'block-end',index:0,block:{type:'text',text:'我们接着看这个问题。'}};yield {type:'finish',reason:{kind:'stop'}};}
  }});
  const fiber=await h.ctx.plugin(await import('../../vault-sqlite/index.js'),{root:h.root,cachePath:':memory:'});await fiber.await();
  const profile='---\ntype: learner-profile\n---\n# 当前学情\n'+('保留完整背景。\n'.repeat(1600))+'偏好：请让我先试。\n';await writeFile(join(h.root,'画像.md'),profile);
  const ws=await h.ctx.workspaceRegistry.resolveByPath(h.root),signal=new AbortController().signal;
  await h.ctx.notaraVault.read({workspaceId:ws.id,path:'画像.md'});
  const say=async(agent,text)=>{agent.followup(createUserMessage({content:[{type:'text',text}],source:{kind:'user'}}));await agent.whenIdle();};
  const updates=agent=>agent.session.snapshotEvents().filter(e=>e.type==='user/message'&&e.data.source?.kind==='notara-context-update');
  for(const preset of ['notara-teacher','notara-coordinator']){
   const agent=await h.create(preset),input={workspaceId:ws.id,sessionId:agent.id};
   const loaded=await h.ctx.tools.execute({name:'skill',callId:randomUUID(),arguments:{name:'notara-whiteboard'},agent,signal});assert.equal(loaded.isError,false);assert.equal((await h.ctx.notaraVault.whiteboard(input)).bound,false,'reading Skill alone creates nothing');
   const state=await h.ctx.notaraVault.setWhiteboard({...input,enabled:true});await say(agent,'我们来讨论这个例子。');
   assert.ok(h.requests.at(-1).messages.some(m=>m.content?.some(b=>b.text?.includes('# 白板教学'))));
   assert.ok(h.requests.at(-1).messages.some(m=>m.content?.some(b=>b.text?.includes('偏好：请让我先试。'))));
   const prefix=JSON.parse(JSON.stringify(h.requests.at(-1).messages)),count=updates(agent).length;
   await say(agent,'继续');assert.equal(updates(agent).length,count);assert.deepEqual(h.requests.at(-1).messages.slice(0,prefix.length),prefix);
   command={action:'append',path:state.path,expectedRevision:state.revision,title:'题目',body:'比较两种方法。'};await say(agent,'把题目放到板上。');assert.equal(updates(agent).length,count,'own successful canvas write does not reinject');
   const file=join(h.root,state.path),board=JSON.parse(await readFile(file,'utf8'));assert.equal(board.nodes.length,1);board.nodes[0].x=250;await writeFile(file,JSON.stringify(board));
   await say(agent,'我调整了位置。');assert.equal(updates(agent).length,count+1);assert.doesNotMatch(updates(agent).at(-1).data.content[0].text,/# 白板教学/);
   await h.ctx.notaraVault.setWhiteboard({...input,enabled:false});await say(agent,'接着聊。');assert.match(updates(agent).at(-1).data.content[0].text,/停止自动板书/);
   const read=await h.ctx.notaraVault.read({workspaceId:ws.id,path:state.path});
   const rejected=await h.ctx.tools.execute({name:'canvas',callId:randomUUID(),agent,signal,arguments:{action:'update',path:state.path,nodeId:board.nodes[0].id,expectedRevision:read.revision,body:'停用后不应写入'}});assert.equal(rejected.isError,true);
   assert.equal((await h.ctx.notaraVault.setWhiteboard({...input,enabled:true})).path,state.path);
  }
  assert.equal(await readFile(join(h.root,'画像.md'),'utf8'),profile);
 });
}
