import test from 'node:test';
import assert from 'node:assert/strict';
import { queryInput, toggleTag, pdfReference, parseReference, parseSessionReference, documentType, dragRect, guideSections, markdownSections, reviewInput, sourceCard, createViewState, callVault, safeSummary, wikiToMarkdown, verifyDisplayedSource } from '../src/logic.js';
import { documentSummary } from '../../vault-sqlite/markdown-projection.js';

test('teacher details retain internal headings, nested folds and unclosed references in one section', () => {
  const source = '# 课稿\n\n<details data-notara="teacher">\n<summary>教师参考</summary>\n\n## A＋B＋C\n\n教师总览\n\n<details><summary>内层</summary>\n\n## 内层标题\n\n内部解答\n</details>\n\n</details>\n\n## 公开题目\n\n题干\n';
  const sections = markdownSections(source);
  assert.deepEqual(sections.map(section => section.title), ['', '公开题目']);
  assert.ok(sections[0].content.includes('## 内层标题'));
  assert.equal((sections[0].content.match(/<\/details>/g) || []).length, 2);
  assert.deepEqual(markdownSections(source.replaceAll('</details>', '')).map(section => section.title), ['']);
  assert.deepEqual(markdownSections(source.replace('<details data-notara="teacher">','<details\n data-notara="teacher"\n>')).map(section => section.title), ['', '公开题目']);
});

test('section splitting and display comments preserve literal code and math', () => {
  const source = '```md\n<!-- notara-task:example -->\n<details>\n## 假标题\n```\n\n$$\n\\text{<details>}\n## 公式内部\n$$\n\n## 公开\n\n任务 <!-- notara-task:real-id -->\n';
  const sections = markdownSections(source);
  assert.deepEqual(sections.map(section => section.title), ['', '公开']);
  assert.ok(sections[0].content.includes('<!-- notara-task:example -->'));
  assert.ok(!sections[1].content.includes('notara-task:real-id'));
});

test('formula previews retain inequalities and whole display atoms at the length boundary', () => {
  const math = '$$a<b\\text{且}c>d$$';
  assert.equal(safeSummary(math), math);
  const prefix = '预览 '.repeat(79);
  const source = prefix + '$$\\frac{1}{\\sqrt{2}}$$';
  assert.ok(documentSummary(source).endsWith('$$\\frac{1}{\\sqrt{2}}$$'));
  assert.ok(safeSummary(documentSummary(source)).endsWith('$$\\frac{1}{\\sqrt{2}}$$'));
});

test('guide task display keeps multiline formula intact without changing checkbox CAS text', () => {
  const source = '# 导读\n<!-- note -->\n## 任务\n- [ ] 推导\n\n  $$\n  \\frac{1}{2}\n\n  +x\n  $$\n\n说明。\n';
  const section = guideSections(source).find(section => section.tasks.length);
  assert.equal(section.tasks[0].text, '推导');
  assert.equal(section.tasks[0].line, 4);
  assert.match(section.tasks[0].displayText, /\$\$\n\\frac\{1\}\{2\}\n\n\+x\n\$\$/);
  assert.ok(!section.bodyLines.join('\n').includes('\\frac'));
  assert.ok(section.bodyLines.join('\n').includes('说明。'));
});

test('shared filters preserve AND tags and review restrictions in every view', () => {
  for (const view of ['table', 'cards', 'guides', 'review']) assert.deepEqual(queryInput({ tags: ['化学', '溶液', '化学'], q: ' Ksp ', minReviews: '2', type: 'card', reviewStatus: 'due' }, view), { view, tags: ['化学', '溶液'], q: 'Ksp', sort: 'title', minReviews: 2, type: 'card', reviewStatus: 'due' });
  assert.deepEqual(toggleTag(toggleTag([], '化学'), '溶液'), ['化学', '溶液']);
});

test('guide line positions survive YAML and CRLF; fenced/comment examples excluded', () => {
  const source = '---\r\ntype: source\r\n---\r\n# 导读\r\n## 背景\r\n先建立判断。\r\n## 任务\r\n- [ ] [[卡片/甲]]\r\n```md\r\n- [ ] 示例\r\n```\r\n<!--\r\n- [ ] 注释\r\n-->\r\n- [x] 真实完成\r\n## 足迹\r\n尚未记录\r\n';
  const sections = guideSections(source);
  assert.equal(sections.find(x => x.title === '背景').lines[0], '先建立判断。');
  assert.deepEqual(sections.flatMap(x => x.tasks), [{ line: 8, checked: false, text: '[[卡片/甲]]' }, { line: 15, checked: true, text: '真实完成' }]);
  assert.ok(sections.find(x => x.title === '足迹'));
});

test('only actual reference section folds, never fenced headings', () => {
  const sections = markdownSections('---\ntype: card\n---\n## 内容\n```\n## 参考理解\n```\n## 参考理解\n答案\n## 学生理解\n实况');
  assert.equal(sections.filter(x => x.reference).length, 1);
  assert.ok(sections.find(x => x.title === '内容').content.includes('## 参考理解'));
});

test('summaries cannot bypass reference folds; extensionless wiki links target Markdown', () => {
  assert.equal(safeSummary('# 标题 ## 内容 思考条件 ## 参考理解 不能泄露的答案 ## 学生理解 旧表达'), '思考条件');
  assert.equal(parseReference('[[卡片/溶液|溶液]]').path, '卡片/溶液.md');
  assert.equal(queryInput({}, 'review').reviewStatus, 'due');
  assert.equal(queryInput({ type: 'source', reviewStatus: 'all' }, 'review').type, 'source');
  assert.equal(queryInput({}, 'review').type, undefined);
  assert.equal(queryInput({ type: 'source', reviewStatus: 'all' }, 'review').reviewStatus, 'due');
  assert.equal(queryInput({ type: 'source' }, 'cards').type, 'source');
  assert.deepEqual(queryInput({ offset: 100, limit: 100 }).offset, 100);
});

test('summary strips complete, nested and truncated folds including their answers', () => {
  for (const folded of [
    '<details><summary>查看原解</summary>ORIGINAL_SOLUTION_42</details>',
    '<DETAILS open><summary>原解</summary><details>INNER_42</details>ORIGINAL_SOLUTION_42</DETAILS>',
    '<details><summary>查看原解</summary>ORIGINAL_SOLUTION_42',
    '<details class="fold"',
  ]) {
    const summary = safeSummary(`# 题目 ## 内容 计算6×7。 ${folded}`);
    assert.ok(summary.includes('计算6×7。')); assert.ok(!summary.includes('ORIGINAL_SOLUTION_42')); assert.ok(!summary.includes('INNER_42')); assert.ok(!summary.includes('原解'));
  }
});

test('PDF source preflight rejects stale display revision from real remote envelope', async () => {
  await assert.rejects(() => verifyDisplayedSource({ read: async () => ({ ok: true, value: { revision: 'pdf-v2' } }) }, { path: '来源/a.pdf', revision: 'pdf-v1' }), error => error.code === 'STALE_SOURCE');
});

test('native Markdown conversion preserves code and encodes PDF locators as local destinations', () => {
  const converted = wikiToMarkdown('[[卡片/溶液|溶液]] ![[来源/a.pdf#page=4&rect=0,0,0.5,0.5]]\n`[[示例]]`\n```md\n[[示例]]\n```');
  assert.match(converted, /^\[溶液\]\(<%E5%8D%A1%E7%89%87\/%E6%BA%B6%E6%B6%B2.md>\)/);
  assert.ok(converted.includes('a.pdf%23page%3D4%26rect%3D0%2C0%2C0.5%2C0.5'));
  assert.ok(converted.endsWith('`[[示例]]`\n```md\n[[示例]]\n```'));
});

test('document references share generic file grammar and leave math/code examples literal', () => {
  const examples = '$\\text{[[train.py]]}$\n\n$$\n[[result.json]]\n$$\n\n    [[indented.py]]\n\n\\[[escaped.py]]';
  assert.equal(wikiToMarkdown(examples), examples);
  assert.equal(wikiToMarkdown('[[train.py#L2|代码]]'), '[代码](<train.py#L2>)');
  assert.equal(parseReference('[[代码/a.py|脚本]]').path, '代码/a.py');
});

test('PDF regions round-trip without copying image bytes and reject unsafe locations', () => {
  const ref = pdfReference('来源/教材.pdf', 42, [.08, .15, .84, .32]);
  assert.deepEqual(parseReference(ref), { path: '来源/教材.pdf', page: 42, rect: [.08, .15, .84, .32], label: '教材.pdf' });
  assert.throws(() => pdfReference('../secret.pdf', 1));
  assert.equal(parseReference('![[来源/a.pdf#page=0]]'), null);
  assert.equal(parseReference('![[来源/a.pdf#page=1&rect=0.9,0,0.5,1]]'), null);
  assert.deepEqual(dragRect({ x: 90, y: 90 }, { x: 10, y: 30 }, 100, 100), [.1, .3, .8, .6]);
  assert.equal(dragRect({ x: 1, y: 1 }, { x: 2, y: 2 }, 100, 100), null);
});

test('honest review rejects untouched support, including successful result', () => {
  assert.throws(() => reviewInput('卡片/a.md', { result: 'done', support: '' }));
  assert.deepEqual(reviewInput('卡片/a.md', { result: 'done', support: 'hint', keyStep: ' 判断边界 ' }), { path: '卡片/a.md', result: 'done', support: 'hint', keyStep: '判断边界', note: '' });
});

test('source card is create-only and does not invent understanding or review state', () => {
  const card = sourceCard({ title: '题目: 溶液', path: '来源/讲义.pdf', page: 2, rect: [0, 0, 1, 1] });
  assert.equal(card.expectedRevision, null);
  assert.equal(card.path, '卡片/题目- 溶液.md');
  assert.match(card.content, /!\[\[来源\/讲义.pdf#page=2&rect=0,0,1,1\]\]/);
  assert.ok(card.content.endsWith('## 参考理解\n\n## 学生理解\n'));
  assert.throws(() => sourceCard({ title: 'CON', path: 'a.pdf', page: 1 }));
});

test('view store keeps tabs and locator and disposes subscriptions', () => {
  const store = createViewState(); let changes = 0;
  const dispose = store.subscribe(() => changes++);
  store.open({ path: 'a.md' }); store.open({ path: 'b.pdf', page: 2 }); store.close('b.pdf');
  assert.equal(store.getSnapshot().active, 'a.md');
  dispose(); store.close('a.md'); assert.equal(changes, 3);
});

test('remote wrapper handles native envelopes and propagates rejected CAS', async () => {
  assert.equal(await callVault({ read: async () => ({ ok: true, value: 5 }) }, 'read'), 5);
  await assert.rejects(() => callVault({ toggleTask: async () => { throw new Error('revision conflict'); } }, 'toggleTask', {}), /revision conflict/);
  await assert.rejects(() => callVault({ read: async () => ({ ok: false }) }, 'read'));
});

test('session links rewrite to clickable internal session destinations outside code and math', () => {
  const source = [
    '关联课堂：[[session:cls-101|极值点偏移第一课]] 与 [校验课堂](session:verify_2)',
    '行内代码：`[[session:code-only|不改写]]`',
    '```md',
    '[[session:fenced-only|代码块内不改写]]',
    '```',
  ].join('\n');
  const rendered = wikiToMarkdown(source);
  assert.match(rendered, /\[极值点偏移第一课\]\(<__notara_session__\/cls-101>\)/);
  assert.match(rendered, /\[校验课堂\]\(<__notara_session__\/verify_2>\)/);
  assert.match(rendered, /`\[\[session:code-only\|不改写\]\]`/);
  assert.match(rendered, /```md\n\[\[session:fenced-only\|代码块内不改写\]\]\n```/);
  assert.equal(parseSessionReference('__notara_session__/cls-101')?.sessionId, 'cls-101');
  assert.equal(documentType('---\ntype: route\n---\n# 路线\n'), 'route');
  assert.equal(documentType('---\ntype: lesson\n---\n# 备课\n'), 'lesson');
});
