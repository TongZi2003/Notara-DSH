import React, { useEffect, useId, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { LIBRARY_KIND } from './navigation.js';

export const CONVERSATION_KIND = 'notara-conversation';
const PROVIDER = 'notara-conversation-surface';
const noSubscribe = () => () => {};
const noSnapshot = () => null;

/** Presentation only. The native Session remains the sole owner of messages/editor/draft. */
export function createConversationPresentation() {
  let value = { mode: 'floating', exclusive: false, fullscreen: false, shown: false, narrow: false, sessionId: null, chromeHost: null, owner: null, menu: null };
  const listeners = new Set();
  return {
    getSnapshot: () => value,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    update(patch) {
      if (Object.entries(patch).every(([key, next]) => value[key] === next)) return;
      value = { ...value, ...patch }; for (const listener of listeners) listener();
    },
    release(owner) { if (value.owner === owner) this.update({ owner: null }); },
  };
}

function useCurrentSession(ctx) {
  const source = ctx.sessions?.list;
  const snapshot = useSyncExternalStore(source ? l => source.subscribe(l) : noSubscribe, source ? () => source.getSnapshot() : noSnapshot);
  return Object.values(snapshot?.byId ?? {}).find(row => row.retainedBy?.mainView > 0);
}

function ConversationMenu({ controller, session }) {
  const { store, ctx } = controller, state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const ref = useRef(null);
  useEffect(() => {
    if (!state.menu) return;
    const close = event => {
      if (event.type === 'keydown' && event.key !== 'Escape') return;
      if (event.type === 'pointerdown' && (ref.current?.contains(event.target) || state.menu.trigger?.contains(event.target))) return;
      store.update({ menu: null });
      if (event.type === 'keydown') state.menu.trigger?.focus();
    };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', close);
    ref.current?.querySelector('button')?.focus();
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); };
  }, [state.menu]);
  useEffect(() => { store.update({ menu: null }); }, [session?.id]);
  if (!state.menu || !session) return null;
  const actions = id => ctx.slots.entries('sidebar.workspaces.session.menu.item').find(entry => entry.options.id === id)?.inject?.();
  const pin = actions('pin'), rename = actions('rename'), fork = actions('fork'), archive = actions('archive');
  const pinned = ctx.get('workspaces')?.list.getSnapshot()?.pinnedSessionIds?.includes(session.id);
  const run = action => { store.update({ menu: null }); action(); };
  return <div ref={ref} className="nv-conversation-menu" role="menu" aria-label="会话操作" style={{ left: Math.max(12, Math.min(state.menu.x - 210, window.innerWidth - 228)), top: Math.max(12, Math.min(state.menu.y, window.innerHeight - 390)) }}>
    {[['floating', '右下角悬浮'], ['left', '展开到左侧'], ['right', '展开到右侧'], ['exclusive', '独占显示'], ['minimized', '最小化']].map(([mode, label]) => <button role="menuitem" key={mode} onClick={() => run(() => controller.show(mode))}>{label}</button>)}
    <div className="nv-conversation-menu-separator" />
    {rename && <button role="menuitem" onClick={() => run(() => rename.requestSessionRename(session.id, session.displayTitle || '新会话'))}>重命名</button>}
    {pin && <button role="menuitem" onClick={() => run(() => (pinned ? pin.unpinSession : pin.pinSession)(session.id))}>{pinned ? '取消置顶' : '置顶会话'}</button>}
    {fork && <button role="menuitem" onClick={() => run(() => fork.forkSession(session.id))}>从这里分支</button>}
    {archive && <button role="menuitem" onClick={() => run(() => archive.archiveSession(session.id))}>归档会话</button>}
  </div>;
}

function ConversationChrome({ controller }) {
  const { ctx, store } = controller, session = useCurrentSession(ctx);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const mode = state.owner ? 'exclusive' : state.mode;
  useLayoutEffect(() => {
    const html = document.documentElement;
    html.dataset.notaraNavigation = '';
    if (state.narrow && state.shown && !state.exclusive) html.dataset.notaraMaterialsSplit = '';
    else delete html.dataset.notaraMaterialsSplit;
    if (state.fullscreen && session) { html.dataset.notaraConversationMode = mode; html.dataset.notaraWorkspaceFullscreen = ''; }
    else { delete html.dataset.notaraConversationMode; delete html.dataset.notaraWorkspaceFullscreen; }
    controller.measure();
    return () => { delete html.dataset.notaraConversationMode; delete html.dataset.notaraWorkspaceFullscreen; };
  }, [mode, state.fullscreen, state.narrow, state.shown, state.exclusive, session?.id]);
  useEffect(() => controller.observe(), [controller]);
  return <>
    {state.shown && state.chromeHost && createPortal(<button className="nv-workspace-mode" aria-label={state.exclusive ? '退出全屏' : '全屏'} title={state.exclusive ? '退出独占' : '独占工作区'} data-notara-workspace-mode={state.exclusive ? 'push' : 'fullscreen'} onClick={() => controller.setExclusive(!state.exclusive)}>
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><path d={state.exclusive ? 'M3 7h4V3m6 0v4h4M3 13h4v4m6 0v-4h4' : 'M7 3H3v4m10-4h4v4M3 13v4h4m6 0h4v-4'} /></svg>
    </button>, state.chromeHost)}
    {state.fullscreen && session && createPortal(<>
    {mode === 'minimized' ? <button className="nv-conversation-bubble" aria-label="展开悬浮会话" title="继续对话" onClick={() => controller.show('floating')}><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true"><path d="M20 11.5a8 8 0 0 1-8 8H4l1.6-4.2A8 8 0 1 1 20 11.5Z"/></svg></button>
      : mode !== 'exclusive' && <div className="nv-conversation-chrome" aria-label="悬浮会话操作栏">
        <span className="nv-conversation-chrome-title">{session.displayTitle || '当前会话'}</span>
        <button title="最小化" aria-label="最小化会话" onClick={() => controller.show('minimized')}>−</button>
        <button title="独占显示" aria-label="独占显示会话" onClick={() => controller.show('exclusive')}>↗</button>
        <button title="会话操作" aria-label="会话操作" aria-haspopup="menu" onClick={controller.openMenu}>⋯</button>
      </div>}
    <ConversationMenu controller={controller} session={session} />
    </>, document.body)}
  </>;
}

function ConversationTabTitle({ controller, useTabInfo, useStore, actions, sessionId }) {
  const session = useCurrentSession(controller.ctx);
  const info = useTabInfo();
  const layout = useStore(state => state.bySession[sessionId]?.layout);
  const presentation = useSyncExternalStore(controller.store.subscribe, controller.store.getSnapshot);
  useLayoutEffect(() => {
    if (!layout || !presentation.exclusive || presentation.sessionId !== sessionId || !layout.tabs[info.tab.id]) return;
    let firstPane = layout.nodes[layout.rootId];
    while (firstPane?.kind === 'split') firstPane = layout.nodes[firstPane.children[0]];
    if (firstPane?.kind !== 'pane' || firstPane.tabs[0] === info.tab.id) return;
    const active = layout.nodes[layout.activePaneId]?.activeTabId;
    // Share the native layout store: ordering survives reload and keyboard navigation.
    // Moving this fixed tab must not steal focus from the selected material.
    actions.placeTab(sessionId, info.tab.id, firstPane.id, 0);
    if (active && active !== info.tab.id && layout.tabs[active]) actions.focusTab(sessionId, active);
  }, [layout, presentation.exclusive, presentation.sessionId, sessionId, info.tab.id, actions]);
  return <span className="nv-conversation-chip" onPointerDown={event => event.stopPropagation()} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); controller.openMenu(event); }}><span>{session?.blank ? '会话' : session?.title || '会话'}</span><span role="button" tabIndex={0} aria-label="会话标签操作" aria-haspopup="menu" title="会话操作" onClick={controller.openMenu} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); controller.openMenu(event); } }}>⋯</span></span>;
}

function ConversationTab({ useTabInfo, controller }) {
  const info = useTabInfo(), ref = useRef(null), owner = useId();
  const state = useSyncExternalStore(controller.store.subscribe, controller.store.getSnapshot);
  const active = state.fullscreen && info.sidebar.expanded && info.tab.visible;
  useLayoutEffect(() => {
    if (!active) return;
    controller.store.update({ owner });
    controller.anchor = { owner, element: ref.current };
    const measure = () => {
      if (!ref.current || controller.store.getSnapshot().owner !== owner) return;
      const box = ref.current.getBoundingClientRect();
      for (const [name, value] of Object.entries({ left: box.left, top: box.top, width: box.width, height: box.height })) document.documentElement.style.setProperty(`--nv-chat-tab-${name}`, `${value}px`);
    };
    measure(); const observer = new ResizeObserver(measure); observer.observe(ref.current);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); if (controller.anchor?.owner === owner) controller.anchor = null; controller.store.release(owner); };
  }, [active, controller, owner]);
  return <div ref={ref} className="nv-conversation-tab-anchor" aria-label="当前会话内容" />;
}

export function installConversationSurface(ctx, sidebar, registry) {
  const store = createConversationPresentation();
  const lastMaterials = new Map();
  const closing = new Set();
  let ensuring = false, disposed = false, measureFrame = 0;
  const preferenceKey = sessionId => `notara.workspace-presentation.v1.${sessionId}`;
  const loadPreference = sessionId => {
    try { return JSON.parse(localStorage.getItem(preferenceKey(sessionId)) || 'null'); } catch { return null; }
  };
  const controller = {
    ctx, store,
    prepareMaterials() {
      if (!store.getSnapshot().shown || ctx.layout.panelInfo.getSnapshot().activePanelId != null) {
        controller.ordinaryOpen = true;
        controller.setExclusive(false);
      }
    },
    savePreference() {
      const { sessionId, exclusive, mode } = store.getSnapshot();
      if (sessionId) try { localStorage.setItem(preferenceKey(sessionId), JSON.stringify({ exclusive, mode })); } catch { /* Presentation still works without persistence. */ }
    },
    setExclusive(exclusive) {
      store.update({ exclusive, fullscreen: exclusive && store.getSnapshot().shown, menu: null });
      controller.savePreference(); controller.sync?.();
    },
    returnToConversation() {
      if (store.getSnapshot().exclusive) controller.show('exclusive');
      else if (window.innerWidth < 768 && sidebar.isExpanded()) sidebar.toggleExpanded();
    },
    materialTab() {
      const sessionId = sidebar.mounted.getSnapshot();
      const tabs = sidebar.tabsIn(sessionId).filter(tab => tab.kind !== CONVERSATION_KIND);
      return tabs.find(tab => tab.id === lastMaterials.get(sessionId)) ?? tabs.find(tab => tab.kind === LIBRARY_KIND) ?? tabs[0];
    },
    leaveConversationTab() {
      if (sidebar.active()?.kind !== CONVERSATION_KIND) return;
      const material = controller.materialTab();
      if (material) sidebar.focus(material.id); else sidebar.openTab(LIBRARY_KIND);
    },
    removeConversationTabs() {
      const tabs = sidebar.tabsIn(sidebar.mounted.getSnapshot()).filter(tab => tab.kind === CONVERSATION_KIND);
      if (!tabs.length) return;
      controller.leaveConversationTab();
      for (const tab of tabs) if (!closing.has(tab.id)) {
        closing.add(tab.id);
        Promise.resolve(sidebar.close(tab.id)).finally(() => closing.delete(tab.id));
      }
    },
    openMenu(event) {
      event.preventDefault(); event.stopPropagation();
      const box = event.currentTarget.getBoundingClientRect();
      store.update({ menu: { x: box.right, y: box.bottom + 6, trigger: event.currentTarget } });
    },
    ensureTab() {
      const sessionId = sidebar.mounted.getSnapshot();
      if (disposed || !sessionId || ensuring || sidebar.openTabs.getSnapshot().some(tab => tab.sessionId === sessionId && tab.kind === CONVERSATION_KIND)) return;
      ensuring = true;
      try { const active = sidebar.active(); sidebar.openTab(CONVERSATION_KIND); if (active) { lastMaterials.set(sessionId, active.id); sidebar.focus(active.id); } }
      finally { ensuring = false; }
    },
    show(mode) {
      store.update({ menu: null });
      const sessionId = sidebar.mounted.getSnapshot();
      if (mode === 'exclusive') {
        if (!store.getSnapshot().exclusive) controller.setExclusive(true);
        const active = sidebar.active(); if (active && active.kind !== CONVERSATION_KIND) lastMaterials.set(sessionId, active.id);
        const existing = sidebar.openTabs.getSnapshot().find(tab => tab.sessionId === sessionId && tab.kind === CONVERSATION_KIND);
        if (existing) sidebar.focus(existing.tabId); else sidebar.openTab(CONVERSATION_KIND);
      } else {
        store.update({ mode });
        controller.savePreference();
        controller.leaveConversationTab();
      }
      const requestedSession = sidebar.mounted.getSnapshot();
      if (mode !== 'minimized') requestAnimationFrame(() => {
        if (disposed || sidebar.mounted.getSnapshot() !== requestedSession) return;
        const session = Object.values(ctx.sessions.list.getSnapshot()?.byId ?? {}).find(row => row.retainedBy?.mainView > 0);
        if (session) { const scope = ctx.sessions.scope(session.id); if (scope) ctx.conversation.input.for(scope).focus(); }
      });
    },
    measure() {
      if (disposed) return;
      cancelAnimationFrame(measureFrame);
      measureFrame = requestAnimationFrame(() => {
        if (disposed) return;
        const state = store.getSnapshot(), mode = state.owner ? 'exclusive' : state.mode;
        if (controller.anchor?.owner === state.owner && controller.anchor?.element?.isConnected) {
          const element = controller.anchor.element, box = element.getBoundingClientRect();
          for (const [name, value] of Object.entries({ left: box.left, top: box.top, width: box.width, height: box.height })) document.documentElement.style.setProperty(`--nv-chat-tab-${name}`, `${value}px`);
          let layer = 45;
          for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) layer = Math.max(layer, (parseInt(getComputedStyle(parent).zIndex, 10) || 0) + 1);
          document.documentElement.style.setProperty('--nv-chat-tab-layer', String(layer));
        }
        const selector = mode === 'floating' ? '.pI_x6G_centerCol [data-composer-seat]' : '.pI_x6G_centerCol .wSkVaW_root';
        const box = document.querySelector(selector)?.getBoundingClientRect();
        // Make the end of scrollable materials reachable above the fixed
        // composer/bubble. This never changes the user's mode or scroll position.
        const inset = !state.fullscreen ? 0 : mode === 'minimized' ? 76
          : mode === 'floating' && box ? Math.ceil(window.innerHeight - box.top + 12) : 0;
        document.documentElement.style.setProperty('--nv-materials-bottom-inset', `${inset}px`);
        if (!box || !state.fullscreen || mode === 'minimized') return;
        for (const [name, value] of Object.entries({ left: box.left + 10, top: box.top + 4, width: box.width - 20 })) document.documentElement.style.setProperty(`--nv-chat-chrome-${name}`, `${value}px`);
      });
    },
    observe() {
      let frame, seat, root, scheduled = false, observing = true, syncFrame = 0;
      const resize = new ResizeObserver(() => controller.measure());
      const sync = () => {
        if (!observing || disposed) return;
        scheduled = false;
        const nextFrame = document.querySelector('.pI_x6G_frame'), nextSeat = document.querySelector('.pI_x6G_centerCol [data-composer-seat]'), nextRoot = document.querySelector('.pI_x6G_centerCol .wSkVaW_root');
        if (frame !== nextFrame || seat !== nextSeat || root !== nextRoot) {
          frame = nextFrame; seat = nextSeat; root = nextRoot; resize.disconnect();
          for (const element of [frame, seat, root]) if (element) resize.observe(element);
        }
        const sessionId = sidebar.mounted.getSnapshot();
        const narrow = window.innerWidth < 1024;
        const panel = sessionId && [...document.querySelectorAll('[data-sidebar-right-session][data-sidebar-right-panel]')].find(element => element.dataset.sidebarRightSession === sessionId);
        const shown = Boolean(root && panel?.hasAttribute('data-sidebar-right-open'));
        const nativeFullscreen = panel?.dataset.sidebarRightPanel === 'fullscreen';
        if (sessionId && sessionId !== store.getSnapshot().sessionId) {
          const saved = loadPreference(sessionId);
          const exclusive = shown && !controller.ordinaryOpen && (saved?.exclusive ?? (!narrow && nativeFullscreen));
          store.update({ sessionId, exclusive, mode: ['floating', 'left', 'right', 'minimized'].includes(saved?.mode) ? saved.mode : 'floating', owner: null, menu: null });
        }
        if (sessionId && controller.ordinaryOpen) { controller.ordinaryOpen = false; store.update({ exclusive: false }); controller.savePreference(); }
        // Collapsing a panel ends its exclusive presentation. Reopening is an ordinary split.
        if (panel && !shown && store.getSnapshot().shown && store.getSnapshot().exclusive) {
          store.update({ exclusive: false }); controller.savePreference();
        }
        const { exclusive } = store.getSnapshot();
        const modeButton = panel?.querySelector('button[data-sidebar-right-mode]');
        store.update({ fullscreen: exclusive && shown, shown, narrow, chromeHost: modeButton?.parentElement ?? null });
        // At 768–1023px the SDK otherwise collapses materials when the navigation opens.
        // Its overlay projection supplies room; our compact CSS still presents two columns.
        if (shown && window.innerWidth >= 768 && nativeFullscreen !== (exclusive || narrow)) {
          const target = sidebar.commandTarget(null);
          if (target) sidebar.toggleFullscreen(target);
        }
        const active = sidebar.active();
        if (active && active.kind !== CONVERSATION_KIND) lastMaterials.set(sessionId, active.id);
        if (sessionId && shown && exclusive) controller.ensureTab();
        else if (sessionId && !exclusive) controller.removeConversationTabs();
        controller.measure();
      };
      const schedule = () => { if (observing && !scheduled) { scheduled = true; syncFrame = requestAnimationFrame(sync); } };
      const observer = new MutationObserver(schedule);
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-rightbar-fullscreen', 'data-sidebar-right-open', 'data-sidebar-right-panel', 'aria-selected', 'style'] });
      controller.sync = schedule;
      window.addEventListener('resize', schedule); sync();
      return () => { observing = false; controller.sync = null; cancelAnimationFrame(syncFrame); observer.disconnect(); resize.disconnect(); window.removeEventListener('resize', schedule); store.update({ fullscreen: false, menu: null }); };
    },
  };
  const disposers = [registry.register({ id: PROVIDER, kind: CONVERSATION_KIND, keepMounted: true, title: () => '会话' })];
  const shortcuts = ctx.get('shortcuts');
  if (shortcuts?.observeFixedInput) disposers.push(shortcuts.observeFixedInput(input => {
    if (input.type !== 'keydown' || input.context.modal || input.gesture.composing || input.gesture.repeat || input.gesture.defaultPrevented) return;
    const command = shortcuts.catalog.getSnapshot().find(row => row.id === 'pane.fullscreen.toggle');
    const binding = command?.binding, gesture = input.gesture;
    if (!binding || command.issue || command.conflicts.length || binding.secondCode || binding.code !== gesture.code) return;
    if (['control', 'alt', 'shift', 'meta'].some(key => Boolean(gesture[key]) !== binding.modifiers.includes(key))) return;
    const target = sidebar.focusedTarget(input.context.target) ?? (store.getSnapshot().owner && sidebar.commandTarget(null));
    if (!target || target.host !== 'dock' || !store.getSnapshot().shown) return;
    input.consume(); controller.setExclusive(!store.getSnapshot().exclusive);
  }));
  disposers.push(ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: PROVIDER, store: ctx.slots.entries('rightbar.session').find(entry => entry.store)?.store }, props => <ConversationTabTitle {...props} controller={controller} />)));
  disposers.push(ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: PROVIDER }, props => <ConversationTab {...props} controller={controller} />)));
  disposers.push(ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: PROVIDER }, () => <ConversationChrome controller={controller} />)));
  return { presentation: store, prepareMaterials: controller.prepareMaterials, returnToConversation: controller.returnToConversation, dispose() { disposed = true; cancelAnimationFrame(measureFrame); for (const dispose of disposers.reverse()) dispose(); document.documentElement.style.removeProperty('--nv-materials-bottom-inset'); for (const name of ['notaraConversationMode', 'notaraWorkspaceFullscreen', 'notaraMaterialsDrawer', 'notaraMaterialsSplit', 'notaraNavigation']) delete document.documentElement.dataset[name]; } };
}
