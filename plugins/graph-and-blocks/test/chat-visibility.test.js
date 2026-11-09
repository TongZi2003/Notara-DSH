import test from 'node:test';
import assert from 'node:assert/strict';
import {projectStudentChat} from '../src/chat-visibility.js';

function fixture(inputs,complete=true) {
  const turn={turn:0,start:complete?{seq:1}:undefined};
  const nodes=[...inputs.map((kind,i)=>({key:'input'+i,kind:kind==='user'?'user':'context',location:{turn},data:{source:{kind}}})),...['assistant-step','tool-call','turn-tail'].map(kind=>({key:kind,kind,location:{turn},data:{blocks:[{text:'SECRET'}]}}))];
  const map=new Map(nodes.map(n=>[n.key,n]));
  const snapshot={order:nodes.map(n=>n.key),nodes:{values:()=>nodes,get:key=>map.get(key)},navigation:{items:()=>[{turn:0,anchorKey:'assistant-step',prompt:'SECRET',response:'SECRET'}]},timeline:{turns:new Map([[0,turn]])}};
  const grouped={entries:[{kind:'group',key:'process'},{kind:'node',key:'assistant-step'},{kind:'node',key:'turn-tail'}],groupSource:()=>({getSnapshot:()=>({data:{turn:0},members:[{key:'tool-call'}]})})};
  return {snapshot,grouped,outline:[{turn:0,seq:1,prompt:'SECRET',response:'SECRET'}]};
}
test('peer-only output, tools, copy actions, groups and loaded navigation all leave Chat while original nodes remain',()=>{
  const input=fixture(['agent-message']),before=JSON.stringify(input.snapshot.nodes.values()),view=projectStudentChat(input);
  assert.deepEqual(view.order,[]);assert.deepEqual(view.entries,[]);assert.deepEqual(view.navigation,[]);assert.deepEqual(view.outline,[]);
  assert.equal(JSON.stringify(input.snapshot.nodes.values()),before);
});
test('attachment import receipts stay in Trajectory while original student input and teaching remain visible', () => {
  const input = fixture(['user', 'notara-attachment-import']);
  const original = JSON.stringify([...input.snapshot.nodes.values()]);
  const view = projectStudentChat(input);
  assert.ok(view.order.includes('input0')); assert.ok(view.order.includes('assistant-step'));
  assert.ok(!view.order.includes('input1'));
  assert.equal(JSON.stringify([...input.snapshot.nodes.values()]), original);
});
test('deduplicated runtime history stays out of student Chat without hiding the lesson',()=>{
  const input=fixture(['user','notara-runtime-context-history']);
  const view=projectStudentChat(input);
  assert.ok(view.order.includes('input0'));assert.ok(view.order.includes('assistant-step'));
  assert.ok(!view.order.includes('input1'));
});
test('append-only background diffs stay in Trajectory without hiding student answers',()=>{
  const input=fixture(['user','notara-context-update']);
  const reminder='<system-reminder>\n后台学习背景\n```diff\n-60分钟\n+30分钟\n```\n</system-reminder>';
  input.snapshot.nodes.get('input1').data.content=[{type:'text',text:reminder}];
  // Visibility follows host provenance, never tag-shaped text a student quotes.
  input.snapshot.nodes.get('input0').data.content=[{type:'text',text:reminder}];
  const before=JSON.stringify(input.snapshot.nodes.values());
  const view=projectStudentChat(input);
  assert.ok(view.order.includes('input0'));assert.ok(view.order.includes('assistant-step'));assert.ok(!view.order.includes('input1'));
  assert.equal(JSON.stringify(input.snapshot.nodes.values()),before);
});
test('navigation projects complete original user text before clipping, never a truncated wire header',()=>{
  const input=fixture(['user']);const user=input.snapshot.nodes.get('input0');
  user.data.content=[{type:'text',text:'INTERNAL_WIRE_WITH_FULL_BOUNDARY'}];
  input.snapshot.navigation.items=()=>[{turn:0,anchorKey:'input0',prompt:'INTERNAL_WIRE…',response:'回答'}];
  input.outline[0].prompt='INTERNAL_WIRE…';
  const output=projectStudentChat({...input,displayUserText:text=>{assert.equal(text,'INTERNAL_WIRE_WITH_FULL_BOUNDARY');return '【大小姐】【讲义】请检查我的证明';}});
  assert.equal(output.navigation[0].prompt,'【大小姐】【讲义】请检查我的证明');assert.equal(output.outline[0].prompt,output.navigation[0].prompt);
  assert.equal(user.data.content[0].text,'INTERNAL_WIRE_WITH_FULL_BOUNDARY');
});
test('a real student input in a peer turn preserves the answer and actions but hides the peer message',()=>{
  const view=projectStudentChat(fixture(['agent-message','user']));
  assert.ok(view.order.includes('assistant-step'));assert.ok(view.order.includes('turn-tail'));assert.ok(!view.order.includes('input0'));assert.equal(view.entries.length,3);assert.equal(view.navigation.length,1);
});
test('unloaded input provenance never reintroduces answer previews from the full outline',()=>{
  const view=projectStudentChat(fixture(['agent-message'],false));
  assert.deepEqual(view.order,[]);assert.deepEqual(view.navigation,[]);assert.deepEqual(view.outline,[{turn:0,seq:1,prompt:'',response:''}]);
});
test('initial handoffs keep the lesson visible without exposing the handoff itself',()=>{
  for(const source of ['notara-topic-handoff','notara-child-handoff']){
    const view=projectStudentChat(fixture([source]));assert.ok(view.order.includes('assistant-step'));assert.ok(!view.order.includes('input0'));
  }
});

test('handoff plus peer steering without a real student is internal, while settlement delivery stays visible',()=>{
  assert.deepEqual(projectStudentChat(fixture(['notara-child-handoff','agent-message'])).order,[]);
  const settled=fixture(['subagent-settled']);
  settled.snapshot.nodes.get('input0').data.source.senderSessionId='child-teacher';
  assert.ok(projectStudentChat({...settled,sessions:{byId:{'child-teacher':{agentPreset:'notara-teacher'}}}}).order.includes('assistant-step'));
  assert.deepEqual(projectStudentChat(fixture(['notara-child-handoff'],false)).order,[]);
});
test('removing the initial handoff reanchors navigation without carrying its prompt into the preview',()=>{
  const input=fixture(['notara-topic-handoff']);input.snapshot.navigation.items=()=>[{turn:0,anchorKey:'input0',prompt:'PRIVATE_HANDOFF',response:'public lesson'}];
  const output=projectStudentChat(input);assert.equal(output.navigation[0].anchorKey,'assistant-step');assert.equal(output.navigation[0].prompt,'');assert.equal(output.outline[0].prompt,'');
});
test('timer context stays hidden while the pacing response remains visible',()=>{
  const input=fixture(['schedule']);input.snapshot.nodes.get('input0').data.content=[{type:'text',text:'Reminder\n<!-- notara-pomodoro:v1 {} -->\nPRIVATE_TIMER'}];
  const output=projectStudentChat(input);assert.ok(output.order.includes('assistant-step'));assert.ok(!output.order.includes('input0'));assert.equal(output.outline[0].prompt,'');assert.equal(output.navigation[0].prompt,'');
});
test('an early outline with a loaded start but no input cannot expose an answer; admission errors remain visible',()=>{
  for(const inputs of [[],['runtime-context']]){
    const input=fixture(inputs),view=projectStudentChat(input);
    assert.deepEqual(view.order,[]);assert.equal(view.outline[0].response,'');assert.equal(view.outline[0].prompt,'');
    const get=input.snapshot.nodes.get;
    input.snapshot.nodes.get=key=>key==='admission-error'?{kind:'turn-error',location:{turn:{turn:0}}}:get(key);
    input.snapshot.order.push('admission-error');assert.deepEqual(projectStudentChat(input).order,['admission-error']);
  }
});

test('internal worker subagent-settled turns hide prep answers by real preset identity while companion settlements and student turns stay visible',()=>{
  const workerViaSessions=fixture(['subagent-settled']);
  workerViaSessions.snapshot.nodes.get('input0').data.source.senderSessionId='child-worker-1';
  const hiddenBySession=projectStudentChat({
    ...workerViaSessions,
    sessions:{projectionsBySession:{'child-worker-1':{values:{agentPreset:'worker-problem'}}}},
  });
  assert.deepEqual(hiddenBySession.order,[]);
  assert.deepEqual(hiddenBySession.entries,[]);
  assert.deepEqual(hiddenBySession.navigation,[]);
  assert.deepEqual(hiddenBySession.outline,[]);

  // Unloaded start boundary on internal worker settled turn must also mask outline previews.
  const unloadedWorker=fixture(['subagent-settled'],false);
  unloadedWorker.snapshot.nodes.get('input0').data.source.senderSessionId='child-worker-1';
  const hiddenUnloaded=projectStudentChat({
    ...unloadedWorker,
    sessions:{byId:{'child-worker-1':{projectionValues:{agentPreset:'worker-lesson'}}}},
  });
  assert.deepEqual(hiddenUnloaded.order,[]);
  assert.deepEqual(hiddenUnloaded.outline,[{turn:0,seq:1,prompt:'',response:''}]);

  // Parent subagent tool-result also identifies worker-* before sessions list hydrates.
  const workerViaToolResult=fixture(['subagent-settled']);
  workerViaToolResult.snapshot.nodes.get('input0').data.source.senderSessionId='child-worker-2';
  const toolNode=workerViaToolResult.snapshot.nodes.get('tool-call');
  toolNode.data.root={
    kind:'tool-result',
    isError:false,
    call:{name:'subagent',argsRaw:JSON.stringify({preset:'worker-exercise',run_in_background:true})},
    content:[{type:'text',text:'已后台启动内部子任务「设计变式」（worker-exercise）。会话标识：child-worker-2。'}],
  };
  assert.deepEqual(projectStudentChat(workerViaToolResult).order,[]);

  // Invited companion settlements are NOT hidden, even if prose mentions internal-looking words.
  const companionSettled=fixture(['subagent-settled']);
  companionSettled.snapshot.nodes.get('input0').data.source.senderSessionId='child-companion-1';
  const companionView=projectStudentChat({
    ...companionSettled,
    sessions:{projectionsBySession:{'child-companion-1':{values:{agentPreset:'companion-deepseek'}}}},
  });
  assert.ok(companionView.order.includes('assistant-step'));
  assert.ok(companionView.order.includes('turn-tail'));

  // A real student input sharing a turn with an internal worker notice keeps the teacher's reply while hiding the internal notice node.
  const mixed=fixture(['subagent-settled','user']);
  mixed.snapshot.nodes.get('input0').data.source.senderSessionId='child-worker-1';
  mixed.snapshot.nodes.get('input1').data.content=[{type:'text',text:'我想先试试第一题'}];
  const mixedView=projectStudentChat({
    ...mixed,
    sessions:{byId:{'child-worker-1':{agentPreset:'worker-review'}}},
  });
  assert.ok(mixedView.order.includes('assistant-step'));
  assert.ok(!mixedView.order.includes('input0'),'internal worker notice must stay hidden');
  assert.ok(mixedView.order.includes('input1'));

  // Before sessions list or parent subagent tool-result hydrates senderSessionId's preset, fail closed (unknown/masked) rather than leaking worker answers.
  const pendingHydration=fixture(['subagent-settled']);
  pendingHydration.snapshot.nodes.get('input0').data.source.senderSessionId='child-unhydrated';
  const pendingView=projectStudentChat({
    ...pendingHydration,
    sessions:{phase:'pending',byId:{},projectionsBySession:{}},
  });
  assert.deepEqual(pendingView.order,[],'unhydrated senderSessionId must not fail open to student');
  assert.deepEqual(pendingView.entries,[]);
  assert.deepEqual(pendingView.navigation,[]);
  assert.deepEqual(pendingView.outline,[{turn:0,seq:1,prompt:'',response:''}],'outline preview stays masked until sender preset resolves');

  // Standalone notara-material-organizer sessions keep their checklist/output turn visible after background worker-* settlements or peer continuations while hiding raw trigger nodes.
  const organizerWorkerDone=fixture(['subagent-settled']);
  organizerWorkerDone.snapshot.nodes.get('input0').data.source.senderSessionId='org-worker-1';
  const organizerView=projectStudentChat({
    ...organizerWorkerDone,
    sessionId:'org-session-1',
    sessionPreset:'notara-material-organizer',
    sessions:{projectionsBySession:{'org-worker-1':{values:{agentPreset:'worker-problem'}}}},
  });
  assert.ok(organizerView.order.includes('assistant-step'),'organizer checklist turn must remain visible');
  assert.ok(!organizerView.order.includes('input0'),'raw worker settlement trigger stays hidden');
  assert.equal(organizerView.entries.length,3);
  assert.equal(organizerView.navigation[0].prompt,'');
  assert.equal(organizerView.outline[0].prompt,'');
  assert.equal(organizerView.outline[0].response,'SECRET');

  const organizerByHandoff=fixture(['subagent-settled']);
  organizerByHandoff.snapshot.nodes.get('input0').data.source.senderSessionId='org-worker-unhydrated';
  organizerByHandoff.snapshot.order.unshift('handoff0');
  const origGet=organizerByHandoff.snapshot.nodes.get,origVals=organizerByHandoff.snapshot.nodes.values;
  const handoffNode={key:'handoff0',kind:'context',location:{turn:{turn:99}},data:{source:{kind:'notara-topic-handoff',targetPreset:'notara-material-organizer'}}};
  organizerByHandoff.snapshot.nodes.get=k=>k==='handoff0'?handoffNode:origGet(k);
  organizerByHandoff.snapshot.nodes.values=()=>[handoffNode,...origVals()];
  const organizerFallbackView=projectStudentChat({...organizerByHandoff,sessionId:'org-session-2',sessions:{byId:{}}});
  assert.ok(organizerFallbackView.order.includes('assistant-step'));
  assert.ok(!organizerFallbackView.order.includes('input0'));

  const organizerPeerCont=fixture(['agent-message']);
  const organizerPeerView=projectStudentChat({...organizerPeerCont,sessionId:'org-session-1',sessionPreset:'notara-material-organizer'});
  assert.ok(organizerPeerView.order.includes('assistant-step'),'organizer continuation checklist remains visible');
  assert.ok(!organizerPeerView.order.includes('input0'),'raw peer trigger stays hidden');

});

test('cold continuable spawn settlements stay masked until real role metadata arrives, then companions and teachers recover',()=>{
  const paginatedCompanion=fixture(['subagent-settled']);
  paginatedCompanion.snapshot.nodes.get('input0').data.source.senderSessionId='child-companion-cold';
  const input={
    ...paginatedCompanion,
    sessionId:'teacher-1',
    sessionPreset:'notara-teacher',
    subagentCatalog:[{id:'child-companion-cold',mode:'continuable',provider:'spawn',label:'大肥鱼'}],
    sessions:{byId:{'child-companion-cold':{id:'child-companion-cold',origin:'subagent',parentId:'teacher-1'}},projectionsBySession:{}},
  };
  const coldCompanionView=projectStudentChat(input);
  assert.deepEqual(coldCompanionView.order,[]);
  assert.deepEqual(coldCompanionView.entries,[]);
  assert.deepEqual(coldCompanionView.navigation,[]);
  assert.deepEqual(coldCompanionView.outline,[{turn:0,seq:1,prompt:'',response:''}]);
  for(const preset of ['companion-deepseek','notara-teacher']){
    input.sessions.projectionsBySession['child-companion-cold']={values:{agentPreset:preset}};
    const recovered=projectStudentChat(input);
    assert.ok(recovered.order.includes('assistant-step'));
    assert.equal(recovered.navigation.length,1);
    assert.equal(recovered.outline[0].response,'SECRET');
  }
});

test('rc.4 startActivation workers are continuable too: catalog transport, provider and label prove no student audience',()=>{
  const paginatedWorker=fixture(['subagent-settled']);
  paginatedWorker.snapshot.nodes.get('input0').data.source.senderSessionId='child-worker-cold';
  const input={
    ...paginatedWorker,
    sessionId:'teacher-1',
    sessionPreset:'notara-teacher',
    sessions:{
      byId:{'child-worker-cold':{id:'child-worker-cold',origin:'subagent',parentId:'teacher-1'}},
      projectionsBySession:{'teacher-1':{values:{subagentCatalog:[{id:'child-worker-cold',mode:'continuable',provider:'spawn',label:'大肥鱼'}]}}},
    },
  };
  const coldWorkerView=projectStudentChat(input);
  assert.deepEqual(coldWorkerView.order,[]);
  assert.deepEqual(coldWorkerView.entries,[]);
  assert.deepEqual(coldWorkerView.navigation,[]);
  assert.deepEqual(coldWorkerView.outline,[{turn:0,seq:1,prompt:'',response:''}]);
  input.sessions.projectionsBySession['child-worker-cold']={values:{agentPreset:'worker-problem'}};
  const hydrated=projectStudentChat(input);
  assert.deepEqual(hydrated.order,[]);
  assert.deepEqual(hydrated.navigation,[]);
  assert.deepEqual(hydrated.outline,[]);
  delete input.sessions.projectionsBySession['child-worker-cold'];
  input.sessions.projectionsBySession['teacher-1'].values.subagentCatalog[0].mode='one-shot';
  assert.deepEqual(projectStudentChat(input).outline,[]);
});

test('a settlement without sender identity cannot expose a cold recovered answer',()=>{
  const view=projectStudentChat(fixture(['subagent-settled']));
  assert.deepEqual(view.order,[]);
  assert.deepEqual(view.entries,[]);
  assert.deepEqual(view.navigation,[]);
  assert.deepEqual(view.outline,[{turn:0,seq:1,prompt:'',response:''}]);
});
