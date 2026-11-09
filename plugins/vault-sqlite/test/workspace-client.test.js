import test from 'node:test';
import assert from 'node:assert/strict';
import { workspaceForSession, currentWorkspace, openLearningHome } from '../workspace-client.js';

test('a retained classroom inherits only its confirmed subagent ancestry workspace', () => {
  const items=[{workspaceId:'A',sessionIds:['parent']},{workspaceId:'B',sessionIds:['unrelated']}];
  const byId={child:{origin:'subagent',parentId:'parent'}, grandchild:{origin:'subagent',parentId:'child'}, fork:{origin:'fork',parentId:'parent'}, unrelated:{id:'unrelated',retainedBy:{mainView:1}}, loop1:{origin:'subagent',parentId:'loop2'},loop2:{origin:'subagent',parentId:'loop1'}};
  const ctx={sessions:{list:{getSnapshot:()=>({byId})},subagentAddress:id=>id==='address-only'?{childSessionId:id,parentSessionId:'parent'}:undefined},get:name=>name==='workspaces'?{list:{getSnapshot:()=>({items})}}:name==='uiSession'?{adapter:{current:{getSnapshot:()=>({key:'child'})}}}:undefined};
  for (const id of ['child','grandchild','address-only']) assert.equal(workspaceForSession(ctx,id),'A');
  assert.equal(currentWorkspace(ctx),'A','The explicitly selected classroom wins over unrelated retained mainView');
  for(const id of ['fork','unknown','loop1']) assert.equal(workspaceForSession(ctx,id),null);
  items[1].sessionIds.push('child'); assert.equal(workspaceForSession(ctx,'child'),'B','Explicit workspace membership takes precedence');
  assert.equal(workspaceForSession({get:()=>undefined},'child'),undefined);
});

test('home navigation waits for authority, ignores superseded navigation and never moves or sends drafts', async () => {
  const opened = [], pending = []; let navigation;
  const ctx = { get: name => name === 'uiWorkspace' ? { openSession: id => opened.push(id) } : undefined,
    layout: { beginNavigation: () => { navigation?.abort(); navigation = new AbortController(); return navigation.signal; }, selectPanel: () => {} },
    remote: { notaraVault: { homeSession: args => new Promise(resolve => pending.push({ args, resolve })) } },
    conversation: { input: { for: () => { throw Error('draft must remain with its native session'); } } } };
  const a = openLearningHome(ctx, 'A'), b = openLearningHome(ctx, 'B');
  pending[1].resolve({ ok: true, value: { sessionId: 'home-B' } }); assert.equal(await b, true);
  pending[0].resolve({ ok: true, value: { sessionId: 'home-A' } }); assert.equal(await a, false);
  assert.deepEqual(opened, ['home-B']); assert.deepEqual(pending[0].args, { workspaceId: 'A', open: true });
  const failed = openLearningHome(ctx, 'A'); pending[2].resolve({ ok: false });
  await assert.rejects(failed); assert.deepEqual(opened, ['home-B']);
});
