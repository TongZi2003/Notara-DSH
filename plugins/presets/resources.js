import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('./resources/', import.meta.url);
const provenance = JSON.parse(readFileSync(new URL('provenance.json', root), 'utf8'));

// Eager, verified package resources: a missing core prompt prevents loading the
// plugin instead of silently sending a generic fallback prompt to the model.
const bundled = Object.freeze(Object.fromEntries(Object.entries(provenance.sha256).map(([path, hash]) => {
  const bytes = readFileSync(new URL(path, root));
  if (createHash('sha256').update(bytes).digest('hex') !== hash) {
    throw new Error(`Bundled Notara resource checksum mismatch: ${path}`);
  }
  return [path, bytes.toString('utf8')];
})));

export const skillManifest = Object.freeze(JSON.parse(bundled['manifest.json']));
export const skillsDirectory = new URL('pi-skills-built/', root);
export function skillsForRole(roleKind) {
  return Object.freeze(skillManifest.skills
    .filter(skill => Array.isArray(skill.roles) && skill.roles.includes(roleKind))
    .map(skill => `notara-${skill.id}`));
}
export function skillsDirectoryFor(roleKind) {
  const names = skillsForRole(roleKind);
  if (!names.length) throw new Error(`Role kind "${roleKind}" has no bundled skills`);
  for (const name of names) {
    if (!Object.hasOwn(bundled, `role-skills/${roleKind}/${name}/SKILL.md`)) {
      throw new Error(`Missing bundled skill ${name} for role kind "${roleKind}"`);
    }
  }
  return new URL(`role-skills/${roleKind}/`, root);
}
export const resourceProvenance = Object.freeze(provenance);
export function resource(path) {
  if (!Object.hasOwn(bundled, path)) throw new Error(`Unknown bundled Notara resource: ${path}`);
  return bundled[path];
}
