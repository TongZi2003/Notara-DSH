import test from 'node:test';
import assert from 'node:assert/strict';
import { installCrossSessionTabSync } from '../src/cross-session-tabs.js';

const settle = () => new Promise(resolve => queueMicrotask(resolve));
function signal(initial) {
  let value = initial;
  const listeners = new Set();
  return { getSnapshot: () => value, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }, set(next) { value = next; for (const fn of [...listeners]) fn(); } };
}
function fixture() {
  const layouts = new Map(), occurrences = new Map(), mutations = [], workspaces = new Map([['a', 'one'], ['b', 'one'], ['c', 'two']]);
  let nextId = 0, publishing = 0;
  const mounted = signal(undefined), openTabs = signal([]);
  // Match native adopt.sync: publish the inventory BEFORE reconciling occurrences.
  const commit = (id, layout) => {
    layouts.set(id, layout);
    publishing++;
    try { openTabs.set([...layouts.entries()].flatMap(([sessionId, value]) => value.tabs.map(tab => ({ ...tab, sessionId })))); }
    finally { publishing--; }
    occurrences.set(id, new Map(layout.tabs.map(tab => [tab.id, { navigation: { getSnapshot: () => ({ address: tab.contentId, params: tab.params }) } }])));
  };
  const mutate = (action, change) => {
    const id = mounted.getSnapshot();
    mutations.push({ action, id, publishing });
    commit(id, change(layouts.get(id)));
  };
  const sidebar = {
    mounted, openTabs, tabsIn: id => layouts.get(id)?.tabs ?? [],
    tabDomain: { occurrence(id, tab) { const value = occurrences.get(id)?.get(tab.id); assert.ok(value, `missing committed occurrence: ${id}/${tab.id}`); return value; } },
    active: () => { const l = layouts.get(mounted.getSnapshot()); return l?.tabs.find(tab => tab.id === l.active); },
    isExpanded: () => layouts.get(mounted.getSnapshot())?.expanded ?? false,
    close: id => mutate('close', l => ({ ...l, tabs: l.tabs.filter(tab => tab.id !== id) })),
    openResource: (address, { params }) => mutate('open', l => { const tab = { id: `new-${++nextId}`, kind: address.includes('/graph/') ? 'notara-graph-page' : 'notara-doc', contentId: address, params }; return { ...l, tabs: [...l.tabs, tab], active: tab.id, expanded: true }; }),
    focus: id => mutate('focus', l => ({ ...l, active: id })),
    toggleExpanded: () => mutate('toggle', l => ({ ...l, expanded: !l.expanded })),
  };
  const initialize = (id, docs = [], expanded = false) => commit(id, {
    tabs: [{ id: `guide-${id}`, kind: 'guide', contentId: 'dsh-page://guide' }, ...docs.map((address, i) => ({ id: `${id}-${i}`, kind: 'notara-doc', contentId: address, params: { workspaceId: workspaces.get(id), path: address } }))],
    active: `guide-${id}`, expanded,
  });
  const dispose = installCrossSessionTabSync(sidebar, { workspaceForSession: id => workspaces.get(id) ?? null, kinds: ['notara-doc', 'notara-graph-page'] });
  return { sidebar, mounted, openTabs, layouts, mutations, workspaces, initialize, dispose,
    clear: id => commit(id, { tabs: [], expanded: false, active: undefined }),
    documents: id => sidebar.tabsIn(id).filter(tab => tab.kind !== 'guide').map(tab => tab.contentId),
    assertCommitted: id => { for (const tab of sidebar.tabsIn(id)) sidebar.tabDomain.occurrence(id, tab); },
  };
}
const doc = 'dsh-resource://notara-vault/doc/lesson';

test('initialization and temporarily unmounted seats do not access an absent pending scope', async () => {
  const f = fixture(); await settle();
  f.initialize('a', [doc]); f.mounted.set('a'); await settle();
  f.mounted.set(undefined); await settle();
  f.mounted.set('a'); await settle();
  assert.deepEqual(f.documents('a'), [doc]);
  f.dispose();
});

test('closing every tab clears the shared snapshot, including before an immediate switch', async () => {
  for (const immediate of [false, true]) {
    const f = fixture(); f.initialize('a', [doc]); f.mounted.set('a'); await settle();
    f.initialize('b'); f.clear('a');
    if (!immediate) await settle();
    f.mounted.set('b'); await settle();
    assert.deepEqual(f.documents('b'), [], 'closed documents are not reopened in another session');
    f.assertCommitted('b'); f.dispose();
  }
});

test('a released native store with saved tabs must not be mistaken for a user-cleared layout', async () => {
  const f = fixture(); f.initialize('b'); f.initialize('a', [doc]); f.mounted.set('a'); await settle();
  f.layouts.delete('a'); // Native release leaves its metadata in openTabs.
  f.mounted.set('b'); await settle();
  assert.deepEqual(f.documents('b'), [doc]);
  f.dispose();
});

test('first expansion in a fresh session commits every adopted tab without reentering native publication', async () => {
  const f = fixture();
  f.initialize('a', [doc]); f.mounted.set('a'); await settle();
  f.mounted.set('b'); await settle(); // B has no adopted store yet.
  f.initialize('b', [], true); await settle();
  assert.deepEqual(f.documents('b'), [doc]);
  f.assertCommitted('b');
  assert.ok(f.mutations.every(row => row.publishing === 0), 'no layout writes inside inventory notifications');
  assert.equal(f.sidebar.isExpanded(), true);
  assert.equal(f.sidebar.active().id, 'guide-b');
  f.dispose();
});

test('coalesced notifications use the latest target and never import another workspace', async () => {
  const f = fixture(); f.initialize('a', [doc]); f.mounted.set('a'); await settle();
  f.initialize('b'); f.initialize('c');
  f.mounted.set('b'); f.mounted.set('c'); await settle();
  assert.deepEqual(f.documents('b'), []);
  assert.deepEqual(f.documents('c'), []);
  f.mounted.set('b'); await settle();
  assert.deepEqual(f.documents('b'), [doc]);
  assert.equal(f.sidebar.isExpanded(), false, 'preserves B collapsed preference');
  f.assertCommitted('b'); f.dispose();
});

test('an outgoing document edit in the same turn is captured before adopting the next session', async () => {
  const f = fixture(); f.initialize('a', [doc]); f.mounted.set('a'); await settle();
  const next = `${doc}-new`; f.initialize('a', [next]); f.initialize('b', [doc]); f.mounted.set('b'); await settle();
  assert.deepEqual(f.documents('b'), [next]);
  assert.deepEqual(f.sidebar.tabDomain.occurrence('b', f.sidebar.tabsIn('b').at(-1)).navigation.getSnapshot().params, { workspaceId: 'one', path: next });
  f.dispose();
});

test('workspace changes and disposal invalidate deferred work', async () => {
  const f = fixture(); f.initialize('a', [doc]); f.mounted.set('a'); await settle();
  f.initialize('b'); f.mounted.set('b'); f.workspaces.set('b', 'two'); await settle();
  assert.deepEqual(f.documents('b'), []);
  f.workspaces.set('b', 'one'); f.openTabs.set([]); f.dispose(); await settle();
  assert.deepEqual(f.documents('b'), []);
});

test('navigation between switching rooms and the deferred sync keeps newer opens and closes', async () => {
  const f = fixture(); f.initialize('a', [doc]); f.mounted.set('a'); await settle();
  f.initialize('b');
  f.mounted.set('b');
  const newer = `${doc}-new`;
  f.sidebar.openResource(newer, { params: { workspaceId: 'one', path: newer } });
  await settle();
  assert.deepEqual(new Set(f.documents('b')), new Set([doc, newer]));
  assert.equal(f.sidebar.active().contentId, newer, 'preserves the latest explicit navigation');
  f.mounted.set('a'); await settle();
  f.mounted.set('b');
  f.sidebar.close(f.sidebar.tabsIn('b').find(tab => tab.contentId === doc).id);
  await settle();
  assert.deepEqual(f.documents('b'), [newer], 'does not reopen a tab closed while sync was pending');
  f.dispose();
});
