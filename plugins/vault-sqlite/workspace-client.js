import { VAULT_REMOTE_METHODS } from './remote.js';
import { bindChangeSource } from './changes-client.js';
export { subscribeVaultChanges, notifyVaultChanged, vaultChangeIncludes, vaultRemoteScope } from './changes-client.js';

export function workspaceForSession(ctx, sessionId) {
  const source = ctx.get?.('workspaces')?.list;
  // Standalone consumers without the native workspace service use the configured root.
  if (!source) return undefined;
  const items = source.getSnapshot()?.items ?? [];
  const byId = ctx.sessions?.list?.getSnapshot()?.byId ?? {}, seen = new Set();
  for (let id = sessionId; id && !seen.has(id); ) {
    seen.add(id);
    const direct = items.find(row => row.sessionIds?.includes(id));
    if (direct) return direct.workspaceId;
    const address = ctx.sessions?.subagentAddress?.(id), row = byId[id];
    id = address?.childSessionId === id ? address.parentSessionId : row?.origin === 'subagent' ? row.parentId : undefined;
  }
  return null;
}
export function currentWorkspace(ctx) {
  const selected = ctx.get?.('uiSession')?.adapter?.current?.getSnapshot()?.key;
  if (selected) return workspaceForSession(ctx, selected);
  const sessions = ctx.sessions?.list?.getSnapshot()?.byId ?? {};
  const session = Object.values(sessions).find(row => row.retainedBy?.mainView > 0);
  return workspaceForSession(ctx, session?.id);
}
export function subscribeWorkspace(ctx, listener) {
  const off = [ctx.sessions?.list, ctx.get?.('workspaces')?.list, ctx.get?.('uiSession')?.adapter?.current].map(source => source?.subscribe(listener));
  return () => off.forEach(dispose => dispose?.());
}
/** Select the durable native home before editing; never move drafts or submit. */
export async function openLearningHome(ctx, workspaceId, { onOpened } = {}) {
  if (typeof workspaceId !== 'string' || !workspaceId) throw new Error('请先选择学习集');
  const ui = ctx.get?.('uiWorkspace');
  if (!ui?.openSession) throw new Error('首页导航暂不可用');
  const signal = ctx.layout?.beginNavigation?.();
  const result = await ctx.remote.notaraVault.homeSession({ workspaceId, open: true });
  if (signal?.aborted) return false;
  if (!result?.ok || typeof result.value?.sessionId !== 'string' || !result.value.sessionId) throw new Error('暂时无法打开长期教师，请重试');
  ctx.get?.('notaraHomeNavigation')?.open(result.value.sessionId);
  ui.openSession(result.value.sessionId);
  ctx.layout?.selectPanel?.(null);
  onOpened?.();
  return true;
}
// Each bound facade freezes its source, including across asynchronous saves and references.
export function bindVaultRemote(remote, workspaceId) {
  const facade=Object.fromEntries(VAULT_REMOTE_METHODS.map(method => [method, input => {
    if (workspaceId === null) return Promise.reject(new Error('请先在侧边栏选择工作区'));
    return remote[method]({ ...input, ...(workspaceId === undefined ? {} : { workspaceId }) });
  }]));
  return bindChangeSource(Object.defineProperty(facade,'workspaceId',{value:workspaceId}), remote, workspaceId);
}
