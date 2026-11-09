// `guide` belongs to the native start page (browser, files and other providers).
export const LIBRARY_KIND = 'notara-library';

/** All material entry points return to the native conversation before using its tabs. */
export function createWorkspaceNavigation({ layout, sidebar, currentSession, sessionSource, panels, beforeOpen,
  defer = callback => typeof requestAnimationFrame === 'function' ? requestAnimationFrame(callback) : queueMicrotask(callback),
}) {
  let pending = null, disposed = false, flushing = false, queued = false;
  const flush = () => {
    if (disposed || !pending || flushing) return;
    const sessionId = currentSession();
    // During initial hydration both values can be undefined; equality does not mean a seat exists.
    if (!sessionId || !sidebar.mounted.getSnapshot()) return;
    if (pending.sessionId == null) pending.sessionId = sessionId;
    if (sessionId !== pending.sessionId) { pending = null; return; }
    if (layout.panelInfo.getSnapshot().activePanelId != null || sidebar.mounted.getSnapshot() !== pending.sessionId) return;
    // An adopted surface may legitimately have no tabs until its first open.
    // The native open command creates that initial layout.
    const request = pending;
    flushing = true;
    try { request.run(); if(pending === request) pending = null; }
    catch (error) {
      // mounted is published before the native store is adopted. Empty adoption
      // emits no inventory change, so allow a bounded retry across render frames.
      if (error?.message === 'sidebarRight: no session surface is mounted' && pending === request && request.retries < 3) {
        request.retries++;
        schedule();
      } else { if (pending === request) pending = null; throw error; }
    }
    finally { flushing = false; }
  };
  const schedule = () => {
    if (disposed || queued) return;
    queued = true;
    // Selection notifications precede the native store's adoption/commit. Let
    // the rendered seat settle before opening, without reentering inventory sync.
    defer(() => { queued = false; flush(); });
  };
  const open = run => {
    if (disposed) return;
    beforeOpen?.();
    pending = { sessionId: currentSession(), run, retries: 0 };
    // A temporarily unbound seat is not a different application layout.
    layout.selectPanel(null);
    schedule();
  };
  const onPanel = () => {
    const id = layout.panelInfo.getSnapshot().activePanelId;
    const panel = panels.find(item => item.id === id);
    if (panel) open(panel.run);
    else if (id != null) pending = null;
  };
  const disposers = [sidebar.mounted.subscribe(schedule), sidebar.openTabs.subscribe(schedule), layout.panelInfo.subscribe(onPanel), sessionSource?.subscribe(schedule)];
  onPanel();
  return { open, dispose() { disposed = true; pending = null; disposers.forEach(off => off?.()); } };
}
