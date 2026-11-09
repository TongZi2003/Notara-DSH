import { createHash } from 'node:crypto';
import { basename, extname } from 'node:path';
import { parseMarkdown, patchFields } from './frontmatter.js';
import { markdownFacts, stripTaskAnchor } from './markdown-projection.js';
import { safeRelativePath } from './vault-path.js';

const fail = code => { throw new Error(code); };
const shortHash = value => createHash('sha256').update(value).digest('hex').slice(0, 8);
const TASK_LINE_RE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\]\s+)(.*?)(\r?)$/;

function headingTitle(path, fields, body) {
  if (typeof fields.title === 'string' && fields.title.trim()) return fields.title.trim();
  const h1 = body.match(/^\s*#\s+(.+?)\s*#*\s*$/m)?.[1]?.trim();
  return h1 || basename(path, extname(path));
}

function parseLessonMarkdown(path, content) {
  const normalized = safeRelativePath(path);
  if (!/\.md$/i.test(normalized)) fail('vault_lesson_type_required');
  const parsed = parseMarkdown(content);
  if (String(parsed.fields?.type ?? '').trim() !== 'lesson' || parsed.fields.template === true || normalized.startsWith('模板/')) fail('vault_lesson_type_required');
  const headerLines = parsed.header ? parsed.header[0].split(/\r?\n/).length - 1 : 0;
  const facts = markdownFacts(parsed.body, headerLines);
  const publicTasks = facts.tasks.filter(task => !task.hidden);
  return { path: normalized, parsed, publicTasks, title: headingTitle(normalized, parsed.fields, parsed.body) };
}

export function formatLessonProgressLabel(counts) {
  if (!counts || counts.total <= 0) return '';
  return [
    ...(counts.completed > 0 ? [`已完成 ${counts.completed}`] : []),
    ...(counts.inProgress > 0 ? [`进行中 ${counts.inProgress}`] : []),
    ...(counts.pending > 0 ? [`待处理 ${counts.pending}`] : []),
  ].join(' · ');
}

export function projectLessonPlan(doc) {
  if (!doc || typeof doc.content !== 'string' || typeof doc.path !== 'string') fail('vault_input_invalid');
  const { path, parsed, publicTasks, title } = parseLessonMarkdown(doc.path, doc.content);
  const seen = new Map();
  for (const task of publicTasks) {
    if (task.anchorId) seen.set(task.anchorId, (seen.get(task.anchorId) ?? 0) + 1);
  }
  const duplicateAnchors = new Set([...seen.entries()].filter(([, count]) => count > 1).map(([id]) => id));
  const rawCurrent = typeof parsed.fields.current_task === 'string' && parsed.fields.current_task.trim()
    ? parsed.fields.current_task.trim()
    : null;
  const activeSource = rawCurrent && !duplicateAnchors.has(rawCurrent)
    ? publicTasks.find(task => !task.checked && task.anchorId === rawCurrent) ?? null
    : null;
  const completedCurrent = Boolean(rawCurrent && !duplicateAnchors.has(rawCurrent) && publicTasks.some(task => task.checked && task.anchorId === rawCurrent));
  const staleCurrentTask = Boolean(rawCurrent && !activeSource && !completedCurrent);
  const tasks = publicTasks.map(task => {
    const status = task.checked ? 'completed' : activeSource === task ? 'in_progress' : 'pending';
    return {
      id: task.anchorId && !duplicateAnchors.has(task.anchorId) ? task.anchorId : null,
      ambiguous: Boolean(task.anchorId && duplicateAnchors.has(task.anchorId)),
      line: task.line,
      checked: task.checked,
      status,
      content: task.text,
      expectedText: task.rawText,
    };
  });
  const completed = tasks.filter(task => task.status === 'completed').length;
  const inProgress = tasks.filter(task => task.status === 'in_progress').length;
  const pending = tasks.length - completed - inProgress;
  const counts = { total: tasks.length, completed, inProgress, pending };
  const currentTask = tasks.find(task => task.status === 'in_progress') ?? null;
  const firstPending = tasks.find(task => task.status === 'pending') ?? null;
  const nextTask = currentTask ? null : firstPending ? { id: firstPending.id, line: firstPending.line, content: firstPending.content, expectedText: firstPending.expectedText } : null;
  return {
    path,
    title,
    revision: doc.revision ?? null,
    counts,
    progressLabel: formatLessonProgressLabel(counts),
    currentTask: currentTask ? { id: currentTask.id, line: currentTask.line, content: currentTask.content, expectedText: currentTask.expectedText } : null,
    nextTask,
    staleCurrentTask,
    tasks,
  };
}

function ensurePublicTaskAnchorsInContent(path, content) {
  const { publicTasks, parsed } = parseLessonMarkdown(path, content);
  const lines = content.split('\n');
  const reserved = new Set();
  // A deleted current task must stay stale when a same-title task is recreated.
  if (typeof parsed.fields.current_task === 'string' && parsed.fields.current_task.trim()) {
    reserved.add(parsed.fields.current_task.trim());
  }
  const existingCounts = new Map();
  for (const task of publicTasks) {
    if (task.anchorId) {
      reserved.add(task.anchorId);
      existingCounts.set(task.anchorId, (existingCounts.get(task.anchorId) ?? 0) + 1);
    }
  }
  const countsByText = new Map();
  let changed = false;
  for (const task of publicTasks) {
    const clean = task.text;
    const occurrence = (countsByText.get(clean) ?? 0) + 1;
    countsByText.set(clean, occurrence);
    let anchorId = task.anchorId;
    if (!anchorId || (existingCounts.get(anchorId) ?? 0) > 1) {
      let attempt = 0;
      do {
        anchorId = `lt-${shortHash(`${path}:${clean}:${occurrence}:${attempt}`)}`;
        attempt += 1;
      } while (reserved.has(anchorId));
      const rawLine = lines[task.line - 1];
      const match = rawLine?.match(TASK_LINE_RE);
      if (!match) fail('vault_task_conflict');
      const stripped = stripTaskAnchor(match[4]).content;
      lines[task.line - 1] = `${match[1]}${match[2]}${match[3]}${stripped} <!-- notara-task:${anchorId} -->${match[5]}`;
      changed = true;
    }
    reserved.add(anchorId);
  }
  return { content: changed ? lines.join('\n') : content, changed };
}

function matchExpectedTaskText(task, expectedText) {
  if (expectedText === undefined) return true;
  if (typeof expectedText !== 'string') return false;
  return expectedText === task.rawText || expectedText === task.text || stripTaskAnchor(expectedText).content === task.text;
}

export function anchorLessonTasks(store, { path, expectedRevision } = {}) {
  const normalized = safeRelativePath(path);
  let doc;
  try { doc = store.read({ path: normalized }); }
  catch (error) { if (error.code === 'ENOENT' || error.message === 'vault_not_found') fail('vault_not_found'); throw error; }
  if (expectedRevision !== undefined && doc.revision !== expectedRevision) fail('vault_revision_conflict');
  const anchored = ensurePublicTaskAnchorsInContent(normalized, doc.content);
  if (anchored.changed) {
    const saved = store.save({ path: normalized, content: anchored.content, expectedRevision: doc.revision });
    doc = { ...doc, content: anchored.content, revision: saved.revision };
  }
  return projectLessonPlan(doc);
}

export function setCurrentLessonTask(store, { path, line, taskId, expectedText, expectedRevision } = {}) {
  if (typeof expectedRevision !== 'string') fail('vault_revision_required');
  const normalized = safeRelativePath(path);
  const doc = store.read({ path: normalized });
  if (doc.revision !== expectedRevision) fail('vault_revision_conflict');
  // Validate target against original line numbers before anchoring shifts nothing (single-line append).
  const initial = parseLessonMarkdown(normalized, doc.content);
  if (line !== undefined && (!Number.isInteger(line) || line < 1)) fail('vault_input_invalid');
  if (line === undefined && (typeof taskId !== 'string' || !taskId.trim())) fail('vault_input_invalid');
  const initialTarget = line !== undefined
    ? initial.publicTasks.find(task => task.line === line)
    : initial.publicTasks.filter(task => task.anchorId === taskId.trim());
  if (Array.isArray(initialTarget)) {
    if (initialTarget.length !== 1) fail('vault_task_conflict');
  } else if (!initialTarget) {
    fail('vault_task_conflict');
  }
  const matchedInitial = Array.isArray(initialTarget) ? initialTarget[0] : initialTarget;
  if (taskId !== undefined && matchedInitial.anchorId && matchedInitial.anchorId !== taskId) fail('vault_task_conflict');
  if (!matchExpectedTaskText(matchedInitial, expectedText)) fail('vault_task_conflict');
  if (matchedInitial.checked) fail('vault_task_completed');

  const anchored = ensurePublicTaskAnchorsInContent(normalized, doc.content);
  const anchoredParsed = parseLessonMarkdown(normalized, anchored.content);
  const target = anchoredParsed.publicTasks.find(task => task.line === matchedInitial.line);
  if (!target?.anchorId) fail('vault_task_conflict');
  const nextContent = patchFields(anchored.content, { current_task: target.anchorId });
  const saved = store.save({ path: normalized, content: nextContent, expectedRevision: doc.revision });
  return projectLessonPlan({ path: normalized, content: nextContent, revision: saved.revision });
}

export function clearCurrentLessonTask(store, { path, expectedRevision } = {}) {
  if (typeof expectedRevision !== 'string') fail('vault_revision_required');
  const normalized = safeRelativePath(path);
  const doc = store.read({ path: normalized });
  if (doc.revision !== expectedRevision) fail('vault_revision_conflict');
  parseLessonMarkdown(normalized, doc.content);
  const nextContent = patchFields(doc.content, { current_task: undefined });
  if (nextContent === doc.content) return projectLessonPlan(doc);
  const saved = store.save({ path: normalized, content: nextContent, expectedRevision: doc.revision });
  return projectLessonPlan({ path: normalized, content: nextContent, revision: saved.revision });
}

export function toggleLessonTask(store, { path, line, checked, expectedText, expectedRevision } = {}) {
  if (typeof expectedRevision !== 'string') fail('vault_revision_required');
  if (!Number.isInteger(line) || line < 1 || typeof checked !== 'boolean' || typeof expectedText !== 'string') fail('vault_input_invalid');
  const normalized = safeRelativePath(path);
  const doc = store.read({ path: normalized });
  if (doc.revision !== expectedRevision) fail('vault_revision_conflict');
  const initial = parseLessonMarkdown(normalized, doc.content);
  const initialTarget = initial.publicTasks.find(task => task.line === line);
  if (!initialTarget || !matchExpectedTaskText(initialTarget, expectedText)) fail('vault_task_conflict');
  const anchored = ensurePublicTaskAnchorsInContent(normalized, doc.content);
  const lines = anchored.content.split('\n');
  const rawLine = lines[line - 1];
  const match = rawLine?.match(TASK_LINE_RE);
  if (!match) fail('vault_task_conflict');
  lines[line - 1] = `${match[1]}${checked ? 'x' : ' '}${match[3]}${match[4]}${match[5]}`;
  let nextContent = lines.join('\n');
  const updatedParsed = parseLessonMarkdown(normalized, nextContent);
  const toggled = updatedParsed.publicTasks.find(task => task.line === line);
  if (checked && toggled?.anchorId && updatedParsed.parsed.fields.current_task === toggled.anchorId) {
    nextContent = patchFields(nextContent, { current_task: undefined });
  }
  const saved = store.save({ path: normalized, content: nextContent, expectedRevision: doc.revision });
  return projectLessonPlan({ path: normalized, content: nextContent, revision: saved.revision });
}
