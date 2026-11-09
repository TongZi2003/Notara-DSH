import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { extractLessonSummary, hasSummaryReference } from '../summary-document.js';
import { referenceMarkdown } from '../file-reference.js';

const heading = '本节总结与下次续接';
const path = '备课/导数第一课.md';
const reference = { path, heading };
const lesson = (body, extra = {}) => ({ path, content: `---\ntype: lesson\n---\n${body}`, revision: 'r1', ...extra });
const note = content => ({ path: '日记/今天.md', content, revision: 'n1' });
const section = content => `## ${heading}\n\n${content}\n`;

test('summary extracts exact section Markdown, normalizes CRLF and keeps ordinary subheadings', () => {
  const content = '经提示后能说明单调性。\n\n### 下次\n- 独立完成变式\n\n> ## 引用标题\n\n- ## 列表标题';
  const doc = lesson(`# 第一课\n\n${section(content)}\n## 其他记录\n不交付。`);
  const result = extractLessonSummary({ ...doc, content: doc.content.replaceAll('\n', '\r\n') });
  assert.deepEqual(result, { path, heading, content, version: createHash('sha256').update(content).digest('hex') });
  assert.equal(doc.revision, 'r1');
});

test('summary recognizes all six top-level heading ranks and Setext headings', () => {
  for (let level = 1; level <= 6; level++) {
    assert.equal(extractLessonSummary(lesson(`${'#'.repeat(level)} ${heading} ###\n正文\n${'#'.repeat(level)} 结束\n之外`)).content, '正文');
    assert.equal(extractLessonSummary(lesson(`${'#'.repeat(level)} ${heading}\n正文\n# 更高层结束\n之外`)).content, '正文');
  }
  assert.equal(extractLessonSummary(lesson(`${heading}\n---\n正文\n\n下一节\n---\n之外`)).content, '正文');
});

test('summary admits lesson, explicit diary and untyped ordinary notes under 日记/', () => {
  for (const doc of [lesson(section('正文')), note(`---\ntype: diary\n---\n${section('正文')}`), note(section('正文')), note(`---\ntitle: 今天\n---\n${section('正文')}`), { path: '记录.md', content: `---\ntype: diary\n---\n${section('正文')}` }]) {
    assert.equal(extractLessonSummary(doc).content, '正文');
  }
});

test('summary rejects other types, templates and non-Markdown documents', () => {
  for (const doc of [
    { path: '普通.md', content: section('正文') },
    note(`---\ntype: card\n---\n${section('正文')}`),
    note(`---\ntype: route\n---\n${section('正文')}`),
    lesson(section('正文'), { content: `---\ntype: lesson\ntemplate: true\n---\n${section('正文')}` }),
    lesson(section('正文'), { path: '模板/第一课.md' }),
    lesson(section('正文'), { path: '第一课.canvas' }),
  ]) assert.throws(() => extractLessonSummary(doc), { message: 'vault_summary_type_required' });
});

test('summary rejects unsafe paths and malformed input/frontmatter with stable errors', () => {
  for (const unsafe of ['../课.md', '/课.md', 'a/../课.md', 'a\\课.md', '.hidden/课.md', 'a/NUL.md']) {
    assert.throws(() => extractLessonSummary(lesson(section('正文'), { path: unsafe })), { message: 'vault_path_invalid' });
  }
  for (const doc of [null, {}, { path, content: 42 }]) assert.throws(() => extractLessonSummary(doc), { message: 'vault_input_invalid' });
  for (const title of ['', '   ', '两行\n标题', 42]) assert.throws(() => extractLessonSummary(lesson(section('正文')), { heading: title }), { message: 'vault_summary_heading_invalid' });
  assert.throws(() => extractLessonSummary(lesson('---\ntype: lesson\ntype: diary\n---\n正文', { content: '---\ntype: lesson\ntype: diary\n---\n正文' })), { message: 'vault_frontmatter_invalid' });
});

const fakeHeadings = [
  `\`\`\`md\n## ${heading}\n示例\n\`\`\``,
  `    ## ${heading}\n    示例`,
  `\`## ${heading}\``,
  `> ## ${heading}\n> 引用`,
  `- ## ${heading}\n  列表`,
  `1. ## ${heading}\n   列表`,
  `<!--\n## ${heading}\n注释\n-->`,
  `<details><summary>教师参考</summary>\n\n## ${heading}\n隐藏\n\n</details>`,
  `<DETAILS>\n\n<details>\n\n## ${heading}\n隐藏\n\n</details>\n\n</DETAILS>`,
  `<details>\n\n## ${heading}\n未关闭的教师区`,
  `普通文本 <details>\n\n## ${heading}\n隐藏\n\n</details>`,
];
test('summary ignores code, quotes, lists, comments and nested/inline/incomplete details headings', () => {
  for (const fake of fakeHeadings) assert.throws(() => extractLessonSummary(lesson(fake)), { message: 'vault_summary_heading_not_found' }, fake);
  const fakes = fakeHeadings.filter(text => !text.includes('未关闭')).join('\n\n');
  assert.equal(extractLessonSummary(lesson(`${fakes}\n\n${section('唯一真实总结')}`)).content, '唯一真实总结');
});

test('literal details text in HTML attributes, custom elements and raw HTML code does not hide following Markdown', () => {
  for (const prefix of ['<div title="<details>">说明</div>', '普通 <span title="<details>">说明</span>', '<details-example>', '<script>const example = "<details>";</script>']) {
    assert.equal(extractLessonSummary(lesson(`${prefix}\n\n${section('真实总结')}`)).content, '真实总结', prefix);
    assert.equal(hasSummaryReference(note(`${prefix}\n\n[[${path}#${heading}]]`), reference), true, prefix);
  }
});

test('summary rejects duplicate real headings, even at different ranks', () => {
  for (const second of [`## ${heading}`, `#### ${heading}`, `${heading}\n===`]) {
    assert.throws(() => extractLessonSummary(lesson(`${section('第一次')}\n${second}\n第二次`)), { message: 'vault_summary_heading_ambiguous' });
  }
});

test('summary custom heading matches exactly and missing/empty summaries fail', () => {
  assert.equal(extractLessonSummary(lesson('### 课后复盘\n正文'), { heading: '课后复盘' }).content, '正文');
  assert.throws(() => extractLessonSummary(lesson('## 旧总结\n正文')), { message: 'vault_summary_heading_not_found' });
  for (const content of ['', ' \n\t ', '<!-- 待填写 -->', '<!-- 一行 -->\n\n<!--\n多行\n-->', '<!-- 未完成的注释']) {
    assert.throws(() => extractLessonSummary(lesson(section(content))), { message: 'vault_summary_empty' });
  }
  assert.equal(extractLessonSummary(lesson(section('`<!-- 代码内容 -->`'))).content, '`<!-- 代码内容 -->`');
});

test('summary enforces 16000 characters without truncation', () => {
  assert.equal(extractLessonSummary(lesson(section('甲'.repeat(16000)))).content.length, 16000);
  assert.throws(() => extractLessonSummary(lesson(section('甲'.repeat(16001)))), { message: 'vault_summary_too_large' });
});

test('summary version follows section content rather than document revision or task edits', () => {
  const original = lesson(`# 课稿\n- [ ] 热身\n\n${section('已确认的理解。')}\n## 课后任务\n- [ ] 练习`);
  const first = extractLessonSummary(original);
  const edited = { ...original, revision: 'r2', content: original.content.replaceAll('[ ]', '[x]').replace('# 课稿', '# 新课稿') };
  assert.equal(extractLessonSummary(edited).version, first.version);
  assert.equal(extractLessonSummary({ ...edited, revision: 'old-revision' }).version, first.version);
  assert.equal(extractLessonSummary({ ...original, content: original.content.replaceAll('\n', '\r\n') }).version, first.version);
  assert.notEqual(extractLessonSummary({ ...edited, content: edited.content.replace('已确认的理解。', '仍需检验。') }).version, first.version);
});

test('summary reference accepts exact vault-root wikilinks and optional .md/alias/embed', () => {
  for (const text of [`[[${path}#${heading}]]`, `[[${path.slice(0, -3)}#${heading}|课后总结]]`, `![[${path}#${heading}]]`]) assert.equal(hasSummaryReference(note(text), reference), true, text);
});

test('summary reference resolves Markdown paths relative to the document, including URI encoding and definitions', () => {
  for (const text of [
    `[总结](../备课/导数第一课.md#${heading})`,
    `[总结](../备课/导数第一课#${heading})`,
    `[总结](<../${encodeURIComponent(path)}#${encodeURIComponent(heading)}>)`,
    `[总结][source]\n\n[source]: ../备课/导数第一课.md#${heading} "总结"`,
  ]) assert.equal(hasSummaryReference(note(text), reference), true, text);
  assert.equal(hasSummaryReference({ path: '首页.md', content: referenceMarkdown({ path, subpath: `#${heading}`, label: '总结' }) }, reference), true);
  assert.equal(hasSummaryReference({ path, content: `[本节](#${encodeURIComponent(heading)})` }, reference), true);
  assert.equal(hasSummaryReference({ path: '备课/续课.md', content: `[上节](./导数第一课.md#${heading})` }, reference), true);
  const special = { path: '备课/导数 #1%.md', heading: '总结 与下次' };
  assert.equal(hasSummaryReference(note(`[总结](../${encodeURIComponent(special.path)}#${encodeURIComponent(special.heading)})`), special), true);
  assert.equal(hasSummaryReference({ path: '首页.md', content: referenceMarkdown({ ...special, subpath: `#${special.heading}`, label: '总结' }) }, special), true);
});

test('summary reference requires both exact file and exact section', () => {
  for (const text of [
    `[[${path}]]`, `[[${path}#其他总结]]`, `[[备课/另课.md#${heading}]]`,
    `[整课](../${path})`, `[别节](../${path}#其他总结)`, `[别课](../备课/另课.md#${heading})`,
    `[错误相对位置](${path}#${heading})`, `[远程](https://example.test/${path}#${heading})`,
    `[越界](../../${path}#${heading})`, `[损坏URI](../备课/%E0%A4%A.md#${heading})`,
    `[假链接](javascript:alert(1))`,
  ]) assert.equal(hasSummaryReference(note(text), reference), false, text);
});

test('summary reference excludes examples, escaped wikilinks, comments, image alt and teacher details', () => {
  const wiki = `[[${path}#${heading}]]`, md = `[总结](../${path}#${heading})`;
  for (const text of [
    `\`${wiki}\``, `\`\`\`md\n${wiki}\n${md}\n\`\`\``, `    ${wiki}\n    ${md}`,
    `\\${wiki}`, `\\!\\${wiki}`, `\\${md}`,
    `<!-- ${wiki} ${md} -->`, `<!--\n${wiki}\n${md}\n-->`,
    `<details><summary>教师参考</summary>\n\n${wiki}\n${md}\n\n</details>`,
    `<DETAILS>\n\n<details>\n\n${wiki}\n\n</details>\n\n${md}\n\n</DETAILS>`,
    `<details>\n\n${wiki}`, `提示 <details>${wiki}</details>`,
    `![${wiki}](image.png)`, `[${wiki}](https://example.test)`,
  ]) assert.equal(hasSummaryReference(note(text), reference), false, text);
  assert.equal(hasSummaryReference(note(`\`<details>\`\n\n${wiki}`), reference), true);
  assert.equal(hasSummaryReference(note(`<!-- <details> -->\n\n${wiki}`), reference), true);
  assert.equal(hasSummaryReference(note(`\\\\${wiki}`), reference), true, 'an escaped backslash does not escape the following real link');
  assert.equal(hasSummaryReference(note(`<details>\n\n隐藏\n\n</details>\n\n${md}`), reference), true);
});

test('summary reference validates source document and target identity', () => {
  assert.throws(() => hasSummaryReference(null, reference), { message: 'vault_input_invalid' });
  assert.throws(() => hasSummaryReference(note('正文'), { path: '../课.md', heading }), { message: 'vault_path_invalid' });
  assert.throws(() => hasSummaryReference(note('正文'), { path, heading: '' }), { message: 'vault_summary_heading_invalid' });
});
