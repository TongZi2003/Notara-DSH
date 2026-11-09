import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceNavigation } from '../src/navigation.js';
const settle = () => new Promise(resolve => queueMicrotask(resolve));

function source(value) {
  const listeners = new Set();
  return { getSnapshot: () => value, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }, set(next) { value = next; [...listeners].forEach(fn => fn()); } };
}
function fixture(options = {}) {
  const panelInfo = source({ activePanelId: 'plugins' }), mounted = source(undefined), session = source('session-a'), opened = [], openTabs = source([{id:'guide'}]);
  const nav = createWorkspaceNavigation({ layout: { panelInfo, selectPanel(id) { panelInfo.set({ activePanelId: id }); } }, sidebar: { mounted, openTabs, tabsIn:()=>openTabs.getSnapshot() }, currentSession: () => session.getSnapshot(), sessionSource: session, panels: ['library', 'cards', 'graph', 'guides', 'review'].map(id => ({ id, run: () => opened.push(id) })), ...options });
  return { nav, panelInfo, mounted, session, opened, openTabs };
}
test('every material shortcut leaves a global panel and waits for the native seat', async () => {
  for (const id of ['library', 'cards', 'graph', 'guides', 'review']) {
    const f = fixture(); f.panelInfo.set({ activePanelId: id });
    assert.equal(f.panelInfo.getSnapshot().activePanelId, null); assert.deepEqual(f.opened, []);
    f.mounted.set('session-a'); assert.deepEqual(f.opened, []); await settle(); assert.deepEqual(f.opened, [id]); f.nav.dispose();
  }
});

test('an adopted but unopened native surface can create its first material tab', async () => {
  const f=fixture();f.openTabs.set([]);f.panelInfo.set({activePanelId:'library'});
  f.mounted.set('session-a');await settle();assert.deepEqual(f.opened,['library']);f.nav.dispose();
});
test('latest navigation wins and session changes cannot redirect another conversation', async () => {
  const f = fixture(); f.panelInfo.set({ activePanelId: 'library' }); f.nav.open(() => f.opened.push('document'));
  f.mounted.set('session-a'); await settle(); assert.deepEqual(f.opened, ['document']);
  f.mounted.set(undefined); f.nav.open(() => f.opened.push('stale')); f.session.set('session-b'); f.mounted.set('session-b');
  await settle(); assert.deepEqual(f.opened, ['document']); f.nav.dispose();
});
test('another global panel cancels a pending material jump', async () => {
  const f = fixture(); f.panelInfo.set({ activePanelId: 'cards' }); f.panelInfo.set({ activePanelId: 'plugins' }); f.mounted.set('session-a');
  await settle(); assert.deepEqual(f.opened, []); f.nav.dispose();
});

test('initial unbound session and seat cannot execute a material navigation', async () => {
  const f = fixture(); f.session.set(undefined);
  f.nav.open(() => f.opened.push('early click'));
  assert.deepEqual(f.opened, []);
  f.session.set('session-a'); assert.deepEqual(f.opened, []);
  f.mounted.set('session-a'); await settle(); assert.deepEqual(f.opened, ['early click']);
  f.nav.dispose();
});

test('disposing before deferred navigation leaves the layout alone', async () => {
  const f = fixture(); f.mounted.set('session-a'); f.nav.open(() => f.opened.push('late'));
  f.nav.dispose(); await settle(); assert.deepEqual(f.opened, []);
});

test('native store adoption after the first frame retries without requiring nonempty inventory', () => {
  const frames = [], f = fixture({ defer: callback => frames.push(callback) });
  let adopted = false, opened = 0;
  f.mounted.set('session-a'); f.openTabs.set([]);
  f.nav.open(() => { if (!adopted) throw new Error('sidebarRight: no session surface is mounted'); opened++; });
  assert.doesNotThrow(() => frames.shift()());
  adopted = true; // Native empty-to-empty inventory adoption does not emit a notification.
  frames.shift()();
  assert.equal(opened, 1); assert.equal(frames.length, 0);
  f.nav.dispose();
});

test('store readiness retries are bounded and never retry an unrelated error', () => {
  for (const message of ['sidebarRight: no session surface is mounted', 'document provider failed']) {
    const frames = [], f = fixture({ defer: callback => frames.push(callback) });
    let attempts = 0;
    f.mounted.set('session-a');
    f.nav.open(() => { attempts++; throw new Error(message); });
    assert.throws(() => { while (frames.length) frames.shift()(); }, new RegExp(message));
    assert.equal(attempts, message.startsWith('sidebarRight:') ? 4 : 1);
    assert.equal(frames.length, 0); f.nav.dispose();
  }
});
