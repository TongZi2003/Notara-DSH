import test from 'node:test';
import assert from 'node:assert/strict';
import {installWhiteboardCommands,runWhiteboardCommand} from '../src/whiteboard-commands.js';
import {createWhiteboardFeedback,whiteboardStatusLabel} from '../src/whiteboard-feedback.js';

function fixture(){
 let current='a';const input={notify:(...args)=>notifications.push(args)},notifications=[],opened=[],calls=[],registered=[],disposed=[];
 const scopes={a:{},b:{}},ctx={get:name=>({uiSession:{adapter:{current:{getSnapshot:()=>({key:current})}}},workspaces:{list:{getSnapshot:()=>({items:[{workspaceId:'ws',sessionIds:['a','b']}]})}},conversation:{input:{for:()=>input}}})[name],sessions:{scope:id=>scopes[id],list:{getSnapshot:()=>({byId:{a:{agentPreset:'notara-coordinator'},b:{agentPreset:'notara-teacher'},worker:{agentPreset:'worker-general'}}})}},remote:{notaraVault:{setWhiteboard:async request=>{calls.push(request);return {ok:true,value:{bound:true,enabled:request.enabled,path:'白板/课堂白板.canvas'}};}}},inject:(_,run)=>run(ctx),effect:run=>disposed.push(run()),commandUi:{register:command=>{registered.push(command);return ()=>{};}}};
 return {ctx,opened,calls,notifications,registered,open:value=>opened.push(value),switchTo:id=>{current=id;}};
}
test('native slash actions activate for the captured teaching session, open existing editor and never submit',async()=>{
 const f=fixture();installWhiteboardCommands(f.ctx,f.open);assert.deepEqual(f.registered.map(c=>c.name),['whiteboard-on','whiteboard-off']);
 assert.ok(f.registered[0].available({sessionId:'a'}));assert.ok(f.registered[0].available({sessionId:'b'}));assert.equal(f.registered[0].available({sessionId:'worker'}),false);
 const receipts=[];
 await runWhiteboardCommand(f.ctx,f.open,'a',true,value=>receipts.push(value));assert.deepEqual(f.calls,[{workspaceId:'ws',sessionId:'a',enabled:true}]);assert.equal(f.opened[0].path,'白板/课堂白板.canvas');
 await runWhiteboardCommand(f.ctx,f.open,'a',false,value=>receipts.push(value));assert.equal(f.opened.length,1);assert.match(receipts.at(-1).text,/停用/);
 assert.equal(receipts[0].sessionId,'a');assert.equal(receipts[0].workspaceId,'ws');assert.deepEqual(f.notifications,[],'success must not leave a persistent input notice');
});
test('late activation does not open a board in another conversation and failures use native input feedback',async()=>{
 const f=fixture(),wait=Promise.withResolvers();f.ctx.remote.notaraVault.setWhiteboard=()=>wait.promise;
 const receipts=[],operation=runWhiteboardCommand(f.ctx,f.open,'a',true,value=>receipts.push(value));f.switchTo('b');wait.resolve({ok:true,value:{enabled:true,path:'旧课.canvas'}});await operation;assert.equal(f.opened.length,0);assert.deepEqual(receipts,[]);
 f.ctx.remote.notaraVault.setWhiteboard=async()=>({ok:false,error:{message:'whiteboard_missing'}});
 await runWhiteboardCommand(f.ctx,f.open,'b',true);assert.equal(f.opened.length,0);assert.match(f.notifications.at(-1)[1],/缺失/);
});
test('whiteboard feedback replaces earlier receipts and stale dismissal cannot clear the latest',()=>{
 const store=createWhiteboardFeedback(),updates=[];const unsubscribe=store.subscribe(()=>updates.push(store.getSnapshot()));
 store.show({sessionId:'a',workspaceId:'ws',text:'已启用白板教学'});const first=store.getSnapshot();
 store.show({sessionId:'a',workspaceId:'ws',text:'已启用白板教学'});const second=store.getSnapshot();
 assert.notEqual(first.seq,second.seq);store.dismiss(first.seq);assert.equal(store.getSnapshot(),second);
 store.dismiss(second.seq);assert.equal(store.getSnapshot(),null);assert.equal(updates.length,3);unsubscribe();
});
test('menu labels reflect saved binding, not the last toast or another board',()=>{
 const state={bound:true,enabled:true,eligible:true,path:'白板/课堂白板.canvas'};
 assert.equal(whiteboardStatusLabel(state,state.path),'白板教学 · 已启用');
 assert.equal(whiteboardStatusLabel({...state,enabled:false},state.path),'白板教学 · 已停用');
 assert.equal(whiteboardStatusLabel({...state,bound:false,path:null},state.path),'白板教学 · 未启用');
 assert.equal(whiteboardStatusLabel(state,'其他.canvas'),'此白板未用于当前会话教学');
 assert.equal(whiteboardStatusLabel({...state,missing:true},state.path),'白板教学 · 文件缺失');
 assert.equal(whiteboardStatusLabel({...state,invalid:true},state.path),'白板教学 · 文件格式异常');
});
