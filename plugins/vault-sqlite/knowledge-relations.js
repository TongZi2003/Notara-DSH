import { parseReference, referenceCandidates } from './file-reference.js';
import { safeWorkspaceRelativePath, isVaultFormat } from './vault-path.js';

const auxiliaryTypes = new Set(['route', 'lesson', 'learner-profile', 'guide', 'diary', 'template', 'skill', 'base']);
export const isLearningDocument = row => !!row && !row.is_guide && !row.isGuide && !row.is_template && !auxiliaryTypes.has(row.type) && !/^(日记|模板)\//.test(row.path);
export const isKnowledgeEntity = row => isLearningDocument(row) && ['concept', 'method'].includes(row.type);
export const isExampleDocument = row => isLearningDocument(row) && ['exercise', 'card'].includes(row.type);
export const knowledgeTagIdentity = target => `[[${target}]]`;

/** Semantic references deliberately have no source-folder preference. A short
 * name must identify one file in the whole learning set, including non-entities.
 * Explicit paths never fall back to a basename after a move or deletion. */
export function createRelationResolver(documents) {
  const metadata = new Map(documents.map(row => [row.path, row])), names = new Map();
  for (const row of documents) {
    const name = row.path.split('/').at(-1);
    if (!names.has(name)) names.set(name, []);
    names.get(name).push(row.path);
  }
  function resolvePath(target, exact = false) {
    try { safeWorkspaceRelativePath(target); } catch { return { reason: 'invalid-reference' }; }
    for (const file of referenceCandidates(target)) {
      if (exact || target.includes('/') || isVaultFormat(target)) {
        if (metadata.has(file)) return { target: file };
      } else {
        const matches = names.get(file) ?? [];
        if (matches.length) return matches.length === 1 ? { target: matches[0] } : { reason: 'ambiguous' };
      }
    }
    return { reason: 'missing' };
  }
  function resolveTag(raw) {
    const ref = typeof raw === 'string' && raw.trim().startsWith('[[') ? parseReference(raw.trim()) : null;
    if (!ref) return { reason: 'invalid-reference' };
    // parseReference supplies a default .md suffix. Retain the authored target
    // here so a true short name and an explicit root filename stay distinct.
    const target = raw.trim().slice(2, -2).split(/[|#]/, 1)[0].trim();
    const result = resolvePath(target);
    if (!result.target) return result;
    if (!isKnowledgeEntity(metadata.get(result.target))) return { reason: 'not-entity' };
    return { raw, target: result.target, label: ref.label };
  }
  return { metadata, resolvePath, resolveTag };
}

export function projectKnowledgeTags(tags, resolveTag) {
  const knowledgeTags = [], unresolvedKnowledgeTags = [];
  for (const raw of tags) {
    if (!raw.trim().startsWith('[[')) continue;
    const result = resolveTag(raw);
    if (result.target) knowledgeTags.push(result);
    else unresolvedKnowledgeTags.push({ raw, reason: result.reason });
  }
  return { knowledgeTags, unresolvedKnowledgeTags };
}

/** Base/raw tag properties remain unchanged. Only tag predicates use resolved
 * file identity. Standalone Base callers can compare already canonical paths;
 * the store supplies its full-set resolver for short/alias query references. */
export function matchesKnowledgeTag(document, tag, resolveTag) {
  if (typeof tag !== 'string' || !tag.trim().startsWith('[[')) return false;
  const target = resolveTag ? resolveTag(tag).target : parseReference(tag.trim())?.path;
  return !!target && (document.knowledgeTags ?? []).some(item => item.target === target);
}

export function relationIdentity(kind, source, target, context = '') {
  context = context.trim().normalize('NFC');
  const unordered = ['association', 'reference', 'source'].includes(kind);
  const endpoints = unordered && source > target ? [target, source] : [source, target];
  // Legacy reference/source DTOs retain the declaring file as source. Their
  // deduplication key is still unordered; prerequisite keys are always directed.
  if (kind === 'association') [source, target] = endpoints;
  return { id: `${kind}:${JSON.stringify([...endpoints, context])}`, kind, source, target, context };
}
