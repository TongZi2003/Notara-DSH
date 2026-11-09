import test from 'node:test';
import assert from 'node:assert/strict';
import {COMPANIONS,invitationText,insertCompanionInvitation,registerCompanionInvitations,INVITATION_SOURCE,companionCall,subagentCallReceipt,sessionPreset} from '../src/companions.js';
import {ROLES} from '../../presets/catalog.js';
import {referenceEnvelopes,serializeReference} from '../src/reference-facts.js';
import {sourceReferenceRule} from '../src/composer.js';
import {companionTextRule} from '../src/companions.js';
import {userMessageCopyText} from '../../graph-and-blocks/src/user-message-text.js';
import {readFile} from 'node:fs/promises';

test('student invitations refer to real companion presets and distinguish answering from blind listening',()=>{
  for(const row of COMPANIONS)assert.equal(ROLES.find(role=>role.id===row.id)?.name,row.name);
  assert.match(invitationText({preset:'companion-claude',mode:'answer'}),/subagent/);
  assert.match(invitationText({preset:'companion-claude',mode:'answer'}),/回答/);
  const blind=invitationText({preset:'companion-deepseek',mode:'teach'});
  assert.match(blind,/companion-deepseek-blind/);assert.match(blind,/不.*答案/);
  assert.throws(()=>invitationText({preset:'worker-problem',mode:'answer'}));
  assert.throws(()=>invitationText({preset:'companion-gpt',mode:'teach'}));
});
test('choosing a classmate adds a native reference to the selected draft without sending',()=>{
  let state={phase:'plain',draft:'我的问题',draftRev:1,occurrences:[]};const input={state:{getSnapshot:()=>state},insertReference:(ref,span)=>{assert.equal(span.draftRev,state.draftRev);state={...state,draft:state.draft+'¤',draftRev:2,occurrences:[{...ref,length:1}]};return true;}};
  let selected='a';const ctx={get:name=>name==='uiSession'?{adapter:{current:{getSnapshot:()=>({key:selected})}}}:null,sessions:{scope:id=>({id})},conversation:{blocks:{storeFor:()=>({getSnapshot:()=>null})},input:{for:()=>input},send:()=>assert.fail('must not send')}};
  insertCompanionInvitation(ctx,'a',{preset:'companion-claude',mode:'answer'});assert.equal(state.draft,'我的问题¤');assert.equal(state.occurrences[0].source,INVITATION_SOURCE);
  insertCompanionInvitation(ctx,'a',{preset:'companion-claude',mode:'answer'});assert.equal(state.occurrences.length,1);
  selected='b';assert.throws(()=>insertCompanionInvitation(ctx,'a',{preset:'companion-gpt',mode:'answer'}),/切换/);
});
test('incomplete or worker calls never acquire a classmate identity; organizer and topic receipts carry real session IDs',()=>{
  assert.equal(companionCall({phase:'preparing',block:{argsRaw:'{"preset":'}}),null);
  assert.equal(companionCall({phase:'start',block:{argsRaw:'{"preset":"worker-problem"}'}}),null);
  const value=companionCall({phase:'result',block:{isError:false,call:{argsRaw:'{"preset":"companion-gpt"}'}}});
  assert.equal(value.status,'invited');assert.equal(value.name,'后桌');
  const workerReceipt=subagentCallReceipt({phase:'result',block:{isError:false,call:{argsRaw:'{"preset":"worker-review","description":"核验计算"}'},content:[{type:'text',text:'ok'}]}});
  assert.equal(workerReceipt.name,'子任务');assert.equal(workerReceipt.status,'已创建记录');assert.equal(workerReceipt.topicId,null);assert.equal(workerReceipt.isTopic,false);
  const topicId='notara-topic-0123456789abcdef0123456789abcdef';
  const orgReceipt=subagentCallReceipt({phase:'result',block:{isError:false,call:{argsRaw:'{"preset":"notara-material-organizer","description":"高二导数课堂笔记"}'},content:[{type:'text',text:`已新建独立资料整理会话「高二导数课堂笔记」并发送交接消息。会话标识：${topicId}`}]}});
  assert.equal(orgReceipt.organizer,true);assert.equal(orgReceipt.isTopic,true);assert.equal(orgReceipt.topicId,topicId);assert.match(orgReceipt.name,/资料整理/);assert.equal(orgReceipt.status,'已转交独立整理');
  const pendingOrg=subagentCallReceipt({phase:'start',block:{argsRaw:'{"preset":"notara-material-organizer","description":"高二导数课堂笔记"}'}});
  assert.equal(pendingOrg.isTopic,true);assert.equal(pendingOrg.topicId,null);assert.equal(pendingOrg.status,'正在安排…');
  const pendingHomeTopic=subagentCallReceipt({phase:'start',block:{argsRaw:'{"preset":"notara-teacher","description":"导数第一课"}'}},'notara-coordinator');
  assert.equal(pendingHomeTopic.isTopic,true);assert.equal(pendingHomeTopic.topicId,null);assert.match(pendingHomeTopic.name,/专题课堂/);
  const teacherChild=subagentCallReceipt({phase:'start',block:{argsRaw:'{"preset":"notara-teacher","description":"梯度累积"}'}},'notara-teacher');
  assert.equal(teacherChild.isTopic,false);
});
test('a sidebar peer reads its own durable preset rather than the staged main-view role',()=>{
  const snapshot={byId:{main:{retainedBy:{mainView:1},projectionValues:{agentPreset:'notara-teacher'}},peer:{retainedBy:{sidebarChat:1},projectionValues:{agentPreset:'companion-gpt'}}}};
  assert.equal(sessionPreset(snapshot,'peer'),'companion-gpt');assert.equal(sessionPreset(snapshot,'main'),'notara-teacher');assert.equal(sessionPreset(snapshot,'unknown'),undefined);
  snapshot.projectionsBySession={peer:{values:{agentPreset:'companion-claude'}}};assert.equal(sessionPreset(snapshot,'peer'),'companion-claude');
});

test('invitation display projects through native userText without swallowing trailing student words or code',async()=>{
  const rules=[];let source;const off=registerCompanionInvitations({inputTriggers:{registerSource(value){source=value;return ()=>{};}},uiConversation:{userText:{register(rule){rules.push(rule);return ()=>rules.splice(rules.indexOf(rule),1);}}}});
  assert.equal(rules.length,1,'the codec must install its native display projection');
  const wire=await source.codec.serialize(JSON.stringify({preset:'companion-deepseek',mode:'teach'}));
  assert.match(wire,/subagent/);assert.match(wire,/companion-deepseek-blind/);
  const suffix='\n我的话：请保留这句。\n```js\nconst preset="my own code";\n```';
  const text=wire+suffix,node=rules[0].match(text,0,{read:()=>undefined});
  assert.equal(node.end,wire.length);assert.doesNotMatch(node.data.display,/subagent|preset|证据/);
  assert.match(node.data.display,/大肥鱼/);assert.equal(text.slice(node.end),suffix);
  assert.equal(rules[0].match('```text\n'+wire+'\n```',0,{read:()=>undefined}),undefined);
  const legacy=referenceEnvelopes(wire)[0].value.instruction.trim(),legacyNode=rules[0].match(legacy+suffix,0);
  assert.equal(legacyNode.end,legacy.length);assert.equal((legacy+suffix).slice(legacyNode.end),suffix);
  assert.equal(rules[0].match(legacy.replace('伙伴的回答不是学生的作答或掌握证据。','')+suffix,0),undefined,'partial or user-written instructions must stay verbatim');
  assert.equal(rules[0].match('```text\n'+legacy+'\n```',0),undefined);
  off();assert.equal(rules.length,0);
});

test('selection backticks cannot hide a following selection or invitation from the native projection',async()=>{
  const src=await readFile(new URL('../../../node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js',import.meta.url),'utf8');
  const region=src.split('//#region lib/types/client/conversation/user-text-document.js\n')[1].split('//#endregion')[0];
  const UserTextDocument=new Function(region+'\nreturn UserTextDocument;')();
  const rules=[sourceReferenceRule,companionTextRule].sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id));
  const evaluate=text=>new UserTextDocument().evaluate({text,facts:{}},rules);
  const source=(title,selection)=>serializeReference({kind:'source',pin:{path:title+'.md',title,revision:'r1',range:[0,selection.length]},locator:`[[${title}.md#text=0,${selection.length}&revision=r1]]`,selection});
  const first=source('片段一','`foo'),second=source('片段二','bar`'),invite=invitationText({preset:'companion-claude',mode:'discuss'});
  for(const [text,labels] of [
    ['请解释：'+first+second+' 后面是我的 `code` 示例',['片段一','片段二']],
    ['请解释：'+first+invite+' 后面是我的 `code` 示例',['片段一','大小姐']],
  ]){
    const copy=userMessageCopyText(text,evaluate(text));
    for(const label of labels)assert.ok(copy.includes(label));
    assert.doesNotMatch(copy,/notara-reference-v1|preset=|subagent|`foo|bar`/);
    assert.match(copy,/后面是我的 `code` 示例/);
  }
  for(const literal of ['```text\n'+first+invite+'\n```','``'+first+invite+'``']){
    assert.deepEqual(referenceEnvelopes(literal),[],'complete envelopes inside actual code remain literal');
    assert.equal(userMessageCopyText(literal,evaluate(literal)),literal);
  }
});

test('installCompanions subagent receipt omits ActivityPanel button on standalone topics and gates openSession via openWorkspaceSession', async () => {
  const { build } = await import('esbuild');
  const { fileURLToPath } = await import('node:url');
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { createRequire } = await import('node:module');
  const req = createRequire(import.meta.url);
  const bundled = await build({
    entryPoints: [fileURLToPath(new URL('../src/companions.jsx', import.meta.url))],
    bundle: true, write: false, format: 'cjs', platform: 'node',
    external: ['react', 'react/*', 'react-dom', 'react-dom/*'],
    alias: { '@deepseek-ai/dsh-client-ui-primitives': fileURLToPath(new URL('../../../tests/fixtures/modal.jsx', import.meta.url)) },
  });
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(req, mod, mod.exports);
  let registeredDecorated = null;
  const opened = [];
  const topicId = 'notara-topic-0123456789abcdef0123456789abcdef';
  const sessionSnap = {
    byId: {
      home: { id: 'home', agentPreset: 'notara-coordinator' },
      cls: { id: 'cls', agentPreset: 'notara-teacher' },
      [topicId]: { id: topicId, agentPreset: 'notara-material-organizer' },
      'other-ws-topic': { id: 'other-ws-topic', agentPreset: 'notara-material-organizer' },
    },
  };
  const wsSnap = {
    archivedSessionIds: [],
    items: [
      { workspaceId: 'ws-a', sessionIds: ['home', 'cls', topicId] },
      { workspaceId: 'ws-b', sessionIds: ['other-ws-topic'] },
    ],
  };
  const nativeEntry = { options: { key: 'subagent', priority: 0 }, locale: 'zh', inject: [] };
  const ctx = {
    inputTriggers: { registerSource: () => () => {} },
    uiConversation: { userText: { register: () => () => {} } },
    sessions: { list: { getSnapshot: () => sessionSnap, subscribe: () => () => {} } },
    slots: {
      entries: name => (name === 'tool.call.toolview' ? [nativeEntry] : []),
      subscribe: () => () => {},
      register: (opts, fn) => { if (opts.name === 'tool.call.toolview') registeredDecorated = fn; return () => {}; },
    },
    get(service) {
      if (service === 'workspaces') return { list: { getSnapshot: () => wsSnap } };
      if (service === 'uiWorkspace') return { openSession: id => opened.push(id) };
      return null;
    },
  };
  const dispose = mod.exports.installCompanions(ctx);
  assert.equal(typeof registeredDecorated, 'function');

  const pendingOrgHtml = renderToStaticMarkup(React.createElement(registeredDecorated, {
    sessionId: 'home', phase: 'start', block: { argsRaw: '{"preset":"notara-material-organizer","description":"导数讲义"}' },
  }));
  assert.doesNotMatch(pendingOrgHtml, /在活动中查看/, 'standalone organizer call must not render fake ActivityPanel button');

  const pendingHomeTopicHtml = renderToStaticMarkup(React.createElement(registeredDecorated, {
    sessionId: 'home', phase: 'start', block: { argsRaw: '{"preset":"notara-teacher","description":"导数第一课"}' },
  }));
  assert.doesNotMatch(pendingHomeTopicHtml, /在活动中查看/, 'Home -> teacher standalone topic must not render ActivityPanel button');

  const workerHtml = renderToStaticMarkup(React.createElement(registeredDecorated, {
    sessionId: 'cls', phase: 'start', block: { argsRaw: '{"preset":"worker-problem","description":"核验"}' },
  }));
  assert.match(workerHtml, /在活动中查看/, 'classroom child worker call retains ActivityPanel button');

  const settledTree = registeredDecorated({
    sessionId: 'home', phase: 'result',
    block: { isError: false, call: { argsRaw: '{"preset":"notara-material-organizer","description":"导数讲义"}' }, content: [{ type: 'text', text: `会话标识：${topicId}` }] },
  });
  const findButtons = node => {
    if (!node || typeof node !== 'object') return [];
    const list = node.type === 'button' ? [node] : [];
    const children = Array.isArray(node.props?.children) ? node.props.children : [node.props?.children];
    for (const child of children) list.push(...findButtons(child));
    return list;
  };
  const openBtn = findButtons(settledTree).find(btn => btn.props.children === '打开整理会话');
  assert.ok(openBtn, 'completed organizer receipt renders 打开整理会话 button');
  openBtn.props.onClick();
  assert.deepEqual(opened, [topicId]);

  const crossTree = registeredDecorated({
    sessionId: 'home', phase: 'result',
    block: { isError: false, call: { argsRaw: '{"preset":"notara-material-organizer","description":"跨库"}' }, content: [{ type: 'text', text: '会话标识：notara-topic-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }] },
  });
  findButtons(crossTree).find(btn => btn.props.children === '打开整理会话').props.onClick();
  assert.deepEqual(opened, [topicId], 'must block opening session outside caller workspace');
  dispose();
});

