import React from 'react';
import { createRoot } from 'react-dom/client';
import { HomeRecommend, HomeRecommendDock } from '../src/HomeRecommend.jsx';

let snapshot = { byId: { s1: { id: 's1', retainedBy: { mainView: 1 } }, s_class: { id: 's_class', retainedBy: {} } } };
const listeners = new Set();
let draft = '保留我的草稿【已选资料】';
let draftRev = 1;
let occurrences = [{ source: 'existing', ref: 'original', length: 6 }];
let pending = [];
const calls = [];
const openedSessions = [];
let root;
let session = { sessionId: 's1', blank: true, running: false, promptAttempted: false, removed: false };
const conversation = { activeTargets: new Set() };
const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
const useConversation = selector => React.useSyncExternalStore(subscribe, () => selector(conversation));
function DockFixture() {
  const current = React.useSyncExternalStore(subscribe, () => session);
  return <HomeRecommendDock ctx={ctx} session={current} useConversation={useConversation} />;
}
const input = {
  state: { getSnapshot: () => ({ phase: 'plain', draft, draftRev, occurrences }) },
  insertReference(reference, span) {
    calls.push({ kind: 'reference', reference, span });
    draft += reference.clipboardText; draftRev++;
    occurrences = [...occurrences, { ...reference, length: reference.clipboardText.length }];
    return true;
  },
};
const scope = { bail(_scope, event, payload) {
  calls.push({ event, payload }); draft += payload.text; draftRev++; return true;
} };
const uiWorkspace = { openSession(id) { openedSessions.push(id); } };
const ctx = {
  get(name) { return name === 'uiWorkspace' ? uiWorkspace : undefined; },
  remote: { notaraVault: { homeSession: async () => ({ ok: true, value: { sessionId: 's1' } }), homeRecommendations() { return new Promise((resolve, reject) => pending.push({ resolve, reject })); } } },
  sessions: { list: { getSnapshot: () => snapshot, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } }, scope: () => scope },
  conversation: { input: { for: () => input }, blocks: { storeFor: () => ({ getSnapshot: () => null }) } },
};
window.fixture = {
  mount(needsWorkspace = false) {
    root = createRoot(document.getElementById('root'));
    root.render(<HomeRecommend ctx={ctx} needsWorkspace={needsWorkspace} nativeWorkspaceSelector={<button type="button">选择学习目录</button>} />);
  },
  mountDock() { root = createRoot(document.getElementById('root')); root.render(<DockFixture />); },
  beginConversation() { session = { ...session, promptAttempted: true }; listeners.forEach(listener => listener()); },
  resolve(value, index = 0) { pending[index].resolve({ ok: true, value }); },
  resolveResult(result, index = 0) { pending[index].resolve(result); },
  reject(index = 0) { pending[index].reject(new Error('INTERNAL_PRIVATE_PATH')); },
  emitVaultUpdate(path = '路线/主路线.md') {
    window.dispatchEvent(new CustomEvent('notara:vault-updated', { detail: { path, workspaceId: undefined } }));
  },
  emitSessionUpdate() {
    snapshot = {
      ...snapshot,
      byId: {
        ...snapshot.byId,
        s_class: { id: 's_class', retainedBy: {}, running: false, updatedAt: Date.now() },
        s_child: { id: 's_child', origin: 'subagent', parentId: 's1', retainedBy: {} },
      },
      projectionsBySession: {
        s1: { values: { subagentCatalog: [{ id: 's_child', mode: 'continuable', label: '导数专题课' }] } },
        s_child: { values: { agentPreset: 'notara-teacher', subagent: { mode: 'continuable' } } },
      },
    };
    listeners.forEach(listener => listener());
  },
  switchSession() { snapshot = { byId: { s2: { id: 's2', retainedBy: { mainView: 1 } } } }; listeners.forEach(listener => listener()); },
  unmount() { root.unmount(); },
  getState: () => ({ draft, occurrences, calls, openedSessions, pending: pending.length, subscriptions: listeners.size }),
};
