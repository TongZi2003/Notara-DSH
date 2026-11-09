import { fromMarkdown } from 'mdast-util-from-markdown';
import { math } from 'micromark-extension-math';
import { mathFromMarkdown } from 'mdast-util-math';
import { notaraParseMath } from './domain/markdown-math.js';
import { parseReference, referenceMarkdown, parseSessionReference, sessionReferenceMarkdown } from '@oh-my-student/plugin-vault-sqlite/file-reference';
import { fencedMarkdownRanges, hasInteractiveBlocks, splitBoardBody } from './domain/board-components.js';

function protectedRanges(text, formulas, blocks, definitions, codes, sessions) {
  const ranges = fencedMarkdownRanges(text);
  const walk = node => {
    if (node.type === 'inlineMath') formulas.push([node.position.start.offset, node.position.end.offset]);
    if (node.type === 'inlineCode') codes.push([node.position.start.offset, node.position.end.offset]);
    if (['heading', 'list', 'blockquote', 'thematicBreak', 'definition', 'code', 'html'].includes(node.type)) blocks.add(node.position.start.offset);
    if (node.type === 'definition') definitions.push(text.slice(node.position.start.offset, node.position.end.offset));
    if (node.type === 'link') {
      const start = node.position.start.offset, token = text.slice(start, node.position.end.offset);
      if (parseSessionReference(token)) sessions.set(start, token);
    }
    if (['code', 'inlineCode', 'math', 'inlineMath', 'link', 'image'].includes(node.type) || node.type === 'html' && node.value.startsWith('<!--')) ranges.push([node.position.start.offset, node.position.end.offset]);
    else for (const child of node.children ?? []) walk(child);
  };
  const masked = text.replace(/<\/?(?:details|summary)\b[^>]*>/gi, token => token.replace(/[^\r\n]/g, 'x'));
  walk(notaraParseMath(fromMarkdown, masked, { mdastExtensions: [mathFromMarkdown()] }, math()));
  return ranges;
}
function escaped(text, index) {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) slashes++;
  return slashes % 2 === 1;
}

/** Allow only source folds and local wiki references, leaving ordinary GFM and
 * KaTeX to the native engine. No arbitrary HTML or attributes are executed. */
export function conversationMarkdown(source) {
  const text = String(source), formulas = [], blocks = new Set(), definitions = [], codes = [], sessions = new Map(), ranges = protectedRanges(text, formulas, blocks, definitions, codes, sessions);
  const allowed = index => !escaped(text, index) && !ranges.some(([from, to]) => index >= from && index < to);
  const tags = [...text.matchAll(/<\/?details\b[^>]*>/gi)].filter(match => allowed(match.index));
  let special = false, sessionLinks = false;
  const normalize = (value, start, tableCell = false) => value.replace(/!?\[\[[^\]\r\n]+\]\]|\[[^\]\r\n]*\]\(\s*<?session:[^\s>)\r\n]+>?\s*\)|<br\s*\/?\s*>|\\\|/gi, (token, offset) => {
    if (token === '\\|') return tableCell && codes.some(([a, b]) => start + offset >= a && start + offset < b) ? '|' : token;
    if (!allowed(start + offset) && sessions.get(start + offset) !== token) return token;
    if (/^<br\b/i.test(token)) { special = true; return '  \n'; }
    const session = !token.startsWith('!') && parseSessionReference(token);
    if (session) { special = true; sessionLinks = true; return sessionReferenceMarkdown(session); }
    const ref = parseReference(token);
    if (!ref) return token;
    special = true;
    return referenceMarkdown(ref);
  });
  // GFM otherwise consumes TeX's | as a column boundary before math parsing.
  // Render only affected tables cell-by-cell with the native Markdown engine;
  // every formula (including array specifications and text) stays verbatim.
  const tableNodes = (start, end) => {
    const lines = []; let offset = start;
    for (const raw of text.slice(start, end).split('\n')) { lines.push({ raw, start: offset, end: offset + raw.length }); offset += raw.length + 1; }
    const cells = line => {
      const parts = []; let from = 0;
      for (let i = 0; i < line.raw.length; i++) if (line.raw[i] === '|' && !escaped(line.raw, i) && !ranges.some(([a, b]) => line.start + i >= a && line.start + i < b)) {
        parts.push({ raw: line.raw.slice(from, i), start: line.start + from }); from = i + 1;
      }
      parts.push({ raw: line.raw.slice(from), start: line.start + from });
      if (!parts[0]?.raw.trim()) parts.shift();
      if (!parts.at(-1)?.raw.trim()) parts.pop();
      return parts;
    };
    const nodes = []; let cursor = start;
    for (let i = 0; i + 1 < lines.length; i++) {
      const header = lines[i], separator = lines[i + 1];
      if (!header.raw.includes('|') || !allowed(header.start) || !separator.raw.includes('|')) continue;
      const columns = cells(header), dividers = cells(separator);
      if (!columns.length || columns.length !== dividers.length || !dividers.every(cell => /^:?-{3,}:?$/.test(cell.raw.trim()))) continue;
      let j = i + 2;
      while (j < lines.length && lines[j].raw.trim() && lines[j].raw.includes('|') && allowed(lines[j].start) && !blocks.has(lines[j].start + (lines[j].raw.match(/^ */)?.[0].length ?? 0))) j++;
      const finish = lines[j - 1].end;
      if (!formulas.some(([a, b]) => a >= header.start && b <= finish && text.slice(a, b).includes('|'))) { i = j - 1; continue; }
      if (header.start > cursor) nodes.push({ kind: 'markdown', start: cursor, text: normalize(text.slice(cursor, header.start), cursor) });
      const render = cell => cell ? normalize(cell.raw, cell.start, true).trim() : '';
      nodes.push({ kind: 'table', start: header.start, definitions: definitions.join('\n'), headers: columns.map(render), align: dividers.map(cell => /^:.*:$/.test(cell.raw.trim()) ? 'center' : /:$/.test(cell.raw.trim()) ? 'right' : null), rows: lines.slice(i + 2, j).map(line => { const values = cells(line); return columns.map((_, n) => render(values[n])); }) });
      special = true; cursor = finish; i = j - 1;
    }
    if (cursor < end) nodes.push({ kind: 'markdown', start: cursor, text: normalize(text.slice(cursor, end), cursor) });
    return nodes;
  };
  const parse = (start, end, depth = 0) => {
    const nodes = []; let cursor = start;
    const plain = to => { if (to > cursor) nodes.push(...tableNodes(cursor, to)); };
    for (let i = 0; i < tags.length; i++) {
      const open = tags[i];
      if (open.index < cursor || open.index >= end || /^<\//.test(open[0]) || depth >= 8) continue;
      let nested = 1, j = i + 1;
      for (; j < tags.length && tags[j].index < end; j++) {
        nested += /^<\//.test(tags[j][0]) ? -1 : 1;
        if (nested === 0) break;
      }
      const close = nested === 0 ? tags[j] : null;
      const bodyStart = open.index + open[0].length, bodyEnd = close?.index ?? end;
      const inner = text.slice(bodyStart, bodyEnd), summaryOpen = /^\s*<summary\b[^>]*>/i.exec(inner);
      const summaryStart = summaryOpen ? bodyStart + summaryOpen[0].length : null;
      const summaryClose = summaryStart === null ? null : [...text.slice(summaryStart, bodyEnd).matchAll(/<\/summary\s*>/gi)].find(match => allowed(summaryStart + match.index));
      const summaryEnd = summaryClose ? summaryStart + summaryClose.index : null;
      const summaryText = summaryEnd === null ? '' : text.slice(summaryStart, summaryEnd);
      const summaryInteractive = hasInteractiveBlocks(summaryText);
      plain(open.index); special = true;
      const contentStart = summaryClose ? summaryEnd + summaryClose[0].length : bodyStart;
      const children = summaryOpen && !summaryClose ? [] : parse(contentStart, bodyEnd, depth + 1);
      if (summaryInteractive) children.unshift(...parse(summaryStart, summaryEnd, depth + 1));
      nodes.push({ kind: 'details', summary: summaryInteractive ? '互动内容' : normalize(summaryText, summaryStart ?? bodyStart).trim() || '展开内容', start: open.index, children });
      cursor = close ? close.index + close[0].length : end;
      i = close ? j : tags.length;
    }
    plain(end);
    return nodes;
  };
  const nodes = parse(0, text.length);
  let index = 0;
  const annotate = list => { for (const node of list) {
    if (node.kind === 'details') annotate(node.children);
    else if (node.kind === 'markdown') { node.componentOffset = index; index += splitBoardBody(node.text).segments.filter(segment => (segment.kind === 'component' || segment.kind === 'retired')).length; }
  } };
  annotate(nodes);
  return { nodes, special, sessionLinks };
}
