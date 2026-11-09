import { isVaultPath } from './model.js';
import { workspaceForSession } from '@oh-my-student/plugin-vault-sqlite/workspace-client';

export const REFERENCE_SOURCE = 'notara-home-reference';
export function currentSessionId(snapshot) {
  return Object.values(snapshot?.byId ?? {}).find(row => row?.retainedBy?.mainView > 0)?.id;
}
export function draftEnd(state) {
  return state.draft.length - state.occurrences.reduce((sum, occurrence) => sum + occurrence.length - 1, 0);
}

function resolveClassroomTarget(ctx, sessionId, requestedWorkspaceId, { verifiedClassroom = false } = {}) {
  if (typeof sessionId !== 'string' || !sessionId.trim()) return null;
  const id = sessionId.trim();
  const ui = ctx?.get?.('uiWorkspace');
  if (!ui?.openSession) return null;
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
  const preset = presetOf(id);
  if (preset !== undefined && preset !== null && preset !== 'notara-teacher') return null;

  if (session.origin === 'subagent') {
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
    const catalogEntry = list?.projectionsBySession?.[parentId]?.values?.subagentCatalog?.find(item => item?.id === id);
    const rawModes = [
      address?.mode,
      session.projectionValues?.subagent?.mode,
      list?.projectionsBySession?.[id]?.values?.subagent?.mode,
      catalogEntry?.mode,
    ];
    const mode = rawModes.find(item => typeof item === 'string' && item !== 'unknown');
    if (mode ? mode !== 'continuable' : !verifiedClassroom) return null;
    return { parentSessionId: parentId, childSessionId: id, mode: 'continuable' };
  }

  if (workspace && !workspace.sessionIds?.includes(id)) return null;
  return id;
}

/** Check whether a classroom session exists in the active workspace, is non-archived, and can be navigated to natively. */
export function canOpenSession(ctx, sessionId, requestedWorkspaceId, options = {}) {
  return resolveClassroomTarget(ctx, sessionId, requestedWorkspaceId, options) !== null;
}

/** Open the exact native classroom session without touching Home draft or prefilling a new conversation. */
export function openContinuationSession(ctx, sessionId, requestedWorkspaceId, options = {}) {
  const target = resolveClassroomTarget(ctx, sessionId, requestedWorkspaceId, options);
  if (target === null) return false;
  ctx.get('uiWorkspace').openSession(target);
  return true;
}

/** Native edit operations preserve all earlier draft text and reference tokens. */
export function prefillComposer(ctx, sessionId, request) {
  if (!sessionId || !request?.text?.trim() || currentSessionId(ctx.sessions.list.getSnapshot()) !== sessionId) return false;
  const scope = ctx.sessions.scope(sessionId);
  if (!scope || ctx.conversation.blocks.storeFor(sessionId).getSnapshot()) return false;
  const input = ctx.conversation.input.for(scope);
  let state = input.state.getSnapshot();
  if (state.phase !== 'plain') return false;
  if (request.reference) {
    const pin = request.reference;
    if (!isVaultPath(pin.path) || typeof pin.title !== 'string' || typeof pin.revision !== 'string') return false;
    const workspaceId = workspaceForSession(ctx, sessionId);
    if (workspaceId === null) return false;
    const rec = request.recommendation;
    if (rec && (!isVaultPath(rec.path) || typeof rec.revision !== 'string' || !Number.isSafeInteger(rec.line) || rec.line < 1 || typeof rec.title !== 'string' || typeof rec.reason !== 'string')) return false;
    const ref = JSON.stringify({ path: pin.path, title: pin.title, revision: pin.revision, ...(workspaceId === undefined ? {} : { workspaceId }), ...(rec ? { recommendation: rec } : {}) });
    if (!state.occurrences.some(item => item.source === REFERENCE_SOURCE && item.ref === ref)) {
      const end = draftEnd(state);
      if (!input.insertReference({ source: REFERENCE_SOURCE, ref, label: pin.title, appearance: 'file', clipboardText: `【${pin.title}】` }, { start: end, end, draftRev: state.draftRev })) return false;
      state = input.state.getSnapshot();
    }
  }
  const text = request.text.trim();
  if (state.draft.includes(text)) return true;
  const end = draftEnd(state);
  return scope.bail(scope, 'slash/input-insert-text', {
    text: (state.draft.length ? '\n\n' : '') + text,
    span: { start: end, end, draftRev: state.draftRev },
  }) === true;
}

export function registerReference(ctx) {
  return ctx.inputTriggers.registerSource({
    trigger: '@', name: REFERENCE_SOURCE, order: 18, showGroupTitle: false,
    async candidates() { return []; },
    onPick() {},
    codec: {
      clipboardText(ref) { try { return `【${JSON.parse(ref).title}】`; } catch { return '【学习资料】'; } },
      // A reference is a locator, never an answer preview or a mastery claim.
      // The native filesystem tools read the file on demand in the current Vault.
      async serialize(ref, signal) {
        signal?.throwIfAborted();
        const pin = JSON.parse(ref);
        if (!isVaultPath(pin?.path) || typeof pin.title !== 'string' || typeof pin.revision !== 'string') throw new TypeError('资料引用无法读取，请重新带入。');
        return `\n学习资料引用：${JSON.stringify(pin)}\n这是资料定位信息。请先读取原文并核对版本；仅带入引用不代表学生已读或掌握。${pin.recommendation ? ' recommendation 是老师此前保存的推荐及依据，不是学生新表达的学情；按其 path 与 line 回读当前版本，目标变化时先对齐。' : ''}\n`;
      },
    },
  });
}
