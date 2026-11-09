import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import MarkdownIt from 'markdown-it';
import { parseMarkdown } from './frontmatter.js';
import { parseReference } from './file-reference.js';
import { safeWorkspaceRelativePath } from './vault-path.js';

const DEFAULT_HEADING = '本节总结与下次续接';
const fail = code => { throw new Error(code); };
const markdown = new MarkdownIt({ html: true, linkify: false, typographer: false });

// As in markdownFacts, let native escapes/code/links consume their input before
// accepting a wiki token. File identity and locators use the shared grammar.
markdown.inline.ruler.before('escape', 'notara_summary_wikilink', (state, silent) => {
  if (state.linkLevel > 0) return false;
  const match = /^!?\[\[[^\]\r\n]+\]\]/.exec(state.src.slice(state.pos));
  const reference = match && parseReference(match[0]);
  if (!reference) return false;
  if (!silent) {
    const token = state.push('notara_summary_wikilink', '', 0);
    token.meta = { reference };
  }
  state.pos += match[0].length;
  return true;
});

const withoutComments = html => html.replace(/<!--[\s\S]*?(?:-->|$)/g, '');
function detailsDepth(html, depth) {
  // Only HTML tokens reach here: literal tags inside code or escaped text do
  // not open a hidden region. Consume whole tags so quoted attribute values
  // and custom elements such as <details-example> cannot open one either.
  const tags = /<!--[^]*?(?:-->|$)|<(script|pre|style|textarea)(?=[\s>])(?:[^>"']|"[^"]*"|'[^']*')*>[^]*?(?:<\/\1\s*>|$)|<(\/?)([a-z][a-z\d:-]*)(?=[\s/>])(?:[^<>"']|"[^"]*"|'[^']*')*>/gi;
  for (const tag of html.matchAll(tags)) {
    if (tag[3]?.toLowerCase() !== 'details') continue;
    depth = Math.max(0, depth + (tag[2] ? -1 : 1));
  }
  return depth;
}

function visibleMarkdown(body) {
  const tokens = markdown.parse(body, {}), headings = [], inlineTokens = [];
  let depth = 0, hasContent = false;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'html_block') {
      const nextDepth = detailsDepth(token.content, depth);
      if (!depth && !nextDepth && withoutComments(token.content).trim()) hasContent = true;
      depth = nextDepth;
    } else if (token.type === 'inline') {
      for (const child of token.children ?? []) {
        if (child.type === 'html_inline') {
          depth = detailsDepth(child.content, depth);
        } else if (!depth) {
          inlineTokens.push(child);
          if (child.content?.trim() || child.type === 'notara_summary_wikilink' || child.type === 'image') hasContent = true;
        }
      }
    } else if (!depth) {
      if (token.type === 'heading_open' && token.level === 0) {
        headings.push({ title: tokens[i + 1]?.content.trim() ?? '', rank: Number(token.tag.slice(1)), map: token.map });
      }
      if (token.type === 'fence' || token.type === 'code_block' || token.type === 'hr') hasContent = true;
    }
  }
  return { headings, inlineTokens, hasContent };
}

function summaryHeading(heading) {
  if (typeof heading !== 'string' || !heading.trim() || /[\x00-\x1f]/.test(heading)) fail('vault_summary_heading_invalid');
  return heading.trim();
}

function readDocument(document) {
  if (!document || typeof document.path !== 'string' || typeof document.content !== 'string') fail('vault_input_invalid');
  const path = safeWorkspaceRelativePath(document.path);
  if (!/\.md$/i.test(path)) fail('vault_summary_type_required');
  return { path, ...parseMarkdown(document.content.replace(/\r\n?/g, '\n')) };
}

/** The receipt version is the section's content identity, never the file CAS revision. */
export function extractLessonSummary(document, { heading = DEFAULT_HEADING } = {}) {
  heading = summaryHeading(heading);
  const { path, fields, body } = readDocument(document);
  const type = String(fields.type ?? '').trim();
  if (fields.template === true || path.startsWith('模板/') || !(type === 'lesson' || type === 'diary' || (!type && path.startsWith('日记/')))) fail('vault_summary_type_required');
  const { headings } = visibleMarkdown(body);
  const matches = headings.filter(row => row.title === heading);
  if (!matches.length) fail('vault_summary_heading_not_found');
  if (matches.length !== 1) fail('vault_summary_heading_ambiguous');
  const start = matches[0];
  const end = headings.find(row => row.map[0] >= start.map[1] && row.rank <= start.rank);
  const content = body.split('\n').slice(start.map[1], end?.map[0]).join('\n').trim();
  if (!visibleMarkdown(content).hasContent) fail('vault_summary_empty');
  if (content.length > 16000) fail('vault_summary_too_large');
  return { path, heading, content, version: createHash('sha256').update(content).digest('hex') };
}

function markdownReference(href, documentPath) {
  try {
    const hash = href.indexOf('#'), decoded = decodeURIComponent(href);
    const encodedHash = decoded.lastIndexOf('#');
    // Native referenceMarkdown encodes the entire locator; ordinary Markdown
    // separates the fragment first, preserving encoded hashes in filenames.
    const fragment = hash >= 0 ? decodeURIComponent(href.slice(hash)) : encodedHash >= 0 && /\.md$/i.test(decoded.slice(0, encodedHash)) ? decoded.slice(encodedHash) : '';
    const target = hash >= 0 ? decodeURIComponent(href.slice(0, hash)) : fragment ? decoded.slice(0, encodedHash) : decoded;
    if (!fragment || /^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith('/')) return null;
    const resolved = target ? posix.join(posix.dirname(documentPath), target) : documentPath;
    const path = safeWorkspaceRelativePath(/\.[a-z0-9]+$/i.test(resolved) ? resolved : `${resolved}.md`);
    return { path, subpath: fragment };
  } catch { return null; }
}

/** A source link must identify this exact section, not merely the same lesson file. */
export function hasSummaryReference(document, { path, heading } = {}) {
  const source = readDocument(document);
  path = safeWorkspaceRelativePath(path);
  heading = summaryHeading(heading);
  return visibleMarkdown(source.body).inlineTokens.some(token => {
    const reference = token.type === 'notara_summary_wikilink' ? token.meta.reference
      : token.type === 'link_open' ? markdownReference(token.attrGet('href'), source.path) : null;
    return reference?.path === path && reference.subpath === `#${heading}`;
  });
}
