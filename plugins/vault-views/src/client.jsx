import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { closeTopModal } from '@deepseek-ai/dsh-client-ui-primitives';
import { VaultWorkspace, VaultSidebar, DocumentReader } from './workspace.jsx';
import { createViewState, resolveFileLocator } from './logic.js';
import { bringReferences, registerReferences,captureSourceOwner,bringDrawingSnapshot } from './composer.js';
import {continueReviewQuestion} from './review-question-navigation.js';
import {installWhiteboardCommands} from './whiteboard-commands.js';
import {createWhiteboardFeedback} from './whiteboard-feedback.js';
import {WhiteboardFeedback,WhiteboardMenuStatus} from './whiteboard-ui.jsx';
import {installMessageReferences} from './message-references.jsx';
import { registerWikiReferenceInput } from './wiki-reference-input.js';
import {parseReference as parseSourceReference,referenceFragment} from '@oh-my-student/plugin-vault-sqlite/file-reference';
import styles from './styles.css';
import editorStyles from './editor-styles.css';
import appearanceStyles from './appearance.css';
import surfaceStyles from './student-surfaces.css';
import { installCompactModelLabel } from './compact-model-label.jsx';
import {installAppearance} from './appearance-store.js';
import {AppearanceSettings} from './appearance.jsx';
import { renderNativeMarkdown } from './native-markdown.jsx';
import {MarkdownReader} from './markdown.jsx';
import { installConversationSurface } from './conversation-surface.jsx';
import conversationStyles from './conversation-surface.css';
import { createWorkspaceNavigation, LIBRARY_KIND } from './navigation.js';
import { installCrossSessionTabSync } from './cross-session-tabs.js';
import { createGraphStateStore } from './graph-view-state.js';
import { nativeFileLocator, nativeFileTitle, workspaceFileAddress } from './file-resources.js';
import { safeRelativePath, safeWorkspaceRelativePath, isVaultFormat } from '@oh-my-student/plugin-vault-sqlite/vault-path';
import { installActivityPanel } from './activity.jsx';
import activityStyles from './activity.css';
import { WorkspaceSessions } from './session-list.jsx';
import { openWorkspaceSession } from './session-list.js';
import { WorkspacePicker } from './workspace-picker.jsx';
import { installMainPresetPicker } from './preset-picker.jsx';
import {installCompanions} from './companions.jsx';
import companionStyles from './companions.css';
import {installDrawingChat} from './drawing-chat.jsx';
export { installMainPresetPicker };
import { bindVaultRemote, currentWorkspace, subscribeWorkspace, workspaceForSession } from '@oh-my-student/plugin-vault-sqlite/workspace-client';

function useWorkspaceVault(ctx, sessionId) {
  const workspaceId = useSyncExternalStore(l => subscribeWorkspace(ctx, l), () => sessionId === undefined ? currentWorkspace(ctx) : workspaceForSession(ctx, sessionId));
  const remote = useMemo(() => bindVaultRemote(ctx.remote.notaraVault, workspaceId), [ctx, workspaceId]);
  return { workspaceId, remote };
}
function CurrentVaultWorkspace({ ctx, sessionId, getStore, onBring, onOpenDocument, onGraph, ...props }) {
  const { workspaceId, remote } = useWorkspaceVault(ctx, sessionId);
  return <VaultWorkspace {...props} captureOwner={()=>captureSourceOwner(ctx)} onSnapshot={(snapshot,owner)=>bringDrawingSnapshot(ctx,snapshot,owner)} key={workspaceId ?? 'default'} workspaceId={workspaceId} remote={remote} store={getStore(workspaceId)}
    renderWhiteboardStatus={props=><WhiteboardMenuStatus {...props} ctx={ctx}/>}
    onReviewQuestion={(doc,plan)=>continueReviewQuestion(ctx,workspaceId,doc,plan)}
    onOpenDocument={onOpenDocument && (locator => onOpenDocument({ ...(typeof locator === 'string' ? { path: locator } : locator), workspaceId }))}
    onGraph={onGraph && (detail => onGraph({ ...detail, workspaceId }))}
    onBring={(pins, intent) => onBring(pins.map(pin => ({ ...pin, workspaceId })), intent)} />;
}

// Preserve the native picker, directory flow, and workspace registration lifecycle.
function installWorkspacePicker(ctx) {
  const add = () => {
    const entry = ctx.slots.entries('sidebar.workspaces').find(entry => entry.inject);
    entry?.inject()?.requestAddWorkspace?.();
  };
  window.addEventListener('notara:choose-workspace', add);
  return () => window.removeEventListener('notara:choose-workspace', add);
}

export { VaultWorkspace, VaultSidebar };
export const PANEL_ID = 'notara-vault';
const GUIDE_TAB_ID = 'notara-vault-guide';
const DOC_TAB_ID = 'notara-vault-doc';
const DOC_KIND = 'notara-doc';
const NATIVE_GUIDE_ID = '@deepseek-ai/dsh-client-ui-sidebar-right/guide';
const GRAPH_TAB_ID='notara-graph-tab', GRAPH_KIND='notara-graph-page', GRAPH_PREFIX='dsh-resource://notara-vault/graph/';
const DOC_PREFIX = 'dsh-resource://notara-vault/doc/';

const QUICK_PANELS = [
  { id: PANEL_ID, order: 10, view: 'table', label: '资料库', icon: size => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><circle cx="11.5" cy="14.5" r="2.5" /><path d="M13.5 16.5L16 19" /></svg> },
  { id: 'notara-vault-graph', order: 11, view: 'graph', label: '图谱', icon: size => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="12" cy="18" r="2.5" /><path d="M8.2 7.2l2.6 8.6M15.8 7.2l-2.6 8.6M8.5 6h7" /></svg> },
  { id: 'notara-vault-cards', order: 12, view: 'cards', label: '卡片', icon: size => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg> },
  { id: 'notara-vault-guides', order: 13, view: 'guides', label: '学习计划', icon: size => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="4" height="4" rx="1" /><path d="M10 7h11" /><rect x="3" y="15" width="4" height="4" rx="1" /><path d="M10 17h11" /></svg> },
  { id: 'notara-vault-routes', order: 14, view: 'routes', label: '学习路线', icon: size => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="5" cy="18" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="6" r="2" /><path d="M6.6 16.6l3.8-3.2M13.6 10.6l3.8-3.2" /></svg> },
  { id: 'notara-vault-lessons', order: 15, view: 'lessons', label: '备课本', icon: size => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v18H6.5A2.5 2.5 0 0 1 4 18.5z" /><path d="M8 7h8M8 11h8M8 15h5" /></svg> },
  { id: 'notara-vault-review', order: 16, view: 'review', label: '复习', icon: size => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /><path d="M9 15l2 2 4-4" /></svg> },
];

const WORKSPACE_CHILDREN = {
  'notara.vault.canvas': { kind: 'single', scope: 'root' },
  'notara.vault.graph': { kind: 'single', scope: 'root' },
  'notara.vault.blocks': { kind: 'single', scope: 'root' },
};

const toDocAddress = (path, workspaceId, subpath) => {
  const query = new URLSearchParams();
  if (workspaceId != null) query.set('workspace', workspaceId);
  if (subpath) query.set('subpath', subpath);
  return DOC_PREFIX + encodeURIComponent(String(path || '').replace(/^\/+/, '')) + (query.size ? `?${query}` : '');
};
const fromDocAddress = address => {
  const raw = String(address || '').slice(DOC_PREFIX.length).split('?')[0];
  try { return decodeURIComponent(raw); } catch { return raw; }
};
const docTitle = address => {
  if (address.startsWith('dsh-resource://file/')) return nativeFileTitle(address);
  const path = fromDocAddress(address);
  return (path.split('/').at(-1) || path).replace(/\.md$/i, '');
};

function createCommandStore() {
  let snapshot = null;
  let seq = 0;
  const listeners = new Set();
  return {
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    dispatch(command) {
      snapshot = { ...command, seq: ++seq };
      for (const listener of [...listeners]) listener();
    },
  };
}

function SidebarVaultTab({ useTabInfo, children }) {
  return children;
}

function GraphGuideEntry({ useTabInfo, workspaceId, title, description }) {
  const { tab } = useTabInfo();
  return <button type="button" className="nv-guide-entry" data-sidebar-right-guide-entry="notara-graph" onClick={() => tab.actions.openResource(GRAPH_PREFIX + encodeURIComponent(workspaceId ?? 'default'), { params: { workspaceId, focusPath: null }, replaceTab: true })}>
    {QUICK_PANELS[1].icon(24)}<span>{title}{description && <small>{description}</small>}</span>
  </button>;
}

function NativeStartTitle({ original: Original, registry, ...props }) {
  const useTabInfo = () => {
    const info = props.useTabInfo();
    // Old builds saved our library label on the native start-page record.
    // Correct its display through the original title renderer, without replacing
    // the start page or rewriting the user's saved pane layout.
    if (info.tab.kind !== 'guide' || info.tab.title !== '资料库') return info;
    return { ...info, tab: { ...info.tab, title: registry.get('guide').title(info.tab.contentId) } };
  };
  return <Original {...props} useTabInfo={useTabInfo} />;
}

export function installNativeStartTitle(ctx, registry) {
  return ctx.slots.inject('sidebar.right.pane.tab.title', () => {
    const original = ctx.slots.entries('sidebar.right.pane.tab.title').find(entry => entry.options.key === NATIVE_GUIDE_ID && entry.options.priority !== -20);
    if (!original) return;
    return ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: NATIVE_GUIDE_ID, priority: -20, locale: original.locale, inject: original.inject }, props => <NativeStartTitle {...props} original={original.component} registry={registry} />);
  });
}

function DocTabTitle({ useTabInfo }) {
  const info = useTabInfo();
  const address = info.tab.navigation?.address || info.tab.contentId;
  return <span className="nv-doc-tab-chip" title={docTitle(address)}>{docTitle(address)}</span>;
}

function VaultDocumentTab({ useTabInfo, renderSlot, ctx, onOpen, onBring, onGraph,onSnapshot }) {
  const info = useTabInfo();
  const [revision, setRevision] = useState(0);
  const workspaces = useSyncExternalStore(listener => subscribeWorkspace(ctx, listener), () => ctx.get('workspaces')?.list.getSnapshot() ?? null);
  const address = info.tab.navigation?.address || info.tab.contentId;
  const isNative = address.startsWith('dsh-resource://file/');
  const file = isNative ? nativeFileLocator(address, workspaces?.items, id => workspaceForSession(ctx, id)) : null;
  const path = isNative ? file?.path : fromDocAddress(address);
  const savedAddress = new URLSearchParams(String(address).split('?')[1] || '');
  const params = { workspaceId: savedAddress.get('workspace') ?? undefined, subpath: savedAddress.get('subpath') ?? undefined, ...info.tab.navigation?.params, ...(isNative ? file ?? { workspaceId: null } : {}) };
  const remote = useMemo(() => bindVaultRemote(ctx.remote.notaraVault, params.workspaceId), [ctx, params.workspaceId]);
  if (isNative && !file) return <p className="nv-vault-error">文件所属工作区已不可用，请重新打开文件。</p>;
  const page = params.page || Number(/page=(\d+)/.exec(params.subpath || '')?.[1]) || undefined;
  const rect = params.rect || /rect=([\d.,-]+)/.exec(params.subpath || '')?.[1]?.split(',').map(Number);
  const sourceLocator=params.subpath?parseSourceReference(`[[${path}${params.subpath}]]`):null;
  const locator = { path, subpath: params.subpath, page, rect, ...sourceLocator, range:params.range??sourceLocator?.range,revision:params.sourceRevision??params.revision??sourceLocator?.revision,title: params.title, workspaceId: params.workspaceId };
  return (
    <div className="nv-vault-workspace nv-vault-doc-tab">
      <div className="nv-vault-body">
        <div className="nv-vault-main">
          <DocumentReader
            key={`${params.workspaceId ?? 'default'}:${path}:${params.subpath || ''}`}
            locator={locator}
            remote={remote}
            onOpen={locator => onOpen({ ...(typeof locator === 'string' ? { path: locator } : locator), workspaceId: params.workspaceId })}
            onBring={(pins, intent) => onBring(pins.map(pin => ({ ...pin, workspaceId: params.workspaceId })), intent)}
            onReviewQuestion={(doc,plan)=>continueReviewQuestion(ctx,params.workspaceId,doc,plan)}
            onGraph={detail=>onGraph({...detail,workspaceId:params.workspaceId})}
            onChanged={() => setRevision(value => value + 1)}
            revision={revision}
            renderSlot={renderSlot}
            renderMarkdown={renderNativeMarkdown}
            showDocHeader
            captureOwner={()=>captureSourceOwner(ctx)}
            renderWhiteboardStatus={props=><WhiteboardMenuStatus {...props} ctx={ctx}/>}
            onSnapshot={onSnapshot}
          />
        </div>
      </div>
    </div>
  );
}

const emptySub = () => () => {};
const emptyObj = () => null;

function IndependentGraphTab({ctx,useTabInfo,renderSlot,onOpen,onBring,graphStates}) {
  const info=useTabInfo(), address=info.tab.navigation?.address||info.tab.contentId;
  const params=info.tab.navigation?.params||{};
  const encoded=String(address).slice(GRAPH_PREFIX.length);
  const workspaceId=params.workspaceId ?? (encoded==='default'?undefined:decodeURIComponent(encoded));
  const root=useSyncExternalStore(l=>subscribeWorkspace(ctx,l),()=>ctx.get('workspaces')?.list.getSnapshot()?.items?.find(row=>row.workspaceId===workspaceId)?.path??null);
  const state=useMemo(()=>graphStates.get(workspaceId,root),[workspaceId,root,graphStates]);
  // Native tabs restore addresses, not transient navigation params. Absence
  // means resume; an explicit focus (including null) remains a new navigation.
  const focusPath=Object.hasOwn(params,'focusPath')?params.focusPath:state.focusPath??null;
  return <div key={JSON.stringify([workspaceId,root])} className="nv-independent-graph" aria-label="知识图谱">{renderSlot('notara.vault.graph',{workspaceId,active:info.tab.visible,focusPath,viewState:state,onViewStateChange:graphStates.changed,onBring:pins=>onBring(pins.map(pin=>({...pin,workspaceId}))),onOpenDocument:locator=>onOpen({...locator,workspaceId})},{fallback:<p className="nv-vault-empty">启用知识图谱插件后可查看图谱</p>})}</div>;
}

function LeftSidebarChrome({ wide, ctx, getStore, onOpenDoc, onOpenOverview, onOpenGraph, useWorkspaceView, workspaceActions }) {
  const [mode, setMode] = useState(() => { try { return localStorage.getItem('notara.sidebar.section.v1') === 'sessions' ? 'sessions' : 'files'; } catch { return 'files'; } });
  const [header, setHeader] = useState(null);
  const sections = useRef([]);
  const activePanel = useSyncExternalStore(l => ctx.layout.panelInfo.subscribe(l), () => ctx.layout.panelInfo.getSnapshot().activePanelId);
  const { workspaceId: sessionWorkspaceId } = useWorkspaceVault(ctx);
  const workspacesService = ctx.get('workspaces');
  const uiWorkspace = ctx.get('uiWorkspace');
  const wsSource = workspacesService?.list;
  const sessSource = ctx.sessions?.list;
  const wsSnap = useSyncExternalStore(wsSource ? l => wsSource.subscribe(l) : emptySub, wsSource ? () => wsSource.getSnapshot() : emptyObj, emptyObj);
  const sessSnap = useSyncExternalStore(sessSource ? l => sessSource.subscribe(l) : emptySub, sessSource ? () => sessSource.getSnapshot() : emptyObj, emptyObj);
  const previousSelection = useRef(null), recoveredArchive = useRef(null);
  const mainSession = Object.values(sessSnap?.byId ?? {}).find(row => row.retainedBy?.mainView > 0);
  if (mainSession && sessionWorkspaceId != null) previousSelection.current = { sessionId: mainSession.id, workspaceId: sessionWorkspaceId };
  // Native archive clears the main Session. Keep the selected workspace and use
  // its native blank-session reuse path, instead of falling back to a different workspace.
  const archivedSelection = !mainSession && sessionWorkspaceId == null && wsSnap?.archivedSessionIds?.includes(previousSelection.current?.sessionId) && wsSnap?.items?.some(row => row.workspaceId === previousSelection.current?.workspaceId) ? previousSelection.current : null;
  const workspaceId = sessionWorkspaceId ?? archivedSelection?.workspaceId ?? null;
  const remote = useMemo(() => bindVaultRemote(ctx.remote.notaraVault, workspaceId), [ctx, workspaceId]);
  const store = getStore(workspaceId);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => {
    if (!archivedSelection || recoveredArchive.current === archivedSelection.sessionId) return;
    recoveredArchive.current = archivedSelection.sessionId;
    uiWorkspace?.startSession(archivedSelection.workspaceId);
  }, [archivedSelection, uiWorkspace]);

  useEffect(() => {
    document.documentElement.dataset.notaraLeftMode = mode;
    return () => { delete document.documentElement.dataset.notaraLeftMode; };
  }, [mode]);
  useLayoutEffect(() => { setHeader(wide ? document.querySelector('.hHd-Xa_logoRow') : null); }, [wide]);
  const selectSection = (next, expand = true) => {
    setMode(next);
    try { localStorage.setItem('notara.sidebar.section.v1', next); } catch { /* Optional presentation preference. */ }
    if (!wide && expand) ctx.layout.toggleSidebar();
  };
  const searchSessions = () => {
    selectSection('sessions', false);
    // The native browser opens a settled rail. During its closing animation
    // `wide` is still true, so handle only that gap here; never toggle twice.
    if (wide && document.querySelector('.pI_x6G_frame')?.hasAttribute('data-sidebar-collapsed')) ctx.layout.toggleSidebar();
  };

  useEffect(() => {
    if (typeof document === 'undefined' || typeof ResizeObserver === 'undefined') return undefined;
    const col = document.querySelector('.pI_x6G_sidebarCol');
    if (!col) return undefined;
    const syncWidth = () => {
      const width = Math.round(col.getBoundingClientRect().width);
      document.documentElement.style.setProperty('--notara-sidebar-col-width', `${width}px`);
    };
    syncWidth();
    const observer = new ResizeObserver(syncWidth);
    observer.observe(col);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--notara-sidebar-col-width');
    };
  }, [wide]);

  const workspaces = wsSnap?.items || [];
  const activeWorkspace = workspaces.find(row => row.workspaceId === workspaceId);

  const handleWorkspaceChange = nextWsId => {
    const targetWs = workspaces.find(w => w.workspaceId === nextWsId);
    if (!targetWs) return;
    const firstSession = targetWs.sessionIds?.find(id => sessSnap?.byId?.[id] && !wsSnap?.archivedSessionIds?.includes(id));
    if (firstSession && uiWorkspace?.openSession) uiWorkspace.openSession(firstSession);
    else if (uiWorkspace?.openWorkspace) void uiWorkspace.openWorkspace(nextWsId);
  };

  return <>
    {wide && header && createPortal(<div className="nv-left-ws-header">
        <WorkspacePicker workspaces={workspaces} current={activeWorkspace} onChange={handleWorkspaceChange} onAdd={uiWorkspace ? () => window.dispatchEvent(new CustomEvent('notara:choose-workspace')) : undefined} />
        {uiWorkspace && (
          <button
            type="button"
            className="nv-left-ws-new"
            title="新会话"
            aria-label="新会话"
            onClick={() => uiWorkspace.startSession()}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-7M16 3l5 5M10 14l-1 4 4-1L22 8a2 2 0 0 0-5-5Z"/></svg>
          </button>
        )}
      </div>, header)}
    <div className="nv-left-chrome" data-mode={mode}>
      {activePanel != null && <button className="nv-left-return" aria-label="返回工作区" title="返回工作区" onClick={() => ctx.layout.selectPanel(null)}><span aria-hidden="true">←</span>{wide && <span>返回工作区</span>}</button>}
      <div className="nv-left-mode-switch" role="tablist" aria-label="工作区栏目" aria-orientation={wide ? 'horizontal' : 'vertical'}>
        {[['sessions', '会话'], ['files', '资料']].map(([id, label], index) => <button ref={element => { sections.current[index] = element; }} key={id} type="button" role="tab" aria-label={label} title={wide ? undefined : label} aria-selected={mode === id} tabIndex={mode === id ? 0 : -1} onClick={() => selectSection(id)} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index; selectSection(next === 0 ? 'sessions' : 'files'); sections.current[next]?.focus(); } }}>
          {!wide && <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{id === 'sessions' ? <path d="M20 11.5a8 8 0 0 1-8 8H4l1.6-4.2A8 8 0 1 1 20 11.5Z" /> : <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></>}</svg>}
          {wide && label}
        </button>)}
      </div>
      <div className="nv-left-sessions-body" hidden={!wide || mode !== 'sessions'}>
        <WorkspaceSessions key={workspaceId ?? 'none'} ctx={ctx} workspace={activeWorkspace} registry={wsSnap} list={sessSnap} visible={wide && mode === 'sessions'} onSearch={searchSessions} useWorkspaceView={useWorkspaceView} workspaceActions={workspaceActions} />
      </div>
      <div className="nv-left-files-body" hidden={!wide || mode !== 'files'}>
          <VaultSidebar
            key={workspaceId ?? 'default'}
            workspaceId={workspaceId}
            remote={remote}
            store={store}
            onOpen={locator => onOpenDoc({ ...(typeof locator === 'string' ? { path: locator } : locator), workspaceId })}
            activePath={state.active}
            tree
            hideHeader
            onOpenOverview={onOpenOverview}
            onOpenGraph={onOpenGraph}
          />
        </div>
    </div>
  </>;
}

export default {
  name: 'notara-vault-views',
  inject: ['slots', 'remote', 'remote.notaraVault', 'conversation', 'uiConversation', 'sessions', 'inputTriggers', 'layout', 'theme'],
  apply(ctx) {
    const stores = new Map();
    const getStore = (workspaceId = currentWorkspace(ctx)) => {
      if (!stores.has(workspaceId)) stores.set(workspaceId, createViewState());
      return stores.get(workspaceId);
    };
    const viewCommandStores = new Map();
    const getViewCommandStore = sessionId => {
      if (!viewCommandStores.has(sessionId)) viewCommandStores.set(sessionId, createCommandStore());
      return viewCommandStores.get(sessionId);
    };
    const sidebarRight = ctx.get('sidebarRight'), sidebarRightTabs = ctx.get('sidebarRightTabs');
    const hasSidebarRight = Boolean(sidebarRight && sidebarRightTabs);
    let navigation, conversationSurface;

    const exitSidebarFullscreen = () => {
      if (!sidebarRight?.mounted?.getSnapshot()) return;
      conversationSurface?.returnToConversation();
    };

    let graphStorage;try{graphStorage=window.localStorage;}catch{}
    const graphStates=createGraphStateStore(graphStorage);
    ctx.effect(()=>{window.addEventListener('pagehide',graphStates.flush);return()=>{graphStates.flush();window.removeEventListener('pagehide',graphStates.flush);};});
    const openGraphTab=(detail={})=>{
      if(!hasSidebarRight)return false;
      const workspaceId=detail.workspaceId ?? currentWorkspace(ctx);
      navigation.open(()=>sidebarRight.openResource(GRAPH_PREFIX+encodeURIComponent(workspaceId??'default'),{params:{workspaceId,focusPath:detail.focusPath??null}}));
      return true;
    };
    const openSidebarGuideTab = (view = null, focusPath = undefined) => {
      if(view==='graph')return openGraphTab({focusPath});
      if (!hasSidebarRight) return false;
      navigation.open(() => {
        if (view) getViewCommandStore(sidebarRight.mounted.getSnapshot()).dispatch({ view, focusPath });
        sidebarRight.openTab(LIBRARY_KIND);
      });
      return true;
    };

    const openDocTab = (locator, resolved=false) => {
      const normalized = typeof locator === 'string' ? { path: locator } : locator;
      if (normalized?.sessionId && !normalized?.path) {
        const workspaceId = normalized.workspaceId === undefined ? currentWorkspace(ctx) : normalized.workspaceId;
        return openWorkspaceSession(ctx, normalized.sessionId, workspaceId, {
          verifiedClassroom: Boolean(normalized.verifiedClassroom),
          onOpened: () => {
            exitSidebarFullscreen();
            ctx.layout.selectPanel(null);
          },
        });
      }
      if (!normalized?.path) return false;
      const workspaceId = normalized.workspaceId === undefined ? currentWorkspace(ctx) : normalized.workspaceId;
      if (!hasSidebarRight) return false;
      safeWorkspaceRelativePath(normalized.path);
      if (!resolved && !isVaultFormat(normalized.path)) {
        const selected=ctx.get('uiSession')?.adapter?.current?.getSnapshot()?.key;
        const signal=ctx.layout?.beginNavigation?.();
        const open=value=>{
          if(signal?.aborted || selected!==ctx.get('uiSession')?.adapter?.current?.getSnapshot()?.key)return;
          openDocTab({...value,workspaceId},true);
        };
        void resolveFileLocator(bindVaultRemote(ctx.remote.notaraVault,workspaceId),normalized).then(open,()=>open(normalized));
        return true;
      }
      if (!isVaultFormat(normalized.path)) {
        const selected = ctx.get('uiSession')?.adapter?.current?.getSnapshot()?.key;
        const sourceSessionId = normalized.sourceSessionId ?? (selected && workspaceForSession(ctx, selected) === workspaceId ? selected : undefined);
        const address = workspaceFileAddress({ ...normalized, workspaceId, sourceSessionId }, ctx.get('workspaces')?.list.getSnapshot()?.items, ctx.sessions.list.getSnapshot().byId, id => workspaceForSession(ctx, id));
        const line = Number(/^#L([1-9]\d*)/.exec(normalized.subpath || '')?.[1]);
        navigation.open(() => sidebarRight.openResource(address, Number.isSafeInteger(line) && line > 0 ? {params:{line}} : undefined));
        return true;
      }
      if (normalized.path === '资料库.base' && workspaceId === currentWorkspace(ctx)) return openSidebarGuideTab();
      navigation.open(() => {
        getStore(workspaceId).open(normalized);
        if (!sidebarRight.tabsIn(sidebarRight.mounted.getSnapshot()).some(tab => tab.kind === LIBRARY_KIND)) sidebarRight.openTab(LIBRARY_KIND);
        const subpath = normalized.subpath || referenceFragment(normalized) || undefined;
        sidebarRight.openResource(toDocAddress(normalized.path, workspaceId, subpath), {
          params: { subpath, page: normalized.page, rect: normalized.rect, title: normalized.title, workspaceId },
        });
      });
      return true;
    };
    const whiteboardFeedback=createWhiteboardFeedback();
    installWhiteboardCommands(ctx,openDocTab,whiteboardFeedback.show);
    ctx.effect(()=>ctx.slots.inject('shell.overlay',()=>ctx.slots.register({name:'shell.overlay',id:'notara-whiteboard-feedback'},()=> <WhiteboardFeedback ctx={ctx} store={whiteboardFeedback}/>)));

    ctx.effect(() => {
      const element = document.createElement('style'); element.dataset.notaraVaultViews = ''; element.dataset.plugin = '@oh-my-student/plugin-vault-views'; element.textContent = styles + '\n' + conversationStyles + '\n' + editorStyles + '\n' + appearanceStyles + '\n' + activityStyles + '\n' + companionStyles + '\n' + surfaceStyles; document.head.append(element);
      return () => element.remove();
    });
    ctx.effect(() => installMainPresetPicker(ctx));
    ctx.effect(() => ctx.slots.inject('conversation.input.model.label', () => installCompactModelLabel(ctx)));
    ctx.effect(() => installCompanions(ctx));
    ctx.effect(() => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
      name:'sidebar.footer.action', id:'notara-plugins', order:5,
    }, ({wide}) => <button type="button" className="nv-plugins-launch" aria-label="插件" title="插件" onClick={()=>ctx.layout.selectPanel('plugins')}><svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><rect x="2.5" y="2.5" width="6" height="6" rx="1.5"/><rect x="11.5" y="2.5" width="6" height="6" rx="1.5"/><rect x="2.5" y="11.5" width="6" height="6" rx="1.5"/><path d="M14.5 11.5v6m-3-3h6"/></svg>{wide&&<span>插件</span>}</button>)));
    ctx.effect(() => ctx.slots.inject('settings.general.item', () => ctx.slots.register({
      name: 'settings.general.item', id: 'notara-plugin-management', order: 80,
    }, () => <div className="nv-plugin-settings-entry"><div><strong>插件管理</strong><p>安装、启用和管理插件。</p></div><button type="button" onClick={() => { ctx.layout.selectPanel('plugins'); closeTopModal(document); }}>管理插件</button></div>)));
    ctx.effect(() => {
      if (typeof document === 'undefined' || typeof ResizeObserver === 'undefined') return undefined;
      let observer = null;
      const attach = () => {
        const col = document.querySelector('.pI_x6G_sidebarCol');
        if (!col) return false;
        const sync = () => {
          const width = Math.round(col.getBoundingClientRect().width);
          document.documentElement.style.setProperty('--notara-sidebar-col-width', `${width}px`);
        };
        sync();
        observer = new ResizeObserver(sync);
        observer.observe(col);
        return true;
      };
      if (!attach()) {
        const timer = setInterval(() => { if (attach()) clearInterval(timer); }, 100);
        return () => { clearInterval(timer); observer?.disconnect(); };
      }
      return () => observer?.disconnect();
    });
    ctx.effect(() => registerReferences(ctx));
    ctx.effect(() => installMessageReferences(ctx,openDocTab));
    ctx.effect(() => registerWikiReferenceInput(ctx));
    ctx.effect(()=>ctx.slots.inject('notara.calendar.diary',()=>ctx.slots.register({name:'notara.calendar.diary'},props=><MarkdownReader content={props.content} onOpen={props.onOpen} remote={props.remote} renderMarkdown={renderNativeMarkdown}/>)));
    ctx.effect(()=>ctx.slots.inject('notara.calendar.question',()=>ctx.slots.register({name:'notara.calendar.question'},props=><button disabled={props.disabled} onClick={()=>void continueReviewQuestion(ctx,props.workspaceId,props.document,props.plan).catch(error=>props.onError(error.message))}>继续讨论</button>)));
    ctx.plugin({name:'notara-drawing-chat',inject:['uiConversation'],apply(scope){scope.effect(()=>installDrawingChat(scope));}});
    ctx.effect(() => {
      const openDocument = event => {
        try {
          if (event.detail?.sessionId && !event.detail?.path) {
            openDocTab(event.detail);
            return;
          }
          if (!openDocTab(event.detail)) {
            getStore().open(event.detail);
            ctx.layout.selectPanel(PANEL_ID);
          }
        } catch { /* Ignore malformed unrelated event payloads. */ }
      };
      const openSession = event => {
        try { if (openDocTab({ sessionId: event.detail?.sessionId, workspaceId: event.detail?.workspaceId })) event.preventDefault(); } catch { /* Ignore malformed unrelated event payloads. */ }
      };
      const openGraph = event => { if(!openGraphTab(event.detail||{}))ctx.layout.selectPanel('notara-graph'); };
      const openCalendar=()=>{if(hasSidebarRight)navigation.open(()=>sidebarRight.openTab('notara-calendar'));};
      const openVault = event => {
        const requestedView = event?.detail?.view || 'table';
        getStore().update({ active: null, visible: true });
        if (!openSidebarGuideTab(requestedView)) ctx.layout.selectPanel(PANEL_ID);
      };
      window.addEventListener('notara:open-document', openDocument);
      window.addEventListener('notara:open-session', openSession);
      window.addEventListener('notara:open-graph',openGraph);
      window.addEventListener('notara:open-calendar',openCalendar);
      window.addEventListener('notara:open-vault', openVault);
      window.addEventListener('notara:exit-fullscreen', exitSidebarFullscreen);
      return () => {
        window.removeEventListener('notara:open-document', openDocument);
        window.removeEventListener('notara:open-session', openSession);
        window.removeEventListener('notara:open-graph',openGraph);
        window.removeEventListener('notara:open-calendar',openCalendar);
        window.removeEventListener('notara:open-vault', openVault);
        window.removeEventListener('notara:exit-fullscreen', exitSidebarFullscreen);
      };
    });

    let appearance;
    ctx.effect(() => { appearance=installAppearance({theme:ctx.get('theme')}); return ()=>appearance.dispose(); });
    ctx.effect(() => ctx.slots.inject('settings.general.item', () => ctx.slots.register({
      name:'settings.general.item',id:'notara-theme-style',order:11.5,
    },()=> <AppearanceSettings store={appearance}/>)));

    if (hasSidebarRight) {
      ctx.effect(() => installNativeStartTitle(ctx, sidebarRightTabs));
      ctx.effect(() => { conversationSurface = installConversationSurface(ctx, sidebarRight, sidebarRightTabs); return () => conversationSurface.dispose(); });
      ctx.effect(() => ctx.slots.inject('sidebar.workspaces', () => installWorkspacePicker(ctx)));
      ctx.effect(() => installCrossSessionTabSync(sidebarRight, {
        workspaceForSession: sessionId => workspaceForSession(ctx, sessionId),
        kinds: [DOC_KIND, GRAPH_KIND],
        subscribeScope: listener => subscribeWorkspace(ctx, listener),
      }));
      ctx.effect(() => sidebarRightTabs.register({
        id: GUIDE_TAB_ID,
        kind: LIBRARY_KIND,
        priority: 'extension',
        keepMounted: true,
        title: () => '资料库',
        guide: [{ id: 'notara-library', order: 10, title: () => '资料库', description: () => '浏览与整理工作区资料' }],
      }));
      ctx.effect(()=>sidebarRightTabs.register({id:GRAPH_TAB_ID,kind:GRAPH_KIND,priority:'extension',keepMounted:true,patterns:[`${GRAPH_PREFIX}**`],title:()=> '知识图谱',guide:[{id:'notara-graph',order:11,title:()=> '知识图谱',description:()=> '按标签与关联探索资料'}]}));
      ctx.effect(() => ctx.slots.inject('sidebar.right.tab.guide.entry', () => ctx.slots.register({ name: 'sidebar.right.tab.guide.entry', key: GRAPH_TAB_ID, inject: sessionId => ({ workspaceId: workspaceForSession(ctx, sessionId) }) }, GraphGuideEntry)));
      ctx.effect(() => sidebarRightTabs.register({
        id: DOC_TAB_ID,
        kind: DOC_KIND,
        priority: 'extension',
        keepMounted: true,
        patterns: [`${DOC_PREFIX}**`, 'dsh-resource://file/session/**'],
        canOpen: address => address.startsWith(DOC_PREFIX) || Boolean(nativeFileLocator(address, ctx.get('workspaces')?.list.getSnapshot()?.items, id => workspaceForSession(ctx, id))),
        title: docTitle,
      }));
      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', function* () {
        yield ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: GUIDE_TAB_ID }, () => <span className="nv-doc-tab-chip">资料库</span>);
        yield ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: DOC_TAB_ID }, DocTabTitle);
        yield ctx.slots.register({name:'sidebar.right.pane.tab.title',key:GRAPH_TAB_ID},()=> <span className="nv-doc-tab-chip">知识图谱</span>);
      }));
      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', function* () {
        yield ctx.slots.register({name:'sidebar.right.pane.tab',key:GRAPH_TAB_ID,children:{'notara.vault.graph':{kind:'single',scope:'root'}}},props=><IndependentGraphTab ctx={ctx} useTabInfo={props.useTabInfo} renderSlot={props.renderSlot} onOpen={openDocTab} onBring={async pins=>{await bringReferences(ctx,pins);exitSidebarFullscreen();}} graphStates={graphStates}/>);
        yield ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: GUIDE_TAB_ID,
          inject: sessionId => ({ ownerSessionId: sessionId }),
        }, props => (
          <SidebarVaultTab useTabInfo={props.useTabInfo}>
            <CurrentVaultWorkspace
              ctx={ctx}
              sessionId={props.ownerSessionId}
              getStore={getStore}
              nativeTabs
              externalViewStore={getViewCommandStore(props.ownerSessionId)}
              onOpenDocument={openDocTab}
              renderMarkdown={renderNativeMarkdown}
              renderSlot={props.renderSlot}
              onBring={async (pins, intent) => {
                await bringReferences(ctx, pins, intent);
                exitSidebarFullscreen();
              }}
              onBack={() => {
                conversationSurface.returnToConversation();
              }}
              onGraph={detail => window.dispatchEvent(new CustomEvent('notara:open-graph', { detail }))}
            />
          </SidebarVaultTab>
        ));
        yield ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: DOC_TAB_ID,
          children: { 'notara.vault.canvas': { kind: 'single', scope: 'root' }, 'notara.vault.blocks': { kind: 'single', scope: 'root' } },
        }, props => (
          <VaultDocumentTab
            useTabInfo={props.useTabInfo}
            renderSlot={props.renderSlot}
            ctx={ctx}
            onOpen={openDocTab}
            onBring={async (pins, intent) => {
              await bringReferences(ctx, pins, intent);
              exitSidebarFullscreen();
            }}
            onGraph={openGraphTab}
            onSnapshot={async(snapshot,owner)=>{await bringDrawingSnapshot(ctx,snapshot,owner);exitSidebarFullscreen();}}
          />
        ));
      }));
      ctx.effect(() => {
        const sessionSource = ctx.get('uiSession')?.adapter?.current;
        navigation = createWorkspaceNavigation({
          layout: ctx.layout, sidebar: sidebarRight, sessionSource,
          beforeOpen: () => conversationSurface.prepareMaterials(),
          currentSession: () => sessionSource?.getSnapshot()?.key ?? sidebarRight.mounted.getSnapshot(),
          panels: QUICK_PANELS.map(item => ({ id: item.id, run: () => { if(item.view==='graph'){sidebarRight.openResource(GRAPH_PREFIX+encodeURIComponent(currentWorkspace(ctx)??'default'),{params:{workspaceId:currentWorkspace(ctx),focusPath:null}});return;}getViewCommandStore(sidebarRight.mounted.getSnapshot()).dispatch({ view: item.view, focusPath: null }); sidebarRight.openTab(LIBRARY_KIND); } })),
        });
        return () => navigation.dispose();
      });
      ctx.effect(() => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'notara-left-workspace-chrome',
        order: 1,
        // Share the native view store so archive toasts and this filter use one state.
        store: ctx.slots.entries('sidebar.workspaces').find(entry => entry.store)?.store,
      }, props => <LeftSidebarChrome wide={props.wide} ctx={ctx} getStore={getStore} onOpenDoc={openDocTab} onOpenOverview={() => openSidebarGuideTab()} onOpenGraph={()=>openGraphTab()} useWorkspaceView={props.useStore} workspaceActions={props.actions} />))));
    }

    ctx.effect(() => ctx.slots.inject('main', function* () {
      yield ctx.slots.register({
        name: 'main',
        key: PANEL_ID,
        ...(hasSidebarRight ? {} : { children: WORKSPACE_CHILDREN }),
      }, props => hasSidebarRight ? null : (
        <CurrentVaultWorkspace
          ctx={ctx}
          getStore={getStore}
          renderMarkdown={renderNativeMarkdown}
          renderSlot={props.renderSlot}
          onBring={(pins, intent) => bringReferences(ctx, pins, intent)}
          onBack={() => ctx.layout.selectPanel(null)}
          onGraph={detail => window.dispatchEvent(new CustomEvent('notara:open-graph', { detail }))}
        />
      ));
      if (hasSidebarRight) {
        for (const item of QUICK_PANELS.slice(1)) {
          yield ctx.slots.register({ name: 'main', key: item.id }, () => null);
        }
      }
    }));

    ctx.plugin({
      name: 'notara-session-activity',
      inject: ['uiConversation', 'sessions', 'slots'],
      apply(scope) {
        scope.effect(() => installActivityPanel(scope, {
          presentation: conversationSurface?.presentation,
          onOpenAgent(address) {
            if(!hasSidebarRight)return;
            const query=new URLSearchParams({parent:address.parentSessionId,mode:address.mode});
            navigation.open(()=>sidebarRight.openResource(`dsh-resource://subagentchat/session/${encodeURIComponent(address.childSessionId)}?${query}`,{kind:'subagentchat'}));
          },
          onOpenUrl(url) { if (hasSidebarRight) navigation.open(() => sidebarRight.openTab('browser', { params: { url } })); },
          onOpenFile(file) {
            if (file.workspaceId != null && /\.(?:md|pdf|canvas|excalidraw)$/i.test(file.path)) {
              try { safeRelativePath(file.path); openDocTab({ path: file.path, workspaceId: file.workspaceId, page:file.page,rect:file.rect,range:file.range,revision:file.revision }); return; } catch { /* Unsupported Vault paths keep the native viewer. */ }
            }
            if (hasSidebarRight) navigation.open(() => sidebarRight.openResource(file.address));
          },
        }));
      },
    });

    ctx.effect(() => ctx.slots.inject('sidebar.panellist', function* () {
      const panels = hasSidebarRight ? QUICK_PANELS : [QUICK_PANELS[0]];
      for (const item of panels) {
        yield ctx.slots.register({
          name: 'sidebar.panellist',
          id: item.id,
          order: item.order,
          label: () => item.label === '资料库' && !hasSidebarRight ? '资料' : item.label,
        }, ({ size = 20 }) => item.icon(size));
      }
    }));
  },
};
