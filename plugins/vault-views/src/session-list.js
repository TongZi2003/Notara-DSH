import { currentWorkspace } from '@oh-my-student/plugin-vault-sqlite/workspace-client';

const pendingSessionOpens = new WeakMap();

/** Read-only projection of native sessions within the selected workspace. */
export function workspaceSessionRows({ list, workspace, registry, currentId, query = '', content = [], archivedFilter = 'default' }) {
  const archiveIds = new Set(registry?.archivedSessionIds ?? []);
  const pinIds = new Set(registry?.pinnedSessionIds ?? []);
  const matches = new Map(content.map(item => [item.sessionId, item.snippet]));
  const text = query.trim().toLocaleLowerCase();
  return [...new Set(workspace?.sessionIds ?? [])].flatMap(id => {
    const session = list?.byId?.[id];
    if (!session || session.origin === 'subagent' || (session.blank && id !== currentId)) return [];
    const archived = archiveIds.has(id);
    if ((archivedFilter === 'default' && archived) || (archivedFilter === 'only' && !archived)) return [];
    const agentPreset = list?.projectionsBySession?.[id]?.values?.agentPreset ?? session.projectionValues?.agentPreset ?? session.agentPreset;
    const kindLabel = agentPreset === 'notara-material-organizer' ? '资料整理' : undefined;
    const title = session.blank ? '新会话' : session.title?.trim() || '未命名会话';
    if (text && !title.toLocaleLowerCase().includes(text) && !(kindLabel && kindLabel.toLocaleLowerCase().includes(text)) && !matches.has(id)) return [];
    return [{ ...session, agentPreset, kindLabel, title, renameTitle: session.blank ? '' : session.title?.trim() || '', pinned: !archived && pinIds.has(id), archived, snippet: text ? matches.get(id) : undefined }];
  }).sort((a, b) => Number(Boolean(b.blank)) - Number(Boolean(a.blank)) || Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}

function validateSubagentAncestry(ctx, list, archived, workspace, id, session) {
  const address = ctx?.sessions?.subagentAddress?.(id);
  const parentId = address?.parentSessionId ?? session.parentId ?? session.parentSession;
  if (typeof parentId !== 'string' || !parentId.trim()) return null;
  let rootId = parentId;
  const seen = new Set([id]);
  while (typeof rootId === 'string' && rootId) {
    if (seen.has(rootId) || archived.has(rootId)) return null;
    seen.add(rootId);
    const anc = list?.byId?.[rootId];
    if (!anc || anc.removed) return null;
    if (anc.origin !== 'subagent') break;
    rootId = ctx?.sessions?.subagentAddress?.(rootId)?.parentSessionId ?? anc.parentId ?? anc.parentSession;
  }
  if (!rootId || list?.byId?.[rootId]?.origin === 'subagent') return null;
  if (workspace && !workspace.sessionIds?.includes(rootId)) return null;
  return { address, parentId, rootId };
}

export function resolveWorkspaceSessionTarget(ctx, sessionId, requestedWorkspaceId, { verifiedClassroom = false } = {}) {
  if (typeof sessionId !== 'string' || !sessionId.trim()) return null;
  const id = sessionId.trim();
  const list = ctx?.sessions?.list?.getSnapshot?.();
  const session = list?.byId?.[id];
  if (!session || session.removed) return null;
  const workspacesService = ctx?.get?.('workspaces')?.list;
  const registry = workspacesService?.getSnapshot?.();
  const archived = new Set(registry?.archivedSessionIds ?? []);
  if (archived.has(id)) return null;
  let workspace = null;
  if (requestedWorkspaceId !== undefined || workspacesService) {
    if (typeof requestedWorkspaceId !== 'string' || !requestedWorkspaceId.trim() || !Array.isArray(registry?.items)) return null;
    workspace = registry.items.find(item => item.workspaceId === requestedWorkspaceId) ?? null;
    if (!workspace) return null;
  }
  const presetOf = targetId =>
    list?.projectionsBySession?.[targetId]?.values?.agentPreset
    ?? list?.byId?.[targetId]?.projectionValues?.agentPreset
    ?? list?.byId?.[targetId]?.agentPreset;

  if (session.origin === 'subagent') {
    const ancestry = validateSubagentAncestry(ctx, list, archived, workspace, id, session);
    if (!ancestry) return null;
    const { address, parentId } = ancestry;
    const catalogEntry = list?.projectionsBySession?.[parentId]?.values?.subagentCatalog?.find(item => item?.id === id);
    const rawModes = [
      address?.mode,
      session.projectionValues?.subagent?.mode,
      list?.projectionsBySession?.[id]?.values?.subagent?.mode,
      catalogEntry?.mode,
    ];
    const mode = rawModes.find(item => typeof item === 'string' && item !== 'unknown');
    if (mode ? mode !== 'continuable' : !verifiedClassroom) return null;
    const preset = presetOf(id);
    if (typeof preset === 'string' && preset ? preset !== 'notara-teacher' : !verifiedClassroom) return null;
    return { parentSessionId: parentId, childSessionId: id, mode: 'continuable' };
  }

  if (workspace && !workspace.sessionIds?.includes(id)) return null;
  return id;
}

export function canOpenWorkspaceSession(ctx, sessionId, requestedWorkspaceId, options = {}) {
  return resolveWorkspaceSessionTarget(ctx, sessionId, requestedWorkspaceId, options) !== null;
}

export function openWorkspaceSession(ctx, sessionId, requestedWorkspaceId, options = {}) {
  const { verifiedClassroom = false, onOpened } = options ?? {};
  const ui = ctx?.get?.('uiWorkspace');
  if (!ui?.openSession) return false;
  // All callers share the native Controller, including separate slot contexts.
  pendingSessionOpens.get(ctx.sessions)?.();
  const target = resolveWorkspaceSessionTarget(ctx, sessionId, requestedWorkspaceId, { verifiedClassroom });
  if (target !== null) {
    ui.openSession(target);
    onOpened?.(target);
    return true;
  }
  if (typeof sessionId !== 'string' || !sessionId.trim() || typeof ctx?.sessions?.refreshProjections !== 'function') return false;
  const id = sessionId.trim();
  const list = ctx?.sessions?.list?.getSnapshot?.();
  const session = list?.byId?.[id];
  if (!session || session.removed || session.origin !== 'subagent') return false;
  const workspacesService = ctx?.get?.('workspaces')?.list;
  const registry = workspacesService?.getSnapshot?.();
  const archived = new Set(registry?.archivedSessionIds ?? []);
  if (archived.has(id)) return false;
  let workspace = null;
  if (requestedWorkspaceId !== undefined || workspacesService) {
    if (typeof requestedWorkspaceId !== 'string' || !requestedWorkspaceId.trim() || !Array.isArray(registry?.items)) return false;
    workspace = registry.items.find(item => item.workspaceId === requestedWorkspaceId) ?? null;
    if (!workspace) return false;
  }
  const ancestry = validateSubagentAncestry(ctx, list, archived, workspace, id, session);
  if (!ancestry) return false;
  const { address, parentId } = ancestry;
  const catalogEntry = list?.projectionsBySession?.[parentId]?.values?.subagentCatalog?.find(item => item?.id === id);
  const knownMode = [address?.mode, session.projectionValues?.subagent?.mode, list?.projectionsBySession?.[id]?.values?.subagent?.mode, catalogEntry?.mode]
    .find(item => typeof item === 'string' && item !== 'unknown');
  if (knownMode && knownMode !== 'continuable') return false;
  const knownPreset = list?.projectionsBySession?.[id]?.values?.agentPreset ?? session.projectionValues?.agentPreset ?? session.agentPreset;
  if (typeof knownPreset === 'string' && knownPreset && knownPreset !== 'notara-teacher') return false;
  if (list?.projectionsBySession?.[id] && list?.projectionsBySession?.[parentId]) return false;

  // rc.4 exposes selection through the SlotScopeAdapter, not uiWorkspace's
  // private saved selection. Observe it so a switch away and back still revokes.
  const selection = ctx.get?.('uiSession')?.adapter?.current;
  const selectedId = () => selection ? selection.getSnapshot()?.key
    : Object.values(ctx.sessions.list.getSnapshot()?.byId ?? {}).find(row => row.retainedBy?.mainView > 0)?.id;
  const initialSelection = selectedId(), initialWorkspace = currentWorkspace(ctx);
  const navigation = ctx.layout?.beginNavigation?.();
  let active = true;
  const disposers = [];
  const cancel = () => {
    if (!active) return;
    active = false;
    disposers.splice(0).forEach(dispose => dispose?.());
    navigation?.removeEventListener('abort', cancel);
    if (pendingSessionOpens.get(ctx.sessions) === cancel) pendingSessionOpens.delete(ctx.sessions);
  };
  const isCurrent = () => active && !navigation?.aborted
    && selectedId() === initialSelection && currentWorkspace(ctx) === initialWorkspace;
  const observe = () => { if (!isCurrent()) cancel(); };
  pendingSessionOpens.set(ctx.sessions, cancel);
  navigation?.addEventListener('abort', cancel, { once: true });
  for (const source of [selection, ctx.sessions.list, workspacesService]) {
    if (source?.subscribe) disposers.push(source.subscribe(observe));
  }
  observe();
  if (!active) return false;
  let refresh;
  try {
    refresh = Promise.all([ctx.sessions.refreshProjections(id), ctx.sessions.refreshProjections(parentId)]);
  } catch {
    cancel();
    return false;
  }
  void refresh.then(() => {
    if (!isCurrent()) return;
    const resolved = resolveWorkspaceSessionTarget(ctx, id, requestedWorkspaceId, { verifiedClassroom });
    if (resolved === null) return;
    const liveUi = ctx?.get?.('uiWorkspace');
    if (!liveUi?.openSession) return;
    cancel();
    liveUi.openSession(resolved);
    onOpened?.(resolved);
  }).catch(() => {}).finally(cancel);
  return true;
}
