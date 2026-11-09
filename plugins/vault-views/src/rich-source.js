import { parseStructure, walkStructure } from './markdown-structure.js';
// Includes retired choice/blank fences only to preserve existing source capsules.
const COMPONENTS = new Set(['blank', 'choice', 'order', 'frames', 'figure', 'flow', 'html']);

/** Preserve application syntax before a rich-text parser normalizes Markdown. */
export function prepareRichSource(source) {
  const prefix = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(source)?.[0] || '';
  const body = source.slice(prefix.length), replacements = [], capsules = new Map();
  const protectedRanges = [];
  const tree = parseStructure(body);
  walkStructure(tree, node => { if (['code', 'inlineCode', 'math', 'inlineMath'].includes(node.type)) protectedRanges.push([node.position.start.offset, node.position.end.offset]); });
  const insideProtected = index => protectedRanges.some(([a, b]) => index >= a && index < b);
  const covered = (a, b) => replacements.some(r => a < r.end && b > r.start);
  const add = (start, end, kind, block = true) => {
    if (covered(start, end)) return;
    const token = `NVREF${capsules.size}X${Math.random().toString(36).slice(2)}END`;
    capsules.set(token, { raw: body.slice(start, end), kind, block });
    replacements.push({ start, end, text: block ? `\n\n\`\`\`notara-preserved\n${token}\n\`\`\`\n\n` : token });
  };
  const tags = [...body.matchAll(/<\/?details\b[^>]*>/gi)].filter(m => !insideProtected(m.index));
  const headings = [...body.matchAll(/^##\s+(.+)\r?$/gm)].filter(m => !insideProtected(m.index));
  headings.forEach((heading, index) => { if (/^(参考理解|教师参考|参考答案|答案|提示)\s*$/.test(heading[1])) add(heading.index, headings[index + 1]?.index ?? body.length, 'fold'); });
  for (let i = 0; i < tags.length; i++) {
    if (/^<\//.test(tags[i][0])) continue;
    let depth = 1, j = i + 1;
    for (; j < tags.length; j++) { depth += /^<\//.test(tags[j][0]) ? -1 : 1; if (!depth) break; }
    add(tags[i].index, tags[j] ? tags[j].index + tags[j][0].length : body.length, 'fold'); i = j;
  }
  for (const node of tree.children ?? []) {
    if (node.type === 'code' && COMPONENTS.has(node.lang?.toLowerCase())) add(node.position.start.offset, node.position.end.offset, 'component');
    if (node.type === 'html') add(node.position.start.offset, node.position.end.offset, 'html');
  }
  for (const match of body.matchAll(/^[ \t]*!\[\[[^\]\n]+\]\][ \t]*\r?$/gm)) if (!insideProtected(match.index)) add(match.index, match.index + match[0].replace(/\r$/, '').length, 'embed');
  for (const match of body.matchAll(/!?\[\[[^\]\n]+\]\]/g)) if (!insideProtected(match.index)) add(match.index, match.index + match[0].length, 'reference', false);
  let value = body;
  for (const r of replacements.sort((a, b) => b.start - a.start)) value = value.slice(0, r.start) + r.text + value.slice(r.end);
  return { source: value, capsules, prefix, newline: source.includes('\r\n') ? '\r\n' : '\n' };
}

export function finishRichSource(markdown, prepared) {
  const body = markdown.replace(/\r?\n/g, prepared.newline);
  return prepared.prefix + body;
}
