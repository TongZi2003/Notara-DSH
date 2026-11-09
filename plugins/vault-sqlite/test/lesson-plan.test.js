import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createVaultStore } from '../vault-indexer.js';
import {
  anchorLessonTasks,
  clearCurrentLessonTask,
  projectLessonPlan,
  setCurrentLessonTask,
  toggleLessonTask,
} from '../lesson-plan.js';

const SAMPLE_LESSON = [
  '---',
  'type: lesson',
  'status: ready',
  'route: "[[路线/导数进阶路线.md]]"',
  'milestone: M1',
  '---',
  '# 第一课：极值点偏移基础',
  '',
  '## 本课目标',
  '- 建立对称化构造直觉',
  '',
  '## 课堂任务',
  '- [ ] 热身：判断极值点两侧单调性',
  '- [ ] 主例题：完成对称函数构造与求导',
  '- [ ] 变式：独立检验比值换元条件',
  '',
  '```markdown',
  '- [ ] 代码块里的伪任务不应进入本课清单',
  '```',
  '',
  '<details data-notara="teacher">',
  '<summary>教师参考（默认折叠）</summary>',
  '',
  '- [ ] 教师暗线检查项：不要提前揭示对数均值不等式',
  '- [x] 教师已完成备课核对',
  '</details>',
  '',
].join('\n');

for (const operation of ['anchor', 'toggle']) {
  test(`lesson-plan ${operation} never resurrects current_task after a same-title task is deleted and recreated`, async t => {
    const root = mkdtempSync(join(tmpdir(), 'notara-lesson-recreated-'));
    const path = '重建.md';
    const hidden = [
      '```markdown', '- [ ] 同名任务', '```',
      '<details data-notara="teacher">', '- [ ] 同名任务', '</details>', '',
    ].join('\r\n');
    writeFileSync(join(root, path), [
      '---', 'type: lesson', '---', '# 同名重建',
      '- [ ] 同名任务', '- [ ] 同名任务', '- [ ] 保留合法锚点 <!-- notara-task:keep-id -->', hidden,
    ].join('\r\n'));
    const store = createVaultStore({ root });
    t.after(async () => { await store.close(); rmSync(root, { recursive: true, force: true }); });
    const anchored = anchorLessonTasks(store, { path });
    const oldId = anchored.tasks[0].id;
    const keptId = anchored.tasks[1].id;
    const active = setCurrentLessonTask(store, { path, taskId: oldId, expectedRevision: anchored.revision });
    const activeDoc = store.read({ path });
    const removed = activeDoc.content.replace(`- [ ] 同名任务 <!-- notara-task:${oldId} -->\r\n`, '');
    const deleted = store.save({ path, content: removed, expectedRevision: active.revision });
    assert.equal(projectLessonPlan(store.read({ path })).staleCurrentTask, true);
    const recreated = removed.replace('# 同名重建\r\n', '# 同名重建\r\n- [ ] 同名任务\r\n');
    const saved = store.save({ path, content: recreated, expectedRevision: deleted.revision });
    const before = projectLessonPlan(store.read({ path }));
    const rebuilt = operation === 'anchor'
      ? anchorLessonTasks(store, { path, expectedRevision: saved.revision })
      : toggleLessonTask(store, { path, line: before.tasks[0].line, checked: false, expectedText: '同名任务', expectedRevision: saved.revision });
    assert.notEqual(rebuilt.tasks[0].id, oldId, 'a new task must not inherit the deleted current task identity');
    assert.notEqual(rebuilt.tasks[0].id, keptId);
    assert.deepEqual(rebuilt.tasks.slice(1).map(task => task.id), [keptId, 'keep-id']);
    assert.equal(rebuilt.currentTask, null);
    assert.equal(rebuilt.staleCurrentTask, true);
    assert.deepEqual(rebuilt.tasks.map(task => task.status), ['pending', 'pending', 'pending']);
    const rebuiltDoc = store.read({ path });
    assert.equal(rebuiltDoc.content.replaceAll('\r\n', '').includes('\n'), false, 'preserve every CRLF');
    assert.ok(rebuiltDoc.content.endsWith(hidden), 'leave code and teacher reference bytes unchanged');
    assert.equal(anchorLessonTasks(store, { path }).revision, rebuilt.revision, 'repeated anchoring keeps the fresh ID');
    const selected = setCurrentLessonTask(store, { path, taskId: rebuilt.tasks[0].id, expectedRevision: rebuilt.revision });
    assert.equal(selected.currentTask?.id, rebuilt.tasks[0].id);
    assert.equal(selected.staleCurrentTask, false);
  });
}

test('lesson-plan rejects projection and every task mutation on an unchanged lesson template', async t => {
  const root = mkdtempSync(join(tmpdir(), 'notara-lesson-template-'));
  const path = '备课模板.md';
  const content = readFileSync(new URL('../../../templates/base-files/lesson.md', import.meta.url), 'utf8');
  writeFileSync(join(root, path), content);
  const store = createVaultStore({ root });
  t.after(async () => { await store.close(); rmSync(root, { recursive: true, force: true }); });
  const doc = store.read({ path });
  const line = content.split('\n').findIndex(row => row.startsWith('- [ ]')) + 1;
  const input = { path, line, checked: true, expectedText: content.split('\n')[line - 1].slice(6), expectedRevision: doc.revision };
  for (const mutation of [anchorLessonTasks, setCurrentLessonTask, clearCurrentLessonTask, toggleLessonTask]) {
    assert.throws(() => mutation(store, input), /vault_lesson_type_required/);
    assert.equal(store.read({ path }).content, content);
  }
  assert.throws(() => projectLessonPlan(doc), /vault_lesson_type_required/);
});

test('lesson-plan anchors only public tasks, excludes teacher details and code blocks, and projects 3-state status accurately', async t => {
  const root = mkdtempSync(join(tmpdir(), 'notara-lesson-plan-1-'));
  writeFileSync(join(root, '第一课.md'), SAMPLE_LESSON);
  const store = createVaultStore({ root });
  t.after(async () => {
    await store.close();
    rmSync(root, { recursive: true, force: true });
  });

  // Anchoring writes deterministic <!-- notara-task:lt-... --> only on public tasks, never inside code or teacher blocks.
  const initial = anchorLessonTasks(store, { path: '第一课.md' });
  const rawAnchored = store.read({ path: '第一课.md' }).content;
  assert.match(rawAnchored, /热身：判断极值点两侧单调性 <!-- notara-task:lt-[0-9a-f]{8} -->/);
  assert.match(rawAnchored, /主例题：完成对称函数构造与求导 <!-- notara-task:lt-[0-9a-f]{8} -->/);
  assert.match(rawAnchored, /变式：独立检验比值换元条件 <!-- notara-task:lt-[0-9a-f]{8} -->/);
  assert.doesNotMatch(rawAnchored, /代码块里的伪任务不应进入本课清单 <!-- notara-task:/);
  assert.doesNotMatch(rawAnchored, /教师暗线检查项.*notara-task:/);

  // Re-anchoring is idempotent (same revision, no extra write).
  const again = anchorLessonTasks(store, { path: '第一课.md' });
  assert.equal(again.revision, initial.revision);

  // Without current_task, unchecked items stay pending (never guessed as in_progress) and nextTask points to first pending.
  assert.deepEqual(initial.counts, { total: 3, completed: 0, inProgress: 0, pending: 3 });
  assert.equal(initial.progressLabel, '待处理 3');
  assert.equal(initial.currentTask, null);
  assert.equal(initial.nextTask?.content, '热身：判断极值点两侧单调性');
  assert.deepEqual(initial.tasks.map(row => [row.content, row.status]), [
    ['热身：判断极值点两侧单调性', 'pending'],
    ['主例题：完成对称函数构造与求导', 'pending'],
    ['变式：独立检验比值换元条件', 'pending'],
  ]);

  // Setting current_task marks only that explicit item in_progress.
  const task2 = initial.tasks[1];
  const active = setCurrentLessonTask(store, {
    path: '第一课.md',
    line: task2.line,
    expectedText: task2.expectedText,
    expectedRevision: initial.revision,
  });
  assert.equal(active.currentTask?.id, task2.id);
  assert.deepEqual(active.counts, { total: 3, completed: 0, inProgress: 1, pending: 2 });
  assert.equal(active.progressLabel, '进行中 1 · 待处理 2');
  assert.deepEqual(active.tasks.map(row => row.status), ['pending', 'in_progress', 'pending']);

  // Completing task-1 and task-2 clears current_task when the active task is checked, and nextTask advances to task-3.
  const done1 = toggleLessonTask(store, {
    path: '第一课.md',
    line: active.tasks[0].line,
    checked: true,
    expectedText: active.tasks[0].expectedText,
    expectedRevision: active.revision,
  });
  assert.equal(done1.progressLabel, '已完成 1 · 进行中 1 · 待处理 1');

  const done2 = toggleLessonTask(store, {
    path: '第一课.md',
    line: done1.tasks[1].line,
    checked: true,
    expectedText: done1.tasks[1].expectedText,
    expectedRevision: done1.revision,
  });
  assert.deepEqual(done2.counts, { total: 3, completed: 2, inProgress: 0, pending: 1 });
  assert.equal(done2.currentTask, null);
  assert.equal(done2.staleCurrentTask, false);
  assert.equal(done2.nextTask?.content, '变式：独立检验比值换元条件');
  assert.equal(done2.progressLabel, '已完成 2 · 待处理 1');

  // Reopen task-2, set current by taskId, then clearCurrentLessonTask explicitly.
  const reopened2 = toggleLessonTask(store, {
    path: '第一课.md',
    line: done2.tasks[1].line,
    checked: false,
    expectedText: done2.tasks[1].content,
    expectedRevision: done2.revision,
  });
  const currentById = setCurrentLessonTask(store, {
    path: '第一课.md',
    taskId: reopened2.tasks[1].id,
    expectedRevision: reopened2.revision,
  });
  assert.equal(currentById.currentTask?.id, reopened2.tasks[1].id);
  const cleared = clearCurrentLessonTask(store, { path: '第一课.md', expectedRevision: currentById.revision });
  assert.equal(cleared.currentTask, null);
  assert.equal(cleared.inProgressCount ?? cleared.counts.inProgress, 0);
});

test('lesson-plan handles CRLF, task insertion/reordering/deletion, duplicate titles, duplicate anchors, and store CAS', async t => {
  const root = mkdtempSync(join(tmpdir(), 'notara-lesson-plan-2-'));
  const crlfLesson = [
    '---',
    'type: lesson',
    '---',
    '# 重复标题与重排测试',
    '',
    '- [ ] 独立推导关键步',
    '- [ ] 独立推导关键步',
  ].join('\r\n') + '\r\n';
  writeFileSync(join(root, '重排课.md'), crlfLesson);
  writeFileSync(join(root, '普通卡片.md'), '---\ntype: card\n---\n# 普通卡片\n- [ ] 练习\n');

  const store = createVaultStore({ root });
  t.after(async () => {
    await store.close();
    rmSync(root, { recursive: true, force: true });
  });

  const anchored = anchorLessonTasks(store, { path: '重排课.md' });
  const anchoredDoc = store.read({ path: '重排课.md' });
  assert.ok(anchoredDoc.content.includes('\r\n'), 'CRLF line endings are preserved');
  assert.notEqual(anchored.tasks[0].id, anchored.tasks[1].id, 'duplicate task titles receive distinct deterministic anchors');

  // Indexed task text in SQLite stays clean (without raw <!-- notara-task:... --> comment).
  const indexed = store.query({ view: 'lessons' }).documents[0];
  assert.deepEqual(indexed.tasks.map(row => row.text), ['独立推导关键步', '独立推导关键步']);

  const firstId = anchored.tasks[0].id;
  const secondId = anchored.tasks[1].id;

  // Insert a new task in front and swap the two identically-named tasks; current_task follows secondId!
  const reordered = [
    '---',
    'type: lesson',
    `current_task: ${secondId}`,
    '---',
    '# 重复标题与重排测试',
    '',
    '- [ ] 新增前置检查',
    `- [ ] 独立推导关键步 <!-- notara-task:${secondId} -->`,
    `- [ ] 独立推导关键步 <!-- notara-task:${firstId} -->`,
  ].join('\r\n') + '\r\n';
  const savedReorder = store.save({ path: '重排课.md', content: reordered, expectedRevision: anchored.revision });
  const reanchored = anchorLessonTasks(store, { path: '重排课.md', expectedRevision: savedReorder.revision });
  assert.equal(reanchored.currentTask?.id, secondId);
  assert.equal(reanchored.currentTask?.line, 8);
  assert.deepEqual(reanchored.tasks.map(row => [row.id, row.status]), [
    [reanchored.tasks[0].id, 'pending'],
    [secondId, 'in_progress'],
    [firstId, 'pending'],
  ]);

  // Toggle line 9 (firstId) specifically even though line 8 has identical clean text.
  const toggledFirst = toggleLessonTask(store, {
    path: '重排课.md',
    line: 9,
    checked: true,
    expectedText: '独立推导关键步',
    expectedRevision: reanchored.revision,
  });
  assert.deepEqual(toggledFirst.tasks.map(row => [row.id, row.checked, row.status]), [
    [reanchored.tasks[0].id, false, 'pending'],
    [secondId, false, 'in_progress'],
    [firstId, true, 'completed'],
  ]);

  // Deleting the uncompleted task referenced by current_task marks staleCurrentTask=true without guessing another in_progress item.
  const toggledFirstDoc = store.read({ path: '重排课.md' });
  const deletedSecond = toggledFirstDoc.content.replace(`- [ ] 独立推导关键步 <!-- notara-task:${secondId} -->\r\n`, '');
  const projectedDeleted = projectLessonPlan({ path: '重排课.md', content: deletedSecond, revision: toggledFirst.revision });
  assert.equal(projectedDeleted.currentTask, null);
  assert.equal(projectedDeleted.staleCurrentTask, true);
  assert.equal(projectedDeleted.counts.inProgress, 0);
  assert.equal(projectedDeleted.nextTask?.content, '新增前置检查');

  // Ordinary store.toggleTask with clean text preserves trailing <!-- notara-task:... --> anchor on line 8 AND clears matching current_task!
  const revAfterStoreToggle = store.toggleTask({
    path: '重排课.md',
    line: 8,
    checked: true,
    expectedRevision: toggledFirst.revision,
    expectedText: '独立推导关键步',
  });
  const docAfterStoreToggle = store.read({ path: '重排课.md' });
  assert.match(docAfterStoreToggle.content, new RegExp(`- \\[x\\] 独立推导关键步 <!-- notara-task:${secondId} -->`));
  assert.equal(projectLessonPlan({ path: '重排课.md', content: docAfterStoreToggle.content, revision: revAfterStoreToggle.revision }).currentTask, null);
  assert.equal(projectLessonPlan({ path: '重排课.md', content: docAfterStoreToggle.content, revision: revAfterStoreToggle.revision }).staleCurrentTask, false);
  assert.throws(
    () => store.toggleTask({ path: '重排课.md', line: 8, checked: false, expectedRevision: 'stale-rev', expectedText: '独立推导关键步' }),
    /vault_revision_conflict/,
  );

  // Duplicate anchor IDs are flagged ambiguous and rejected by setCurrentLessonTask by taskId.
  const dupContent = [
    '---',
    'type: lesson',
    'current_task: dup-anchor',
    '---',
    '# 锚点冲突',
    '- [ ] 第一项 <!-- notara-task:dup-anchor -->',
    '- [ ] 第二项 <!-- notara-task:dup-anchor -->',
    '',
  ].join('\n');
  store.save({ path: '冲突.md', content: dupContent, expectedRevision: null });
  const dupDoc = store.read({ path: '冲突.md' });
  const dupProjected = projectLessonPlan(dupDoc);
  assert.equal(dupProjected.tasks[0].ambiguous, true);
  assert.equal(dupProjected.tasks[1].ambiguous, true);
  assert.equal(dupProjected.currentTask, null);
  assert.equal(dupProjected.staleCurrentTask, true);
  assert.throws(
    () => setCurrentLessonTask(store, { path: '冲突.md', taskId: 'dup-anchor', expectedRevision: dupDoc.revision }),
    /vault_task_conflict/,
  );
  assert.throws(
    () => toggleLessonTask(store, { path: '冲突.md', line: 6, checked: true, expectedText: '不匹配文本', expectedRevision: dupDoc.revision }),
    /vault_task_conflict/,
  );
  assert.throws(
    () => toggleLessonTask(store, { path: '冲突.md', line: 6, checked: true, expectedText: '第一项', expectedRevision: 'stale-rev' }),
    /vault_revision_conflict/,
  );

  // Non-lesson documents reject lesson projection and mutations.
  const cardDoc = store.read({ path: '普通卡片.md' });
  assert.throws(() => projectLessonPlan(cardDoc), /vault_lesson_type_required/);
  assert.throws(
    () => setCurrentLessonTask(store, { path: '普通卡片.md', line: 5, expectedText: '练习', expectedRevision: cardDoc.revision }),
    /vault_lesson_type_required/,
  );

  // Toggling the active current_task checkbox directly from the Markdown reader (store.toggleTask) clears current_task cleanly.
  store.save({
    path: '阅读器联动.md',
    content: ['---', 'type: lesson', '---', '# 阅读器联动', '- [ ] 独立尝试主例题', '- [ ] 小结沉淀', ''].join('\n'),
    expectedRevision: null,
  });
  const readerAnchored = anchorLessonTasks(store, { path: '阅读器联动.md' });
  const readerCurrent = setCurrentLessonTask(store, {
    path: '阅读器联动.md',
    line: readerAnchored.tasks[0].line,
    expectedText: readerAnchored.tasks[0].expectedText,
    expectedRevision: readerAnchored.revision,
  });
  assert.equal(readerCurrent.currentTask?.id, readerAnchored.tasks[0].id);
  const toggledViaReader = store.toggleTask({
    path: '阅读器联动.md',
    line: readerCurrent.tasks[0].line,
    checked: true,
    expectedText: readerCurrent.tasks[0].expectedText,
    expectedRevision: readerCurrent.revision,
  });
  const afterReaderToggle = projectLessonPlan(store.read({ path: '阅读器联动.md', expectedRevision: toggledViaReader.revision }));
  assert.equal(afterReaderToggle.currentTask, null, 'reader checkbox completion must clear matching current_task');
  assert.equal(afterReaderToggle.staleCurrentTask, false);
  assert.equal(afterReaderToggle.counts.completed, 1);

  // Inserting an un-anchored task with the EXACT same title above an anchored current_task must NOT steal its anchor ID.
  store.save({
    path: '同名防夺取.md',
    content: ['---', 'type: lesson', '---', '# 同名防夺取', '- [ ] 独立完成变式', ''].join('\n'),
    expectedRevision: null,
  });
  const initSame = anchorLessonTasks(store, { path: '同名防夺取.md' });
  const originalAnchor = initSame.tasks[0].id;
  const activeSame = setCurrentLessonTask(store, {
    path: '同名防夺取.md',
    line: initSame.tasks[0].line,
    expectedText: '独立完成变式',
    expectedRevision: initSame.revision,
  });
  const activeSameDoc = store.read({ path: '同名防夺取.md' });
  const insertedAbove = activeSameDoc.content.replace(
    `- [ ] 独立完成变式 <!-- notara-task:${originalAnchor} -->`,
    `- [ ] 独立完成变式\n- [ ] 独立完成变式 <!-- notara-task:${originalAnchor} -->`,
  );
  store.save({ path: '同名防夺取.md', content: insertedAbove, expectedRevision: activeSame.revision });
  const afterInsertAbove = anchorLessonTasks(store, { path: '同名防夺取.md' });
  assert.notEqual(afterInsertAbove.tasks[0].id, originalAnchor, 'newly inserted top task must receive a fresh anchor');
  assert.equal(afterInsertAbove.tasks[1].id, originalAnchor, 'existing bottom task must keep its original anchor');
  assert.equal(afterInsertAbove.currentTask?.line, afterInsertAbove.tasks[1].line, 'current_task must remain on the original task');
  assert.equal(afterInsertAbove.tasks[0].status, 'pending');
  assert.equal(afterInsertAbove.tasks[1].status, 'in_progress');

  // Re-anchoring a file with copy-pasted duplicate current_task anchors assigns distinct new IDs and keeps staleCurrentTask=true instead of guessing copy #1.
  const dedupedConflict = anchorLessonTasks(store, { path: '冲突.md' });
  assert.notEqual(dedupedConflict.tasks[0].id, 'dup-anchor');
  assert.notEqual(dedupedConflict.tasks[1].id, 'dup-anchor');
  assert.notEqual(dedupedConflict.tasks[0].id, dedupedConflict.tasks[1].id);
  assert.equal(dedupedConflict.currentTask, null);
  assert.equal(dedupedConflict.staleCurrentTask, true);
});
