import { isAbsoluteWorkspacePath, parseFileAddress, relativizeToCwd, fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path';
import { safeRelativePath, safeWorkspaceRelativePath, isVaultFormat } from '@oh-my-student/plugin-vault-sqlite/vault-path';
import { referenceFragment } from '@oh-my-student/plugin-vault-sqlite/file-reference';

/** Claim only supported files bound to a registered source Session/workspace. */
export function nativeFileLocator(address, workspaces = [], workspaceForSession) {
  const file = parseFileAddress(address);
  if (file?.scope !== 'session') return null;
  const sourceWorkspace = workspaceForSession?.(file.sessionId);
  const workspace = workspaceForSession ? workspaces.find(row => row.workspaceId === sourceWorkspace) : workspaces.find(row => row.sessionIds?.includes(file.sessionId));
  if (!workspace) return null;
  const [filePath, ...suffix] = file.path.split('#');
  const path = relativizeToCwd(filePath.replace(/\\/g, '/'), workspace.path?.replace(/\\/g, '/'));
  if (isAbsoluteWorkspacePath(path) || !isVaultFormat(path)) return null;
  try { safeRelativePath(path); } catch { return null; }
  const subpath = suffix.length ? '#' + suffix.join('#') : address.includes('#') ? address.slice(address.indexOf('#')) : undefined;
  return { path, workspaceId: workspace.workspaceId, ...(subpath ? { subpath } : {}) };
}

/** Choose an authorized source session in this exact workspace, never the
 * unrelated session currently displaying the material tab. */
export function workspaceFileAddress(locator, workspaces = [], sessions = {}, workspaceForSession) {
  safeWorkspaceRelativePath(locator.path);
  const workspace = workspaces.find(row => row.workspaceId === locator.workspaceId);
  const requested = locator.sourceSessionId;
  const source = requested ? (sessions[requested] && (workspace?.sessionIds?.includes(requested) || workspaceForSession?.(requested) === locator.workspaceId) ? requested : undefined) : workspace?.sessionIds?.find(id => sessions[id]);
  if (!source) throw new Error('文件所属工作区已不可用，请重新打开工作区。');
  return fileAddressFor(source, sessions[source].cwd, locator.path) + referenceFragment(locator);
}

export function nativeFileTitle(address) {
  return parseFileAddress(address)?.path.split(/[\\/]/).at(-1)?.replace(/\.(?:md|markdown)$/i, '') ?? '文件';
}
