import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import {collectRuntimeContexts} from '../prompt.js';

export function registerLearningDeliveryTests({ harness, mountSummaryVault, summaryFixture, untilSummary }) {
  const notices = agent => agent.session.snapshotEvents().filter(e => e.type === 'user/message' && e.data.source?.summaryDeliveryId);
  const call = (h, agent, args, callId = randomUUID()) => h.ctx.tools.execute({ name: 'lesson_summary', arguments: args, callId, agent, signal: new AbortController().signal });
  const value = result => { assert.equal(result.isError, false, JSON.stringify(result)); return JSON.parse(result.value.result); };
  const report = async (h, title = '错题讨论') => {
    await mkdir(join(h.root, '日记'), { recursive: true });
    const path = '日记/问题记录.md';
    await writeFile(join(h.root, path), `---\ntype: diary\n---\n# 学习记录\n\n## ${title}\n学生经一步提示补齐因式分解，独立迁移尚未检查。\n`);
    return { path, heading: title };
  };

  test('learning delivery: real teacher assembly includes current learning and preferences without creating home ownership', { timeout: 30000 }, async t => {
    const h = await summaryFixture(t);
    await h.ctx.notaraVault.save({ workspaceId: h.workspace.id, path: '画像.md', expectedRevision: (await h.ctx.notaraVault.read({ workspaceId: h.workspace.id, path: '画像.md' })).revision,
      content: '---\ntype: learner-profile\n---\n# 模拟画像\n## 当前学情\n会求导，判号时尚未主动想到因式分解。\n## 学习偏好\n先给一句提示，保留自行尝试的时间。\n' });
    const contexts = await collectRuntimeContexts(h.ctx,h.teacher);
    const learning = contexts.find(item => item.name === 'notara-learning-context');
    assert.ok(learning); assert.match(learning.text, /会求导/); assert.match(learning.text, /先给一句提示/);
    const worker = await h.create('worker-general');
    const hidden = await h.ctx.systemPrompt.assemble({ agent: worker, scope: worker });
    assert.ok(!hidden.contexts.some(item => item.name === 'notara-learning-context'));
    assert.equal(h.ctx.notaraSummaryDeliveries.store.home(h.workspace.id), undefined, 'read-only prompt inspection must not bind a home');
  });

  test('learning delivery: lightweight result creates a diary index and an unchanged decision needs no document rewrites', { timeout: 30000 }, async t => {
    const h = await summaryFixture(t), source = await report(h);
    const before = await Promise.all(['画像.md', '路线/当前.md'].map(p => readFile(join(h.root, p), 'utf8')));
    const first = value(await call(h, h.teacher, { action: 'deliver', ...source, kind: 'question', summary: '提示后补齐因式分解，暂不调整原计划。' }));
    await h.home.whenIdle();
    assert.equal(first.kind, 'question'); assert.ok(first.journal.path.startsWith('日记/')); assert.equal(first.journal.version, first.version);
    const diary = await readFile(join(h.root, first.journal.path), 'utf8');
    assert.match(diary, /错题讨论/); assert.match(diary, /轻量|问答|讨论/);
    const again = value(await call(h, h.teacher, { action: 'deliver', ...source, kind: 'question' }));
    assert.equal(again.deliveryId, first.deliveryId); assert.equal(notices(h.home).length, 1);
    assert.equal(await readFile(join(h.root, first.journal.path), 'utf8'), diary);
    const decision = value(await call(h, h.home, { action: 'decide', deliveryId: first.deliveryId, version: first.version, targets: [], note: '只是局部澄清，继续当前安排，无需改长期文档。' }));
    assert.equal(decision.complete, true); assert.deepEqual(decision.decision.targets, []);
    assert.deepEqual(await Promise.all(['画像.md', '路线/当前.md'].map(p => readFile(join(h.root, p), 'utf8'))), before);
  });

  test('learning delivery: preparation is indexed without filling the lesson student summary', { timeout: 30000 }, async t => {
    const h = await summaryFixture(t), source = await report(h, '备课交付');
    await writeFile(join(h.root, h.path), '---\ntype: lesson\n---\n# 本课\n- [ ] 引入\n\n## 本节总结与下次续接\n');
    const lessonBefore = await readFile(join(h.root, h.path), 'utf8');
    await writeFile(join(h.root, source.path), `---\ntype: diary\n---\n## 备课交付\n完成 [[${h.path}]] 的备课。尚未授课，无新增学生表现。\n`);
    const receipt = value(await call(h, h.teacher, { action: 'deliver', ...source, kind: 'preparation' }));
    await h.home.whenIdle();
    assert.equal(receipt.kind, 'preparation'); assert.equal(receipt.journal.version, receipt.version);
    const noticeText = notices(h.home)[0].data.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
    assert.match(noticeText, /首页回复本身也是学生可见内容/);
    assert.match(noticeText, /只交付[^。]*链接[^。]*安排/);
    assert.match(noticeText, /未尝试题目的答案[^。]*教师参考/);
    assert.equal(await readFile(join(h.root, h.path), 'utf8'), lessonBefore);
    assert.match(value(await call(h, h.home, { action: 'read', deliveryId: receipt.deliveryId })).summary, /无新增学生表现/);
  });

  test('learning delivery: material organizer can deliver its saved checklist through the same home chain', { timeout: 30000 }, async t => {
    const h = await summaryFixture(t), source = await report(h, '资料整理交付');
    const topic = await h.ctx.notaraTopics.start(h.home, { preset: 'notara-material-organizer', description: '整理', prompt: '整理交付测试。' }, 'organize-delivery', new AbortController().signal);
    const organizer = h.ctx.agents.get(topic.id); await organizer.whenIdle();
    const receipt = value(await call(h, organizer, { action: 'deliver', ...source, kind: 'materials' }));
    await h.home.whenIdle(); assert.equal(receipt.delivery.sent, true); assert.equal(receipt.kind, 'materials');
    const rejected = await call(h, organizer, { action: 'decide', deliveryId: receipt.deliveryId, version: receipt.version, targets: [], note: '冒充首页' });
    assert.equal(rejected.isError, true);
  });

  test('learning delivery: direct question persists before a home exists and binds once on a real home request', { timeout: 30000 }, async t => {
    const h = await harness(t, { withController: true }); await mountSummaryVault(h);
    const teacher = await h.create('notara-teacher'), source = await report(h);
    const first = value(await call(h, teacher, { action: 'deliver', ...source, kind: 'question' }));
    assert.equal(first.delivery.sent, false); assert.equal(first.delivery.suspended, 'awaiting_home'); assert.equal(first.journal.version, 1);
    const home = await h.create('notara-coordinator');
    home.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '看看现在的学习情况。' }] }));
    await home.whenIdle();
    await untilSummary(() => h.ctx.notaraSummaryDeliveries.store.get(first.deliveryId)?.delivery.messageId);
    await home.whenIdle(); assert.equal(notices(home).length, 1);
    assert.equal(h.ctx.notaraSummaryDeliveries.store.get(first.deliveryId).recipientSessionId, home.id);
    const another = await h.create('notara-coordinator');
    another.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '另一个首页会话。' }] })); await another.whenIdle();
    const again = value(await call(h, teacher, { action: 'deliver', ...source, kind: 'question' }));
    assert.equal(again.deliveryId, first.deliveryId); assert.equal(notices(another).length, 0);
    assert.equal((await call(h, another, { action: 'read', deliveryId: first.deliveryId })).isError, true);
  });

  test('learning delivery: a failed diary save cannot notify and retry preserves the original delivery date', { timeout: 30000 }, async t => {
    const h = await summaryFixture(t), source = await report(h);
    const store = h.ctx.notaraVault.forWorkspace(h.workspace.id).store, save = store.save.bind(store);
    let fail = true;
    store.save = input => { if (fail && input.path.startsWith('日记/')) throw new Error('fixture diary disk offline'); return save(input); };
    const first = value(await call(h, h.teacher, { action: 'deliver', ...source, kind: 'question' }));
    assert.equal(first.delivery.sent, false); assert.equal(notices(h.home).length, 0); assert.match(first.delivery.error, /diary disk offline/);
    const date = first.journal.date; fail = false;
    const next = value(await call(h, h.teacher, { action: 'retry', deliveryId: first.deliveryId }));
    await h.home.whenIdle(); assert.equal(next.delivery.sent, true); assert.equal(next.journal.date, date); assert.equal(notices(h.home).length, 1);
  });

  test('learning delivery: next-step decision keeps only selected document work and cannot discard a failed update', { timeout: 30000 }, async t => {
    const h = await summaryFixture(t), first = value(await call(h, h.teacher, { action: 'deliver', path: h.path, kind: 'lesson' })); await h.home.whenIdle();
    const choice = { action: 'decide', deliveryId: first.deliveryId, version: first.version, targets: ['route'], note: '下一课先补判号，画像无需改变。' };
    assert.equal(value(await call(h, h.home, choice)).complete, false);
    value(await call(h, h.home, { action: 'acknowledge', deliveryId: first.deliveryId, version: first.version, target: 'route', outcome: 'retryable', note: '路线暂不可写。' }));
    assert.equal((await call(h, h.home, { ...choice, targets: [] })).isError, true);
    const doc = value(await call(h, h.home, { action: 'read', deliveryId: first.deliveryId, path: '路线/当前.md' })).document;
    const done = value(await call(h, h.home, { action: 'acknowledge', deliveryId: first.deliveryId, version: first.version, target: 'route', outcome: 'unchanged', path: doc.path, expectedRevision: doc.revision, note: '回读确认路线已经有同一安排。' }));
    assert.equal(done.complete, true); assert.equal(done.targets.profile.state, 'pending');
  });

  test('learning delivery: committed diary survives a lost receipt and full restart without a duplicate entry', { timeout: 30000 }, async t => {
    const root = await mkdtemp(join(tmpdir(), 'notara-diary-restart-')); t.after(() => rm(root, { recursive: true, force: true }));
    const h = await summaryFixture(t, { existingRoot: root }), source = await report(h), service = h.ctx.notaraSummaryDeliveries;
    const put = service.store.put; let failOnce = true;
    service.store.put = async (id, row) => { if (row.journal?.version && !row.delivery.messageId && failOnce) { failOnce = false; throw new Error('fixture journal receipt lost'); } return put(id, row); };
    const first = value(await call(h, h.teacher, { action: 'deliver', ...source, kind: 'question' }));
    assert.equal(first.delivery.sent, false); assert.equal(notices(h.home).length, 0);
    const path = `日记/${first.journal.date}.md`, before = await readFile(join(root, path), 'utf8');
    const homeId = h.home.id; await h.ctx.sessions.flush(h.home.session); await h.ctx.sessions.flush(h.teacher.session); await h.ctx.fiber.dispose();
    const reopened = await harness(t, { existingRoot: root, withController: true }), restored = await mountSummaryVault(reopened);
    await untilSummary(() => restored.store.get(first.deliveryId)?.delivery.messageId);
    await reopened.ctx.agents.get(homeId)?.whenIdle();
    assert.equal(await readFile(join(root, path), 'utf8'), before);
    const persisted = await reopened.ctx.sessionQuery.readSession(homeId);
    assert.equal(persisted.events.filter(e => e.type === 'user/message' && e.data.source?.summaryDeliveryId === first.deliveryId).length, 1);
  });

  test('learning delivery: revision updates one diary entry and rejects an older next-step decision', { timeout: 30000 }, async t => {
    const h = await summaryFixture(t), source = await report(h);
    const first = value(await call(h, h.teacher, { action: 'deliver', ...source, kind: 'question', summary: '旧稿摘要：独立迁移尚未检查。' })); await h.home.whenIdle();
    value(await call(h, h.home, { action: 'decide', deliveryId: first.deliveryId, version: first.version, targets: [], note: '继续原计划。' }));
    await writeFile(join(h.root, source.path), (await readFile(join(h.root, source.path), 'utf8')).replace('独立迁移尚未检查', '补充独立题仍在判号处受阻'));
    const revised = value(await call(h, h.teacher, { action: 'deliver', ...source, kind: 'question' })); await h.home.whenIdle();
    assert.equal(revised.deliveryId, first.deliveryId); assert.equal(revised.version, first.version + 1); assert.equal(revised.complete, false);
    const diary = await readFile(join(h.root, revised.journal.path), 'utf8');
    assert.doesNotMatch(diary, /旧稿摘要/, 'a changed report must not silently reuse an old optional brief');
    assert.equal((diary.match(/<!-- notara-delivery:/g) ?? []).length, 1);
    assert.equal(notices(h.home).length, 2);
    const old = await call(h, h.home, { action: 'decide', deliveryId: first.deliveryId, version: first.version, targets: [], note: '迟到判断。' });
    assert.equal(old.isError, true); assert.match(JSON.stringify(old), /summary_version_conflict/);
  });

  test('learning delivery: prior v1 receipts still reopen and accept their verified partial targets', { timeout: 30000 }, async t => {
    const root = await mkdtemp(join(tmpdir(), 'notara-legacy-delivery-')); t.after(() => rm(root, { recursive: true, force: true }));
    const h = await summaryFixture(t, { existingRoot: root });
    const first = value(await call(h, h.teacher, { action: 'deliver', path: h.path })); await h.home.whenIdle();
    const legacy = { ...h.ctx.notaraSummaryDeliveries.store.get(first.deliveryId) };
    for (const name of ['kind', 'senderPreset', 'routing', 'summary', 'journal', 'decision']) delete legacy[name];
    await h.ctx.notaraSummaryDeliveries.store.put(first.deliveryId, legacy);
    const homeId = h.home.id; await h.ctx.sessions.flush(h.home.session); await h.ctx.sessions.flush(h.teacher.session); await h.ctx.fiber.dispose();
    const reopened = await harness(t, { existingRoot: root, withController: true }); await mountSummaryVault(reopened);
    const home = await reopened.ctx.notaraTopics.resume(homeId);
    const saved = value(await call(reopened, home, { action: 'read', deliveryId: first.deliveryId }));
    assert.equal(saved.version, first.version); assert.equal(saved.journal, null); assert.equal(saved.sourceCurrent, true);
    for (const [target, path] of [['profile', '画像.md'], ['route', '路线/当前.md']]) {
      const doc = value(await call(reopened, home, { action: 'read', deliveryId: first.deliveryId, path })).document;
      value(await call(reopened, home, { action: 'acknowledge', deliveryId: first.deliveryId, version: first.version, target, path, expectedRevision: doc.revision, outcome: 'unchanged', note: '旧交付核实无需调整。' }));
    }
    assert.equal(value(await call(reopened, home, { action: 'read', deliveryId: first.deliveryId })).complete, true);
  });

  test('learning delivery: home binding during the first receipt write is reconciled without another user entry', { timeout: 30000 }, async t => {
    const h = await harness(t, { withController: true }); await mountSummaryVault(h);
    const teacher = await h.create('notara-teacher'), home = await h.create('notara-coordinator'), source = await report(h);
    const service = h.ctx.notaraSummaryDeliveries, put = service.store.put;
    let racing = true;
    service.store.put = async (id, row) => {
      if (racing && !row.recipientSessionId) { racing = false; await service.rememberHome(home); }
      return put(id, row);
    };
    const receipt = value(await call(h, teacher, { action: 'deliver', ...source, kind: 'question' }));
    await home.whenIdle(); assert.equal(receipt.delivery.sent, true); assert.equal(notices(home).length, 1);
  });

  test('learning delivery: third-attempt delivered message is reconciled after restart without a fourth model wake', { timeout: 30000 }, async t => {
    const root = await mkdtemp(join(tmpdir(), 'notara-third-delivery-')); t.after(() => rm(root, { recursive: true, force: true }));
    const h = await summaryFixture(t, { existingRoot: root }), service = h.ctx.notaraSummaryDeliveries;
    const resume = h.ctx.notaraTopics.resume.bind(h.ctx.notaraTopics), put = service.store.put;
    let failures = 0;
    h.ctx.notaraTopics.resume = async id => { if (id === h.home.id && failures++ < 2) throw Error('fixture two transport failures'); return resume(id); };
    service.store.put = async (id, row) => { if (row.delivery.attempts === 3 && row.delivery.messageId) throw Error('fixture final receipt checkpoint failed'); return put(id, row); };
    const receipt = value(await call(h, h.teacher, { action: 'deliver', path: h.path }));
    await untilSummary(() => notices(h.home).length === 1 && service.store.get(receipt.deliveryId)?.delivery.attempts === 3);
    await h.home.whenIdle();
    assert.equal(service.store.get(receipt.deliveryId).delivery.messageId, null);
    const homeId = h.home.id; await h.ctx.sessions.flush(h.home.session); await h.ctx.sessions.flush(h.teacher.session); await h.ctx.fiber.dispose();
    const reopened = await harness(t, { existingRoot: root, withController: true }), restored = await mountSummaryVault(reopened);
    await untilSummary(() => restored.store.get(receipt.deliveryId)?.delivery.messageId);
    assert.equal(reopened.requests.length, 0, 'reconciliation must not rerun a delivered message');
    assert.equal((await reopened.ctx.sessionQuery.readSession(homeId)).events.filter(e => e.type === 'user/message' && e.data.source?.summaryDeliveryId === receipt.deliveryId).length, 1);
  });

  test('learning delivery: retry reconciliation saves its message and replay key in one checkpoint', { timeout: 30000 }, async t => {
    const h = await summaryFixture(t), service = h.ctx.notaraSummaryDeliveries;
    const receipt = value(await call(h, h.teacher, { action: 'deliver', path: h.path })); await h.home.whenIdle();
    const row = service.store.get(receipt.deliveryId);
    await service.store.put(receipt.deliveryId, { ...row, delivery: { ...row.delivery, messageId: null } });
    const put = service.store.put; let failOnce = true;
    service.store.put = async (id, next) => { if (next.delivery.messageId && next.retryKeys.length && failOnce) { failOnce = false; throw Error('fixture retry key checkpoint failed'); } return put(id, next); };
    assert.equal((await call(h, h.teacher, { action: 'retry', deliveryId: receipt.deliveryId }, 'same-reconcile-key')).isError, true);
    value(await call(h, h.teacher, { action: 'retry', deliveryId: receipt.deliveryId }, 'same-reconcile-key'));
    await h.home.whenIdle();
    assert.equal(notices(h.home).length, 1); assert.equal(service.store.get(receipt.deliveryId).delivery.round, row.delivery.round);
  });

  test('learning delivery: home binding resets the budget spent before a recipient existed', { timeout: 30000 }, async t => {
    const h = await harness(t, { withController: true }); await mountSummaryVault(h);
    const teacher = await h.create('notara-teacher'), source = await report(h), workspace = await h.ctx.workspaceRegistry.resolveByPath(h.root);
    const store = h.ctx.notaraVault.forWorkspace(workspace.id).store, save = store.save.bind(store);
    let failures = 0;
    store.save = input => { if (input.path.startsWith('日记/') && failures++ < 2) throw Error('fixture first diary writes fail'); return save(input); };
    const receipt = value(await call(h, teacher, { action: 'deliver', ...source, kind: 'question' }));
    await untilSummary(() => h.ctx.notaraSummaryDeliveries.store.get(receipt.deliveryId)?.delivery.suspended === 'awaiting_home');
    assert.equal(h.ctx.notaraSummaryDeliveries.store.get(receipt.deliveryId).delivery.attempts, 3);
    const home = await h.create('notara-coordinator');
    home.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '继续学习。' }] })); await home.whenIdle();
    await untilSummary(() => notices(home).length === 1);
    await untilSummary(() => h.ctx.notaraSummaryDeliveries.store.get(receipt.deliveryId).delivery.messageId);
  });

  for (const permanent of [false, true]) test(`learning delivery: preflight history failure has bounded recovery (${permanent ? 'permanent' : 'transient'})`, { timeout: 30000 }, async t => {
    const h = await summaryFixture(t), service = h.ctx.notaraSummaryDeliveries, snapshot = service.snapshot.bind(service);
    let reads = 0;
    service.snapshot = async id => {
      if (id === h.home.id && service.store.entries().length > 0 && (permanent || reads === 0)) { reads++; throw Error('fixture history read offline'); }
      return snapshot(id);
    };
    const receipt = value(await call(h, h.teacher, { action: 'deliver', path: h.path }));
    assert.equal(receipt.delivery.sent, false); assert.match(receipt.delivery.error, /history read offline/);
    if (permanent) {
      await untilSummary(() => reads >= 3); await new Promise(resolve => setTimeout(resolve, 700));
      assert.equal(reads, 3); assert.equal(notices(h.home).length, 0);
    } else {
      await untilSummary(() => service.store.get(receipt.deliveryId)?.delivery.messageId); await h.home.whenIdle();
      assert.equal(notices(h.home).length, 1);
    }
  });
}
