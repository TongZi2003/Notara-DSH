/** Share resource addresses; each native session owns its own tab occurrences. */
export function installCrossSessionTabSync(sidebar, { workspaceForSession, kinds, subscribeScope }) {
  const byWorkspace = new Map();
  let last, pending, queued = false, syncing = false, disposed = false;
  const isShared = tab => kinds.includes(tab.kind);
  const scope = () => {
    const sessionId = sidebar.mounted.getSnapshot();
    return sessionId ? { sessionId, workspaceId: workspaceForSession(sessionId) } : null;
  };
  const sameScope = (a, b) => a?.sessionId === b?.sessionId && a?.workspaceId === b?.workspaceId;
  const capture = target => {
    if (!target || target.workspaceId === null || workspaceForSession(target.sessionId) !== target.workspaceId) return;
    const tabs = sidebar.tabsIn(target.sessionId);
    // capture is called only for a scope that has already supplied committed tabs.
    // Released native stores can be empty while their saved inventory still exists;
    // a genuinely cleared layout removes those inventory rows too.
    if (!tabs.length && sidebar.openTabs.getSnapshot().some(tab => tab.sessionId === target.sessionId)) return;
    byWorkspace.set(target.workspaceId, tabs.filter(isShared).map(tab => {
      const nav = sidebar.tabDomain.occurrence(target.sessionId, tab).navigation.getSnapshot();
      return { address: nav.address, params: nav.params };
    }));
  };
  const flush = () => {
    queued = false;
    if (disposed) return;
    const target = scope();
    const baseline = sameScope(pending?.scope, target) ? pending?.addresses : undefined;
    pending = undefined;
    // A tab may have changed immediately before switching rooms, in the same turn.
    // Read the outgoing committed layout before replacing the workspace snapshot.
    if (!sameScope(last, target)) capture(last);
    if (!target || target.workspaceId === null) return;
    if (!sidebar.tabsIn(target.sessionId).length) {
      if (sameScope(last, target)) capture(target);
      return; // A never-opened target still waits for its native surface.
    }
    if (!sameScope(last, target)) {
      const shared = byWorkspace.get(target.workspaceId);
      if (shared) {
        const present = new Set(sidebar.tabsIn(target.sessionId).filter(isShared).map(tab => tab.contentId));
        // Explicit navigation while this sync was queued wins over the shared snapshot.
        const removed = new Set((baseline ?? []).filter(address => !present.has(address)));
        const added = new Set([...present].filter(address => baseline && !baseline.includes(address)));
        const current = () => !disposed && sameScope(scope(), target);
        const active = sidebar.active(), expanded = sidebar.isExpanded();
        syncing = true;
        try {
          for (const tab of sidebar.tabsIn(target.sessionId)) {
            if (!current()) return;
            if (isShared(tab) && !added.has(tab.contentId) && !shared.some(doc => doc.address === tab.contentId)) sidebar.close(tab.id);
          }
          for (const doc of shared) {
            if (!current()) return;
            if (!removed.has(doc.address) && !sidebar.tabsIn(target.sessionId).some(tab => isShared(tab) && tab.contentId === doc.address)) {
              sidebar.openResource(doc.address, { params: doc.params });
            }
          }
          if (!current()) return;
          if (active && sidebar.tabsIn(target.sessionId).some(tab => tab.id === active.id)) sidebar.focus(active.id);
          if (current() && !expanded && sidebar.isExpanded()) sidebar.toggleExpanded();
        } finally { syncing = false; }
      }
    }
    if (!sameScope(scope(), target)) return;
    last = target;
    capture(target);
  };
  const schedule = () => {
    if (disposed || syncing) return;
    const target = scope();
    if (!sameScope(pending?.scope, target)) pending = { scope: target };
    const tabs = target && sidebar.tabsIn(target.sessionId);
    // Metadata is already published; occurrence reads and all writes wait for flush.
    if (pending && !pending.addresses && tabs?.length) pending.addresses = tabs.filter(isShared).map(tab => tab.contentId);
    if (queued) return;
    queued = true;
    // Native inventory notifications run BEFORE tabDomain.sync commits occurrences.
    // Never read occurrences or issue layout commands from inside that notification.
    queueMicrotask(flush);
  };
  const disposers = [sidebar.mounted.subscribe(schedule), sidebar.openTabs.subscribe(schedule), subscribeScope?.(schedule)];
  schedule();
  return () => { disposed = true; disposers.forEach(dispose => dispose?.()); };
}
