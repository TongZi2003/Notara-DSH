import { parseMarkdown } from './frontmatter.js';
import { parseReference, parseSessionReference, resolveReferencePath } from './file-reference.js';
import { stripTaskAnchor } from './markdown-projection.js';
import { isReferenceHeading } from './preview.js';
import { safeWorkspaceRelativePath } from './vault-path.js';
import MarkdownIt from 'markdown-it';

const EMPTY_PLACEHOLDER_RE = /^(?:无|暂无|无缺口|待定|待填写|[-—]+)$/;
const NO_FOLLOW_UP_RE = /^(?:无|暂无)(?:待补(?:内容|缺口|事项)?|缺口)?[。.!！]?$/;
const routeInline = new MarkdownIt('zero').enable('backticks');

function maskNonPublicLines(content, { stripFrontmatter = true } = {}) {
  const rawText = String(content ?? '');
  const rawLines = rawText.split(/\r?\n/);
  const lines = [...rawLines];
  let frontmatterLines = 0;
  if (stripFrontmatter && rawLines[0]?.replace(/^\uFEFF/, '') === '---') {
    try {
      const parsed = parseMarkdown(rawText);
      if (parsed.header && (Object.keys(parsed.fields).length > 0 || parsed.header[1].trim() === '')) {
        const headerText = parsed.header[0];
        const parts = headerText.split(/\r?\n/);
        frontmatterLines = /\r?\n$/.test(headerText) ? parts.length - 1 : parts.length;
      }
    } catch {
      frontmatterLines = 0;
    }
  }
  let fence = null;
  let detailsDepth = 0;
  let pendingDetailsTag = '';
  let inComment = false;
  let referenceSection = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (i < frontmatterLines) {
      lines[i] = '';
      continue;
    }
    if (inComment) {
      const end = line.indexOf('-->');
      if (end < 0) { lines[i] = ''; continue; }
      line = line.slice(end + 3);
      inComment = false;
    }
    while (line.includes('<!--')) {
      const start = line.indexOf('<!--');
      const end = line.indexOf('-->', start + 4);
      if (end >= 0) {
        line = line.slice(0, start) + line.slice(end + 3);
      } else {
        line = line.slice(0, start);
        inComment = true;
        break;
      }
    }
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (marker) {
      if (!fence) fence = { char: marker[1][0], len: marker[1].length };
      else if (marker[1][0] === fence.char && marker[1].length >= fence.len && /^\s*(?:`+|~+)\s*$/.test(line)) fence = null;
      lines[i] = '';
      continue;
    }
    if (fence) {
      lines[i] = '';
      continue;
    }
    const detailsLine = pendingDetailsTag ? `${pendingDetailsTag}\n${line}` : line;
    const hadDetails = detailsDepth > 0 || Boolean(pendingDetailsTag) || /<\s*\/?\s*details\b/i.test(line);
    pendingDetailsTag = /<\s*\/?\s*details\b[^>]*$/i.exec(detailsLine)?.[0] ?? '';
    for (const match of detailsLine.matchAll(/<\s*(\/?)\s*details\b[^>]*>/gi)) {
      detailsDepth = Math.max(0, detailsDepth + (match[1] ? -1 : 1));
    }
    if (hadDetails || detailsDepth > 0 || pendingDetailsTag) {
      lines[i] = '';
      continue;
    }
    const heading = /^#{1,2}\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      referenceSection = /^##\s/.test(line) && isReferenceHeading(heading[1]);
    }
    lines[i] = referenceSection ? '' : line;
  }
  return lines;
}

function joinRelativeSegments(basePath, rawTarget) {
  const baseParts = String(basePath || '').includes('/') ? String(basePath).split('/').slice(0, -1).filter(Boolean) : [];
  for (const part of String(rawTarget).split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!baseParts.length) return null;
      baseParts.pop();
    } else {
      baseParts.push(part);
    }
  }
  return baseParts.length ? baseParts.join('/') : null;
}

function resolveDocRelative(basePath, rawTarget, relative = false, paths) {
  if (!rawTarget || rawTarget.startsWith('/') || rawTarget.includes('\\')) return null;
  const normalized = relative || rawTarget.startsWith('./') || rawTarget.startsWith('../')
    ? joinRelativeSegments(basePath, rawTarget)
    : rawTarget;
  if (!normalized) return null;
  try {
    return (paths && resolveReferencePath(normalized,paths)) || safeWorkspaceRelativePath(/\.[a-z0-9]+$/i.test(normalized) ? normalized : `${normalized}.md`);
  } catch {
    return null;
  }
}

export function extractLineLinks(line, basePath = '', paths) {
  const text = String(line ?? '');
  const references = [];
  const sessions = [];
  const seenRefs = new Set();
  const seenSessions = new Set();

  for (const match of text.matchAll(/!?\[\[[^\]\r\n]+\]\]/g)) {
    const token = match[0];
    const session = parseSessionReference(token);
    if (session) {
      if (!seenSessions.has(session.sessionId)) {
        seenSessions.add(session.sessionId);
        sessions.push(session);
      }
      continue;
    }
    const ref = parseReference(token,{paths});
    if (ref) {
      const key = `${ref.path}${ref.subpath || ''}${ref.page || ''}`;
      if (!seenRefs.has(key)) {
        seenRefs.add(key);
        references.push(ref);
      }
    }
  }

  for (const match of text.matchAll(/(?<!!)\[([^\]\r\n]+)\]\(\s*<?([^)\s>\r\n]+)>?\s*\)/g)) {
    const [token, rawLabel, rawHref] = match;
    const session = parseSessionReference(token);
    if (session) {
      if (!seenSessions.has(session.sessionId)) {
        seenSessions.add(session.sessionId);
        sessions.push(session);
      }
      continue;
    }
    if (/^[a-z][a-z\d+.-]*:/i.test(rawHref) || rawHref.startsWith('#') || rawHref.startsWith('__notara_session__/')) continue;
    const hashIdx = rawHref.indexOf('#');
    let decodedPath;
    let subpath = '';
    try {
      decodedPath = decodeURIComponent(hashIdx >= 0 ? rawHref.slice(0, hashIdx) : rawHref);
      if (hashIdx >= 0) subpath = decodeURIComponent(rawHref.slice(hashIdx));
    } catch {
      continue;
    }
    const resolved = resolveDocRelative(basePath, decodedPath, true,paths);
    if (!resolved) continue;
    const key = `${resolved}${subpath}`;
    if (!seenRefs.has(key)) {
      seenRefs.add(key);
      references.push({
        path: resolved,
        ...(subpath ? { subpath } : {}),
        label: rawLabel.trim() || resolved.split('/').at(-1).replace(/\.md$/i, ''),
      });
    }
  }

  return { references, sessions };
}

/** Existing public route links and lessons are associations, not mtime guesses. */
export function routeContextReferences(body, {path, fields = {}, documentsByPath} = {}) {
  const lessons = new Set((Array.isArray(fields.lessons) ? fields.lessons : typeof fields.lessons === 'string' ? [fields.lessons] : [])
    .map(value => resolveDocRelative(path, String(value),false,documentsByPath)).filter(value => documentsByPath?.get(value)?.type === 'lesson'));
  const sessions = new Set();
  // Parse code spans before extracting links; examples are not associations.
  // The zero preset leaves real Markdown/wiki link syntax intact.
  const visible = maskNonPublicLines(body, {stripFrontmatter:false}).join('\n');
  const text = routeInline.parseInline(visible, {}).flatMap(token => token.children ?? [])
    .map(token => token.type === 'code_inline' ? ' ' : token.content).join('');
  for (const line of text.split('\n')) {
    const refs = extractLineLinks(line, path,documentsByPath);
    for (const ref of refs.references) if (documentsByPath?.get(ref.path)?.type === 'lesson') lessons.add(ref.path);
    for (const ref of refs.sessions) sessions.add(ref.sessionId);
  }
  return {lessons, sessions};
}

function cleanFieldText(text) {
  return String(text ?? '')
    .replace(/!?\[\[session:[^\]|\r\n]+(?:\|([^\]\r\n]+))?\]\]/gi, (_, label) => label || '')
    .replace(/!?\[\[([^\]|#\r\n]+)(?:#[^\]|\r\n]*)?(?:\|([^\]\r\n]+))?\]\]/g, (_, target, label) => label || target.split('/').at(-1).replace(/\.md$/i, ''))
    .replace(/\[([^\]\r\n]+)\]\([^)\r\n]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function projectRouteDocument(content, {
  path = '',
  title = '',
  revision = null,
  frontmatter = null,
  lineOffset = null,
  indexedTasks = null,
  existingPaths = null,
  documentsByPath = null,
  validSessionIds = null,
  bindings = [],
} = {}) {
  const parsed = frontmatter ? { fields: frontmatter, body: String(content ?? '') } : parseMarkdown(String(content ?? ''));
  const { fields } = parsed;
  const resolvedTitle = typeof fields.title === 'string' && fields.title.trim() ? fields.title.trim() : title;
  const status = typeof fields.status === 'string' && fields.status.trim() ? fields.status.trim() : 'active';
  const declaredLessons = new Set(
    (Array.isArray(fields.lessons) ? fields.lessons : typeof fields.lessons === 'string' ? [fields.lessons] : [])
      .map(item => resolveDocRelative(path, String(item || '').trim(),false,documentsByPath??existingPaths))
      .filter(item => item && (!existingPaths || existingPaths.has(item))),
  );
  const validBindings = Array.isArray(bindings) ? bindings.filter(b => b && !b.missing && typeof b.sessionId === 'string' && typeof b.path === 'string') : [];
  const bindingsByLesson = new Map();
  for (const binding of validBindings) {
    if (!bindingsByLesson.has(binding.path)) bindingsByLesson.set(binding.path, []);
    bindingsByLesson.get(binding.path).push(binding);
  }

  const lines = maskNonPublicLines(frontmatter ? parsed.body : content, { stripFrontmatter: !frontmatter });
  let offset = 0;
  if (frontmatter) {
    if (Number.isInteger(lineOffset) && lineOffset >= 0) {
      offset = lineOffset;
    } else if (Array.isArray(indexedTasks) && indexedTasks.length > 0 && Number.isInteger(indexedTasks[0]?.line)) {
      const firstLocalTaskIdx = lines.findIndex(line => /^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]\s+/.test(line));
      if (firstLocalTaskIdx >= 0) {
        offset = Math.max(0, indexedTasks[0].line - (firstLocalTaskIdx + 1));
      }
    }
  }
  let section = '';
  const rawMilestones = [];
  const nextSectionLines = [];
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const lineNo = i + 1 + offset;
    if (!raw.trim()) continue;
    const h2 = /^##\s+(.+?)\s*#*\s*$/.exec(raw);
    if (h2) {
      section = h2[1].trim();
      current = null;
      continue;
    }
    if (/^#\s+/.test(raw)) {
      current = null;
      continue;
    }
    if (section === '下一步行动') {
      nextSectionLines.push({ line: lineNo, text: raw });
      continue;
    }
    const topTask = /^([-*+]|\d+[.)])\s+\[([ xX])\]\s+(.+)$/.exec(raw);
    if (topTask) {
      const stripped = stripTaskAnchor(topTask[3]);
      current = {
        line: lineNo,
        checked: topTask[2] !== ' ',
        rawTitle: stripped.content.trim(),
        anchorId: stripped.anchorId,
        sublines: [],
      };
      rawMilestones.push(current);
      continue;
    }
    if (current && (/^\s{2,}/.test(raw) || /^\t/.test(raw))) {
      current.sublines.push({ line: lineNo, text: raw.trim() });
    } else if (/^[-*+]\s+/.test(raw)) {
      current = null;
    }
  }

  const keepRef = ref => !existingPaths || existingPaths.has(ref.path);
  const enrichRef = ref => {
    const meta = documentsByPath?.get?.(ref.path);
    if (!meta) return ref;
    return {
      ...ref,
      ...(typeof meta.title === 'string' && meta.title ? { title: meta.title } : {}),
      ...(typeof meta.revision === 'string' && meta.revision ? { revision: meta.revision } : {}),
    };
  };
  const keepSession = session => !validSessionIds || validSessionIds.has(session.sessionId);

  const milestones = rawMilestones.map(item => {
    let criteria = '';
    let remediation = '';
    const lessonRefs = [];
    const summaries = [];
    const materialRefs = [];
    const sessions = [];
    const seenRefPaths = new Set();
    const seenSummaryKeys = new Set();
    const seenSessions = new Set();

    const collectFromLine = (lineText, hint = '') => {
      const extracted = extractLineLinks(lineText, path,documentsByPath??existingPaths);
      for (const s of extracted.sessions) {
        if (!keepSession(s) || seenSessions.has(s.sessionId)) continue;
        seenSessions.add(s.sessionId);
        sessions.push({ sessionId: s.sessionId, label: s.label });
      }
      for (const rawRef of extracted.references) {
        if (!keepRef(rawRef)) continue;
        const ref = enrichRef(rawRef);
        const docMeta = documentsByPath?.get?.(rawRef.path);
        const isSummaryHint = /证据|总结|散打|复盘/.test(hint) || ref.path.startsWith('日记/') || Boolean(ref.subpath && (/^#L\d+/i.test(ref.subpath) || /总结|续接/.test(ref.subpath)));
        const isLesson = docMeta?.type === 'lesson' || declaredLessons.has(ref.path) || ref.path.startsWith('备课/') || bindingsByLesson.has(ref.path);
        if (isSummaryHint) {
          const sKey = `${ref.path}${ref.subpath || ''}`;
          if (!seenSummaryKeys.has(sKey)) {
            seenSummaryKeys.add(sKey);
            summaries.push(ref);
          }
        }
        if (isLesson) {
          if (!seenRefPaths.has(`lesson:${ref.path}`)) {
            seenRefPaths.add(`lesson:${ref.path}`);
            lessonRefs.push(ref);
          }
        } else if (!ref.path.startsWith('日记/')) {
          if (!seenRefPaths.has(`mat:${ref.path}`)) {
            seenRefPaths.add(`mat:${ref.path}`);
            materialRefs.push(ref);
          }
        }
      }
    };

    collectFromLine(item.rawTitle, '');
    for (const sub of item.sublines) {
      const cleaned = sub.text.replace(/^(?:[-*+]|\d+[.)])\s+/, '');
      const critMatch = /^(?:阶段依据|校验依据|达标标准|判断依据)(?:（[^）]*）|\([^)]*\))?\s*[:：]\s*(.*)$/.exec(cleaned);
      if (critMatch) {
        const val = cleanFieldText(critMatch[1]);
        if (val && !EMPTY_PLACEHOLDER_RE.test(val)) criteria = criteria ? `${criteria}；${val}` : val;
      }
      const remMatch = /^(?:待补内容|待补缺口|需补内容|前置缺口|未达标原因|待补)(?:（[^）]*）|\([^)]*\))?\s*[:：]\s*(.*)$/.exec(cleaned);
      if (remMatch) {
        const val = cleanFieldText(remMatch[1]);
        if (val && !EMPTY_PLACEHOLDER_RE.test(val)) remediation = remediation ? `${remediation}；${val}` : val;
      }
      collectFromLine(cleaned, cleaned.split(/[:：]/)[0] || '');
    }

    for (const lessonRef of lessonRefs) {
      for (const bound of bindingsByLesson.get(lessonRef.path) ?? []) {
        if (!keepSession({ sessionId: bound.sessionId }) || seenSessions.has(bound.sessionId)) continue;
        seenSessions.add(bound.sessionId);
        sessions.push({
          sessionId: bound.sessionId,
          label: bound.title || lessonRef.label || '打开关联课堂',
          progressLabel: bound.progressLabel,
          currentTask: bound.currentTask ?? null,
          nextTask: bound.nextTask ?? null,
        });
      }
    }

    const needsRemediation = Boolean(remediation);
    return {
      line: item.line,
      checked: item.checked,
      text: cleanFieldText(item.rawTitle) || item.rawTitle,
      rawText: item.rawTitle,
      ...(item.anchorId ? { anchorId: item.anchorId } : {}),
      criteria: criteria || null,
      remediation: remediation || null,
      needsRemediation,
      lessonRefs,
      materialRefs,
      summaries,
      sessions,
    };
  });

  let nextAction = null;
  for (const row of nextSectionLines) {
    if (/^\s*(?:[-*+]|\d+[.)])\s+\[[xX]\]\s+/.test(row.text)) continue;
    const body = row.text
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '')
      .replace(/^当前下一步\s*[:：]\s*/, '')
      .trim();
    if (!body) continue;
    const rawLinks = extractLineLinks(body, path,documentsByPath??existingPaths);
    const validRefs = rawLinks.references.filter(keepRef).map(enrichRef);
    const validSessions = rawLinks.sessions.filter(keepSession);
    // If the action explicitly pointed only to missing files/sessions, skip it rather than recommending broken targets.
    if ((rawLinks.references.length > 0 || rawLinks.sessions.length > 0) && validRefs.length === 0 && validSessions.length === 0) {
      continue;
    }
    for (const ref of validRefs) {
      for (const bound of bindingsByLesson.get(ref.path) ?? []) {
        if (keepSession({ sessionId: bound.sessionId }) && !validSessions.some(s => s.sessionId === bound.sessionId)) {
          validSessions.push({ sessionId: bound.sessionId, label: bound.title || ref.label || '打开关联课堂' });
        }
      }
    }
    const clean = cleanFieldText(body);
    if (!clean || EMPTY_PLACEHOLDER_RE.test(clean)) continue;
    nextAction = {
      line: row.line,
      text: clean,
      rawText: body,
      references: validRefs,
      sessions: validSessions,
    };
    break;
  }

  const completed = milestones.filter(m => m.checked && !m.needsRemediation).length;
  const checkedCount = milestones.filter(m => m.checked).length;
  const needsRemediation = milestones.some(m => m.needsRemediation);
  const nextMilestone = milestones.find(m => !m.checked || m.needsRemediation) ?? null;

  return {
    path,
    title: resolvedTitle,
    revision,
    status,
    completed,
    checkedCount,
    total: milestones.length,
    needsRemediation,
    milestones,
    nextMilestone,
    nextAction,
  };
}

/** Current student evidence and an optional next question, never a mastery score.
 * An explicitly cleared/completed next section opts out; retained history stays intact. */
export function projectCardRevisit(content, { bodyOnly = false } = {}) {
  const lines = maskNonPublicLines(content, { stripFrontmatter: !bodyOnly });
  let student = false, next = false, hasNext = false, evidence = false;
  const questions = [];
  let current = null;
  for (const raw of lines) {
    const text = raw.trim(), heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(text);
    if (heading) {
      if (heading[1].length <= 2) {
        student = heading[1] === '##' && heading[2] === '学生理解';
        if (student) { evidence = false; hasNext = false; questions.length = 0; }
        next = false; current = null;
      } else if (student && heading[1].length === 3) {
        next = heading[2] === '下次探讨'; current = null;
        if (next) { hasNext = true; questions.length = 0; }
      }
      continue;
    }
    if (!student || !text || /^>/.test(text)) continue;
    const item = text.replace(/^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '').trim();
    if (!next) {
      if (item && !EMPTY_PLACEHOLDER_RE.test(item) && !/^暂无(?:学生)?(?:理解|记录|表达)[。！!]?$/u.test(item)) evidence = true;
      continue;
    }
    if (/^(?:[-*+]|\d+[.)])\s+\[[xX]\]\s+/.test(text)) { current = null; continue; }
    if (NO_FOLLOW_UP_RE.test(item) || /^(?:已解决|已完成|已撤回|不再回访)[。！!]?$/u.test(item)) { questions.length = 0; current = null; continue; }
    if (EMPTY_PLACEHOLDER_RE.test(item)) continue;
    if (/^(?:[-*+]|\d+[.)])\s+/.test(text) || !current) { current = { text: item }; questions.push(current); }
    else current.text += `\n${raw}`;
  }
  if (!evidence || (hasNext && !questions.length)) return null;
  return { kind: 'card-next', snippet: questions[0]?.text ?? null, heading: questions.length ? '下次探讨' : '学生理解' };
}

export function extractFollowUpSnippet(content, docType, { bodyOnly = false } = {}) {
  const lines = maskNonPublicLines(content, { stripFrontmatter: !bodyOnly });
  let h2 = '';
  let h3 = '';
  let referenceLevel = 0;
  let nextSnippet;
  let fallbackGap;
  let followUp = null;

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(trimmed);
    if (heading) {
      const level = heading[1].length;
      if (referenceLevel && level > referenceLevel) continue;
      referenceLevel = isReferenceHeading(heading[2]) ? level : 0;
      if (referenceLevel) continue;
      if (level <= 2) {
        h2 = level === 2 ? heading[2].trim() : '';
        h3 = '';
      } else if (level === 3) {
        h3 = heading[2].trim();
      }
      // Appended summaries get their own next-start/gap preference. Empty
      // templates and unrelated prose do not replace the latest public result.
      if (level <= 3) {
        nextSnippet = undefined;
        fallbackGap = undefined;
      }
      continue;
    }
    if (referenceLevel) continue;
    if (/^(?:[-*+]|\d+[.)])\s+\[[xX]\]\s+/.test(trimmed)) continue;
    const item = trimmed.replace(/^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '').trim();
    if (!item) continue;

    if (docType === 'lesson') {
      if (!/总结|续接/.test(h2)) continue;
      const nextMatch = /^(?:下次起点建议|下次续接|下一步建议|下次安排)\s*[:：]\s*(.+)$/.exec(item);
      const gapMatch = /^(?:尚未检查(?:\s*[\/／与和及、]\s*暴露缺口)?|暴露缺口|待补(?:内容|缺口)?)\s*[:：]\s*(.+)$/.exec(item);
      const match = nextMatch || gapMatch;
      if (!match) continue;
      const clean = cleanFieldText(match[1]);
      const cleared = NO_FOLLOW_UP_RE.test(clean);
      if (!clean || (!cleared && EMPTY_PLACEHOLDER_RE.test(clean))) continue;
      if (nextMatch) nextSnippet = cleared ? null : clean;
      else fallbackGap = cleared ? null : clean;
      const snippet = nextSnippet !== undefined ? nextSnippet : fallbackGap;
      followUp = snippet ? { kind: 'lesson-summary', snippet } : null;
    } else if (docType === 'diary') {
      const nextMatch = /^下次(?:起点建议|起点|续接|探讨|安排)\s*[:：]\s*(.+)$/.exec(item);
      const gapMatch = /^(?:待补(?:内容|缺口)|尚未检查)\s*[:：]\s*(.+)$/.exec(item);
      const match = nextMatch || gapMatch;
      if (!match) continue;
      const clean = cleanFieldText(match[1]);
      const cleared = NO_FOLLOW_UP_RE.test(clean);
      if (!clean || (!cleared && EMPTY_PLACEHOLDER_RE.test(clean))) continue;
      if (nextMatch) nextSnippet = cleared ? null : clean;
      else fallbackGap = cleared ? null : clean;
      const snippet = nextSnippet !== undefined ? nextSnippet : fallbackGap;
      followUp = snippet ? { kind: 'diary', snippet } : null;
    } else if (docType === 'card') {
      if (h2 === '学生理解' && h3 === '下次探讨') {
        const clean = cleanFieldText(item);
        if (clean && !EMPTY_PLACEHOLDER_RE.test(clean)) return { kind: 'card-next', snippet: clean };
      }
    }
  }
  return followUp;
}

/** The profile owns the current list; this is a read-only public projection. */
export function projectHomeRecommendations(content, {
  path, title, revision, documentsByPath = new Map(), validSessionIds = new Set(), lineOffset = 0,
} = {}) {
  const lines = maskNonPublicLines(content, { stripFrontmatter: false });
  let found = false, inSection = false, current = null;
  let tasks = [];
  for (const [index, raw] of lines.entries()) {
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(raw);
    if (heading) {
      current = null;
      if (heading[1].length <= 2) {
        inSection = heading[1] === '##' && heading[2].trim() === '首页推荐';
        if (inSection) { found = true; tasks = []; }
      }
      continue;
    }
    if (!inSection) continue;
    const task = /^[-*+]\s+\[([ xX])\]\s+(.+)$/.exec(raw);
    if (task) {
      current = task[1] === ' ' ? { line: index + 1 + lineOffset, raw: stripTaskAnchor(task[2]).content.trim(), reason: '' } : null;
      if (current) tasks.push(current);
      continue;
    }
    const reason = /^\s{2,3}(?:[-*+]\s+)?理由\s*[:：]\s*(.+)$/.exec(raw);
    if (current && reason) current.reason = reason[1].trim();
  }
  if (!found) return null;
  const items = [];
  for (const task of tasks) {
    const links = extractLineLinks(task.raw, path,documentsByPath);
    const references = links.references.flatMap(ref => {
      const doc = documentsByPath.get(ref.path);
      return doc && !['archived', 'completed'].includes(doc.status)
        ? [{ ...ref, title: doc.title, revision: doc.revision }] : [];
    });
    const sessions = links.sessions.filter(ref => validSessionIds?.has(ref.sessionId));
    // A removed/finished target cannot silently turn into a new, unbound action.
    const hasTarget = links.references.length || links.sessions.length || /\[\[|\]\(/.test(task.raw);
    if (hasTarget && !references.length && !sessions.length) continue;
    const text = cleanFieldText(task.raw), reason = cleanFieldText(task.reason);
    if (!text || EMPTY_PLACEHOLDER_RE.test(text)) continue;
    items.push({ line: task.line, text, reason, references, sessions });
    if (items.length === 3) break;
  }
  return { path, title, revision, items };
}
