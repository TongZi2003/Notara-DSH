import test from 'node:test';
import assert from 'node:assert/strict';
import { workspaceSessionRows, canOpenWorkspaceSession, openWorkspaceSession } from '../src/session-list.js';


const sessions = [
  { id: 'a', title: '甲的数学', updatedAt: 10 },
  { id: 'b', title: '乙的数学', updatedAt: 30 },
  { id: 'pinned', title: '置顶', updatedAt: 1 },
  { id: 'archive', title: '归档', updatedAt: 20 },
  { id: 'blank', blank: true, updatedAt: 1 },
  { id: 'old-blank', blank: true, updatedAt: 40 },
  { id: 'child', origin: 'subagent', title: '工作员', updatedAt: 50 },
];
const list = { byId: Object.fromEntries(sessions.map(row => [row.id, row])) };
const registry = { pinnedSessionIds: ['pinned', 'b'], archivedSessionIds: ['archive'] };
const a = { sessionIds: ['a', 'pinned', 'archive', 'blank', 'old-blank', 'child', 'missing', 'a'] };
const b = { sessionIds: ['b'] };
const project = extra => workspaceSessionRows({ list, registry, workspace: a, currentId: 'blank', ...extra });

test('selected workspace is the sole membership boundary, including pins and search hits', () => {
  assert.deepEqual(project().map(row => row.id), ['blank', 'pinned', 'a']);
  assert.deepEqual(project({ workspace: b }).map(row => row.id), ['b']);
  assert.deepEqual(project({ workspace: null }), []);
  assert.deepEqual(project({ query: '数学', content: [{ sessionId: 'b', snippet: '另一工作区' }] }).map(row => row.id), ['a']);
});
test('scoped content hits, archives and native blank/subagent visibility are retained', () => {
  assert.deepEqual(project({ query: '正文', content: [{ sessionId: 'a', snippet: '正文匹配' }, { sessionId: 'archive', snippet: '正文匹配' }] }).map(row => [row.id, row.snippet]), [['a', '正文匹配']]);
  assert.deepEqual(project({ archivedFilter: 'only' }).map(row => row.id), ['archive']);
  assert.deepEqual(project({ archivedFilter: 'show' }).map(row => row.id), ['blank', 'pinned', 'archive', 'a']);
  assert.deepEqual(project({ currentId: 'a' }).map(row => row.id), ['pinned', 'a']);
});

test('untitled display never leaks an internal identity into the label or rename input', () => {
  const row = project({ list: { byId: { a: { id: 'a', displayTitle: 'internal-session-id', blank: false } } } })[0];
  assert.equal(row.title, '未命名会话'); assert.equal(row.renameTitle, '');
  assert.equal(project()[0].renameTitle, '');
});

test('standalone material organizer sessions project kindLabel and match kind search within workspace', () => {
  const customList = {
    byId: {
      org: { id: 'org', title: '整理导数课堂笔记', updatedAt: 60 },
      cls: { id: 'cls', title: '导数专题课', agentPreset: 'notara-teacher', updatedAt: 50 },
    },
    projectionsBySession: {
      org: { values: { agentPreset: 'notara-material-organizer' } },
    },
  };
  const rows = workspaceSessionRows({ list: customList, registry: {}, workspace: { sessionIds: ['org', 'cls'] }, currentId: 'cls' });
  assert.equal(rows[0].id, 'org');
  assert.equal(rows[0].kindLabel, '资料整理');
  assert.equal(rows[1].kindLabel, undefined);
  const filtered = workspaceSessionRows({ list: customList, registry: {}, workspace: { sessionIds: ['org', 'cls'] }, currentId: 'cls', query: '资料整理' });
  assert.deepEqual(filtered.map(row => row.id), ['org']);
});

test('openWorkspaceSession fails closed on unhydrated/null workspaces, cross-workspace, archived, removed, missing and subagent sessions', () => {
  const opened = [];
  let registryState = {
    archivedSessionIds: ['archive'],
    items: [
      { workspaceId: 'ws-a', sessionIds: ['a', 'archive', 'child', 'removed'] },
      { workspaceId: 'ws-b', sessionIds: ['b'] },
    ],
  };
  const sessionList = {
    byId: {
      ...list.byId,
      removed: { id: 'removed', title: '已删除', removed: true, updatedAt: 15 },
    },
  };
  const ctx = {
    sessions: { list: { getSnapshot: () => sessionList } },
    get(service) {
      if (service === 'workspaces') return { list: { getSnapshot: () => registryState } };
      if (service === 'uiWorkspace') return { openSession: id => opened.push(id) };
      return null;
    },
  };

  assert.equal(canOpenWorkspaceSession(ctx, 'a', 'ws-a'), true);
  assert.equal(canOpenWorkspaceSession(ctx, 'b', 'ws-a'), false, 'must reject cross-workspace session');
  assert.equal(canOpenWorkspaceSession(ctx, 'archive', 'ws-a'), false, 'must reject archived session');
  assert.equal(canOpenWorkspaceSession(ctx, 'child', 'ws-a'), false, 'must reject subagent session');
  assert.equal(canOpenWorkspaceSession(ctx, 'removed', 'ws-a'), false, 'must reject removed session');
  assert.equal(canOpenWorkspaceSession(ctx, 'missing', 'ws-a'), false, 'must reject missing session');
  assert.equal(canOpenWorkspaceSession(ctx, 'a', null), false, 'must fail closed when workspaceId is unresolved null');
  assert.equal(canOpenWorkspaceSession(ctx, 'a', undefined), false, 'must fail closed when workspaces service exists without workspaceId');
  assert.equal(openWorkspaceSession(ctx, 'b', 'ws-a'), false);

  registryState = { archivedSessionIds: [] };
  assert.equal(canOpenWorkspaceSession(ctx, 'a', 'ws-a'), false, 'must fail closed before workspaces.list items hydrate');
  assert.equal(openWorkspaceSession(ctx, 'a', 'ws-a'), false);
  assert.equal(opened.length, 0);

  registryState = { archivedSessionIds: ['archive'], items: [{ workspaceId: 'ws-a', sessionIds: ['a'] }] };
  assert.equal(openWorkspaceSession(ctx, 'a', 'ws-a'), true);
  assert.deepEqual(opened, ['a']);

  // Continuable notara-teacher child classroom under an attached unarchived parent opens via durable subagent address; companion, one-shot, or archived-parent children fail closed.
  sessionList.byId['child-teacher'] = { id: 'child-teacher', origin: 'subagent', parentId: 'a', agentPreset: 'notara-teacher' };
  sessionList.byId['child-companion'] = { id: 'child-companion', origin: 'subagent', parentId: 'a', agentPreset: 'companion-deepseek' };
  sessionList.byId['child-archived-parent'] = { id: 'child-archived-parent', origin: 'subagent', parentId: 'archive', agentPreset: 'notara-teacher' };
  sessionList.projectionsBySession = {
    a: { values: { subagentCatalog: [{ id: 'child-teacher', mode: 'continuable' }, { id: 'child-companion', mode: 'continuable' }, { id: 'child', mode: 'one-shot' }] } },
    archive: { values: { subagentCatalog: [{ id: 'child-archived-parent', mode: 'continuable' }] } },
  };
  assert.equal(canOpenWorkspaceSession(ctx, 'child-teacher', 'ws-a'), true);
  assert.equal(canOpenWorkspaceSession(ctx, 'child-teacher', 'ws-b'), false);
  assert.equal(canOpenWorkspaceSession(ctx, 'child-companion', 'ws-a'), false);
  assert.equal(canOpenWorkspaceSession(ctx, 'child-archived-parent', 'ws-a'), false);
  assert.equal(openWorkspaceSession(ctx, 'child-teacher', 'ws-a'), true);
  assert.deepEqual(opened.at(-1), { parentSessionId: 'a', childSessionId: 'child-teacher', mode: 'continuable' });
});

test('openWorkspaceSession handles DSH cold-reload subagentAddress mode==="unknown", verifiedClassroom bindings, and unverified refreshProjections', async () => {
  const opened = [];
  const onOpenedCalls = [];
  const registryState = {
    archivedSessionIds: ['archive'],
    items: [
      { workspaceId: 'ws-a', sessionIds: ['a', 'archive'] },
      { workspaceId: 'ws-b', sessionIds: ['b'] },
    ],
  };
  const sessionList = {
    byId: {
      a: { id: 'a', title: '父课堂', updatedAt: 10 },
      archive: { id: 'archive', title: '归档父课', updatedAt: 5 },
      b: { id: 'b', title: '他区父课', updatedAt: 20 },
      // Cold reload: session headers lack agentPreset and projectionValues, and subagentAddress returns mode: 'unknown'.
      'cold-bound-child': { id: 'cold-bound-child', origin: 'subagent', parentId: 'a' },
      'cold-unbound-teacher': { id: 'cold-unbound-teacher', origin: 'subagent', parentId: 'a' },
      'cold-unbound-companion': { id: 'cold-unbound-companion', origin: 'subagent', parentId: 'a' },
      'cold-archived-child': { id: 'cold-archived-child', origin: 'subagent', parentId: 'archive' },
      'cold-other-ws-child': { id: 'cold-other-ws-child', origin: 'subagent', parentId: 'b' },
    },
    projectionsBySession: {},
  };
  const serverProjections = {
    a: {
      subagentCatalog: [
        { id: 'cold-bound-child', mode: 'continuable' },
        { id: 'cold-unbound-teacher', mode: 'continuable' },
        { id: 'cold-unbound-companion', mode: 'continuable' },
      ],
    },
    'cold-bound-child': { agentPreset: 'notara-teacher', subagent: { mode: 'continuable' } },
    'cold-unbound-teacher': { agentPreset: 'notara-teacher', subagent: { mode: 'continuable' } },
    'cold-unbound-companion': { agentPreset: 'companion-deepseek', subagent: { mode: 'continuable' } },
  };
  const ctx = {
    sessions: {
      list: { getSnapshot: () => sessionList },
      subagentAddress(id) {
        const s = sessionList.byId[id];
        if (!s || s.origin !== 'subagent') return null;
        const catalogMode = sessionList.projectionsBySession[s.parentId]?.values?.subagentCatalog?.find(x => x.id === id)?.mode;
        return { parentSessionId: s.parentId, childSessionId: id, mode: catalogMode ?? 'unknown' };
      },
      async refreshProjections(id) {
        if (serverProjections[id]) {
          sessionList.projectionsBySession[id] = { values: serverProjections[id] };
        }
      },
    },
    get(service) {
      if (service === 'workspaces') return { list: { getSnapshot: () => registryState } };
      if (service === 'uiWorkspace') return { openSession: target => opened.push(target) };
      return null;
    },
  };

  // 1. Host-verified bound child classroom opens synchronously on cold reload even with mode === 'unknown',
  //    while archived-parent and cross-workspace children still fail closed.
  assert.equal(canOpenWorkspaceSession(ctx, 'cold-bound-child', 'ws-a', { verifiedClassroom: true }), true);
  assert.equal(canOpenWorkspaceSession(ctx, 'cold-archived-child', 'ws-a', { verifiedClassroom: true }), false);
  assert.equal(canOpenWorkspaceSession(ctx, 'cold-other-ws-child', 'ws-a', { verifiedClassroom: true }), false);
  assert.equal(openWorkspaceSession(ctx, 'cold-bound-child', 'ws-a', {
    verifiedClassroom: true,
    onOpened: target => onOpenedCalls.push(target),
  }), true);
  assert.deepEqual(opened, [{ parentSessionId: 'a', childSessionId: 'cold-bound-child', mode: 'continuable' }]);
  assert.equal(onOpenedCalls.length, 1);

  // 2. Unverified [[session:...]] link on cold reload refreshes projections before deciding:
  //    companion subagent is rejected without calling openSession or onOpened;
  //    notara-teacher continuable subagent opens cleanly once projections hydrate.
  assert.equal(canOpenWorkspaceSession(ctx, 'cold-unbound-companion', 'ws-a'), false);
  assert.equal(openWorkspaceSession(ctx, 'cold-unbound-companion', 'ws-a', {
    onOpened: target => onOpenedCalls.push(target),
  }), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(opened.length, 1, 'companion subagent must not open after refreshProjections');
  assert.equal(onOpenedCalls.length, 1, 'onOpened must not fire when hydrated subagent is rejected');

  // Reset projections to simulate cold reload for cold-unbound-teacher while parent projections are loaded with mode: 'unknown' override check
  sessionList.projectionsBySession = {};
  assert.equal(openWorkspaceSession(ctx, 'cold-unbound-teacher', 'ws-a', {
    onOpened: target => onOpenedCalls.push(target),
  }), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(opened.at(-1), { parentSessionId: 'a', childSessionId: 'cold-unbound-teacher', mode: 'continuable' });
  assert.equal(onOpenedCalls.length, 2);

  // 3. Once parent catalog is loaded, even if subagentAddress somehow returns mode: 'unknown', catalogEntry + preset resolve synchronously.
  ctx.sessions.subagentAddress = id => ({ parentSessionId: 'a', childSessionId: id, mode: 'unknown' });
  assert.equal(canOpenWorkspaceSession(ctx, 'cold-unbound-teacher', 'ws-a'), true);
  assert.equal(canOpenWorkspaceSession(ctx, 'cold-unbound-companion', 'ws-a'), false);
});

function observable(initial) {
  let value=initial;
  const listeners=new Set();
  return {
    getSnapshot:()=>value,
    subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener);},
    set(next){value=next;for(const listener of [...listeners])listener();},
    get listenerCount(){return listeners.size;},
  };
}

function delayedOpenFixture() {
  const opened=[],callbacks=[],pending=[];
  const sessionList={byId:{a:{id:'a'},b:{id:'b'},'child-a':{id:'child-a',origin:'subagent',parentId:'a'},'child-b':{id:'child-b',origin:'subagent',parentId:'a'}},projectionsBySession:{}};
  const list=observable(sessionList);
  // rc.4 SlotScopeAdapter.current is the public selection source, not UiWorkspace's private selection.
  const selection=observable({key:'a',hooks:{},keyedHooks:{},props:{}});
  const workspaces=observable({items:[{workspaceId:'ws-a',sessionIds:['a','b']},{workspaceId:'ws-b',sessionIds:[]}],archivedSessionIds:[]});
  let navigation=new AbortController();
  const layout={
    beginNavigation(){navigation.abort();navigation=new AbortController();return navigation.signal;},
    selectPanel(){navigation.abort();},
  };
  const ui={openSession(target){opened.push(target);selection.set({...selection.getSnapshot(),key:typeof target==='string'?target:target.childSessionId});layout.selectPanel(null);}};
  const ctx={
    layout,
    sessions:{
      list,
      subagentAddress:id=>({parentSessionId:'a',childSessionId:id,mode:sessionList.projectionsBySession[id]?'continuable':'unknown'}),
      refreshProjections(id){return new Promise((resolve,reject)=>pending.push({id,resolve,reject}));},
    },
    get:name=>name==='uiWorkspace'?ui:name==='uiSession'?{adapter:{current:selection}}:name==='workspaces'?{list:workspaces}:undefined,
  };
  return {
    ctx,opened,callbacks,pending,sessionList,list,selection,workspaces,ui,
    open:id=>openWorkspaceSession(ctx,id,'ws-a',{onOpened:target=>callbacks.push(target)}),
    async settle(batch=pending.splice(0),fail=false){
      for(const item of batch){
        if(fail){item.reject(new Error('projection unavailable'));continue;}
        sessionList.projectionsBySession[item.id]={values:item.id==='a'?{subagentCatalog:['child-a','child-b'].map(id=>({id,mode:'continuable'}))}:{agentPreset:'notara-teacher',subagent:{mode:'continuable'}}};
        list.set({...sessionList});item.resolve();
      }
      await new Promise(resolve=>setImmediate(resolve));
    },
    assertReleased(){assert.equal(selection.listenerCount,0);assert.equal(workspaces.listenerCount,0);assert.equal(list.listenerCount,0);},
  };
}

test('late cold-session hydration cannot override a newer synchronous open',async()=>{
  const f=delayedOpenFixture();
  assert.equal(f.open('child-a'),true);
  assert.equal(f.open('b'),true);
  await f.settle();
  assert.deepEqual(f.opened,['b']);
  assert.deepEqual(f.callbacks,['b']);
  f.assertReleased();
});

test('newer asynchronous open supersedes the older request even when hydration finishes out of order',async()=>{
  const f=delayedOpenFixture();
  assert.equal(f.open('child-a'),true);
  const first=f.pending.splice(0);
  assert.equal(f.open('child-b'),true);
  await f.settle();
  await f.settle(first);
  assert.deepEqual(f.opened,[{parentSessionId:'a',childSessionId:'child-b',mode:'continuable'}]);
  assert.deepEqual(f.callbacks,f.opened);
  f.assertReleased();
});

test('public rc.4 selection changes revoke hydration even after returning to the original session',async()=>{
  const f=delayedOpenFixture();
  f.open('child-a');
  // A native selection can change independently of the helper and layout panel notifications.
  f.selection.set({...f.selection.getSnapshot(),key:'b'});
  f.selection.set({...f.selection.getSnapshot(),key:'a'});
  await f.settle();
  assert.deepEqual(f.opened,[]);
  assert.deepEqual(f.callbacks,[]);
  f.assertReleased();
});

test('clearing public selection revokes hydration even while old mainView retention is still listed',async()=>{
  const f=delayedOpenFixture();
  f.sessionList.byId.a.retainedBy={mainView:1};
  f.open('child-a');
  f.selection.set({...f.selection.getSnapshot(),key:undefined});
  await f.settle();
  assert.deepEqual(f.opened,[]);
  assert.deepEqual(f.callbacks,[]);
  f.assertReleased();
});

test('native pending navigation revokes a cold open before its destination is selected',async()=>{
  const f=delayedOpenFixture();
  f.open('child-a');
  f.ctx.layout.beginNavigation();
  await f.settle();
  assert.deepEqual(f.opened,[]);
  assert.deepEqual(f.callbacks,[]);
  f.assertReleased();
});

test('moving the selected session to another workspace revokes pending hydration even after moving back',async()=>{
  const f=delayedOpenFixture();
  f.open('child-a');
  const initial=f.workspaces.getSnapshot();
  f.workspaces.set({...initial,items:[{workspaceId:'ws-a',sessionIds:['b']},{workspaceId:'ws-b',sessionIds:['a']}]});
  f.workspaces.set(initial);
  await f.settle();
  assert.deepEqual(f.opened,[]);
  assert.deepEqual(f.callbacks,[]);
  f.assertReleased();
});

test('same-target retries and unrelated projection updates remain valid and open only once',async()=>{
  const f=delayedOpenFixture();
  f.open('child-a');
  const first=f.pending.splice(0);
  f.open('child-a');
  f.selection.set({...f.selection.getSnapshot(),props:{metadataUpdated:true}});
  f.workspaces.set({...f.workspaces.getSnapshot(),pinnedSessionIds:['b']});
  await f.settle(first);
  assert.deepEqual(f.opened,[],'superseded retry cannot open before the latest request resolves');
  await f.settle();
  assert.deepEqual(f.opened,[{parentSessionId:'a',childSessionId:'child-a',mode:'continuable'}]);
  assert.deepEqual(f.callbacks,f.opened);
  f.assertReleased();
});

test('same-target retry also opens once when rc.4 shares the in-flight projection promises',async()=>{
  const f=delayedOpenFixture(),inflight=new Map();
  const refresh=f.ctx.sessions.refreshProjections;
  f.ctx.sessions.refreshProjections=id=>{
    if(!inflight.has(id))inflight.set(id,refresh(id));
    return inflight.get(id);
  };
  f.open('child-a');
  f.open('child-a');
  assert.equal(f.pending.length,2,'one shared child read and one shared parent read');
  await f.settle();
  assert.deepEqual(f.opened,[{parentSessionId:'a',childSessionId:'child-a',mode:'continuable'}]);
  assert.deepEqual(f.callbacks,f.opened);
  f.assertReleased();
});

test('failed refresh releases navigation observers and a later retry can still open',async()=>{
  const f=delayedOpenFixture();
  f.open('child-a');
  await f.settle(undefined,true);
  assert.deepEqual(f.opened,[]);
  f.assertReleased();
  assert.equal(f.open('child-a'),true);
  await f.settle();
  assert.equal(f.opened.length,1);
  f.assertReleased();
});
