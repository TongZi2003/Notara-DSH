import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, renameSync, unlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createVaultStore } from '../vault-indexer.js';
import { serializeBase, filtersToBase } from '../bases.js';

const document = (type, body = '', tags = []) => `---\ntype: ${type}\ntags: ${JSON.stringify(tags)}\n---\n${body}`;
function fixture(t, files, persistent = false) {
  const root = mkdtempSync(join(tmpdir(), 'notara-knowledge-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  const cachePath = persistent ? join(root, 'cache.sqlite') : ':memory:';
  const store = createVaultStore({ root, cachePath });
  t.after(async () => { await store.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, store, cachePath };
}
const kinds = (store, kind) => store.graph().edges.filter(edge => edge.kind === kind);
const paths = result => result.documents.map(row => row.path).sort();

test('knowledge tags resolve explicit paths and unique short names, never ambiguous or non-entity targets', t => {
  const tags = ['[[卡片/A|基础]]', '[[卡片/A.md|别名]]', '[[唯一]]', 'A', '[[A]]', '[[错误/A]]', '[[卡片/例子]]', '[[卡片/旧卡]]', '[[来源]]'];
  const { store, root } = fixture(t, {
    '卡片/A.md': document('concept'), '其他/A.md': document('method'),
    '卡片/唯一.md': document('method'), '卡片/旧卡.md': document('card'),
    '来源.md': document('source'), '卡片/例子.md': document('exercise', '实验原始材料', tags),
  });
  const example = store.query({ paths: ['卡片/例子.md'] }).documents[0];
  assert.deepEqual(example.knowledgeTags, [
    { raw: tags[0], target: '卡片/A.md', label: '基础' },
    { raw: tags[1], target: '卡片/A.md', label: '别名' },
    { raw: tags[2], target: '卡片/唯一.md', label: '唯一' },
  ]);
  assert.deepEqual(example.tags, tags);
  assert.deepEqual(example.unresolvedKnowledgeTags.map(row => row.raw), tags.slice(4));
  assert.equal(kinds(store, 'example').length, 2);
  assert.ok(kinds(store, 'example').every(edge => edge.target === example.path && edge.style === 'dashed'));
  assert.equal(readFileSync(join(root, example.path), 'utf8'), document('exercise', '实验原始材料', tags));
});

test('full root-relative filenames stay explicit even when another folder has the same basename', t => {
  const { store } = fixture(t, {
    'A.md': document('concept'), '其他/A.md': document('method'), '其他/缺失.md': document('concept'),
    '例子.md': document('exercise', '', ['[[A.md|根实体]]', '[[A]]', '[[缺失.md]]']),
    'B.md': document('method', '## 前序依赖\n- [[A.md]]：精确根路径。\n- [[A]]：歧义短名不生成前序。\n- [[缺失.md]]：明确路径不按短名重挂。'),
  });
  assert.deepEqual(store.query({ paths: ['例子.md'] }).documents[0].knowledgeTags, [{ raw: '[[A.md|根实体]]', target: 'A.md', label: '根实体' }]);
  assert.deepEqual(paths(store.query({ tags: ['[[A.md]]'] })), ['例子.md']);
  assert.deepEqual(kinds(store, 'prerequisite').map(edge => [edge.source, edge.target]), [['A.md', 'B.md']]);
});

test('canonical tag identity filters alias-equivalent examples through query, graph, Base and saved filters', t => {
  const files = { '卡片/A.md': document('concept'), '卡片/B.md': document('method') };
  for (const [name, material, tag] of [
    ['题目', '完整题面与推演', '[[卡片/A|方法一]]'], ['实验', '设置、实现、观察和取舍', '[[A]]'],
    ['历史', '史料与不同解释', '[[卡片/A.md|历史解释]]'], ['医学', '病案材料、依据与问题', '[[卡片/A]]'],
  ]) files[`${name}.md`] = document('exercise', material, [tag, '普通', '[[卡片/B]]']);
  files['旧卡.md'] = document('card', '旧格式也能挂接', ['[[A|旧别名]]']);
  files['同名检索.md'] = document('exercise', '纯检索标签', ['A', '普通']);
  const { store } = fixture(t, files);
  const expected = ['医学.md', '历史.md', '实验.md', '旧卡.md', '题目.md'].sort();
  const before = { ...store.metrics };
  assert.deepEqual(paths(store.query({ tags: ['[[卡片/A.md]]'] })), expected);
  assert.deepEqual(paths(store.query({ tags: ['[[A|随意显示名]]'] })), expected);
  assert.equal(store.query({ tags: ['[[卡片/A]]', '普通'], tagMatch: 'all' }).total, 4);
  assert.equal(store.query({ tags: ['[[卡片/A]]', 'A'], tagMatch: 'any' }).total, 6);
  assert.deepEqual(store.graph({ tagFilter: '[[卡片/A.md]]' }).nodes.map(row => row.path).sort(), expected);
  assert.deepEqual(paths(store.query({ tags: ['A'] })), ['同名检索.md']);
  assert.deepEqual(paths(store.query({ q: '病案' })), ['医学.md']);
  assert.equal(kinds(store, 'example').length, 9, 'four forms use the same multi-attachment projection');
  assert.equal(store.metrics.fileReads, before.fileReads);
  assert.equal(store.metrics.scans, before.scans);
  for (const filter of ['file.hasTag("[[卡片/A.md]]")', 'file.tags.contains("[[卡片/A.md]]")', { and: filtersToBase({ tags: ['[[卡片/A.md]]'] }) }]) {
    const content = serializeBase({ filters: filter, views: [{ type: 'table', order: ['note.tags'] }] });
    const old = (() => { try { return store.read({ path: '筛选.base' }); } catch { return null; } })();
    store.save({ path: '筛选.base', expectedRevision: old?.revision ?? null, content });
    const result = store.query({ base: { path: '筛选.base' } });
    assert.deepEqual(paths(result), expected);
    assert.deepEqual(result.documents.find(row => row.path === '实验.md').properties['note.tags'], ['[[A]]', '普通', '[[卡片/B]]']);
    assert.equal(result.documents[0].knowledgeTags[0].target, '卡片/A.md');
  }
});

test('six mutually referencing entities stay references; shared plain tags never invent prerequisites or example links', t => {
  const files = {};
  for (const name of 'ABCDEF') files[`${name}.md`] = document('concept', [...'ABCDEF'].filter(other => other !== name).map(other => `[[${other}]]`).join('\n'), ['共同']);
  files['例子一.md'] = document('exercise', '[[例子二]]', ['A', '共同']);
  files['例子二.md'] = document('exercise', '[[例子一]]', ['A', '共同']);
  const { store } = fixture(t, files);
  assert.equal(store.graph().relationsVersion, 2);
  assert.equal(kinds(store, 'prerequisite').length, 0);
  assert.equal(kinds(store, 'example').length, 0);
  assert.equal(kinds(store, 'reference').length, 16);
});

test('explicit prerequisites preserve direction, common context, joint routes, alternatives, cycles and direct edges', t => {
  const { store } = fixture(t, {
    'A.md': document('concept', '## 前序依赖\n- [[B]]：保留循环。'),
    'B.md': document('method', '## 前序依赖\n- [[A]]：共同基础。\n### 路线：同支比较\n- [[A]]：同支第一项。\n- [[C]]：同支第二项。\n### 路线：代数\n- [[D]]：替代路径。'),
    'C.md': document('concept', '## 前序依赖\n- [[A]]：直接边，即使已有间接路径也保留。'),
    'D.md': document('method'), '例子.md': document('exercise', '## 前序依赖\n- [[A]]：例子不声明实体前序。'),
  });
  const edges = kinds(store, 'prerequisite');
  assert.deepEqual(edges.map(({ source, target, context }) => [source, target, context]).sort(), [
    ['B.md', 'A.md', ''], ['A.md', 'B.md', ''], ['A.md', 'B.md', '同支比较'],
    ['C.md', 'B.md', '同支比较'], ['D.md', 'B.md', '代数'], ['A.md', 'C.md', ''],
  ].sort());
  assert.equal(new Set(edges.map(edge => edge.id)).size, 6);
  const id = edges.find(edge => edge.source === 'A.md' && edge.target === 'B.md' && !edge.context).id;
  const old = store.read({ path: 'B.md' });
  store.save({ path: old.path, expectedRevision: old.revision, content: old.content.replace('共同基础。', '重新说明；身份不变。') });
  assert.equal(kinds(store, 'prerequisite').find(edge => edge.source === 'A.md' && edge.target === 'B.md' && !edge.context).id, id);
});

test('qualified student evidence changes only an existing directed relation and matching context', t => {
  const body = '## 前序依赖\n- [[A]]：共同用途。\n### 路线：比较\n- [[A]]：比较用途。\n## 横向联系\n### 主题：类比\n- [[A]]：横向类比。\n## 学生理解\n### 已建立的联系\n- [[A]]（前序依赖）：经提示解释共同用途，来源 [[日记/今天]]。\n- [[A]]（前序依赖／比较）：解释比较用途。\n- [[A]]（横向联系／类比）：解释类比。\n- [[C]]（前序依赖）：没有声明，不能造依赖。';
  const { store } = fixture(t, {
    'A.md': document('concept', '## 前序依赖\n- [[B]]：反方向。'), 'B.md': document('method', body),
    'C.md': document('concept'), '日记/今天.md': '# 今天',
    '例子.md': document('exercise', '## 学生理解\n### 已建立的联系\n- [[A]]（知识标签）：选择了实际方法。\n- [[C]]（知识标签）：无标签不能凭空挂接。', ['[[A]]']),
  });
  const by = (kind, source, target, context = '') => store.graph().edges.find(edge => edge.kind === kind && edge.source === source && edge.target === target && edge.context === context);
  assert.equal(by('prerequisite', 'A.md', 'B.md').style, 'solid');
  assert.equal(by('prerequisite', 'B.md', 'A.md').style, 'dashed');
  assert.equal(by('prerequisite', 'A.md', 'B.md', '比较').style, 'solid');
  assert.equal(by('association', 'A.md', 'B.md', '类比').style, 'solid');
  assert.equal(by('example', 'A.md', '例子.md').style, 'solid');
  assert.equal(kinds(store, 'prerequisite').some(edge => edge.source === 'C.md'), false);
  assert.equal(kinds(store, 'example').some(edge => edge.source === 'C.md'), false);
  const old = store.read({ path: 'B.md' });
  store.save({ path: old.path, expectedRevision: old.revision, content: old.content + '\n### 待探索的联系\n- [[A]]（横向联系／类比）：撤回类比，保留前序理解。\n- [[A]]（前序依赖／比较）：只撤回比较路线。' });
  assert.equal(by('association', 'A.md', 'B.md', '类比').style, 'dashed');
  assert.equal(by('prerequisite', 'A.md', 'B.md').style, 'solid');
  assert.equal(by('prerequisite', 'A.md', 'B.md', '比较').style, 'dashed');
  assert.match(by('prerequisite', 'A.md', 'B.md').description, /共同用途/);
  assert.equal(by('prerequisite', 'A.md', 'B.md').description.includes('撤回类比'), false);
  assert.ok(store.graph().edges.filter(edge => edge.target === '日记/今天.md').every(edge => edge.style === 'dashed'));
});

test('legacy solid associations and source memberships survive separately from new relation kinds', t => {
  const { store } = fixture(t, {
    'A.md': document('card', '## 内容\n[[讲义.pdf]]\n## 学生理解\n### 已建立的联系\n- [[B]]：经帮助建立旧联系。'),
    'B.md': document('concept', '## 横向联系\n### 主题：比较\n- [[A]]：另一主题。\n## 学生理解\n### 已建立的联系\n- [[A]]：旧另一端。'),
    '讲义.pdf': '%PDF-1.4\n',
  });
  assert.equal(kinds(store, 'association').find(edge => !edge.context).style, 'solid');
  assert.equal(kinds(store, 'association').find(edge => edge.context === '比较').style, 'dashed');
  assert.equal(kinds(store, 'source').length, 1);
  assert.deepEqual(store.graph().nodes.find(row => row.path === 'A.md').sourcePaths, ['讲义.pdf']);
  const old = store.read({ path: 'A.md' });
  store.save({ path: old.path, expectedRevision: old.revision, content: old.content.replace('已建立的联系', '待探索的联系') });
  assert.equal(kinds(store, 'association').find(edge => !edge.context).style, 'dashed');
  assert.equal(kinds(store, 'source').length, 1);
});

test('relation declarations exclude code, hidden references, quotes, nested lists and non-root headings', t => {
  const excluded = [
    '```md\n## 前序依赖\n- [[A]]：示例。\n```',
    '<details><summary>教师参考</summary>\n\n## 前序依赖\n- [[A]]：参考。\n\n</details>',
    '> ## 前序依赖\n> - [[A]]：引用。',
    '## 前序依赖\n- 父列表\n  - [[A]]：嵌套。',
    '### 前序依赖\n- [[A]]：非根。',
    '## 前序依赖\n#### 补充\n- [[A]]：四级不声明共同前序。',
    '## 前序依赖\n- `[[A]]`：行内代码。',
    '## 前序依赖\n- \\[[A]]：转义。',
    '<!--\n## 前序依赖\n- [[A]]：注释。\n-->',
  ];
  const files = { 'A.md': document('concept'), '合法.md': document('method', '## 前序依赖\n- [[A]]：实际用途。') };
  excluded.forEach((body, index) => { files[`隐藏${index}.md`] = document('method', body); });
  files['模板/伪实体.md'] = document('concept', '## 前序依赖\n- [[A]]：模板。');
  files['导读.md'] = document('concept', '## 前序依赖\n- [[A]]：导读。');
  const { store } = fixture(t, files);
  assert.deepEqual(kinds(store, 'prerequisite').map(edge => edge.target), ['合法.md']);
});

test('details-looking HTML attributes and custom elements do not hide real declarations that follow', t => {
  const files = { 'A.md': document('concept') };
  for (const [name, html] of [
    ['属性', '<div title="<details>">普通 HTML</div>'],
    ['自定义', '<details-example>普通自定义元素'],
    ['脚本', '<script>const example = "<details>";</script>'],
  ]) files[`${name}.md`] = document('method', `${html}\n\n## 前序依赖\n- [[A]]：可见的实际用途。`);
  const { store } = fixture(t, files);
  assert.deepEqual(kinds(store, 'prerequisite').map(edge => edge.target).sort(), ['属性.md', '自定义.md', '脚本.md'].sort());
});

test('entity move, deletion, type changes and new ambiguity invalidate projections without rewriting references', t => {
  const original = document('exercise', '## 内容\n原文不改。', ['[[卡片/A]]', '[[A|短名]]']);
  const { root, store } = fixture(t, { '卡片/A.md': document('concept'), '例子.md': original });
  assert.equal(kinds(store, 'example').length, 1);
  assert.equal(store.query({ tags: ['[[卡片/A.md]]'] }).total, 1);
  renameSync(join(root, '卡片/A.md'), join(root, '卡片/新名.md')); store.scan();
  assert.equal(kinds(store, 'example').length, 0);
  assert.equal(store.query({ paths: ['例子.md'] }).documents[0].knowledgeTags.length, 0);
  writeFileSync(join(root, 'A.md'), document('concept')); store.update('A.md');
  assert.deepEqual(store.query({ paths: ['例子.md'] }).documents[0].knowledgeTags.map(tag => tag.target), ['A.md'], 'explicit missing path must not reattach by basename');
  writeFileSync(join(root, '卡片/A.md'), document('method')); store.update('卡片/A.md');
  assert.deepEqual(store.query({ paths: ['例子.md'] }).documents[0].knowledgeTags.map(tag => tag.raw), ['[[卡片/A]]'], 'local short name must still reject global ambiguity');
  const entity = store.read({ path: '卡片/A.md' });
  store.save({ path: entity.path, expectedRevision: entity.revision, content: document('exercise') });
  assert.equal(kinds(store, 'example').length, 0);
  unlinkSync(join(root, 'A.md')); store.update('A.md');
  assert.equal(store.query({ paths: ['例子.md'] }).documents[0].knowledgeTags.length, 0);
  assert.equal(readFileSync(join(root, '例子.md'), 'utf8'), original);
});

test('projection rebuild and reopened cache preserve relation identities and isolate returned metadata', async t => {
  const files = { 'A.md': document('concept'), 'B.md': document('method', '## 前序依赖\n- [[A]]：用途。'), '例子.md': document('exercise', '', ['[[A|别名]]']) };
  const { root, store, cachePath } = fixture(t, files, true);
  const graph = store.graph(), ids = graph.edges.map(edge => edge.id).sort();
  assert.ok(graph.nodes.find(row => row.path === '例子.md').knowledgeTags);
  graph.nodes.find(row => row.path === '例子.md').knowledgeTags[0].target = 'FAKE.md';
  store.query({ paths: ['例子.md'] }).documents[0].knowledgeTags[0].label = 'FAKE';
  assert.equal(store.graph().nodes.find(row => row.path === '例子.md').knowledgeTags[0].target, 'A.md');
  assert.equal(store.query({ paths: ['例子.md'] }).documents[0].knowledgeTags[0].label, '别名');
  await store.close();
  const db = new DatabaseSync(cachePath);
  db.exec('UPDATE cache_meta SET projection_version=12'); db.close();
  const rebuilt = createVaultStore({ root, cachePath });
  assert.deepEqual(rebuilt.graph().edges.map(edge => edge.id).sort(), ids);
  assert.ok(rebuilt.metrics.fileReads > 0);
  await rebuilt.close();
  const reopened = createVaultStore({ root, cachePath });
  t.after(() => reopened.close());
  assert.equal(reopened.metrics.fileReads, 0);
  assert.deepEqual(reopened.graph().edges.map(edge => edge.id).sort(), ids);
});
