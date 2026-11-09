import { parseDocument, isMap } from 'yaml';

export function parseMarkdown(content) {
  const match = content.match(/^(?:\uFEFF)?---\r?\n([\s\S]*?)^---[ \t]*(?:\r?\n|$)/m);
  if (!match || match.index !== 0) {
    if (/^(?:\uFEFF)?---\r?\n/.test(content)) throw new Error('vault_frontmatter_invalid');
    return { fields: {}, body: content, yaml: null, header: null };
  }
  const yaml = parseDocument(match[1], { uniqueKeys: true });
  if (yaml.errors.length || (yaml.contents && !isMap(yaml.contents))) throw new Error('vault_frontmatter_invalid');
  const fields = yaml.toJS({ maxAliasCount: 20 }) ?? {};
  return { fields, yaml, header: match, body: content.slice(match[0].length) };
}

/** Replace only owned top-level keys. All unrelated header bytes and body stay intact. */
export function patchFields(content, changes) {
  const parsed = parseMarkdown(content), eol = content.includes('\r\n') ? '\r\n' : '\n';
  const source = parsed.header?.[1] ?? '';
  if (parsed.yaml?.contents?.flow) {
    // Keep the outer flow map and every unowned pair byte-for-byte. Values are
    // JSON (valid YAML), and separators remain flow commas, never block newlines.
    const map = parsed.yaml.contents, edits = [], additions = [];
    for (const [key, value] of Object.entries(changes)) {
      const index = map.items.findIndex(pair => pair.key?.value === key), pair = map.items[index];
      if (!pair) { if (value !== undefined) additions.push(`${key}: ${JSON.stringify(value)}`); continue; }
      if (value !== undefined) {
        if (!pair.value?.range) throw new Error('vault_frontmatter_invalid');
        edits.push({ from: pair.value.range[0], to: pair.value.range[1], text: JSON.stringify(value) });
      } else if (index < map.items.length - 1) {
        edits.push({ from: pair.key.range[0], to: map.items[index + 1].key.range[0], text: '' });
      } else {
        const from = index ? source.lastIndexOf(',', pair.key.range[0]) : pair.key.range[0];
        edits.push({ from, to: pair.value?.range?.[1] ?? pair.key.range[1], text: '' });
      }
    }
    if (additions.length) {
      const at = map.range[1] - 1;
      const remaining = map.items.some(pair => !Object.hasOwn(changes, pair.key.value) || changes[pair.key.value] !== undefined);
      const trailingComma = /,\s*$/.test(source.slice(0, at));
      edits.push({ from: at, to: at, text: `${remaining && !trailingComma ? ', ' : ''}${additions.join(', ')}` });
    }
    let output = source;
    for (const edit of edits.sort((a, b) => b.from - a.from)) output = output.slice(0, edit.from) + edit.text + output.slice(edit.to);
    const prefix = content.startsWith('\uFEFF') ? '\uFEFF' : '';
    return `${prefix}---${eol}${output}---${eol}${parsed.body}`;
  }
  const edits = [], additions = [];
  for (const [key, value] of Object.entries(changes)) {
    const pair = parsed.yaml?.contents?.items.find(pair => pair.key?.value === key);
    const text = value === undefined ? '' : `${key}: ${JSON.stringify(value)}${eol}`;
    if (pair) {
      const from = pair.key.range[0], to = pair.value?.range?.[2] ?? source.indexOf('\n', pair.key.range[2]) + 1;
      edits.push({ from, to: to || source.length, text });
    } else if (value !== undefined) additions.push(text);
  }
  let output = source;
  for (const edit of edits.sort((a, b) => b.from - a.from)) output = output.slice(0, edit.from) + edit.text + output.slice(edit.to);
  output += additions.join('');
  const prefix = content.startsWith('\uFEFF') ? '\uFEFF' : '';
  return `${prefix}---${eol}${output}---${eol}${parsed.body}`;
}
