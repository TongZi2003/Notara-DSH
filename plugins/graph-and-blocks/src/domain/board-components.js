// Adapted from Notara Desktop packages/vault-core/src/board-components.js (2026-10-24); see DEVELOPMENT.md.
/**
 * Board components: the typed code blocks a lesson-board block may carry — the
 * one contract the Host (validation on write, answer checks, the message sent
 * to the teacher) and the page (rendering, drafts) both read. A component is
 * `\`\`\`<type>` … `\`\`\`` inside a block's Markdown body, written line by line;
 * its identity is (block, index among the block's components) plus a
 * fingerprint of what the student is asked, so an answer never silently moves
 * onto a changed question. There is no answer-key field anywhere: whether an
 * answer is right is the teacher's judgement after it arrives.
 */

import { FIGURE_SYNTAX, answerFigure, figureAnswerText, figureIdentity, parseFigure } from './board-figure.js';
import { FLOW_SYNTAX, answerFlow, flowAnswerText, flowBlanks, flowIdentity, parseFlow } from './board-flow.js';
import { FRAMES_SYNTAX, answerFrames, framesAnswerText, framesIdentity, parseFrames, predictedFrames } from './board-frames.js';
import { HTML_SYNTAX, htmlIdentity, parseHtmlComponent } from './board-html.js';
import { parseReference } from '@oh-my-student/plugin-vault-sqlite/file-reference';
import {validateFollowUp} from '@oh-my-student/plugin-vault-sqlite/review-schedule';

const fail = message => { throw new BoardComponentError(message); };
/** Parser errors of every component type carry a line; figure and flow have their own classes. */
const PARSE_ERRORS = new Set(['BoardComponentError', 'FigureError', 'FlowError', 'FramesError', 'HtmlComponentError']);

export class BoardComponentError extends Error {
  constructor(message, line) { super(message); this.name = 'BoardComponentError'; this.line = line; }
}

/** A short, stable, non-cryptographic fingerprint (cyrb53) shared by both sides. */
export function fingerprint(text) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761); h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

const MAX_TEXT = 2000;
const clean = value => String(value ?? '').replace(/\r/g, '');
const text = (value, max, message) => {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail(message);
  return value.trim();
};
const item = line => line.match(/^\s*[-*]\s+(.*)$/)?.[1]?.trim();

/** Numbered, trimmed, non-empty lines of a component's source. */
function numbered(source) {
  return clean(source).split('\n').map((raw, index) => ({ raw, value: raw.trim(), line: index + 1 })).filter(row => row.value);
}
function lineError(row, message) { throw new BoardComponentError(message, row?.line); }

/** `order`: 题干 lines, `- 条目` lines, optional `groups 甲 | 乙 | 丙` for sorting into groups. */
function parseOrder(source) {
  source = clean(source).replace(/^\s*prompt:\s*/m, '').replace(/^\s*groups:\s*/gm, 'groups ');
  const rows = numbered(source), stem = [], items = [];
  let groups = null;
  for (const row of rows) {
    const entry = item(row.raw);
    if (entry !== undefined) {
      if (!entry) lineError(row, '条目不能是空的。');
      if (entry.length > 200) lineError(row, '一个条目最多 200 字。');
      if (items.includes(entry)) lineError(row, `条目“${entry}”重复了。`);
      items.push(entry);
      continue;
    }
    const grouped = row.value.match(/^groups\s+(.+)$/);
    if (grouped) {
      if (groups) lineError(row, 'groups 只能写一行。');
      groups = grouped[1].split('|').map(name => name.trim());
      if (groups.length < 2 || groups.length > 4 || groups.some(name => !name || name.length > 20)) lineError(row, 'groups 写 2 到 4 个组名，用 | 分开，每个最多 20 字。');
      if (new Set(groups).size !== groups.length) lineError(row, '组名重复了。');
      continue;
    }
    if (items.length) lineError(row, `不认识的一行：“${row.value}”。条目以“- ”开头；归类另写一行 groups 甲 | 乙。`);
    stem.push(row.value);
  }
  if (!stem.length) fail('缺少题干：第一行写要学生做什么，例如“把证明步骤排好”。');
  if (items.length < 2) fail('至少要有两个条目，每个以“- ”开头。');
  if (items.length > 12) fail('条目最多 12 个。');
  return { stem: stem.join('\n'), items, groups };
}

const special = (value, noteRequired) => {
  if (value.unsure === true) return { unsure: true, ...(value.note ? { note: text(value.note, MAX_TEXT, 'board_answer_invalid') } : {}) };
  if (typeof value.other === 'string') {
    const other = text(value.other, MAX_TEXT, 'board_answer_invalid');
    if (!other && noteRequired) fail('board_answer_invalid');
    return { other };
  }
  return undefined;
};
const onlyKeys = (value, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) fail('board_answer_invalid');
};
const permutation = (list, size) => Array.isArray(list) && list.length === size && list.every(n => Number.isInteger(n) && n >= 0 && n < size) && new Set(list).size === size;

function answerOrder(spec, value) {
  onlyKeys(value, ['order', 'groups', 'unsure', 'note', 'other']);
  const exit = special(value, true);
  if (exit) return exit;
  if (spec.groups) {
    const groups = value.groups;
    if (!Array.isArray(groups) || groups.length !== spec.groups.length || !groups.every(Array.isArray)) fail('board_answer_invalid');
    const all = groups.flat();
    if (!permutation(all, spec.items.length)) fail('board_answer_invalid');
    return { groups: groups.map(group => [...group]) };
  }
  if (!permutation(value.order, spec.items.length)) fail('board_answer_invalid');
  return { order: [...value.order] };
}

const exitText = (answer, otherLead) => answer.unsure ? (answer.note ? `我不确定：${answer.note}` : '我不确定。') : `${otherLead}${answer.other}`;

const exitOf = value => value && typeof value === 'object' && !Array.isArray(value) && (value.unsure === true || typeof value.other === 'string') ? special(value, true) : undefined;

export const BOARD_COMPONENTS = Object.freeze({
  'notara-review': {
    title: '学习记录待确认', answerable: false,
    parse: source => {
      let value;
      try { value = JSON.parse(source); } catch { fail('学习记录需要完整的 JSON。'); }
      if (!value || typeof value !== 'object' || Array.isArray(value)) fail('学习记录格式不完整。');
      const ref = typeof value.targetPath === 'string' && parseReference(`[[${value.targetPath}]]`);
      if (!ref || ref.path !== value.targetPath || ref.subpath || ref.page || !/\.md$/i.test(ref.path)) fail('学习记录需要关联真实卡片或日记。');
      if (!['done', 'missed', 'unchecked'].includes(value.result) || !['independent', 'hint', 'explanation', 'unknown'].includes(value.support)) fail('学习结果或帮助条件无效。');
      if (typeof value.keyStep !== 'string' || value.keyStep.length > 200 || (value.result !== 'unchecked' && !value.keyStep.trim()) || typeof value.note !== 'string' || !value.note.trim()) fail('学习记录缺少关键步骤或实况说明。');
      if(value.heading!==undefined&&(typeof value.heading!=='string'||!value.heading.trim()||value.heading.includes('\n')))fail('日记标题无效。');
      let followUp;if(Object.hasOwn(value,'followUp'))try{followUp=validateFollowUp(value.followUp);}catch{fail('续接安排需要具体问题、非负整数 afterDays 和依据 reason；null 表示清除安排。');}
      return {...Object.fromEntries(['targetPath', 'keyStep', 'result', 'support', 'note'].map(key => [key, value[key]])),...value.heading?{heading:value.heading}:{},...Object.hasOwn(value,'followUp')?{followUp}:{}};
    },
    identity: spec => JSON.stringify(spec),
    syntax: 'notara-review 使用完整 JSON：targetPath、keyStep、result、support、note；日记加实际 heading。可选 followUp:{question,afterDays,reason}，null清除安排，省略保留原安排；结果与帮助由学生确认，不自动梯度排期。',
  },
  figure: {
    title: '图', answerable: spec => Boolean(spec.ask), parse: parseFigure,
    answer: (spec, value) => { const allowed = spec.ask?.kind === 'param' ? ['value'] : ['point']; onlyKeys(value, [...allowed, 'unsure', 'note', 'other']); return answerFigure(spec, value, exitOf); },
    label: spec => spec.ask?.prompt ?? '图',
    identity: figureIdentity,
    text: (spec, answer) => figureAnswerText(spec, answer) ?? exitText(answer, '我有别的想法：'),
    syntax: FIGURE_SYNTAX,
  },
  frames: {
    title: '逐帧演示', answerable: spec => predictedFrames(spec).length > 0, parse: parseFrames,
    answer: (spec, value) => answerFrames(spec, value),
    label: spec => spec.title ?? '逐帧演示',
    identity: framesIdentity,
    text: framesAnswerText,
    syntax: FRAMES_SYNTAX,
  },
  flow: {
    title: '关系图', answerable: spec => flowBlanks(spec).length > 0, parse: parseFlow,
    answer: (spec, value) => { onlyKeys(value, ['fills', 'unsure', 'note', 'other']); return answerFlow(spec, value, exitOf); },
    label: () => '关系图',
    identity: flowIdentity,
    text: (spec, answer) => flowAnswerText(spec, answer) ?? exitText(answer, '我有别的想法：'),
    syntax: FLOW_SYNTAX,
  },
  order: {
    title: '排序与归类', answerable: true, parse: parseOrder, answer: answerOrder,
    label: spec => spec.stem.split('\n')[0],
    identity: spec => ['order', spec.stem, ...spec.items, ...(spec.groups ?? [])].join('\u0000'),
    text: (spec, answer) => answer.order
      ? `我的顺序：${answer.order.map((n, i) => `${i + 1}. ${spec.items[n]}`).join(' ')}`
      : answer.groups ? `我的归类：${answer.groups.map((group, g) => `${spec.groups[g]}：${group.map(n => spec.items[n]).join('、') || '（空）'}`).join('；')}`
        : exitText(answer, '我有别的想法：'),
    syntax: '```order\n把证明步骤排好\n- 两式相减\n- 设 A、B 的坐标\n- 用中点坐标化简\n- 代入椭圆方程\n```\n第一行起是题干；每个条目一行（2 到 12 个），写之前先打乱顺序，界面按你写下的顺序显示；归类另写一行 groups 已知 | 所求（2 到 4 组）。',
  },
  html: {
    title: '图解', answerable: false, parse: parseHtmlComponent,
    identity: htmlIdentity,
    syntax: HTML_SYNTAX,
  },
});
export const BOARD_COMPONENT_TYPES = Object.freeze(Object.keys(BOARD_COMPONENTS));
export const BOARD_ANSWER_LIMIT = 10;
// Read-only historical fences still occupy their original component index.
const RETIRED_COMPONENTS = new Set(['choice', 'blank']);

// One fence grammar is used for detection and rendering. CommonMark permits
// 0–3 leading spaces, either marker, and marker lengths >=3. Recognizable
// interactive fences with unsupported indentation/info still fail closed.
function openingFence(line) {
  const match = line.match(/^([ \t]*)(`{3,}|~{3,})[ \t]*(.*)$/);
  if (!match) return null;
  const type = match[3].match(/^([A-Za-z][A-Za-z-]*)(?:\s|$)/)?.[1]?.toLowerCase();
  return { indent: match[1], marker: match[2], type, valid: /^ {0,3}$/.test(match[1]) && match[3].trim().toLowerCase() === type };
}
function closingFence(line, opening) {
  const match = line.match(/^[ \t]*(`{3,}|~{3,})[ \t]*$/);
  return Boolean(match && match[1][0] === opening.marker[0] && match[1].length >= opening.marker.length);
}

/** Same fence grammar as component admission, even inside raw HTML where a
 * CommonMark AST deliberately treats fenced content as an opaque HTML block. */
export function fencedMarkdownRanges(body) {
  const text = String(body), ranges = [];
  let opening = null, start = 0, offset = 0;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (opening) {
      if (closingFence(line, opening)) { ranges.push([start, offset + raw.length]); opening = null; }
    } else {
      opening = openingFence(line);
      if (opening) start = offset;
    }
    offset += raw.length + 1;
  }
  if (opening) ranges.push([start, text.length]);
  return ranges;
}

/**
 * Split a body into Markdown text and component segments, in order. Fences of
 * other languages stay Markdown. `open` is set when the body ends inside an
 * unclosed component fence (a streaming preview): that tail is not rendered.
 */
export function splitBoardBody(body) {
  const lines = clean(body).split('\n'), segments = [];
  let buffer = [], index = 0, open = null;
  const flush = () => { if (buffer.length) segments.push({ kind: 'markdown', text: buffer.join('\n') }); buffer = []; };
  for (let row = 0; row < lines.length; row++) {
    const line = lines[row], opened = openingFence(line);
    if (opened && RETIRED_COMPONENTS.has(opened.type)) {
      const start = row;
      for (row++; row < lines.length && !closingFence(lines[row], opened); row++);
      flush();
      segments.push({ kind: 'retired', type: opened.type, index: index++, text: lines.slice(start, Math.min(row + 1, lines.length)).join('\n') });
      continue;
    }
    if (opened && Object.hasOwn(BOARD_COMPONENTS, opened.type)) {
      const start = row, inner = [];
      let closed = false;
      for (row = row + 1; row < lines.length; row++) { if (closingFence(lines[row], opened)) { closed = true; break; } inner.push(lines[row].replace(new RegExp(`^ {0,${opened.indent.length}}`), '')); }
      if (!closed) { open = { type: opened.type, index, source: inner.join('\n') }; break; }
      flush();
      segments.push({ kind: 'component', type: opened.type, index: index++, source: inner.join('\n'), startLine: start + 1, invalidFence: !opened.valid });
      continue;
    }
    if (opened) {
      // Another language's code fence is Markdown, copied through untouched.
      buffer.push(line);
      for (row = row + 1; row < lines.length; row++) { buffer.push(lines[row]); if (closingFence(lines[row], opened)) break; }
      continue;
    }
    buffer.push(line);
  }
  flush();
  return { segments, open };
}

export function hasInteractiveBlocks(body) {
  const parsed = splitBoardBody(body);
  return Boolean(parsed.open || parsed.segments.some(segment => segment.kind === 'component' || segment.kind === 'retired'));
}

/** Parse one component; a parse error is kept on the component, never thrown. */
export function readComponent(segment) {
  const definition = BOARD_COMPONENTS[segment.type];
  try {
    if (segment.invalidFence) throw new BoardComponentError('互动围栏写法需要调整。');
    const spec = definition.parse(segment.source);
    const answerable = typeof definition.answerable === 'function' ? definition.answerable(spec) : definition.answerable;
    return { ...segment, spec, fingerprint: fingerprint(definition.identity(spec)), answerable };
  } catch (error) {
    if (!PARSE_ERRORS.has(error?.name)) throw error;
    return { ...segment, error: { message: error.message, line: error.line } };
  }
}

/** Every component of a body, parsed, in order. */
export function boardComponents(body) {
  return splitBoardBody(body).segments.filter(segment => segment.kind === 'component').map(readComponent);
}

/**
 * The teacher's write check: every component must parse. The thrown message
 * locates the problem and carries that component's whole syntax so the next
 * write can be right without loading anything else.
 */
export function validateBoardComponents(body) {
  const { open } = splitBoardBody(body);
  if (open) throw new Error(`board_component_invalid：第${open.index + 1}个组件（${open.type}）没有用单独一行 \`\`\` 结束。\n${open.type} 的写法：\n${BOARD_COMPONENTS[open.type].syntax}`);
  const components = boardComponents(body);
  for (const component of components) {
    if (!component.error) continue;
    const where = component.error.line ? `第${component.error.line}行：` : '';
    throw new Error(`board_component_invalid：第${component.index + 1}个组件（${component.type}）${where}${component.error.message}\n${component.type} 的写法：\n${BOARD_COMPONENTS[component.type].syntax}`);
  }
  return components;
}

/** Validate a student's answer against the component it answers. */
export function validateBoardAnswer(component, value) {
  if (!component?.answerable || component.error) throw new Error('board_component_missing');
  try { return BOARD_COMPONENTS[component.type].answer(component.spec, value); }
  catch (error) { if (PARSE_ERRORS.has(error?.name)) throw new Error(error.message); throw error; }
}

/** The student's message: a locating prefix, then the answer in words. */
export function boardAnswerMessage({ component, answer }) {
  const definition = BOARD_COMPONENTS[component.type];
  // The locator is system text. Never cut Markdown/TeX from the question into
  // a prefix: an unmatched delimiter can absorb the student's actual answer.
  return `〔白板｜${definition.title} · 第 ${component.index + 1} 项〕\n\n${definition.text(component.spec, answer)}`;
}

/** Answers kept for the current question and the ones left from a changed one. */
export function answersFor(component, answers = []) {
  const own = answers.filter(entry => entry.c === component.index);
  return { current: own.filter(entry => entry.fp === component.fingerprint), stale: own.filter(entry => entry.fp !== component.fingerprint) };
}

/** Append one answer, keeping at most BOARD_ANSWER_LIMIT per component question. */
export function appendBoardAnswer(answers = [], entry) {
  const next = [...answers, entry], same = next.filter(item => item.c === entry.c && item.fp === entry.fp);
  const drop = new Set(same.slice(0, Math.max(0, same.length - BOARD_ANSWER_LIMIT)));
  return next.filter(item => !drop.has(item)).slice(-80);
}

/** Validate the stored answer list inside a block marker. */
export function validateStoredAnswers(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 80) throw new Error('board_format_invalid');
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).some(key => !['id', 'c', 'fp', 'at', 'v'].includes(key))
      || typeof entry.id !== 'string' || !/^[a-f0-9]{8,32}$/.test(entry.id) || !Number.isInteger(entry.c) || entry.c < 0 || entry.c > 50
      || typeof entry.fp !== 'string' || !/^[a-f0-9]{16}$/.test(entry.fp) || typeof entry.at !== 'string' || Number.isNaN(Date.parse(entry.at))
      || !entry.v || typeof entry.v !== 'object' || Array.isArray(entry.v)) throw new Error('board_format_invalid');
  }
  return value;
}

/** A readable line for an answer whose question has since changed: only what it held. */
export function staleAnswerSummary(type, value) {
  if (value?.unsure) return value.note ? `不确定：${value.note}` : '不确定';
  if (typeof value?.other === 'string') return `别的想法：${value.other}`;
  if (type === 'choice' && Array.isArray(value?.pick)) return `选了 ${value.pick.map(n => String.fromCharCode(65 + n)).join('、')}${value.reason ? `，理由：${value.reason}` : ''}`;
  if (type === 'blank' && Array.isArray(value?.fills)) return value.fills.map((fill, n) => `第${n + 1}空：${fill || '（没填）'}`).join('；');
  if (type === 'order' && Array.isArray(value?.order)) return `顺序：${value.order.map(n => n + 1).join(' → ')}`;
  if (type === 'order' && Array.isArray(value?.groups)) return `归类：${value.groups.map(group => group.map(n => n + 1).join('、') || '空').join(' ｜ ')}`;
  if (type === 'figure' && value?.point) return `点 (${value.point.x}, ${value.point.y})`;
  if (type === 'figure' && Number.isFinite(value?.value)) return `参数 ${value.value}`;
  if (type === 'frames' && Number.isInteger(value?.frame)) return value.skipped ? `第${value.frame + 1}帧直接看了` : `第${value.frame + 1}帧预测：${value.text ?? '预测不出来'}`;
  if (type === 'flow' && value?.fills) return Object.entries(value.fills).map(([id, text]) => `${id}：${text || '（没填）'}`).join('；');
  if (type === 'html') {
    const parts = [];
    if (Array.isArray(value?.pick) && value.pick.length) parts.push(`选了 ${value.pick.map(n => String.fromCharCode(65 + n)).join('、')}${value.reason ? `，理由：${value.reason}` : ''}`);
    if (Array.isArray(value?.fills) && value.fills.some(Boolean)) parts.push(value.fills.map((fill, n) => `第${n + 1}空：${fill || '（没填）'}`).join('；'));
    if (parts.length) return parts.join(' ｜ ');
  }
  return '作答';
}
