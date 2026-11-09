import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVaultStore } from '../vault-indexer.js';

test('revisit candidates project current student questions without formal review or import debt', async t => {
  const root = await mkdtemp(join(tmpdir(), 'notara-revisit-'));
  const store = createVaultStore({ root, cachePath: ':memory:' });
  t.after(async () => { await store.close(); await rm(root, { recursive: true, force: true }); });
  const card = (body, fields = '') => `---\ntype: concept\ntitle: 求导与判号\n${fields}---\n## 内容\n求导后如何判断符号？\n${body}`;
  const question = '如果导数不能因式分解，能不能换一个比较方式？' + '保留完整条件。'.repeat(80);
  await writeFile(join(root, '讨论.md'), card(`## 学生理解\n经老师提示，学生提出先因式分解再判号。\n### 下次探讨\n- [ ] ${question}\n- [x] 已解决的问题\n`));
  await writeFile(join(root, '导入.md'), card('## 参考理解\n老师说明了如何判号。\n## 学生理解\n<!-- 等实际讨论后记录 -->\n### 下次探讨\n- 备课时准备的问题\n'));
  await writeFile(join(root, '归档.md'), card('## 学生理解\n已经讨论。\n### 下次探讨\n旧问题\n', 'status: archived\n'));
  await store.scan();
  const home = store.homeRecommendations();
  assert.equal(home.due.total, 0);
  assert.equal(home.revisits.length, 1);
  assert.equal(home.revisits[0].path, '讨论.md');
  assert.equal(home.revisits[0].snippet, question, 'whole semantic content, no character clipping');
  assert.equal(store.read({ path: '讨论.md' }).content.includes('review_history'), false);
  assert.deepEqual(store.homeRecommendations().revisits, home.revisits, 'projection does not accumulate duplicates');
  const before = store.read({ path: '讨论.md' });
  store.save({ path: before.path, expectedRevision: before.revision, content: card('## 学生理解\n已更正并解决原问题。\n### 下次探讨\n- [x] 已解决的问题\n') });
  assert.deepEqual(store.homeRecommendations().revisits, []);
  assert.equal(store.homeRecommendations().followUp, null, 'resolved or imported prompts must not leak through legacy fallback');
});
