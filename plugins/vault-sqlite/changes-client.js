import { symbols } from '@deepseek-ai/cordis';

// Cordis returns a new tracing wrapper on each service access. Unwrap only the
// identity used for sharing; all calls still use the caller's traced service.
const sourceIdentity = remote => remote?.[symbols.original] ?? remote;
const registryKey = Symbol.for('@oh-my-student/vault-changes/v2');
const { bindings, feeds, eventSources } = globalThis[registryKey] ??= { bindings: new WeakMap(), feeds: new WeakMap(), eventSources: new WeakMap() };

export function vaultChangeIncludes(change, path) {
  return !!(change.reset || change.path === path || change.changes?.some(item => item.path === path));
}

function dispatch(source, workspaceId, detail) {
  const event = new CustomEvent('notara:vault-updated', { detail: { ...detail, workspaceId } });
  eventSources.set(event, source);
  window.dispatchEvent(event);
}

/** Publish the actual saved revision, so the stream echo is the same update. */
export function notifyVaultChanged(facade, detail, workspace = facade?.workspaceId) {
  if (typeof window === 'undefined') return;
  const { remote, workspaceId } = bindings.get(facade) ?? { remote: facade, workspaceId: workspace };
  const source = sourceIdentity(remote), feed = source && feeds.get(source)?.get(workspaceId);
  if (feed) feed.enqueue(detail);
  else dispatch(source, workspaceId, detail);
}

export function bindChangeSource(facade, remote, workspaceId) {
  bindings.set(facade, { remote, workspaceId });
  return facade;
}

export function vaultRemoteScope(facade) {
  const { remote, workspaceId } = bindings.get(facade) ?? { remote: facade, workspaceId: facade?.workspaceId };
  return { source: sourceIdentity(remote), workspaceId };
}

/** One cancellable stream per namespace/workspace, shared by its mounted views. */
export function subscribeVaultChanges(facade, listener, workspace = facade?.workspaceId) {
  const { remote, workspaceId } = bindings.get(facade) ?? { remote: facade, workspaceId: workspace };
  if (!remote || workspaceId === null || typeof window === 'undefined') return () => {};
  const source = sourceIdentity(remote);
  const changed = event => { if (event.detail?.workspaceId === workspaceId && (!eventSources.has(event) || eventSources.get(event) === source)) listener(event.detail); };
  window.addEventListener('notara:vault-updated', changed);
  let scopes = feeds.get(source);
  if (!scopes) feeds.set(source, scopes = new Map());
  let feed = scopes.get(workspaceId);
  if (!feed) {
    feed = { users: 0, stopped: false, stream: null, timer: null, resume: null, flushTimer: null };
    scopes.set(workspaceId, feed);
    const pending = new Map(), seen = new Map(); let reset = false;
    feed.enqueue = detail => {
      if (feed.stopped) return;
      if (detail.reset) { reset = true; seen.clear(); pending.clear(); }
      for (const change of detail.changes ?? (detail.path ? [detail] : [])) {
        if (change.revision !== undefined && seen.has(change.path) && seen.get(change.path) === change.revision) continue;
        if (change.revision === undefined) seen.delete(change.path);
        else { seen.delete(change.path); seen.set(change.path, change.revision); if (seen.size > 256) seen.delete(seen.keys().next().value); }
        pending.set(change.path, { path: change.path, revision: change.revision });
      }
      if ((!reset && !pending.size) || feed.flushTimer) return;
      feed.flushTimer = setTimeout(() => {
        feed.flushTimer = null;
        const changes = [...pending.values()], detail = { reset, changes, ...(changes.length === 1 ? changes[0] : {}) };
        pending.clear(); reset = false;
        dispatch(source, workspaceId, detail);
      }, 16);
    };
    const run = async () => {
      let delay = 500;
      while (!feed.stopped && typeof remote.changes === 'function') {
        try {
          feed.stream = remote.changes(workspaceId === undefined ? {} : { workspaceId });
          for await (const update of feed.stream) {
            if (feed.stopped) break;
            delay = 500;
            // A fresh subscription also covers changes missed while disconnected.
            feed.enqueue(update);
          }
        } catch { /* Reopen the subscription after a lost connection; no data polling. */ }
        finally { feed.stream?.dispose?.(); feed.stream = null; }
        if (feed.stopped) break;
        await new Promise(resolve => { feed.resume = resolve; feed.timer = setTimeout(resolve, delay); });
        feed.resume = null; feed.timer = null;
        delay = Math.min(delay * 2, 15000);
      }
    };
    void run();
  }
  feed.users++;
  let disposed = false;
  return () => {
    if (disposed) return; disposed = true;
    window.removeEventListener('notara:vault-updated', changed);
    if (--feed.users) return;
    feed.stopped = true; scopes.delete(workspaceId);
    clearTimeout(feed.timer); clearTimeout(feed.flushTimer); feed.resume?.(); feed.stream?.dispose?.();
  };
}
