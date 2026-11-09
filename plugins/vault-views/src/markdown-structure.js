import { fromMarkdown } from 'mdast-util-from-markdown';
import { math } from 'micromark-extension-math';
import { mathFromMarkdown } from 'mdast-util-math';
import { notaraParseMath } from '@oh-my-student/plugin-graph-and-blocks/markdown-math';
import { cjkFriendlyStrong } from './cjk-strong.js';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';

export const parseStructure = source => notaraParseMath(fromMarkdown, String(source), { extensions: [gfm(),cjkFriendlyStrong()], mdastExtensions: [gfmFromMarkdown(),mathFromMarkdown()] }, math());
export function walkStructure(node, visit) {
  visit(node);
  for (const child of node.children ?? []) walkStructure(child, visit);
}
export function protectedMarkdownRanges(source) {
  const ranges = [];
  walkStructure(parseStructure(source), node => {
    if (['math', 'inlineMath', 'code', 'inlineCode'].includes(node.type) || node.type === 'html' && node.value.startsWith('<!--')) {
      ranges.push([node.position.start.offset, node.position.end.offset]);
    }
  });
  return ranges;
}

// Remove display comments only when the parser identifies HTML. Examples in
// code and TeX stay literal; callers never write this projection back to disk.
export function withoutMarkdownComments(source) {
  const ranges = [];
  walkStructure(parseStructure(source), node => {
    if (node.type !== 'html') return;
    const start = node.position.start.offset;
    const raw = source.slice(start, node.position.end.offset);
    for (const match of raw.matchAll(/<!--[\s\S]*?-->/g)) ranges.push([start + match.index, start + match.index + match[0].length]);
  });
  let cursor = 0, result = '';
  for (const [from, to] of ranges.sort((a, b) => a[0] - b[0])) {
    if (from < cursor) continue;
    result += source.slice(cursor, from); cursor = to;
  }
  return result + source.slice(cursor);
}
