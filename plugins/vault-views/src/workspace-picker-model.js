export const RECENT_WORKSPACES_KEY = 'notara.workspace.recent.v1';
export const workspaceTitle = workspace => workspace?.title === 'default-workspace' ? '默认工作区' : workspace?.title || '工作区';
export function rememberWorkspace(ids, id) {
  return id ? [id, ...ids.filter(value => value !== id)].slice(0, 8) : ids;
}
export function workspaceGroups(workspaces, currentId, recent, search = '') {
  const query = search.trim().toLocaleLowerCase();
  const available = workspaces.filter(item => workspaceTitle(item).toLocaleLowerCase().includes(query));
  const current = available.filter(item => item.workspaceId === currentId);
  const byId = new Map(available.filter(item => item.workspaceId !== currentId).map(item => [item.workspaceId, item]));
  const last = [...new Set(recent)].flatMap(id => byId.has(id) ? [byId.get(id)] : []);
  const used = new Set(last.map(item => item.workspaceId));
  return [['当前', current], ['最近使用', last], ['其他学习集', [...byId.values()].filter(item => !used.has(item.workspaceId))]].filter(([, items]) => items.length);
}
