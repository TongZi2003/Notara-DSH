import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setImmediate } from 'node:timers/promises';
import { Context } from '@deepseek-ai/cordis';
import * as StorageHub from '@deepseek-ai/dsh-storage';
import * as StorageJson from '@deepseek-ai/dsh-storage-json';
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain';
import plugin from '../index.js';
import { bindVaultRemote } from '../workspace-client.js';

async function mountStorageAndVault(ctx, { vaultA, vaultB, storageRoot, sessionsMap }) {
  await ctx.plugin(StorageHub.default ?? StorageHub);
  await ctx.plugin(StorageJson.default ?? StorageJson, { root: storageRoot });
  await ctx.plugin(StorageDomain.default ?? StorageDomain, { backend: 'json' });
  ctx.provide('workspaceRegistry', {
    get: id => ({ wsA: { id: 'wsA', path: vaultA }, wsB: { id: 'wsB', path: vaultB } })[id],
  });
  ctx.provide('sessionController', {
    inspect: async id => sessionsMap.get(id) ?? null,
  });
  const fiber = await ctx.plugin(plugin, { root: vaultA, cachePath: ':memory:' });
  await fiber;
  return fiber;
}

async function bindingFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'notara-lesson-mutations-'));
  const vaultA = join(root, 'vault');
  const storageRoot = join(root, 'storage');
  mkdirSync(vaultA);
  for (const path of ['a.md', 'b.md']) {
    writeFileSync(join(vaultA, path), `---\ntype: lesson\n---\n# ${path}\n- [ ] 公开任务\n`);
  }
  const sessionsMap = new Map(['teacher-1', 'teacher-2'].map(id => [id, {
    meta: { cwd: vaultA, agentPreset: 'notara-teacher' }, events: [],
  }]));
  const ctx = new Context();
  t.after(async () => {
    await ctx.fiber.dispose();
    rmSync(root, { recursive: true, force: true });
  });
  await mountStorageAndVault(ctx, { vaultA, vaultB: vaultA, storageRoot, sessionsMap });
  const A = bindVaultRemote(ctx.notaraVault, 'wsA');
  const bound = await A.bindLessonPlan({ sessionId: 'teacher-1', path: 'a.md' });
  const taskInput = {
    sessionId: 'teacher-1', path: 'a.md', line: bound.plan.tasks[0].line,
    expectedText: bound.plan.tasks[0].expectedText, expectedRevision: bound.revision, checked: true,
  };
  const storedBindings = () => JSON.parse(readFileSync(join(storageRoot, 'notara_lesson_bindings.json'), 'utf8')).tables.bindings;
  return { A, ctx, vaultA, taskInput, storedBindings };
}

for (const method of ['toggleLessonTask', 'setCurrentLessonTask']) {
  for (const path of ['b.md', null]) {
    for (const includePath of [true, false]) {
      test(`lesson-bindings ${path === null ? 'unbind' : 'rebind'} rejects a later ${method} from the old lesson (${includePath ? 'explicit' : 'implicit'} path)`, async t => {
        const { A, vaultA, taskInput, storedBindings } = await bindingFixture(t);
        const before = readFileSync(join(vaultA, 'a.md'), 'utf8');
        if (!includePath) delete taskInput.path;
        const [binding, task] = await Promise.allSettled([
          A.bindLessonPlan({ sessionId: 'teacher-1', path }),
          A[method](taskInput),
        ]);
        assert.equal(binding.status, 'fulfilled');
        assert.equal(binding.value.path, path);
        assert.equal(task.status, 'rejected', 'the old request must not report success against a superseded binding');
        assert.match(task.reason.message, path && !includePath ? /vault_revision_conflict/ : /vault_lesson_unbound/);
        assert.equal(readFileSync(join(vaultA, 'a.md'), 'utf8'), before, 'a rejected old request must not write through');
        assert.equal((await A.lessonPlan({ sessionId: 'teacher-1' })).path, path);
        assert.equal(storedBindings()['teacher-1']?.path ?? null, path);
      });
    }

    test(`lesson-bindings ${method} before ${path === null ? 'unbind' : 'rebind'} leaves the final binding intact`, async t => {
      const { A, taskInput, storedBindings } = await bindingFixture(t);
      const [task, binding] = await Promise.all([
        A[method](taskInput),
        A.bindLessonPlan({ sessionId: 'teacher-1', path }),
      ]);
      assert.equal(task.path, 'a.md');
      assert.equal(method === 'toggleLessonTask' ? task.plan.counts.completed : task.plan.counts.inProgress, 1);
      assert.equal(binding.path, path);
      assert.equal((await A.lessonPlan({ sessionId: 'teacher-1' })).path, path);
      assert.equal(storedBindings()['teacher-1']?.path ?? null, path);
    });
  }
}

test('lesson-bindings serializes bind before unbind even when host inspection is delayed', async t => {
  const { A, ctx, vaultA, storedBindings } = await bindingFixture(t);
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const controller = ctx.get('sessionController');
  const inspect = controller.inspect;
  let pause = true;
  controller.inspect = async id => {
    if (pause) {
      pause = false;
      entered.resolve();
      await release.promise;
    }
    return inspect(id);
  };
  t.after(() => release.resolve());
  const binding = A.bindLessonPlan({ sessionId: 'teacher-1', path: 'b.md' });
  await entered.promise;
  const unbinding = A.bindLessonPlan({ sessionId: 'teacher-1', path: null });
  await setImmediate();
  release.resolve();
  const [bound, unbound] = await Promise.all([binding, unbinding]);
  assert.equal(bound.path, 'b.md');
  assert.match(readFileSync(join(vaultA, 'b.md'), 'utf8'), /notara-task:lt-/);
  assert.equal(unbound.bound, false);
  assert.equal((await A.lessonPlan({ sessionId: 'teacher-1' })).bound, false);
  assert.equal(storedBindings()['teacher-1'], undefined);
});

test('lesson-bindings releases a failed session mutation and keeps concurrent task CAS', async t => {
  const { A, vaultA, taskInput, storedBindings } = await bindingFixture(t);
  writeFileSync(join(vaultA, 'card.md'), '---\ntype: card\n---\n- [ ] 非课稿\n');
  const [invalid, active] = await Promise.allSettled([
    A.bindLessonPlan({ sessionId: 'teacher-1', path: 'card.md' }),
    A.setCurrentLessonTask(taskInput),
  ]);
  assert.equal(invalid.status, 'rejected');
  assert.match(invalid.reason.message, /vault_lesson_type_required/);
  assert.equal(active.status, 'fulfilled');
  const [stale, rebound] = await Promise.allSettled([
    A.toggleLessonTask(taskInput),
    A.bindLessonPlan({ sessionId: 'teacher-1', path: 'b.md' }),
  ]);
  assert.equal(stale.status, 'rejected');
  assert.match(stale.reason.message, /vault_revision_conflict/);
  assert.equal(rebound.status, 'fulfilled');
  assert.equal(storedBindings()['teacher-1'].path, 'b.md');
  const target = rebound.value.plan.tasks[0];
  const [current, conflicting] = await Promise.allSettled([
    A.setCurrentLessonTask({ sessionId: 'teacher-1', taskId: target.id, expectedRevision: rebound.value.revision }),
    A.toggleLessonTask({ sessionId: 'teacher-1', line: target.line, checked: true, expectedText: target.expectedText, expectedRevision: rebound.value.revision }),
  ]);
  assert.equal(current.status, 'fulfilled');
  assert.equal(conflicting.status, 'rejected');
  assert.match(conflicting.reason.message, /vault_revision_conflict/);
  const cleared = await A.setCurrentLessonTask({ sessionId: 'teacher-1', clear: true, expectedRevision: current.value.revision });
  assert.equal(cleared.plan.currentTask, null);
});

test('lesson-bindings does not block a different session behind host inspection', { timeout: 5000 }, async t => {
  const { A, ctx, storedBindings } = await bindingFixture(t);
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const controller = ctx.get('sessionController');
  const inspect = controller.inspect;
  controller.inspect = async id => {
    if (id === 'teacher-1') { entered.resolve(); await release.promise; }
    return inspect(id);
  };
  t.after(() => release.resolve());
  const first = A.bindLessonPlan({ sessionId: 'teacher-1', path: null });
  try {
    await entered.promise;
    const second = await A.bindLessonPlan({ sessionId: 'teacher-2', path: 'b.md' });
    assert.equal(second.path, 'b.md');
    assert.equal(storedBindings()['teacher-2'].path, 'b.md');
  } finally {
    release.resolve();
    await first;
  }
});

test('lesson-bindings excludes unchanged lesson templates from candidates and rejects direct binding without changing their hashes', async t => {
  const { A, ctx, vaultA, storedBindings } = await bindingFixture(t);
  mkdirSync(join(vaultA, '模板'));
  const template = readFileSync(new URL('../../../templates/base-files/lesson.md', import.meta.url));
  const templates = {
    '模板/备课本.md': template,
    '原样模板.md': template,
    '模板/自定义课稿.md': Buffer.from(template.toString('utf8').replace('template: true\n', '')),
  };
  const hash = path => createHash('sha256').update(readFileSync(join(vaultA, path))).digest('hex');
  for (const [path, content] of Object.entries(templates)) writeFileSync(join(vaultA, path), content);
  ctx.notaraVault.forWorkspace('wsA').store.scan();
  const view = await A.lessonPlan({ sessionId: 'teacher-1' });
  assert.deepEqual(view.candidates.map(row => row.path).sort(), ['a.md', 'b.md']);
  for (const [path, content] of Object.entries(templates)) {
    await assert.rejects(() => A.bindLessonPlan({ sessionId: 'teacher-1', path }), /vault_lesson_type_required/);
    assert.equal(hash(path), createHash('sha256').update(content).digest('hex'));
  }
  assert.equal(storedBindings()['teacher-1'].path, 'a.md');
});

test('lesson-bindings persists in storageDomain across reload, enforces classroom role & workspace boundaries, isolates classrooms, and handles missing/renamed lessons', async t => {
  const root = mkdtempSync(join(tmpdir(), 'notara-lesson-bindings-'));
  const vaultA = join(root, 'vault-a');
  const vaultB = join(root, 'vault-b');
  const storageRoot = join(root, 'storage');
  mkdirSync(join(vaultA, '备课'), { recursive: true });
  mkdirSync(join(vaultB, '备课'), { recursive: true });

  writeFileSync(
    join(vaultA, '备课/第一课.md'),
    [
      '---',
      'type: lesson',
      'status: ready',
      '---',
      '# 第一课：奇异值几何直觉',
      '- [ ] 观察单位圆映射为椭圆',
      '- [ ] 验证正交方向保持正交',
      '<details data-notara="teacher">',
      '- [ ] 教师参考私有项',
      '</details>',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(vaultA, '备课/第二课.md'),
    [
      '---',
      'type: lesson',
      'status: ready',
      '---',
      '# 第二课：秩 1 最佳逼近',
      '- [ ] 计算外积分解项',
      '- [ ] 核对 Frobenius 误差公式',
      '',
    ].join('\n'),
  );
  writeFileSync(join(vaultA, '普通卡片.md'), '---\ntype: card\n---\n# 非备课本\n- [ ] 不能绑定\n');
  writeFileSync(join(vaultB, '备课/第一课.md'), '---\ntype: lesson\n---\n# B 库第一课\n- [ ] B 库任务\n');

  const sessionsMap = new Map([
    ['teacher-1', { meta: { cwd: vaultA, agentPreset: 'notara-teacher' }, events: [] }],
    ['teacher-2', { meta: { cwd: vaultA, agentPreset: 'notara-teacher' }, events: [] }],
    ['teacher-sub', { meta: { cwd: vaultA, agentPreset: 'notara-teacher', origin: 'subagent' }, events: [{ type: 'subagent/descriptor', data: { mode: 'continuable' } }] }],
    ['teacher-oneshot', { meta: { cwd: vaultA, agentPreset: 'notara-teacher', origin: 'subagent' }, events: [{ type: 'subagent/descriptor', data: { mode: 'one-shot' } }] }],
    ['teacher-b', { meta: { cwd: vaultB, agentPreset: 'notara-teacher' }, events: [] }],
    ['coordinator-1', { meta: { cwd: vaultA, agentPreset: 'notara-coordinator' }, events: [] }],
    ['organizer-1', { meta: { cwd: vaultA, agentPreset: 'notara-material-organizer' }, events: [] }],
    ['worker-1', { meta: { cwd: vaultA, agentPreset: 'worker-general', origin: 'subagent' }, events: [{ type: 'subagent/descriptor', data: { mode: 'one-shot' } }] }],
    ['companion-1', { meta: { cwd: vaultA, agentPreset: 'companion-deepseek', origin: 'subagent' }, events: [{ type: 'subagent/descriptor', data: { mode: 'continuable' } }] }],
    ['blind-1', { meta: { cwd: vaultA, agentPreset: 'companion-deepseek-blind', origin: 'subagent' }, events: [{ type: 'subagent/descriptor', data: { mode: 'continuable' } }] }],
  ]);

  const ctx1 = new Context();
  t.after(async () => {
    await ctx1.fiber.dispose().catch(() => {});
    rmSync(root, { recursive: true, force: true });
  });
  await mountStorageAndVault(ctx1, { vaultA, vaultB, storageRoot, sessionsMap });
  const A = bindVaultRemote(ctx1.notaraVault, 'wsA');
  const B = bindVaultRemote(ctx1.notaraVault, 'wsB');

  // Unbound teacher classroom (and continuable teacher subagent) sees eligible=true and candidate lessons, without bound=true.
  const unbound = await A.lessonPlan({ sessionId: 'teacher-1' });
  assert.equal(unbound.bound, false);
  assert.equal(unbound.eligible, true);
  assert.deepEqual(unbound.candidates.map(c => c.path).sort(), ['备课/第一课.md', '备课/第二课.md']);
  assert.equal((await A.lessonPlan({ sessionId: 'teacher-sub' })).eligible, true);

  // Ineligible roles (including one-shot subagents) and missing/cross-workspace sessions are rejected cleanly.
  for (const ineligibleId of ['coordinator-1', 'organizer-1', 'worker-1', 'companion-1', 'blind-1', 'teacher-oneshot']) {
    const view = await A.lessonPlan({ sessionId: ineligibleId });
    assert.equal(view.bound, false);
    assert.equal(view.eligible, false);
    assert.deepEqual(view.candidates, []);
    await assert.rejects(
      () => A.bindLessonPlan({ sessionId: ineligibleId, path: '备课/第一课.md' }),
      /vault_session_role_forbidden/,
    );
  }
  await assert.rejects(() => A.bindLessonPlan({ sessionId: 'missing-session', path: '备课/第一课.md' }), /vault_session_not_found/);
  await assert.rejects(() => A.bindLessonPlan({ sessionId: 'teacher-b', path: '备课/第一课.md' }), /vault_workspace_mismatch/);
  await assert.rejects(() => A.bindLessonPlan({ sessionId: 'teacher-1', path: '普通卡片.md' }), /vault_lesson_type_required/);

  // Bind two classrooms to two different lessons and verify isolation.
  const bound1 = await A.bindLessonPlan({ sessionId: 'teacher-1', path: '备课/第一课.md' });
  const bound2 = await A.bindLessonPlan({ sessionId: 'teacher-2', path: '备课/第二课.md' });
  assert.equal(bound1.bound, true);
  assert.equal(bound1.plan.counts.total, 2, 'hidden teacher checklist inside <details data-notara="teacher"> must be excluded');
  assert.equal(bound2.bound, true);
  assert.equal(bound2.plan.title, '第二课：秩 1 最佳逼近');

  const firstTask = bound1.plan.tasks[0];
  const active1 = await A.setCurrentLessonTask({
    sessionId: 'teacher-1',
    line: firstTask.line,
    expectedText: firstTask.expectedText,
    expectedRevision: bound1.revision,
  });
  assert.equal(active1.plan.currentTask?.content, '观察单位圆映射为椭圆');
  assert.equal((await A.lessonPlan({ sessionId: 'teacher-2' })).plan.currentTask, null, 'classroom 2 is unaffected by classroom 1 progress');
  assert.equal((await B.lessonPlan({ sessionId: 'teacher-b' })).bound, false, 'workspace B is isolated from workspace A');

  // Toggle task 1 completed with CAS check; stale expectedRevision rejects.
  await assert.rejects(
    () => A.toggleLessonTask({
      sessionId: 'teacher-1',
      line: active1.plan.tasks[0].line,
      checked: true,
      expectedText: active1.plan.tasks[0].expectedText,
      expectedRevision: 'stale-revision',
    }),
    /vault_revision_conflict/,
  );
  const completed1 = await A.toggleLessonTask({
    sessionId: 'teacher-1',
    line: active1.plan.tasks[0].line,
    checked: true,
    expectedText: active1.plan.tasks[0].expectedText,
    expectedRevision: active1.revision,
  });
  assert.equal(completed1.plan.counts.completed, 1);
  assert.equal(completed1.plan.nextTask?.content, '验证正交方向保持正交');

  // Verify immediate index sync when a new lesson file is written directly to disk before watcher debounce.
  writeFileSync(join(vaultA, '备课/即时写入课.md'), '---\ntype: lesson\n---\n# 即时写入课\n- [ ] 新写入任务\n');
  const instantBind = await A.bindLessonPlan({ sessionId: 'teacher-2', path: '备课/即时写入课.md' });
  assert.equal(instantBind.bound, true);
  assert.equal(instantBind.plan.tasks[0].content, '新写入任务');

  // Dispose ctx1 completely, inject a corrupt record alongside valid storage, and reload in a fresh Context!
  await ctx1.fiber.dispose();
  const domainBindingsDir = join(storageRoot, 'notara_lesson_bindings', 'bindings');
  mkdirSync(domainBindingsDir, { recursive: true });
  writeFileSync(join(domainBindingsDir, 'corrupt-record.json'), JSON.stringify({ workspaceId: 123, broken: true }));

  const ctx2 = new Context();
  t.after(async () => { await ctx2.fiber.dispose().catch(() => {}); });
  await mountStorageAndVault(ctx2, { vaultA, vaultB, storageRoot, sessionsMap });
  const A2 = bindVaultRemote(ctx2.notaraVault, 'wsA');

  const restored1 = await A2.lessonPlan({ sessionId: 'teacher-1' });
  assert.equal(restored1.bound, true);
  assert.equal(restored1.path, '备课/第一课.md');
  assert.equal(restored1.plan.counts.completed, 1);
  const bindingsSummary = await A2.lessonBindings({});
  assert.equal(bindingsSummary.bindings.length, 2);

  // Rename / delete the bound lesson file -> returns bound=true, missing=true without crashing, and can rebind to renamed path.
  renameSync(join(vaultA, '备课/第一课.md'), join(vaultA, '备课/第一课-重命名.md'));
  ctx2.notaraVault.forWorkspace('wsA').store.scan();

  const afterRename = await A2.lessonPlan({ sessionId: 'teacher-1' });
  assert.equal(afterRename.bound, true);
  assert.equal(afterRename.missing, true);
  assert.equal(afterRename.path, '备课/第一课.md');
  assert.ok(afterRename.candidates.some(c => c.path === '备课/第一课-重命名.md'));

  const rebound = await A2.bindLessonPlan({ sessionId: 'teacher-1', path: '备课/第一课-重命名.md' });
  assert.equal(rebound.bound, true);
  assert.equal(rebound.missing, false);
  assert.equal(rebound.plan.counts.completed, 1);

  unlinkSync(join(vaultA, '备课/即时写入课.md'));
  ctx2.notaraVault.forWorkspace('wsA').store.scan();
  const afterDelete = await A2.lessonPlan({ sessionId: 'teacher-2' });
  assert.equal(afterDelete.bound, true);
  assert.equal(afterDelete.missing, true);

  // Unbind clears the broken binding cleanly.
  const unbound2 = await A2.bindLessonPlan({ sessionId: 'teacher-2', path: null });
  assert.equal(unbound2.bound, false);
  assert.equal((await A2.lessonBindings({})).bindings.length, 1);

  // Non-Notara presets (e.g. cordis), preset changes on an already-bound session, workspace sessionIds detachment, and parent archive/detachment.
  sessionsMap.set('cordis-1', { meta: { cwd: vaultA, agentPreset: 'cordis' }, events: [] });
  const cordisView = await A2.lessonPlan({ sessionId: 'cordis-1' });
  assert.equal(cordisView.bound, false);
  assert.equal(cordisView.eligible, false);
  await assert.rejects(() => A2.bindLessonPlan({ sessionId: 'cordis-1', path: '备课/第二课.md' }), /vault_session_role_forbidden/);

  // Changing teacher-1's preset to notara-coordinator hides stale binding in lessonPlan and excludes it from lessonBindings.
  sessionsMap.set('teacher-1', { meta: { cwd: vaultA, agentPreset: 'notara-teacher' }, events: [{ type: 'agent-preset/selected', data: { agentPreset: 'notara-coordinator' } }] });
  const switchedRoleView = await A2.lessonPlan({ sessionId: 'teacher-1' });
  assert.equal(switchedRoleView.bound, false);
  assert.equal(switchedRoleView.eligible, false);
  assert.deepEqual((await A2.lessonBindings({})).bindings, []);

  // Restore teacher-1 and test workspace.sessionIds attachment + continuable child classroom parent checks.
  sessionsMap.set('teacher-1', { meta: { cwd: vaultA, agentPreset: 'notara-teacher' }, events: [] });
  sessionsMap.set('teacher-sub', { meta: { cwd: vaultA, agentPreset: 'notara-teacher', origin: 'subagent', parentSession: 'teacher-1' }, events: [{ type: 'subagent/descriptor', data: { mode: 'continuable' } }] });
  await A2.bindLessonPlan({ sessionId: 'teacher-sub', path: '备课/第二课.md' });

  const attachedIds = new Set(['teacher-1', 'teacher-2']);
  const archivedSet = new Set();
  ctx2.registry.delete?.('workspaceRegistry');
  const ctx3 = new Context();
  t.after(async () => { await ctx3.fiber.dispose().catch(() => {}); });
  await ctx3.plugin(StorageHub.default ?? StorageHub);
  await ctx3.plugin(StorageJson.default ?? StorageJson, { root: storageRoot });
  await ctx3.plugin(StorageDomain.default ?? StorageDomain, { backend: 'json' });
  ctx3.provide('workspaceRegistry', {
    archivedSessionIds: archivedSet,
    get: id => id === 'wsA' ? { id: 'wsA', path: vaultA, get sessionIds() { return [...attachedIds]; }, archivedSessionIds: archivedSet } : null,
  });
  ctx3.provide('sessionController', { inspect: async id => sessionsMap.get(id) ?? null });
  await ctx3.plugin(plugin, { root: vaultA, cachePath: ':memory:' });
  const A3 = bindVaultRemote(ctx3.notaraVault, 'wsA');

  assert.equal((await A3.lessonBindings({})).bindings.length, 2, 'attached parent and continuable child classroom both appear');

  // Archiving teacher-1 keeps bound=true, eligible=false for read-only inspection, blocks mutations, and excludes both teacher-1 and its child from lessonBindings.
  archivedSet.add('teacher-1');
  const archivedParentView = await A3.lessonPlan({ sessionId: 'teacher-1' });
  assert.equal(archivedParentView.bound, true);
  assert.equal(archivedParentView.eligible, false);
  assert.deepEqual(archivedParentView.candidates, []);
  const archivedChildView = await A3.lessonPlan({ sessionId: 'teacher-sub' });
  assert.equal(archivedChildView.bound, true);
  assert.equal(archivedChildView.eligible, false);
  assert.deepEqual((await A3.lessonBindings({})).bindings, []);
  await assert.rejects(() => A3.bindLessonPlan({ sessionId: 'teacher-1', path: null }), /vault_session_archived/);
  archivedSet.delete('teacher-1');

  // Detaching teacher-1 from workspace.sessionIds excludes both teacher-1 and its child and hides bound state.
  attachedIds.delete('teacher-1');
  assert.equal((await A3.lessonPlan({ sessionId: 'teacher-1' })).bound, false);
  assert.equal((await A3.lessonPlan({ sessionId: 'teacher-1' })).eligible, false);
  assert.equal((await A3.lessonPlan({ sessionId: 'teacher-sub' })).bound, false);
  assert.deepEqual((await A3.lessonBindings({})).bindings, []);
  await assert.rejects(() => A3.bindLessonPlan({ sessionId: 'teacher-1', path: '备课/第二课.md' }), /vault_workspace_mismatch/);
});
