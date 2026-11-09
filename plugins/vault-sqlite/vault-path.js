// Browser-safe path contract shared by the Vault and native preview routing.
const IGNORED = new Set(['node_modules', '.git', '.venv', 'venv', 'target', 'dist', '_templates']);
export const IMAGE_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
export const EXTENSIONS = new Set(['.md', '.base', '.canvas', '.excalidraw', '.pdf', ...Object.keys(IMAGE_MIME)]);
export const ignoredPart = part => part.startsWith('.') || IGNORED.has(part.toLowerCase()) || part.toLowerCase().endsWith('.app') || part.endsWith('.notara-lock');
/** A file identity is independent from its preview/editing capability. */
export function safeWorkspaceRelativePath(path) {
  const invalid = () => { throw new Error('vault_path_invalid'); };
  if (typeof path !== 'string' || !path || path.length > 1000 || /[\\\x00-\x1f<>:"|?*]/.test(path)) invalid();
  const parts = path.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || ignoredPart(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) invalid();
  return path;
}
export function isVaultFormat(path) {
  const name = path.split('/').at(-1), dot = name.lastIndexOf('.');
  return dot >= 0 && EXTENSIONS.has(name.slice(dot).toLowerCase());
}
/** Read/write admission stays restricted to formats owned by the Vault engine. */
export function safeRelativePath(path) {
  safeWorkspaceRelativePath(path);
  if (!isVaultFormat(path)) throw new Error('vault_path_invalid');
  return path;
}
