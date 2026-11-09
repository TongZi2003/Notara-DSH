import { realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

const inside = (root, path) => { const part = relative(root, path); return part === '' || (!part.startsWith(`..${sep}`) && part !== '..' && !isAbsolute(part)); };
async function existingParent(path) {
  try { return await realpath(path); } catch (error) {
    if (error.code !== 'ENOENT' || dirname(path) === path) throw error;
    return existingParent(dirname(path));
  }
}

/** Test-only boundary: cwd alone is not a filesystem sandbox. */
export async function checkSummaryProbeAccess(root, resources, name, args) {
  if (['bash', 'shell', 'job_list', 'job_output', 'job_kill'].includes(name)) return false;
  if (!['read', 'read_image', 'write', 'edit', 'glob', 'grep'].includes(name)) return true;
  const write = ['write', 'edit'].includes(name), search = ['glob', 'grep'].includes(name);
  const input = search ? args.path ?? '.' : args.file_path;
  if (typeof input !== 'string' || !input || input.includes('\0') || /^\w+:\/\//.test(input)) return false;
  if (name === 'glob' && (typeof args.pattern !== 'string' || isAbsolute(args.pattern) || args.pattern.split(/[\\/]/).includes('..'))) return false;
  const roots = await Promise.all((write ? [root] : [root, resources]).map(async path => ({ lexical: resolve(path), physical: await realpath(path) })));
  const target = resolve(root, input);
  const resolved = await existingParent(target);
  return roots.some(allowed => (inside(allowed.lexical, target) || inside(allowed.physical, target)) && inside(allowed.physical, resolved));
}
