import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { posix } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseMarkdown } from '@oh-my-student/plugin-vault-sqlite/frontmatter';
import { safeWorkspaceRelativePath } from '@oh-my-student/plugin-vault-sqlite/vault-path';
import { extractLessonSummary } from '@oh-my-student/plugin-vault-sqlite/summary-document';

// Resolve the Vault's locked parser at its declared dependency boundary, even
// when the package manager does not hoist that dependency next to presets.
const MarkdownIt = createRequire(import.meta.resolve('@oh-my-student/plugin-vault-sqlite/summary-document'))('markdown-it');
const markdown = new MarkdownIt({ html: true, linkify: false, typographer: false });
const hash = text => createHash('sha256').update(text).digest('hex');
const fail = code => { throw new Error(code); };
const normalize = text => text.replace(/\r\n/g, '\n');
const escape = text => text.replace(/[\\`*_{}\[\]()#+\-.!|<>~]/g, '\\$&');
const encode = text => encodeURIComponent(text).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
const link = (path, heading, from, label) => `[${escape(label)}](<${encode(posix.relative(posix.dirname(from), path)).replaceAll('%2F', '/')}#${encode(heading)}>)`;
const kinds = { lesson: '课后总结', preparation: '备课交付', question: '轻量讨论', materials: '资料整理' };
const headingText = inline => (inline.children ?? []).map(child => ['text', 'code_inline', 'image'].includes(child.type) ? child.content : ['softbreak', 'hardbreak'].includes(child.type) ? ' ' : '').join('');

// Follow actual Markdown tokens, not raw substring matches. Quotes, lists,
// code, comments and folded teacher references cannot claim a managed entry.
function trackDetails(html, depth) {
  const tags = /<!--[\s\S]*?(?:-->|$)|<(script|pre|style|textarea)(?=[\s>])(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?(?:<\/\1\s*>|$)|<(\/?)([a-z][a-z\d:-]*)(?=[\s/>])(?:[^<>"']|"[^"]*"|'[^']*')*>/gi;
  for (const tag of html.matchAll(tags)) if (tag[3]?.toLowerCase() === 'details') depth = Math.max(0, depth + (tag[2] ? -1 : 1));
  return depth;
}

function visibleDocument(content) {
  const { body } = parseMarkdown(content), base = content.length - body.length;
  const offsets = [base];
  for (const line of body.matchAll(/\n/g)) offsets.push(base + line.index + 1);
  const at = line => offsets[line] ?? content.length;
  const tokens = markdown.parse(body, {}), headings = [], markers = [];
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'html_block' && token.level === 0) {
      if (!depth && /^\s*<!--\s*\/?notara-delivery:/.test(token.content)) {
        const raw = token.content.trim();
        const start = /^<!-- notara-delivery:([a-f0-9]{64}):v([1-9]\d*):([a-f0-9]{64}) -->$/.exec(raw);
        const end = /^<!-- \/notara-delivery:([a-f0-9]{64}) -->$/.exec(raw);
        const prefix = /^<!--\s*(\/?)notara-delivery:([a-f0-9]{64})(?=[:\s>]|$)/.exec(raw);
        markers.push({ id: prefix?.[2], closing: Boolean(prefix?.[1]), valid: Boolean(start || end), version: start ? Number(start[2]) : null, digest: start?.[3],
          from: at(token.map[0]), to: at(token.map[1]) });
      }
      depth = trackDetails(token.content, depth);
    } else if (token.type === 'heading_open' && token.level === 0 && !depth) {
      headings.push({ title: tokens[i + 1].content.trim(), text: headingText(tokens[i + 1]), rank: Number(token.tag.slice(1)),
        from: at(token.map[0]), to: at(token.map[1]) });
    } else if (token.type === 'inline' && token.level === 1) {
      for (const child of token.children ?? []) if (child.type === 'html_inline') depth = trackDetails(child.content, depth);
    }
  }
  return { headings, markers };
}

function deliveryArea(document, content) {
  const sections = document.headings.filter(heading => heading.rank === 2 && heading.title === '工作交付');
  if (sections.length > 1) fail('diary_section_ambiguous');
  const section = sections[0];
  return section && { ...section, end: document.headings.find(heading => heading.from > section.from && heading.rank <= 2)?.from ?? content.length };
}

function entryOf(content, deliveryId) {
  const document = visibleDocument(content), area = deliveryArea(document, content);
  // Duplicated identities are ambiguous even when they belong to another
  // delivery. Integrity checks otherwise belong only to the entry we own.
  for (const id of new Set(document.markers.map(marker => marker.id).filter(Boolean))) {
    const matches = document.markers.filter(marker => marker.id === id);
    if (matches.filter(marker => !marker.closing).length > 1 || matches.filter(marker => marker.closing).length > 1) fail('diary_marker_duplicate');
  }
  const matches = document.markers.filter(marker => marker.id === deliveryId);
  if (!matches.length) return { document, area, entry: null };
  const start = matches.find(marker => !marker.closing), end = matches.find(marker => marker.closing);
  if (!start?.valid || !end?.valid || !area || start.from < area.to || end.to > area.end || start.to >= end.from
    || !Number.isSafeInteger(start.version) || document.markers.some(marker => marker.from > start.from && marker.from < end.from)) fail('diary_entry_damaged');
  const heading = document.headings.find(heading => heading.to === start.from && heading.rank === 3);
  const body = heading && normalize(content.slice(heading.from, start.from) + content.slice(start.to, end.from));
  if (!heading || heading.from < area.to || !Object.values(kinds).some(label => heading.text.startsWith(`${label} · `))
    || !body.startsWith(`### ${heading.title}\n\n`) || hash(body) !== start.digest
    || document.headings.filter(row => row.title === heading.title || row.text === heading.text).length !== 1) fail('diary_entry_damaged');
  return { document, area, entry: { ...start, from: heading.from, to: end.to, body, heading: heading.title, label: heading.text } };
}

function chooseHeading(document, kind, sourceTitle) {
  const taken = new Set(document.headings.flatMap(heading => [heading.title, heading.text]));
  const base = `${kind} · ${sourceTitle}`;
  let label = base, sequence = 1;
  while (taken.has(label) || taken.has(escape(label))) label = `${base}（${++sequence}）`;
  return { heading: escape(label), label };
}

function validateSource(document, source) {
  const headings = visibleDocument(document.content).headings.filter(heading => heading.title === source.heading);
  if (headings.length !== 1) fail('diary_source_invalid');
  return headings[0];
}

function validate(input) {
  const { workspaceId, deliveryId, version, date, kind, source, summary } = input ?? {};
  if (typeof workspaceId !== 'string' || !workspaceId.trim() || typeof deliveryId !== 'string' || !deliveryId.trim()
    || !Number.isSafeInteger(version) || version < 1 || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)
    || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date
    || typeof kind !== 'string' || !Object.hasOwn(kinds, kind)
    || !source || typeof source.heading !== 'string' || !source.heading.trim() || /[\x00-\x1f]/.test(source.heading)
    || (summary !== undefined && (typeof summary !== 'string' || summary.length > 1000))) fail('diary_input_invalid');
  const sourcePath = safeWorkspaceRelativePath(source.path);
  if (!/\.md$/i.test(sourcePath)) fail('diary_source_invalid');
  return { workspaceId, deliveryId, version, date, kind: kinds[kind],
    source: { path: sourcePath, heading: source.heading.trim() }, summary: summary?.replace(/\s+/g, ' ').trim() ?? '' };
}

function separator(text, eol) {
  return !text || text.endsWith(eol + eol) ? '' : text.endsWith(eol) ? eol : eol + eol;
}

/** The Host supplies a durable delivery identity, monotonic version, first
 * completion date and already-saved source. This helper only maintains a
 * visible diary entry; it creates no tasks, receipts or model notifications.
 * kind: lesson / preparation / question / materials.
 */
export async function ensureDeliveryDiary(vault, input) {
  const args = validate(input), { workspaceId, version, date, source } = args;
  const path = `日记/${date}.md`, id = hash(JSON.stringify([workspaceId, args.deliveryId]));
  const receipt = (document, title) => ({ path, heading: title.heading, revision: document.revision,
    locator: link(path, title.heading, '索引.md', title.label) });
  const read = async target => {
    const document = await vault.read({ workspaceId, path: target });
    if (typeof document?.content !== 'string' || typeof document.revision !== 'string' || !document.revision) fail('diary_document_invalid');
    return document;
  };
  // Source read failures are never mistaken for a missing diary.
  const sourceDocument = await read(source.path), sourceHeading = validateSource(sourceDocument, source);
  const sourceIdentity = document => extractLessonSummary({ path: source.path, content: document.content }, { heading: source.heading }).version;
  const sourceVersion = source.path === path ? sourceIdentity(sourceDocument) : null;
  const verifySource = document => {
    if (sourceVersion !== null && sourceIdentity(document) !== sourceVersion) fail('diary_source_changed');
  };
  for (let attempt = 0; attempt < 5; attempt++) {
    let current;
    try { current = await read(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const content = current?.content ?? `---\ntype: diary\n---\n# ${date}\n`;
    const protectedSource = source.path === path ? validateSource(current, source) : null;
    if (protectedSource) verifySource(current);
    const { document, area, entry } = entryOf(content, id);
    const sourceEnd = protectedSource && (document.headings.find(heading => heading.from >= protectedSource.to && heading.rank <= protectedSource.rank)?.from ?? content.length);
    const title = entry ?? chooseHeading(document, args.kind, sourceHeading.text);
    const headingLine = `### ${title.heading}\n`;
    const body = `${headingLine}\n类型：${args.kind}\n\n报告：${link(source.path, source.heading, path, source.heading)}${args.summary ? `\n\n结果：${escape(args.summary)}` : ''}\n\n`;
    // Start with the visible section boundary so no system comment can enter
    // the preceding report. Hash and replace the heading with the owned body.
    const block = `${headingLine}<!-- notara-delivery:${id}:v${version}:${hash(body)} -->\n${body.slice(headingLine.length)}<!-- /notara-delivery:${id} -->\n`;
    if (entry) {
      if (entry.version > version || (entry.version === version && entry.body !== body)) fail('diary_version_conflict');
      if (entry.version === version) return receipt(current, title);
      // Never replace a report that someone has designated as the source.
      if (source.path === path) {
        const heading = validateSource(current, source);
        if (heading.from >= entry.from && heading.from < entry.to) fail('diary_source_overlap');
      }
    }
    const eol = content.includes('\r\n') ? '\r\n' : '\n', rendered = block.replaceAll('\n', eol);
    const insert = (at, newArea = false) => {
      const prefix = content.slice(0, at), suffix = content.slice(at);
      return prefix + separator(prefix, eol) + (newArea ? `## 工作交付${eol}${eol}` : '') + rendered + (suffix ? eol : '') + suffix;
    };
    let next;
    if (entry) next = content.slice(0, entry.from) + rendered + content.slice(entry.to);
    else if (area) {
      let at = area.end;
      // Keep a trailing source report together at this area's boundary.
      if (protectedSource && at > protectedSource.from && at <= sourceEnd && protectedSource.from >= area.to) at = protectedSource.from;
      next = insert(at);
    } else if (protectedSource?.rank === 1 && sourceEnd === content.length) next = insert(protectedSource.from, true);
    else next = insert(content.length, true);
    // Check the actual receipt identity before saving, including H1 reports
    // enclosing an existing delivery area where no safe insertion is possible.
    verifySource({ content: next });
    // An unclosed fence/HTML block must not hide a newly appended entry.
    if (entryOf(next, id).entry?.body !== body) fail('diary_verification_failed');
    try { await vault.save({ workspaceId, path, content: next, expectedRevision: current?.revision ?? null }); }
    catch (error) {
      if (!['vault_revision_conflict', 'vault_locked'].includes(error.code ?? error.message)) throw error;
      if (attempt === 4) fail('diary_cas_exhausted');
      await delay(5 * (attempt + 1));
      continue;
    }
    const saved = await read(path), persisted = entryOf(saved.content, id).entry;
    if (!persisted || persisted.version !== version || persisted.body !== body) fail('diary_verification_failed');
    verifySource(saved);
    return receipt(saved, persisted);
  }
}
