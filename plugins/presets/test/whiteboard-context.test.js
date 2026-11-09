import test from 'node:test';
import assert from 'node:assert/strict';
import {Session} from '@deepseek-ai/dsh-session';
import {readWhiteboardContexts} from '../whiteboard-context.js';
import {planContextUpdate} from '../context-snapshots.js';
import {registerCanvasTool} from '../canvas-tool.js';

test('board skill loads on activation only, preserves history and restores on cold resume',async()=>{
 const session=Session.create('board-teacher'),agent={id:session.id,session:{...session,header:{cwd:'/tmp/board-vault'}}};
 let state={bound:false,enabled:false},calls=0;
 const ctx={get:name=>({notaraVault:{whiteboard:async()=>{calls++;return state;}},workspaceRegistry:{resolveByPath:async()=>({id:'ws'})}})[name]};
 assert.deepEqual(await readWhiteboardContexts(ctx,agent,'teacher'),[]);
 state={bound:true,eligible:true,enabled:true,path:'白板/课堂白板.canvas',revision:'r1'};
 const contexts=()=>readWhiteboardContexts(ctx,agent,'teacher'),options={cwd:'/tmp/board-vault'};
 const append=m=>session.append('user/message',m,{surfaceOp:'append'});
 const first=planContextUpdate(session,await contexts(),options);assert.match(first.content[0].text,/题目|原文/);assert.match(first.content[0].text,/课堂白板.canvas/);append(first);
 const before=session.snapshotEvents();assert.equal(planContextUpdate(session,await contexts(),options),null);
 state.enabled=false;const off=planContextUpdate(session,await contexts(),options);assert.match(off.content[0].text,/停止自动板书/);append(off);
 assert.deepEqual(session.snapshotEvents().slice(0,before.length),before);
 const cold=Session.create(session.id,session.snapshotEvents(),session.header);assert.equal(planContextUpdate(cold,await contexts(),options),null);
 state.enabled=true;assert.match(planContextUpdate(session,await contexts(),options).content[0].text,/白板教学/);assert.ok(calls>0);
});
test('own canvas receipt advances known version; external edits notify once without repeating Skill',async()=>{
 const session=Session.create('board-changes'),agent={id:session.id,session:{header:{cwd:'/tmp/board-vault'}}};let revision='r1',registered;
 const ctx={tools:{register:tool=>registered=tool},get:name=>({notaraVault:{whiteboard:async()=>({bound:true,eligible:true,enabled:true,path:'课堂.canvas',revision})},workspaceRegistry:{resolveByPath:async()=>({id:'ws'})}})[name]};
 registerCanvasTool(ctx,'notara-teacher');const contexts=()=>readWhiteboardContexts(ctx,agent,'teacher'),options={cwd:'/tmp/board-vault'};
 session.append('user/message',planContextUpdate(session,await contexts(),options),{surfaceOp:'append'});
 session.append('assistant/message',{turn:0,step:1,message:{id:'assistant',role:'assistant',source:{kind:'model'},content:[{type:'tool-call',id:'c1',name:'canvas',arguments:'{}'}]},stream:[]},{surfaceOp:'append'});
 const meta=registered.output.presentationMeta({},{result:JSON.stringify({path:'课堂.canvas',revision:'r2'})});
 session.append('tool/result',{turn:0,step:1,message:{id:'result',role:'tool',source:{kind:'tool',callId:'c1'},toolCallId:'c1',content:[{type:'text',text:'saved'}]},meta},{surfaceOp:'append'});
 revision='r2';assert.equal(planContextUpdate(session,await contexts(),options),null);
 revision='r3';const external=planContextUpdate(session,await contexts(),options);assert.match(external.content[0].text,/r3/);assert.doesNotMatch(external.content[0].text,/# 白板教学/);
 session.append('user/message',external,{surfaceOp:'append'});assert.equal(planContextUpdate(session,await contexts(),options),null);
});
