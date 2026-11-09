import { mapPreviewText, previewText,isReferenceHeading } from '@oh-my-student/plugin-vault-sqlite/preview';
import { parseStructure, walkStructure, protectedMarkdownRanges, withoutMarkdownComments } from './markdown-structure.js';
import { parseReference, referenceCandidates, validateRect, referenceMarkdown, referenceFragment, parseSessionReference, sessionReferenceMarkdown, validateSessionId } from '@oh-my-student/plugin-vault-sqlite/file-reference';
import { parseMarkdown } from '@oh-my-student/plugin-vault-sqlite/frontmatter';
import { projectRouteDocument } from '@oh-my-student/plugin-vault-sqlite/route-projection';
import { safeWorkspaceRelativePath } from '@oh-my-student/plugin-vault-sqlite/vault-path';
export { parseReference, validateRect, parseSessionReference, sessionReferenceMarkdown, validateSessionId, projectRouteDocument };
export const VIEWS = ['table', 'cards', 'guides', 'routes', 'lessons', 'review'];
export const CARD_TYPES = new Set(['card', 'concept', 'method', 'exercise']);
export const isCardType = type => CARD_TYPES.has(type);
export const TYPE_LABELS = { card: '卡片', concept: '概念', method: '方法', exercise: '具体例子', source: '来源', guide: '学习计划', plan: '学习计划', route: '学习路线', lesson: '备课本', 'learner-profile': '学习画像', diary: '日记', template: '模板', canvas: '白板', drawing: '手绘', image: '图片', pdf: 'PDF', file: '文件' };
import {REVIEW_SUPPORT_LABELS as SUPPORT_LABELS} from '@oh-my-student/plugin-vault-sqlite/review-contract';
export {SUPPORT_LABELS};

export function queryInput(filters = {}, view = 'table') {
  const query = { view, tags: [...new Set(filters.tags ?? [])], q: (filters.q ?? '').trim(), sort: filters.sort || 'title' };
  if (filters.tagMatch === 'any') query.tagMatch = 'any';
  if (filters.type) query.type = filters.type;
  if (filters.sourcePath) query.sourcePath = filters.sourcePath;
  if (filters.reviewStatus) query.reviewStatus = filters.reviewStatus;
  if (view === 'routes') query.type = 'route';
  if (view === 'lessons') query.type = 'lesson';
  if (view === 'review') { query.reviewStatus = 'due'; }
  if (filters.minReviews !== '' && filters.minReviews != null) query.minReviews = Math.max(0, Number(filters.minReviews) || 0);
  if (Number.isInteger(filters.offset) && filters.offset >= 0) query.offset = filters.offset;
  if (Number.isInteger(filters.limit) && filters.limit > 0) query.limit = filters.limit;
  return query;
}

export function safeSummary(text = '') {
  // The index summary may flatten newlines. Do not let folded reference or
  // learner-history sections become a preview answer in the card grid.
  const visible = stripCollapsedContent(String(text));
  let summary = mapPreviewText(visible.split(/##\s*(?:参考理解|学生理解)/)[0], text => text.replace(/!?\[\[[^\]]*\]\]/g, '').replace(/<[^>]*>/g, '')).replace(/^#\s+[^#]*?(?=##|$)/, '').replace(/##\s*内容\s*/, '').trim();
  summary = previewText(summary);
  if ((summary.match(/\$\$/g) || []).length % 2 === 1) summary = summary.slice(0, summary.lastIndexOf('$$')).trim();
  if ((summary.replace(/\$\$/g, '').match(/\$/g) || []).length % 2 === 1) summary = summary.slice(0, summary.lastIndexOf('$')).trim();
  if ((summary.match(/\*\*/g) || []).length % 2 === 1) summary = summary.slice(0, summary.lastIndexOf('**')).trim();
  return summary;
}

export function stripCollapsedContent(text) {
  let depth = 0, cursor = 0, visible = '';
  for (const match of text.matchAll(/<\/?details\b[^>]*(?:>|$)/gi)) {
    const closing = /^<\//.test(match[0]);
    if (!closing) { if (depth === 0) visible += text.slice(cursor, match.index); depth++; }
    else if (depth > 0) { depth--; if (depth === 0) cursor = match.index + match[0].length; }
  }
  return depth === 0 ? visible + text.slice(cursor) : visible;
}

export function assertDisplayedRevision(record, expectedRevision) {
  if (typeof expectedRevision !== 'string' || record.revision !== expectedRevision) {
    const error = new Error('来源已更新，请刷新页面并重新框选');
    error.code = 'STALE_SOURCE'; throw error;
  }
}

export async function verifyDisplayedSource(remote, record) {
  const current = await callVault(remote, 'read', { path: record.path });
  assertDisplayedRevision(current, record.revision);
  return current;
}

export function toggleTag(tags, tag) {
  return tags.includes(tag) ? tags.filter(value => value !== tag) : [...tags, tag];
}

export function relativePath(path) {
  if (typeof path !== 'string' || !path || /[\u0000-\u001f\u007f|\[\]#]/.test(path) || path.startsWith('/') || path.includes('\\') || /^[a-z]:/i.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('资料位置无效');
  return safeWorkspaceRelativePath(path);
}

export function dragRect(start, end, width, height) {
  if (!(width > 0 && height > 0)) return null;
  const x1 = Math.max(0, Math.min(width, start.x)), x2 = Math.max(0, Math.min(width, end.x));
  const y1 = Math.max(0, Math.min(height, start.y)), y2 = Math.max(0, Math.min(height, end.y));
  if (Math.abs(x1 - x2) < 3 || Math.abs(y1 - y2) < 3) return null;
  return validateRect([Math.min(x1, x2) / width, Math.min(y1, y2) / height, Math.abs(x1 - x2) / width, Math.abs(y1 - y2) / height]);
}

export function pdfReference(path, page, rect, revision) {
  relativePath(path);
  if (!Number.isInteger(page) || page < 1) throw new Error('页码无效');
  return `![[${path}${referenceFragment({page,rect,revision})}]]`;
}

export function stripFrontmatter(content) {
  return String(content ?? '').replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
}

export function documentType(content) {
  try {
    const { fields } = parseMarkdown(String(content ?? ''));
    return typeof fields?.type === 'string' && fields.type.trim() ? fields.type.trim() : null;
  } catch {
    return null;
  }
}

export function wikiToMarkdown(content) {
  const text = String(content), codeRanges = protectedMarkdownRanges(text), protectedRanges = [...codeRanges], linkRewrites = [];
  walkStructure(parseStructure(text), node => {
    if (['link', 'image'].includes(node.type)) {
      const from = node.position.start.offset, to = node.position.end.offset;
      protectedRanges.push([from, to]);
      if (node.type === 'link' && !codeRanges.some(([a, b]) => from >= a && from < b)) {
        const session = parseSessionReference(text.slice(from, to));
        if (session) linkRewrites.push([from, to, sessionReferenceMarkdown(session)]);
      }
    }
  });
  let rewritten = text;
  for (const [from, to, replacement] of linkRewrites.sort((a, b) => b[0] - a[0])) {
    if (replacement) rewritten = rewritten.slice(0, from) + replacement + rewritten.slice(to);
  }
  const finalProtected = linkRewrites.length ? (() => {
    const ranges = protectedMarkdownRanges(rewritten);
    walkStructure(parseStructure(rewritten), node => { if (['link', 'image'].includes(node.type)) ranges.push([node.position.start.offset, node.position.end.offset]); });
    return ranges;
  })() : protectedRanges;
  return rewritten.replace(/!?\[\[[^\]\r\n]+\]\]/g, (token, offset) => {
    let slashes = 0; for (let i = offset - 1; i >= 0 && rewritten[i] === '\\'; i--) slashes++;
    if (slashes % 2 || finalProtected.some(([from,to]) => offset >= from && offset < to)) return token;
    if (!token.startsWith('!')) {
      const session = parseSessionReference(token);
      if (session) return sessionReferenceMarkdown(session) || token;
    }
    const ref = parseReference(token);
    return ref ? referenceMarkdown({ ...ref, label: ref.page ? `查看原页 · 第 ${ref.page} 页` : ref.label }) : token;
  });
}

// Lines retain their original 1-based positions for toggleTask CAS. Fenced
// examples and comments are never promoted to actual guide tasks/headings.
export function guideSections(content) {
  const lines = String(content ?? '').split(/\r?\n/);
  const sections = [{ title: '导读', line: 1, lines: [], tasks: [] }];
  let section = sections[0], fence = null, comment = false, frontmatter = lines[0] === '---';
  const lineNumbers = new Map([[section, []]]);
  const append = (raw, index) => { section.lines.push(raw); lineNumbers.get(section).push(index + 1); };
  lines.forEach((raw, index) => {
    if (frontmatter) { if (index > 0 && raw === '---') frontmatter = false; return; }
    if (comment) { if (raw.includes('-->')) comment = false; return; }
    if (raw.trim().startsWith('<!--')) { comment = !raw.includes('-->'); return; }
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(raw);
    if (marker) { if (!fence) fence = marker[1][0]; else if (marker[1][0] === fence) fence = null; append(raw, index); return; }
    const heading = !fence && /^#{1,3}\s+(.+?)\s*#*\s*$/.exec(raw);
    if (heading) { section = { title: heading[1], line: index + 1, lines: [], tasks: [] }; sections.push(section); lineNumbers.set(section, []); return; }
    append(raw, index);
    const task = !fence && /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s+(.+)$/.exec(raw);
    if (task) section.tasks.push({ line: index + 1, checked: task[1] !== ' ', text: task[2] });
  });
  const ranges = new Map();
  walkStructure(parseStructure(content ?? ''), node => { if (node.type === 'listItem') ranges.set(node.position.start.line, node.position.end.line); });
  for (const item of sections) {
    for (const task of item.tasks) {
      const end = ranges.get(task.line) ?? task.line;
      const indent = /^(\s*(?:[-*+]|\d+[.)])\s+)/.exec(lines[task.line - 1])?.[1].length ?? 2;
      const displayText = [task.text, ...lines.slice(task.line, end).map(line => line.replace(new RegExp(`^ {1,${indent}}`), ''))].join('\n').trimEnd();
      if (displayText !== task.text) task.displayText = displayText;
    }
    item.bodyLines = item.lines.filter((line, index) => !item.tasks.some(task => lineNumbers.get(item)[index] >= task.line && lineNumbers.get(item)[index] <= (ranges.get(task.line) ?? task.line)));
  }
  return sections.filter(item => item.title !== '导读' || item.lines.some(line => line.trim()) || item.tasks.length);
}

export function markdownSections(content) {
  const sections = [{ title: '', content: '', reference: false }];
  const source = withoutMarkdownComments(stripFrontmatter(content));
  const protectedRanges = protectedMarkdownRanges(source);
  const protectedAt = offset => protectedRanges.some(([from, to]) => offset >= from && offset < to);
  const tags = [...source.matchAll(/<\/?details\b[^>]*>/gi)].filter(tag => !protectedAt(tag.index));
  let section = sections[0], detailsDepth = 0, offset = 0, tagIndex = 0;
  for (const rawLine of source.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const heading = !detailsDepth && !protectedAt(offset) && /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) { section = { title: heading[1], content: '', reference: isReferenceHeading(heading[1]) }; sections.push(section); }
    else section.content += line + '\n';
    offset += rawLine.length + 1;
    while (tagIndex < tags.length && tags[tagIndex].index < offset) {
      detailsDepth = Math.max(0, detailsDepth + (/^<\//.test(tags[tagIndex++][0]) ? -1 : 1));
    }
  }
  return sections;
}

export function reviewInput(path, form) {
  if (!['done', 'missed', 'unchecked'].includes(form.result)) throw new Error('请选择本次结果');
  if (!Object.hasOwn(SUPPORT_LABELS, form.support)) throw new Error('请明确选择本次帮助条件');
  return { path: relativePath(path), result: form.result, support: form.support, keyStep: (form.keyStep || '').trim(), note: (form.note || '').trim(),...form.heading?{heading:form.heading.trim()}:{} };
}

export function sourceCard({ title, path, page, rect, range, revision }) {
  const clean = String(title ?? '').trim();
  if (!clean || clean.length > 100 || /[\r\n]/.test(clean)) throw new Error('请填写 1–100 字的卡片标题');
  const filename = clean.replace(/[<>:"/\\|?*#\[\]\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '');
  if (!filename || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(filename)) throw new Error('请换一个卡片标题');
  const reference = range?`![[${path}${referenceFragment({range,revision})}]]`:pdfReference(path, page, rect, revision);
  const parsed=parseReference(reference);
  if(!parsed||parsed.path!==path||Boolean(parsed.range)!==Boolean(range))throw new Error('来源文件名无法用于选区引用，请先移除 #、| 或方括号后重试');
  return { path: `卡片/${filename}.md`, expectedRevision: null, content: `---\ntype: card\ntitle: ${JSON.stringify(clean)}\ntags: []\n---\n# ${clean}\n\n## 内容\n\n<details>\n<summary>查看原页</summary>\n\n${reference}\n\n</details>\n\n## 参考理解\n\n## 学生理解\n` };
}

export function groupCards(documents, group) {
  const groups = new Map();
  for (const doc of documents) {
    const label = group === 'reviews' ? `${doc.reviewCount || 0} 次记录` : (doc.tags?.[0] || '未标标签');
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(doc);
  }
  return [...groups].map(([title, cards]) => ({ title, cards }));
}

export async function callVault(remote, method, input = {}) {
  if (!remote || typeof remote[method] !== 'function') throw new Error('资料库暂时无法连接，请稍后重试');
  const reply = await remote[method](input);
  if (reply?.ok === false) {
    const error = new Error('资料操作未完成，请刷新后重试');
    const msg = reply.error?.message;
    error.code = typeof msg === 'string' && /^(vault_|review_)/.test(msg) ? msg : reply.error?.code;
    throw error;
  }
  return reply?.ok === true ? reply.value : reply;
}

/** Resolve extensionless/dotted note references without stealing real attachments. */
export async function resolveFileLocator(remote, locator) {
  const paths = referenceCandidates(locator.path);
  if (paths.length === 1 || typeof remote?.query !== 'function') return locator;
  const result = await callVault(remote, 'query', { paths, limit: paths.length });
  const found = new Set((result.documents ?? []).map(doc => doc.path));
  const path = paths.find(value => found.has(value));
  return path && path !== locator.path ? { ...locator, path } : locator;
}

export function createViewState(initial = {}) {
  let value = { visible: false, tabs: [], active: null, ...initial };
  const listeners = new Set();
  return {
    getSnapshot: () => value,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    update(patch) { value = { ...value, ...patch }; listeners.forEach(fn => fn()); },
    open(locator) {
      relativePath(locator.path);
      if (locator.page !== undefined && (!Number.isSafeInteger(locator.page) || locator.page < 1)) throw new Error('页码无效');
      if (locator.rect) validateRect(locator.rect);
      this.update({ visible: true, active: locator.path, tabs: [...value.tabs.filter(tab => tab.path !== locator.path), { ...locator }] });
    },
    close(path) {
      const tabs = value.tabs.filter(tab => tab.path !== path);
      this.update({ tabs, active: value.active === path ? tabs.at(-1)?.path ?? null : value.active });
    },
  };
}
