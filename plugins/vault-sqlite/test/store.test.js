import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, symlinkSync, rmSync, unlinkSync, linkSync, statSync, realpathSync, utimesSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVaultStore } from '../vault-indexer.js';

const card = '---\ntype: card\ntitle: 数学\ntags: [数学, 代数]\ncustom: "keep me" # comment\n---\n# 数学\n## 参考理解\n[[B]]\n## 学生理解\n### 已建立的联系\n- [[B]]：学生经提示说明了二者的关系。\n';
test('proposal retry returns its receipt before CAS, changed cards and targeted undo are guarded', t => {
  const { store } = fixture(t, { 'A.md': card });
  const doc = store.read({ path: 'A.md' });
  const input = { path: 'A.md', source: { messageId: 'm1', index: 2 }, result: 'done', support: 'hint', keyStep: '关键步', note: '真实作答', expectedRevision: doc.revision };
  const saved = store.recordReview(input);
  assert.deepEqual(store.recordReview(input), saved);
  assert.equal(store.query({}).documents[0].reviewCount, 1);
  assert.throws(() => store.recordReview({ ...input, support: 'independent' }), /proposal_conflict/);
  assert.throws(() => store.recordReview({ ...input, source: { messageId: 'm2', index: 0 } }), /revision_conflict/);
  assert.throws(() => store.recordReview({ ...input, source: { messageId: 'm2', index: 0 }, expectedRevision: undefined }), /revision_required/);
  assert.throws(() => store.undoReview({ path: 'A.md', expectedRecordId: 'not-this-review' }), /record_conflict/);
  store.undoReview({ path: 'A.md', expectedRevision: saved.revision });
  assert.throws(() => store.recordReview(input), /proposal_reverted/);
  assert.equal(store.query({}).documents[0].reviewCount, 0);
});
function fixture(t, files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'notara-sqlite-'));
  for (const [path, content] of Object.entries(files)) { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), content); }
  const store = createVaultStore({ root, now: () => new Date('2026-10-24T12:00:00+08:00') });
  t.after(async () => { await store.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, store };
}
test('continuations are CAS-bound, retryable, scoped by diary heading and visible after restart',async t=>{
 const path='日记/2026-10-24.md',body='---\ntype: diary\n---\n## 循环边界\n学生修正了起点。\n## 阅读发现\n学生提出疑问。\n';
 const {root,store}=fixture(t,{[path]:body});
 const followUp={question:'空列表是否还走入循环？',afterDays:0,reason:'再用边界例子追问一次'};
 const input={path,heading:'循环边界',followUp,requestId:'first',expectedRevision:store.read({path}).revision};
 const saved=store.scheduleReview(input);assert.deepEqual(store.scheduleReview(input),saved);
 assert.throws(()=>store.scheduleReview({...input,requestId:'new'}),/revision_conflict/);
 assert.throws(()=>store.scheduleReview({...input,followUp:null}),/proposal_conflict/);
 assert.throws(()=>store.scheduleReview({...input,requestId:'new',expectedRevision:undefined}),/revision_required/);
 const second=store.scheduleReview({...input,heading:'阅读发现',requestId:'second',followUp:{...followUp,afterDays:6},expectedRevision:saved.revision});
 const document=store.query({view:'review',reviewStatus:'due'}).documents[0];assert.equal(document.path,path);assert.equal(document.reviewCount,0);assert.equal(document.reviewPlans.length,2);assert.equal(document.reviewDue,'2026-10-24');
 document.reviewPlans[0].question='polluted';document.reviewPlans.push({heading:'fake'});
 assert.equal(store.query({}).documents[0].reviewPlans.length,2);assert.equal(store.query({}).documents[0].reviewPlans[0].question,followUp.question);
 assert.equal(store.homeRecommendations().due.cards[0].path,path);
 const reopened=createVaultStore({root,now:()=>new Date('2026-10-24T12:00:00+08:00')});t.after(()=>reopened.close());
 assert.deepEqual(reopened.scheduleReview(input),second);assert.equal(reopened.query({view:'review',reviewStatus:'due'}).documents[0].reviewPlans.length,2);
 reopened.scheduleReview({path,heading:'循环边界',followUp:null,expectedRevision:second.revision});
 assert.equal(reopened.query({view:'review',reviewStatus:'due'}).total,0);assert.equal(reopened.query({}).documents[0].reviewDue,'2026-10-30');
 reopened.undoReview({path});assert.equal(reopened.query({view:'review',reviewStatus:'due'}).total,1);
 assert.equal(reopened.query({}).documents[0].reviewCount,0);
});
for (const status of ['draft', 'completed', 'archived', 'paused']) {
  test(`home recommendations prefer the active route over a newer ${status} route`, t => {
    const route = (title, state) => `---\ntype: route\nstatus: ${state}\n---\n# ${title}\n## 下一步行动\n- 当前下一步：${title}的课堂\n`;
    const { root, store } = fixture(t, {
      '路线/当前.md': route('当前路线', 'active'),
      '路线/其他.md': route('其他路线', status),
    });
    utimesSync(join(root, '路线/当前.md'), new Date('2026-10-20'), new Date('2026-10-20'));
    utimesSync(join(root, '路线/其他.md'), new Date('2026-10-24'), new Date('2026-10-24'));
    store.scan();
    assert.equal(store.homeRecommendations().route?.path, '路线/当前.md');
    unlinkSync(join(root, '路线/当前.md'));
    store.scan();
    assert.equal(store.homeRecommendations().route, null, 'an inactive route cannot become a fallback action');
  });
}
test('route and lesson templates remain in the library but never become learning plans or home actions', t => {
  const routeTemplate = readFileSync(new URL('../../../templates/base-files/route.md', import.meta.url), 'utf8');
  const lessonTemplate = readFileSync(new URL('../../../templates/base-files/lesson.md', import.meta.url), 'utf8');
  const files = {
    '模板/路线.md': routeTemplate,
    '模板/备课.md': lessonTemplate,
    '个人路线模板.md': routeTemplate,
    '个人备课模板.md': lessonTemplate,
  };
  const { root, store } = fixture(t, files);
  assert.equal(store.query({}).total, 4, 'templates remain ordinary accessible files');
  assert.deepEqual(store.query({ view: 'lessons' }).documents, []);
  assert.deepEqual(store.query({ view: 'routes' }).documents, []);
  assert.equal(store.homeRecommendations().route, null);
  for (const [path, content] of Object.entries(files)) assert.equal(readFileSync(join(root, path), 'utf8'), content);
});
test('routes without a status retain their legacy active behavior', t => {
  const { store } = fixture(t, {
    '路线/旧路线.md': '---\ntype: route\n---\n# 旧路线\n## 下一步行动\n- 当前下一步：继续现有课堂\n',
  });
  assert.equal(store.homeRecommendations().route?.path, '路线/旧路线.md');
});
test('home guide recommendations and counts exclude teacher references and folded tasks', t => {
  const content = '# 导读\n## 教师参考\n- [ ] 内部提示\n- [x] 内部核验\n## 学习任务\n<details>\n<summary>旧任务</summary>\n\n- [ ] 折叠的任务\n- [x] 折叠的完成项\n\n</details>\n\n- [x] 学生已做\n- [ ] 学生下一步\n';
  const { store, root } = fixture(t, { '导读.md': content });
  const guide = store.homeRecommendations().guide;
  assert.equal(guide.total, 2);
  assert.equal(guide.completed, 1);
  assert.deepEqual(guide.nextTask, { line: 15, text: '学生下一步' });
  store.toggleTask({ path: guide.path, line: guide.nextTask.line, checked: true, expectedText: guide.nextTask.text });
  assert.equal(store.homeRecommendations().guide.nextTask, null);
  assert.equal(store.homeRecommendations().guide.completed, 2);
  assert.equal(readFileSync(join(root, guide.path), 'utf8'), content.replace('- [ ] 学生下一步', '- [x] 学生下一步'));
});
test('Base cards receive only explicit string summaries independent of visible columns and legacy preview flags', t => {
  const {store}=fixture(t,{
    '资料库.base':'views:\n  - name: 全部\n    type: cards\n    order: [file.name]\n    notara:\n      cardPreview: true\n',
    'A.md':'---\nsummary: "  说明主题与用途。  "\n---\n正文不应成为简介\n',
    'B.md':'---\nsummary: [错误的摘要类型]\n---\n不能回退到这段正文\n',
    'C.md':'没有摘要时不显示正文\n',
  });
  const docs=store.query({base:{path:'资料库.base',view:0}}).documents;
  assert.equal(docs.find(d=>d.path==='A.md').cardSummary,'说明主题与用途。');
  for(const path of ['B.md','C.md'])assert.equal(docs.find(d=>d.path===path).cardSummary,'');
  assert.equal(docs.find(d=>d.path==='A.md').frontmatter,undefined);
});
test('FTS, AND tags, solid precedence, guides and no read-path rescan', t => {
  const { store } = fixture(t, { 'A.md': card.replace('## 参考理解\n', '## 参考理解\n不应在卡片摘要揭开的解析\n'), 'B.md': card.replaceAll('数学', '几何'), '00-导读.md': '# 导读\n- [x] 已做\n- [ ] 下一步\n', 'dist/ignored.md': card });
  assert.equal(store.query({ tags: ['数学', '代数'], q: '数学' }).total, 1);
  assert.equal(store.query({ tags: ['数学', '不存在'] }).total, 0);
  assert.equal(store.query({tags:['数学','几何'],tagMatch:'all'}).total,0);
  assert.equal(store.query({tags:['数学','几何'],tagMatch:'any'}).total,2);
  assert.equal(store.query({tags:['数学','几何'],tagMatch:'any',q:'数学'}).total,1);
  assert.equal(store.query({tags:[],tagMatch:'any'}).total,3);
  assert.throws(()=>store.query({tags:['数学'],tagMatch:'invalid'}),/vault_input_invalid/);
  assert.equal(store.graph({tagFilter:['数学','几何'],tagMatch:'any'}).nodes.length,2);
  assert.equal(store.graph({tagFilter:['数学','几何'],tagMatch:'all'}).nodes.length,0);
  assert.equal(store.query({ tags: ['数学'] }).documents[0].summary.includes('不应在卡片摘要'), false);
  assert.equal(store.graph({ focusPath: 'A.md', hops: 1 }).edges[0].style, 'solid');
  assert.equal(store.homeRecommendations().guide.nextTask.line, 3);
  const before = { ...store.metrics };
  store.query({}); store.graph({}); store.homeRecommendations(); store.read({ path: 'A.md' });
  assert.equal(store.metrics.scans, before.scans);
  assert.equal(store.metrics.fileReads, before.fileReads + 1);
  const reads = store.metrics.fileReads;
  store.scan(); assert.equal(store.metrics.fileReads, reads);
});
test('CAS rejects stale and null overwrite; portable and symlink paths are blocked', t => {
  const { root, store } = fixture(t, { 'A.md': card });
  const doc = store.read({ path: 'A.md' });
  store.save({ path: 'A.md', content: card + 'new', expectedRevision: doc.revision });
  assert.throws(() => store.save({ path: 'A.md', content: 'bad', expectedRevision: doc.revision }), /revision_conflict/);
  assert.throws(() => store.save({ path: 'A.md', content: 'bad', expectedRevision: null }), /revision_conflict/);
  for (const path of ['../A.md', '/tmp/A.md', 'x\\A.md', 'CON.md', '.git/a.md']) assert.throws(() => store.read({ path }), /path/);
  symlinkSync(join(root, 'A.md'), join(root, 'link.md'));
  assert.throws(() => store.read({ path: 'link.md' }), /path/);
  linkSync(join(root, 'A.md'), join(root, 'hardlink.md'));
  assert.throws(() => store.read({ path: 'hardlink.md' }), /path/);
  unlinkSync(join(root, 'hardlink.md'));
  writeFileSync(join(root, 'A.md.notara-lock'), '');
  assert.throws(() => store.save({ path: 'A.md', content: 'bad', expectedRevision: store.read({ path: 'A.md' }).revision }), /vault_locked/);
});
test('CRLF task edits are exact, stale text rejected, no review schedule manufactured', t => {
  const content = '---\r\ntype: source\r\n---\r\n# 导读\r\n- [ ] 下一步\r\n';
  const { root, store } = fixture(t, { '导读.md': content });
  assert.throws(() => store.toggleTask({ path: '导读.md', line: 5, checked: true, expectedText: '过期' }), /task_conflict/);
  store.toggleTask({ path: '导读.md', line: 5, checked: true });
  assert.equal(readFileSync(join(root, '导读.md'), 'utf8'), content.replace('[ ]', '[x]'));
  assert.equal(store.query({}).documents[0].reviewDue, null);
});
test('code examples and YAML tasks are excluded; PDF reads are bounded base64; Canvas stays JSON', t => {
  const guide = '---\ntitle: 导读\nexample: |\n  - [ ] YAML example\n---\n````md\n- [ ] fenced example\n```\n- [ ] still fenced\n````\n- [ ] real task\n';
  const { store } = fixture(t, { '导读.md': guide, '来源.pdf': Buffer.from('%PDF-1.7\n'), '白板.canvas': '{"nodes":[],"edges":[]}' });
  assert.deepEqual(store.query({ view: 'guides' }).documents[0].tasks.map(task => task.line), [11]);
  assert.throws(() => store.toggleTask({ path: '导读.md', line: 7, checked: true }), /task_conflict/);
  const pdf = store.read({ path: '来源.pdf' });
  assert.equal(pdf.encoding, 'base64'); assert.equal(Buffer.from(pdf.content, 'base64').toString(), '%PDF-1.7\n');
  assert.equal(store.read({ path: '白板.canvas' }).mimeType, 'application/json');
  assert.throws(() => store.save({ path: '白板.canvas', content: '{', expectedRevision: null }));
});
test('drawing and Canvas preserve payloads, enforce CAS and reject invalid replacements; images stay binary', t => {
  const drawing = { type: 'excalidraw', version: 2, source: 'fixture', elements: [{ id: 'rect', type: 'rectangle', x: 10, y: 20, width: 90, height: 60 }], appState: { viewBackgroundColor: '#fff' }, files: {}, custom: { retain: true } };
  const canvas = { nodes: [{ id: 'file', type: 'file', file: '手绘.excalidraw', x: 0, y: 0, width: 300, height: 200, custom: 'node' }], edges: [], custom: 'document' };
  const { store } = fixture(t, { '手绘.excalidraw': JSON.stringify(drawing), '白板.canvas': JSON.stringify(canvas), '图片.png': Buffer.from([137, 80, 78, 71, 1, 2, 3]) });
  assert.equal(store.query({ type: 'drawing' }).documents[0].type, 'drawing');
  const read = store.read({ path: '手绘.excalidraw' });
  const content = JSON.stringify({ ...drawing, elements: [{ ...drawing.elements[0], x: 30 }] });
  store.save({ path: read.path, content, expectedRevision: read.revision });
  assert.equal(store.read({ path: read.path }).content, content);
  assert.throws(() => store.save({ path: read.path, content, expectedRevision: read.revision }), /revision_conflict/);
  const current = store.read({ path: read.path });
  assert.throws(() => store.save({ path: read.path, content: '{"elements":[]}', expectedRevision: current.revision }));
  assert.equal(store.read({ path: read.path }).content, content);
  const canvasRead = store.read({ path: '白板.canvas' });
  store.save({ path: canvasRead.path, content: JSON.stringify({ ...canvas, nodes: [{ ...canvas.nodes[0], x: 88 }] }), expectedRevision: canvasRead.revision });
  const updated = JSON.parse(store.read({ path: canvasRead.path }).content);
  assert.equal(updated.custom, 'document'); assert.equal(updated.nodes[0].custom, 'node');
  const image = store.read({ path: '图片.png' });
  assert.equal(image.mimeType, 'image/png'); assert.deepEqual(Buffer.from(image.content, 'base64'), Buffer.from([137, 80, 78, 71, 1, 2, 3]));
  assert.throws(() => store.save({ path: image.path, content: 'invalid text', expectedRevision: image.revision }), /content_invalid/);
});
test('P2-1 indented and inline code never create tasks or student-link evidence', t => {
  const { store } = fixture(t, {
    '00-导读.md': '# 导读\n\n    - [ ] 代码示例\n\n- [ ] 真实任务\n',
    '卡片/A.md': '## 学生理解\n`[[C]]`\n`` [[C]] `literal` ``\n\\[[C]]\n\n    [[C]]\n', 'C.md': '# C\n',
  });
  assert.equal(store.homeRecommendations().guide.total, 1);
  assert.equal(store.homeRecommendations().guide.nextTask.line, 5);
  assert.throws(() => store.toggleTask({ path: '00-导读.md', line: 3, checked: true }), /task_conflict/);
  assert.equal(store.graph({}).edges.length, 0);
});
test('real nested list tasks remain indexable and editable despite indentation', t => {
  const { store } = fixture(t, { '导读.md': '# 导读\n- [ ] 外层\n    - [ ] 内层\n\n1. [ ] 编号任务\n' });
  assert.equal(store.homeRecommendations().guide.total, 3);
  store.toggleTask({ path: '导读.md', line: 3, checked: true, expectedText: '内层' });
  store.toggleTask({ path: '导读.md', line: 5, checked: true, expectedText: '编号任务' });
  assert.equal(store.homeRecommendations().guide.completed, 2);
});
test('UI-2 summary excludes original solution details including nested and incomplete tags', t => {
  const bodies = [
    '问题\n<details><summary>查看原解</summary>ORIGINAL_SOLUTION_42</details>\n仍可见的问题',
    '问题\n<DETAILS open><summary>原解</summary>外层答案<details>内层答案</details>ORIGINAL_SOLUTION_42</DETAILS>',
    '问题\n<details><summary>原解</summary>ORIGINAL_SOLUTION_42',
    '问题\n<details title="未闭合 ORIGINAL_SOLUTION_42',
  ];
  const files = Object.fromEntries(bodies.map((body, i) => [`${i}.md`, `---\ntype: card\n---\n## 内容\n${body}\n`]));
  const { store } = fixture(t, files);
  for (const document of store.query({}).documents) { assert.ok(document.summary.includes('问题')); assert.equal(document.summary.includes('ORIGINAL_SOLUTION_42'), false); assert.equal(document.summary.includes('内层答案'), false); }
  assert.ok(store.query({}).documents[0].summary.includes('仍可见的问题'));
  assert.ok(store.read({ path: '0.md' }).content.includes('ORIGINAL_SOLUTION_42'));
});
test('P2-2 local short links resolve without guessing ambiguous global basenames', t => {
  const { root, store } = fixture(t, { '卡片/A.md': '## 学生理解\n[[B]]\n', '卡片/B.md': '# B\n', '其他/B.md': '# Other B\n' });
  assert.equal(store.graph({ focusPath: '卡片/A.md' }).edges[0].target, '卡片/B.md');
  assert.equal(store.graph({ focusPath: '卡片/B.md' }).nodes.length, 2);
  unlinkSync(join(root, '卡片/B.md')); store.update('卡片/B.md');
  assert.equal(store.graph({}).edges[0].target, '其他/B.md');
  writeFileSync(join(root, '新B.md'), '# Not B\n'); store.update('新B.md');
  mkdirSync(join(root, '第三')); writeFileSync(join(root, '第三/B.md'), '# Ambiguous\n'); store.update('第三/B.md');
  assert.equal(store.graph({}).edges.length, 0);
});
test('P2-3 Chinese infix terms match complete indexed text without file rescans', t => {
  const { store } = fixture(t, { 'A.md': '# 理解导数的定义\n这里讲微积分基础\n', 'B.md': '# 代数\n这里讲导数和极限\n' });
  const before = { ...store.metrics };
  assert.equal(store.query({ q: '导数' }).total, 2);
  assert.equal(store.query({ q: '导数 微积分' }).total, 1);
  assert.equal(store.query({ q: '数' }).total, 2);
  assert.deepEqual(store.metrics, before);
});
test('P2-4 flow-style YAML card supports review and exact restoration without touching custom syntax', t => {
  const original = '---\r\n{type: card, learned: false, custom: "keep"}\r\n---\r\n## 内容\r\n问题\r\n';
  const { store } = fixture(t, { 'Flow.md': original });
  store.recordReview({ path: 'Flow.md', result: 'done', support: 'independent', keyStep: '判据', note: '尝试' });
  assert.equal(store.query({}).documents[0].independentReviewCount, 1);
  assert.ok(store.read({ path: 'Flow.md' }).content.includes('custom: "keep"'));
  store.undoReview({ path: 'Flow.md' });
  const restored = store.read({ path: 'Flow.md' }).content;
  assert.ok(restored.startsWith('---\r\n{type: card, learned: false, custom: "keep"'));
  assert.ok(restored.endsWith('## 内容\r\n问题\r\n'));
});
test('honest review, retained legacy unknown, exact before undo and YAML/body preservation', t => {
  const content = card.replaceAll('\n', '\r\n');
  const { store } = fixture(t, { 'A.md': content });
  assert.throws(() => store.recordReview({ path: 'A.md', result: 'done', keyStep: '关键步', note: '完成' }), /support/);
  store.recordReview({ path: 'A.md', result: 'done', support: 'hint', keyStep: '关键步', note: '提示后',followUp:{question:'再找出关键步',afterDays:1,reason:'这次仍需要提示'} });
  let doc = store.query({}).documents[0];
  assert.equal(doc.lastResult, 'done'); assert.equal(doc.independentReviewCount, 0);
  assert.equal(doc.reviewDue, '2026-10-25'); assert.equal(doc.lastSupport, 'hint');
  store.recordReview({ path: 'A.md', result: 'done', support: 'independent', keyStep: '关键步', note: '提前完成' });
  assert.equal(store.graph({}).nodes[0].independentReviewCount, 1);
  assert.equal(store.query({}).documents[0].reviewDue, '2026-10-25');
  store.undoReview({ path: 'A.md' }); store.undoReview({ path: 'A.md' });
  doc = store.query({}).documents[0]; assert.equal(doc.reviewCount, 0); assert.equal(doc.reviewDue, null);
  assert.equal(doc.lastResult, null); assert.equal(doc.independentReviewCount, 0);
  const saved = store.read({ path: 'A.md' }).content;
  assert.ok(saved.includes('custom: "keep me" # comment\r\n'));
  assert.ok(saved.endsWith(content.slice(content.indexOf('# 数学'))));
  assert.equal(saved.replaceAll('\r\n', '').includes('\n'), false);
});
test('watch updates add/change/unlink without a query scan, graph cache stays isolated', async t => {
  const { root, store } = fixture(t, { 'A.md': card });
  await store.startWatching();
  const scans = store.metrics.scans;
  async function eventually(check) {
    const deadline = Date.now() + 4000;
    while (!check()) { if (Date.now() > deadline) assert.fail('watch update timeout'); await new Promise(resolve => setTimeout(resolve, 30)); }
  }
  const cached = store.graph({}); cached.nodes[0].tags.push('polluted');
  assert.equal(store.graph({}).nodes[0].tags.includes('polluted'), false);
  writeFileSync(join(root, 'B.md'), '# B\n');
  await eventually(() => store.query({}).total === 2);
  assert.equal(store.graph({}).edges.length, 1);
  writeFileSync(join(root, 'B.md'), '# Changed\n');
  await eventually(() => store.query({ q: 'Changed' }).total === 1);
  unlinkSync(join(root, 'B.md'));
  await eventually(() => store.query({}).total === 1);
  assert.equal(store.graph({}).edges.length, 0);
  assert.equal(store.metrics.scans, scans);
});
test('persistent cache reuses unchanged metadata and refuses a different Vault root', async t => {
  const { root, store } = fixture(t, { 'A.md': card });
  const cachePath = join(root, 'index.sqlite');
  const first = createVaultStore({ root, cachePath }); await first.close();
  const second = createVaultStore({ root, cachePath });
  assert.equal(second.metrics.fileReads, 0); assert.equal(second.query({}).total, 1); await second.close();
  const other = mkdtempSync(join(tmpdir(), 'notara-other-'));
  t.after(() => rmSync(other, { recursive: true, force: true }));
  assert.throws(() => createVaultStore({ root: other, cachePath }), /cache_root_mismatch/);
  const reads = store.metrics.fileReads; store.read({ path: 'A.md' }); assert.equal(store.metrics.fileReads, reads + 1);
});
test('legacy cache migration repairs old Markdown facts once at startup and preserves explicit evidence', async t => {
  const { root } = fixture(t, { 'A.md': card });
  const cachePath = join(root, 'legacy.sqlite'), db = new DatabaseSync(cachePath);
  const fields = { type: 'card', review_history: [{ result: 'done', support: 'independent' }, { result: 'done' }, { result: 'done', support: 'independent', revertedAt: '2026-10-24T00:00:00Z' }, { result: 'missed', support: 'independent' }] };
  const body = '# 理解导数的定义\n完整正文里的微积分\n## 学生理解\n`[[A]]`\n';
  writeFileSync(join(root, 'A.md'), `---\ntype: card\nreview_history: ${JSON.stringify(fields.review_history)}\n---\n${body}`);
  const stat = statSync(join(root, 'A.md'));
  db.exec(`CREATE TABLE cache_meta(root TEXT); CREATE TABLE documents(path TEXT PRIMARY KEY,mtime_ms REAL,size INTEGER,revision TEXT,title TEXT,type TEXT,tags_json TEXT,frontmatter_json TEXT,review_due TEXT,review_count INTEGER,last_support TEXT,summary TEXT,is_guide INTEGER);
    CREATE VIRTUAL TABLE documents_fts USING fts5(path,title,tags,body,tokenize='unicode61');`);
  db.prepare('INSERT INTO cache_meta VALUES(?)').run(realpathSync(root));
  db.prepare('INSERT INTO documents(rowid,path,mtime_ms,size,revision,title,type,tags_json,frontmatter_json,review_count) VALUES(?,?,?,?,?,?,?,?,?,?)').run(7, 'A.md', stat.mtimeMs, stat.size, 'a'.repeat(64), '理解导数的定义', 'card', '[]', JSON.stringify(fields), 3);
  db.prepare('INSERT INTO documents_fts(rowid,path,title,tags,body) VALUES(?,?,?,?,?)').run(99, 'A.md', '理解导数的定义', '', '完整正文里的微积分');
  db.close();
  const migrated = createVaultStore({ root, cachePath }); t.after(() => migrated.close());
  assert.equal(migrated.metrics.fileReads, 1);
  const result = migrated.query({ q: '导数 微积分' });
  assert.equal(result.total, 1); assert.equal(result.documents[0].lastResult, 'missed'); assert.equal(result.documents[0].independentReviewCount, 1);
  assert.equal(migrated.graph({}).edges.length, 0);
  const reopened = createVaultStore({ root, cachePath }); assert.equal(reopened.metrics.fileReads, 0); await reopened.close();
  const before = migrated.read({ path: 'A.md' });
  migrated.save({ path: 'A.md', content: card + '\n替换正文', expectedRevision: before.revision });
  assert.equal(migrated.query({ q: '微积分' }).total, 0);
  assert.equal(migrated.query({ q: '替换' }).total, 1);
});

test('guides, routes, and lessons keep distinct classifications and reading tasks never count as route milestones', t => {
  const { store } = fixture(t, {
    '00-资料导读.md': '---\ntype: source\ntags: [导读]\n---\n# 极值点偏移资料导读\n- [x] 阅读第一节\n- [ ] 阅读第二节\n',
    '路线/极值点偏移导读路线.md': '---\ntype: route\nstatus: active\ntags: [导读]\n---\n# 极值点偏移学习路线\n## 里程碑与校验\n- [ ] 里程碑 1：独立识别双变量函数值相等信号\n<details data-notara="teacher"><summary>教师规划说明</summary>\n\n- [ ] 内部规划待办\n\n</details>\n',
    '备课/极值点偏移第一课.md': '---\ntype: lesson\nstatus: active\ntags: [导读]\n---\n# 极值点偏移第一课\n- [ ] 任务 1：求单调区间\n<details data-notara="teacher"><summary>教师参考</summary>\n\n- [ ] 内部提示链\n\n</details>\n',
    '模板/个人模板.md': '---\ntemplate: true\ntitle: 导读模板\n---\n# 导读模板\n- [ ] 模板示例\n',
  });
  assert.deepEqual(store.query({ view: 'guides' }).documents.map(d => d.path), ['00-资料导读.md']);
  assert.deepEqual(store.query({ type: 'guide' }).documents.map(d => d.path), ['00-资料导读.md']);
  assert.deepEqual(store.query({ view: 'routes' }).documents.map(d => d.path), ['路线/极值点偏移导读路线.md']);
  assert.deepEqual(store.query({ view: 'lessons' }).documents.map(d => d.path), ['备课/极值点偏移第一课.md']);
  assert.equal(store.query({ view: 'routes' }).documents[0].tasks.length, 1);
  assert.equal(store.query({ view: 'lessons' }).documents[0].tasks.length, 1);

  const rec = store.homeRecommendations();
  assert.equal(rec.guide.path, '00-资料导读.md');
  assert.equal(rec.guide.completed, 1);
  assert.equal(rec.route.path, '路线/极值点偏移导读路线.md');
  assert.equal(rec.route.completed, 0, 'completed reading-guide tasks must never be counted as route milestones');
  assert.equal(rec.route.total, 1);
  assert.equal(rec.route.nextMilestone.text, '里程碑 1：独立识别双变量函数值相等信号');
});
