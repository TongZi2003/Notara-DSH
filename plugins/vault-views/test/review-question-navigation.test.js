import test from 'node:test';
import assert from 'node:assert/strict';
import {continueReviewQuestion} from '../src/review-question-navigation.js';
const plan={heading:'',question:'为什么先判断符号？',nextReview:'2026-11-07'};
const doc={path:'卡片/条件.md',title:'条件',revision:'r1'};
const content='---\ntype: card\nreview_history: '+JSON.stringify([{scheduleVersion:3,kind:'continuation',day:'2026-11-07',baseline:null,followUp:{question:plan.question,afterDays:0,reason:'旧理由'}}])+'\n---\n原记录';
function fixture(){
 let active='lesson',home='home',sent=0;const calls=[],controller=new AbortController(),states=Object.fromEntries(['lesson','home'].map(id=>[id,{phase:'plain',draft:id+'旧草稿',draftRev:1,occurrences:[]}])) ;
 const scopes=Object.fromEntries(Object.keys(states).map(id=>[id,{id,bail(_scope,event,request){assert.equal(event,'slash/input-insert-text');states[id]={...states[id],draft:states[id].draft+request.text,draftRev:states[id].draftRev+1};return true;}}]));
 const ui={openSession:id=>{calls.push({open:id});active=id;}};
 const ctx={get:name=>name==='uiWorkspace'?ui:name==='workspaces'?{list:{getSnapshot:()=>({items:[{workspaceId:'a',sessionIds:['home','lesson']}]})}}:undefined,
 sessions:{list:{getSnapshot:()=>({byId:{[active]:{id:active,retainedBy:{mainView:1}}}})},scope:id=>scopes[id]},
 remote:{notaraVault:{read:async input=>{calls.push(input);return {ok:true,value:{...doc,content}};},homeSession:async input=>{calls.push(input);return {ok:true,value:{sessionId:home}};}}},
 conversation:{send:()=>sent++,blocks:{storeFor:()=>({getSnapshot:()=>null})},input:{for:scope=>({state:{getSnapshot:()=>states[scope.id]},insertReference(ref){const s=states[scope.id];states[scope.id]={...s,draft:s.draft+'¤',draftRev:s.draftRev+1,occurrences:[...s.occurrences,{...ref,length:1}]};return true;}})}},
 layout:{beginNavigation:()=>controller.signal,selectPanel:()=>{}}};
 return {ctx,states,calls,controller,home:value=>home=value,active:()=>active,sent:()=>sent};
}
test('question goes to bound teacher, appends without losing either draft, deduplicates and never sends',async()=>{
 const f=fixture();await continueReviewQuestion(f.ctx,'a',doc,plan);await continueReviewQuestion(f.ctx,'a',doc,plan);
 assert.equal(f.active(),'home');assert.equal(f.states.lesson.draft,'lesson旧草稿');assert.match(f.states.home.draft,/^home旧草稿/);assert.match(f.states.home.draft,/为什么先判断符号/);assert.equal(f.states.home.occurrences.length,1);assert.equal(f.sent(),0);assert.ok(f.calls.filter(x=>x.workspaceId).every(x=>x.workspaceId==='a'));assert.ok(f.calls.every(x=>!x.open||x.open==='home'));
});
test('missing home, stale question and cancelled navigation leave drafts intact',async()=>{
 const noHome=fixture();noHome.home(null);await assert.rejects(()=>continueReviewQuestion(noHome.ctx,'a',doc,plan),/还没有长期教师/);assert.equal(noHome.active(),'lesson');assert.ok(noHome.calls.every(x=>x.open!==true));
 const stale=fixture();await assert.rejects(()=>continueReviewQuestion(stale.ctx,'a',{...doc,revision:'old'},plan),/问题已有更新/);assert.equal(stale.active(),'lesson');
 const cancelled=fixture();cancelled.controller.abort();assert.equal(await continueReviewQuestion(cancelled.ctx,'a',doc,plan),false);assert.equal(cancelled.states.home.draft,'home旧草稿');
});
test('native open invalidates the lookup signal; later navigation cancels only the draft phase',async()=>{
 const f=fixture();let signal=new AbortController();f.ctx.layout.beginNavigation=()=>{signal.abort();signal=new AbortController();return signal.signal;};
 const nativeOpen=f.ctx.get('uiWorkspace').openSession;f.ctx.get('uiWorkspace').openSession=id=>{signal.abort();nativeOpen(id);};
 await continueReviewQuestion(f.ctx,'a',doc,plan);assert.match(f.states.home.draft,/为什么先判断符号/);
 const g=fixture();let current=new AbortController();g.ctx.layout.beginNavigation=()=>{current.abort();current=new AbortController();return current.signal;};
 const read=g.ctx.remote.notaraVault.read;let reads=0;g.ctx.remote.notaraVault.read=async input=>{const value=await read(input);if(++reads===2)current.abort();return value;};
 await assert.rejects(()=>continueReviewQuestion(g.ctx,'a',doc,plan),/对话已切换/);assert.equal(g.states.home.draft,'home旧草稿');
});
