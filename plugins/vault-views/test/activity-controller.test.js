import test from 'node:test';
import assert from 'node:assert/strict';
import { createActivityController } from '../src/activity-controller.js';
function observable(value) {
  const listeners = new Set();
  return { getSnapshot: () => value, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }, set(next) { value = next; for (const fn of listeners) fn(); } };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture({ delayed = false } = {}) {
  const catalog = observable([{ id: 'child', label: '核对', mode: 'one-shot', createdAt: 1 }]);
  const bindings = new Map(), held = new Map(), watching = new Map(), pending = [];
  for (const id of ['parent', 'child', 'other']) {
    const state = observable({ hasMore: false }), timing = observable({ lastTurnCompleted: true }), children = id === 'parent' ? catalog : observable([]);
    bindings.set(id, { sessionId: id, session: { ...state, projections: { faceOf: key => key === 'subagentCatalog' ? children : timing } }, chat: observable({ nodes: { values: () => [] } }) });
  }
  const list = observable({ byId: { parent: { id: 'parent', cwd: '/vault', retainedBy: { mainView: 1 } },child:{id:'child',origin:'subagent',parentId:'parent'},other:{id:'other',origin:'subagent',parentId:'child'} } });
  const kills = [];
  const jobs = { state: observable({ rows: {}, observed: {} }), async kill(owner, id) { kills.push([owner, id]); return { ok: true }; }, watchRows(id) { watching.set(id, (watching.get(id) ?? 0) + 1); return () => watching.set(id, watching.get(id) - 1); } };
  const sessions = { list, retain(target, options) {
    assert.equal(options.source, 'notaraActivity');
    const id = typeof target === 'string' ? target : target.childSessionId;
    held.set(id, (held.get(id) ?? 0) + 1);
    let live = true;
    const ready = delayed ? new Promise(resolve => pending.push(() => resolve(bindings.get(id)))) : Promise.resolve(bindings.get(id));
    return { ready, release() { assert.ok(live, 'release once'); live = false; held.set(id, held.get(id) - 1); } };
  } };
  const workspace = { list: observable({ items: [{ workspaceId: 'a', path: '/vault', sessionIds: ['parent', 'other'] }] }) };
  const mainOpened=[];
  const ctx = { sessions, get: key => ({ jobs, workspaces: workspace, uiWorkspace:{openSession:id=>mainOpened.push(id)}, uiConversation: { binding: binding => ({ target: () => binding.chat }) } })[key] };
  const opened=[];
  return {ctx,mainOpened, controller: createActivityController(ctx,{openAgent:address=>opened.push(address)}), opened, held, watching, bindings, pending, list, jobs, kills };
}

test('activity opens the same native child in a tab, rejects stale scope and never interrupts it',async()=>{
  const f=fixture();f.controller.setOpen(true);await settle();await settle();
  const child=f.controller.getSnapshot().data.agents[0];f.controller.openAgent(child);
  assert.deepEqual(f.opened,[{parentSessionId:'parent',childSessionId:'child',mode:'one-shot'}]);assert.equal(f.controller.getSnapshot().open,false);
  assert.equal(f.held.get('child'),0);
  f.controller.openAgent({...child,id:'unrelated'});assert.equal(f.opened.length,1);
  f.list.set({byId:{other:{id:'other',cwd:'/vault',retainedBy:{mainView:1}}}});f.controller.openAgent(child);assert.equal(f.opened.length,1);await settle();
  assert.equal(f.held.get('child'),0);assert.deepEqual(f.kills,[]);f.controller.dispose();
});
test('nested tasks keep their actual direct parent when opened from root activity',async()=>{
  const f=fixture();f.bindings.get('child').session.projections.faceOf('subagentCatalog').set([{id:'other',label:'下一级',mode:'continuable'}]);
  f.controller.setOpen(true);await settle();await settle();await settle();
  const nested=f.controller.getSnapshot().data.agents.find(row=>row.id==='other');assert.equal(nested.address.parentSessionId,'child');
  f.controller.openAgent(nested);assert.equal(f.opened[0].childSessionId,'other');assert.equal(f.opened[0].parentSessionId,'child');
  f.controller.openFrom('unrelated');assert.equal(f.controller.getSnapshot().open,false);
  f.controller.openFrom('child');assert.equal(f.controller.getSnapshot().open,true);
  f.controller.setOpen(false);f.list.set({byId:{other:{id:'other',cwd:'/vault',retainedBy:{mainView:1}}}});
  f.controller.openFrom('child');assert.equal(f.controller.getSnapshot().open,false);
  await settle();f.controller.dispose();
});
test('restored child receipt opens activity before its catalog has loaded',async()=>{
  const f=fixture();assert.equal(f.controller.getSnapshot().data.agents.length,0);
  f.controller.openFrom('other');assert.equal(f.controller.getSnapshot().open,true);
  f.controller.setOpen(false);
  f.list.set({byId:{parent:{id:'parent',retainedBy:{mainView:1}},child:{id:'child',origin:'subagent',parentId:'other'},other:{id:'other',origin:'subagent',parentId:'child'}}});
  f.controller.openFrom('other');assert.equal(f.controller.getSnapshot().open,false);
  f.controller.dispose();
});
test('opening owns native references/streams, closing releases them and never stops host work', async () => {
  const f = fixture(); f.controller.setOpen(true); await settle(); await settle();
  assert.equal(f.held.get('parent'), 1); assert.equal(f.held.get('child'), 1);
  assert.equal(f.controller.getSnapshot().data.agents[0].status, '已完成');
  f.controller.setOpen(false); await settle();
  assert.deepEqual([...f.held.values()], [0, 0]); assert.deepEqual([...f.watching.values()], [0, 0]);
  f.controller.dispose();
});
test('late history completion cannot repopulate a closed panel or the next session', async () => {
  const f = fixture({ delayed: true }); f.controller.setOpen(true); f.controller.setOpen(false);
  f.pending.splice(0).forEach(resolve => resolve()); await settle();
  assert.equal(f.held.get('parent'), 0);
  assert.equal(f.controller.getSnapshot().data.agents.length, 0);
  f.controller.setOpen(true); await settle();
  f.list.set({ byId: { other: { id: 'other', cwd: '/vault', retainedBy: { mainView: 1 } } } }); await settle();
  f.pending.splice(0).forEach(resolve => resolve()); await settle();
  assert.equal(f.controller.getSnapshot().sessionId, 'other');
  assert.equal(f.controller.getSnapshot().open, false);
  assert.equal(f.controller.getSnapshot().data.agents.length, 0);
  assert.equal(f.held.get('parent'), 0);
  f.controller.dispose(); assert.equal(f.held.get('other') ?? 0, 0);
});
test('a child header opens its own activity and switching owners clears all previous facts',async()=>{
  const f=fixture();f.jobs.state.set({rows:{parent:[{id:'p',status:'running'}],child:[]}});
  f.controller.openFrom('parent');await settle();await settle();
  f.controller.openFrom('child');
  assert.equal(f.controller.getSnapshot().sessionId,'child');
  assert.equal(f.controller.getSnapshot().data.agents.length,0);
  await settle();await settle();
  assert.equal(f.held.get('parent'),0);
  assert.equal(f.held.get('child'),1);
  assert.equal(f.controller.getSnapshot().data.jobs.length,0);
  f.controller.toggle('child');assert.equal(f.controller.getSnapshot().open,false);
  f.controller.openFrom('parent');await settle();await settle();
  assert.equal(f.controller.getSnapshot().sessionId,'parent');
  assert.equal(f.controller.getSnapshot().data.agents[0].id,'child');
  f.controller.dispose();
});
test('normally resolved native history errors remain errors, including later stream failures', async () => {
  const f = fixture();
  f.bindings.get('parent').session.set({ openState: 'error', openError: { code: 'test' }, hasMore: false });
  f.controller.setOpen(true); await settle(); await settle();
  assert.equal(f.controller.getSnapshot().loading, false);
  assert.equal(f.controller.getSnapshot().error, true);
  f.bindings.get('parent').session.set({ openState: 'ready', hasMore: false }); await settle();
  assert.equal(f.controller.getSnapshot().error, false);
  f.bindings.get('parent').session.set({ openState: 'error', openError: { code: 'stream-lost' } }); await settle();
  assert.equal(f.controller.getSnapshot().error, true);
  f.controller.dispose();
});
test('stop is admitted only for a currently running job owned by this session or its child', async () => {
  const f = fixture(); f.controller.setOpen(true); await settle(); await settle();
  f.jobs.state.set({ rows: { parent: [{ id: 'own', owner: 'parent', kind: 'bash', status: 'running' }, { id: 'done', owner: 'parent', status: 'completed' }], child: [{ id: 'child-job', owner: 'child', status: 'running' }] } }); await settle();
  await f.controller.stopJob({ id: 'own', owner: 'parent' });
  await f.controller.stopJob({ id: 'child-job', owner: 'child' });
  await assert.rejects(() => f.controller.stopJob({ id: 'done', owner: 'parent' }));
  await assert.rejects(() => f.controller.stopJob({ id: 'own', owner: 'unrelated' }));
  assert.deepEqual(f.kills, [['parent', 'own'], ['child', 'child-job']]);
  f.controller.dispose();
});
test('child jobs and source navigation keep native child tabs; stale or foreign jobs cannot navigate',async()=>{
  const f=fixture(),address={parentSessionId:'parent',childSessionId:'child',mode:'one-shot'};
  f.ctx.sessions.subagentAddress=id=>id==='child'?address:undefined;
  f.jobs.state.set({rows:{parent:[{id:'p',owner:'parent',status:'running'}],child:[{id:'c',owner:'child',status:'running'}]}});
  f.controller.openFrom('child');await settle();await settle();
  f.controller.openJob({id:'c',owner:'child'});
  assert.deepEqual(f.opened,[address]);assert.deepEqual(f.mainOpened,[]);assert.equal(f.controller.getSnapshot().open,false);
  f.controller.openFrom('child');await settle();await settle();
  f.controller.openSource({sourceSessionId:'child'});assert.equal(f.opened.length,2);assert.deepEqual(f.mainOpened,[]);
  f.controller.openFrom('parent');await settle();await settle();
  f.controller.openJob({id:'c',owner:'unrelated'});assert.equal(f.opened.length,2);assert.deepEqual(f.mainOpened,[]);
  f.controller.openJob({id:'p',owner:'parent'});assert.deepEqual(f.mainOpened,['parent']);
  f.controller.openFrom('child');await settle();await settle();
  f.list.set({byId:{other:{id:'other',retainedBy:{mainView:1}}}});
  f.controller.openJob({id:'c',owner:'child'});assert.equal(f.opened.length,2);assert.deepEqual(f.mainOpened,['parent']);
  f.controller.dispose();
});

test('lesson checklist in activity is session-scoped, skips blank drafts, refreshes on Vault changes, never leaks into child subagents, and discards stale async responses', async t => {
  const prevWindow = globalThis.window;
  globalThis.window = new EventTarget();
  t.after(() => { globalThis.window = prevWindow; });

  const f = fixture();
  const lessonCalls = [];
  const deferredPlans = [];
  let delayLessonRpc = false;
  const changeWaiters = new Set();
  const pushVaultChange = changes => {
    for (const resolve of [...changeWaiters]) {
      changeWaiters.delete(resolve);
      resolve(changes);
    }
  };
  let parentRevision = 'rev-1';
  let parentCompleted = 0;
  const vault = {
    async lessonPlan(input) {
      lessonCalls.push(['lessonPlan', input]);
      if (delayLessonRpc) {
        return new Promise(resolve => deferredPlans.push(() => resolve({ ok: true, value: { sessionId: input.sessionId, bound: true, eligible: true, path: '晚到课稿.md', plan: { path: '晚到课稿.md', title: '晚到课稿', revision: 'late', counts: { total: 1, completed: 0, inProgress: 0, pending: 1 }, tasks: [] } } })));
      }
      if (input.sessionId === 'parent') {
        return {
          ok: true,
          value: {
            sessionId: 'parent',
            workspaceId: input.workspaceId,
            bound: true,
            eligible: true,
            missing: false,
            path: '备课/第一课.md',
            plan: {
              path: '备课/第一课.md',
              title: '第一课',
              revision: parentRevision,
              counts: { total: 2, completed: parentCompleted, inProgress: 0, pending: 2 - parentCompleted },
              progressLabel: `已完成 ${parentCompleted}`,
              tasks: [{ id: 'lt-1', line: 6, checked: parentCompleted > 0, status: parentCompleted > 0 ? 'completed' : 'pending', content: '推导第 1 步', expectedText: '推导第 1 步 <!-- notara-task:lt-1 -->' }],
            },
            candidates: [{ path: '备课/第一课.md', title: '第一课', revision: parentRevision }],
          },
        };
      }
      return { ok: true, value: { sessionId: input.sessionId, bound: false, eligible: false, missing: false, path: null, plan: null, candidates: [] } };
    },
    async bindLessonPlan(input) {
      lessonCalls.push(['bindLessonPlan', input]);
      return this.lessonPlan(input);
    },
    async toggleLessonTask(input) {
      lessonCalls.push(['toggleLessonTask', input]);
      parentCompleted = input.checked ? 1 : 0;
      parentRevision = 'rev-2';
      return this.lessonPlan(input);
    },
    async setCurrentLessonTask(input) {
      lessonCalls.push(['setCurrentLessonTask', input]);
      parentRevision = 'rev-3';
      return this.lessonPlan(input);
    },
    changes() {
      const control = new AbortController();
      async function* iterate() {
        yield { reset: true, changes: [] };
        while (!control.signal.aborted) {
          const next = await new Promise(resolve => {
            changeWaiters.add(resolve);
            control.signal.addEventListener('abort', () => { changeWaiters.delete(resolve); resolve(null); }, { once: true });
          });
          if (!next || control.signal.aborted) return;
          yield { reset: false, changes: next };
        }
      }
      const iterator = iterate();
      return { [Symbol.asyncIterator]: () => iterator, dispose() { control.abort(); } };
    },
  };
  f.ctx.remote = { notaraVault: vault };

  // 1. Blank draft session skips lessonPlan RPC completely.
  f.ctx.get('workspaces').list.set({ items: [{ workspaceId: 'a', path: '/vault', sessionIds: ['parent', 'draft'] }] });
  f.list.set({ byId: { draft: { id: 'draft', cwd: '/vault', blank: true, retainedBy: { mainView: 1 } } } });
  f.controller.setOpen(true);
  await settle(); await settle();
  assert.equal(lessonCalls.length, 0);
  assert.equal(f.controller.getSnapshot().lesson, null);
  f.controller.setOpen(false);

  // 2. Real parent classroom loads its bound lesson checklist and updates live on Vault changes + task mutations.
  f.list.set({ byId: { parent: { id: 'parent', cwd: '/vault', retainedBy: { mainView: 1 } }, child: { id: 'child', origin: 'subagent', parentId: 'parent' } } });
  f.controller.setOpen(true);
  await settle(); await settle(); await settle();
  assert.equal(f.controller.getSnapshot().lesson?.bound, true);
  assert.equal(f.controller.getSnapshot().lesson?.plan?.title, '第一课');
  assert.equal(f.controller.getSnapshot().lesson?.plan?.counts.completed, 0);

  await f.controller.toggleLessonTask(f.controller.getSnapshot().lesson.plan.tasks[0], true);
  assert.equal(f.controller.getSnapshot().lesson.plan.counts.completed, 1);
  assert.equal(f.controller.getSnapshot().lesson.plan.revision, 'rev-2');

  parentRevision = 'rev-external';
  pushVaultChange([{ path: '备课/第一课.md', revision: 'rev-external' }]);
  await new Promise(resolve=>setTimeout(resolve,35)); // Shared invalidations flush once per batch.
  await settle(); await settle(); await settle();
  assert.equal(f.controller.getSnapshot().lesson.plan.revision, 'rev-external');

  // 3. Opening child subagent activity never inherits parent's bound lesson checklist.
  f.controller.openFrom('child');
  await settle(); await settle(); await settle();
  assert.equal(f.controller.getSnapshot().sessionId, 'child');
  assert.equal(f.controller.getSnapshot().lesson?.bound, false);

  // 4. Late async lessonPlan completion after closing panel is discarded.
  delayLessonRpc = true;
  f.controller.openFrom('parent');
  await settle();
  f.controller.setOpen(false);
  deferredPlans.splice(0).forEach(resolve => resolve());
  await settle(); await settle();
  assert.equal(f.controller.getSnapshot().open, false);
  assert.equal(f.controller.getSnapshot().lesson, null);

  // 5. Archiving the classroom refreshes lesson scope immediately, and vault_session_archived translates cleanly.
  delayLessonRpc = false;
  f.controller.openFrom('parent');
  await settle(); await settle(); await settle();
  const callsBeforeArchive = lessonCalls.length;
  f.ctx.get('workspaces').list.set({ items: [{ workspaceId: 'a', path: '/vault', sessionIds: ['parent', 'draft'] }], archivedSessionIds: ['parent'] });
  await settle(); await settle(); await settle();
  assert.ok(lessonCalls.length > callsBeforeArchive, 'archiving classroom refreshes lessonPlan scope');
  vault.bindLessonPlan = async () => ({ ok: false, error: { code: 'vault_session_archived', message: 'vault_session_archived' } });
  await assert.rejects(() => f.controller.bindLesson(null), /已归档课堂为只读/);

  f.controller.dispose();
});
