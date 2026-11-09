import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createUserMessage } from '@deepseek-ai/dsh-llm';

export function registerCorrectionRelayTests({ harness, mountSummaryVault, summaryFixture }) {
  const signal = () => new AbortController().signal;
  const value = result => { assert.equal(result.isError, false, JSON.stringify(result)); return result.value; };
  const send = (h, sender, target, message = '请核对关键结论。', callId = randomUUID()) => h.ctx.tools.execute({
    name: 'send_message', arguments: { agent_id: target.id ?? target, message }, callId, agent: sender, signal: signal(),
  });
  const user = async agent => {
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '请继续。' }] }));
    await agent.whenIdle();
  };
  const delivered = async (t, { direct = true, ...options } = {}) => {
    const h = await summaryFixture(t, options);
    if (direct) { await user(h.home); h.teacher = await h.create('notara-teacher'); }
    h.receipt = h.value(await h.invoke(h.teacher, { action: 'deliver', path: h.path }));
    await h.home.whenIdle();
    return h;
  };
  const rejectsBoth = async (h, sender, target) => {
    assert.equal((await send(h, sender, target)).isError, true);
    await assert.rejects(h.ctx.notaraTopics.send(sender, target.id, '不能绕过工具检查。', randomUUID(), signal()));
  };

  test('correction relay: retrying an accepted message retries a failed flush without another followup', { timeout: 30000 }, async t => {
    const h = await delivered(t), flush = h.ctx.sessions.flush.bind(h.ctx.sessions);
    let failed = false, writes = 0;
    h.ctx.sessions.flush = async session => {
      if (session === h.teacher.session) {
        writes++;
        if (!failed) { failed = true; return false; }
      }
      return flush(session);
    };
    const message = '请核对原记录中保留和漏掉的两项。', key = 'retry-failed-flush';
    assert.equal((await send(h, h.home, h.teacher, message, key)).isError, true);
    await h.teacher.whenIdle();
    const before = writes, requests = h.requests.length;
    const retried = value(await send(h, h.home, h.teacher, message, key));
    assert.ok(writes > before, 'an in-memory message is not proof that the failed durable save succeeded');
    assert.equal(h.requests.length, requests, 'retry must not start another model turn');
    assert.equal((await h.ctx.sessionQuery.readSession(h.teacher.id)).events.filter(e => e.type === 'user/message' && e.data.id === retried.messageId).length, 1);
  });

  for (const direct of [false, true]) test(`correction relay: ${direct ? 'direct teacher' : 'ordinary topic'} can reply both ways and recover both receivers cold`, { timeout: 30000 }, async t => {
    const root = await mkdtemp(join(tmpdir(), 'notara-correction-cold-')); t.after(() => rm(root, { recursive: true, force: true }));
    const h = await delivered(t, { direct, existingRoot: root });
    const read = h.value(await h.invoke(h.home, { action: 'read', deliveryId: h.receipt.deliveryId }));
    assert.equal(read.senderSessionId, h.teacher.id); assert.equal(read.recipientSessionId, h.home.id);
    const notice = h.home.session.snapshotEvents().find(e => e.type === 'user/message' && e.data.source?.summaryDeliveryId === read.deliveryId);
    assert.match(JSON.stringify(notice.data.content), /关键.*结论/); assert.match(JSON.stringify(notice.data.content), /send_message/);
    const first = value(await send(h, h.home, h.teacher, '结论有误，请回读并简短更正。', 'same-correction'));
    await h.teacher.whenIdle();
    value(await send(h, h.teacher, h.home, '已在原记录修正。')); await h.home.whenIdle();
    const homeId = h.home.id, teacherId = h.teacher.id;
    await h.ctx.sessions.flush(h.home.session); await h.ctx.sessions.flush(h.teacher.session); await h.ctx.fiber.dispose();
    const cold = await harness(t, { existingRoot: root, withController: true }); await mountSummaryVault(cold);
    const home = await cold.ctx.notaraTopics.resume(homeId);
    const requests = cold.requests.length;
    assert.equal(value(await send(cold, home, teacherId, '结论有误，请回读并简短更正。', 'same-correction')).messageId, first.messageId);
    assert.equal(cold.ctx.agents.get(teacherId), undefined, 'replayed RPC must not even resume the recipient');
    assert.equal(cold.requests.length, requests);
    value(await send(cold, home, teacherId, '补充检查定义域。')); const teacher = cold.ctx.agents.get(teacherId); await teacher.whenIdle();
    assert.equal((await cold.ctx.sessionQuery.readSession(teacherId)).events.filter(e => e.type === 'user/message' && e.data.id === first.messageId).length, 1);
    await cold.ctx.sessions.flush(teacher.session); await cold.ctx.sessions.flush(home.session); await cold.ctx.fiber.dispose();
    const back = await harness(t, { existingRoot: root, withController: true }); await mountSummaryVault(back);
    const restoredTeacher = await back.ctx.notaraTopics.resume(teacherId);
    assert.equal(back.ctx.agents.get(homeId), undefined);
    value(await send(back, restoredTeacher, homeId, '定义域也已核对。')); await back.ctx.agents.get(homeId).whenIdle();
  });

  test('correction relay: receipt identity rejects unbound same-library sessions, wrong homes, changed roles and foreign roots', { timeout: 30000 }, async t => {
    const h = await delivered(t), other = await h.create('notara-teacher'), wrongHome = await h.create('notara-coordinator');
    await rejectsBoth(h, h.home, other); await rejectsBoth(h, other, h.home);
    await rejectsBoth(h, wrongHome, h.teacher); await rejectsBoth(h, h.teacher, wrongHome);
    const service = h.ctx.notaraSummaryDeliveries, row = service.store.get(h.receipt.deliveryId);
    const foreignRoot = join(h.root, 'other-library'); await mkdir(foreignRoot);
    const foreign = await h.ctx.workspaceRegistry.create(foreignRoot);
    await service.store.put(h.receipt.deliveryId, { ...row, root: foreign.path, workspaceId: foreign.id });
    await rejectsBoth(h, h.home, h.teacher);
    await service.store.put(h.receipt.deliveryId, row);
    const foreignHandle = await h.ctx.notaraTopics.native.create({
      sessionId: randomUUID(), meta: { cwd: foreignRoot, agentPreset: 'notara-teacher' },
      agentOptions: { provider: 'fixture', model: 'fixture' },
      setup: async childCtx => { await childCtx.get('agentPresets').mount(childCtx, 'notara-teacher'); },
    });
    t.after(() => foreignHandle.dispose());
    const foreignTeacher = foreignHandle.agent;
    assert.equal(foreignTeacher.session.header.cwd, foreignRoot, 'foreign-root fixture must actually run in the other workspace');
    await service.store.put(h.receipt.deliveryId, { ...row, senderSessionId: foreignTeacher.id });
    await rejectsBoth(h, h.home, foreignTeacher);
    await service.store.put(h.receipt.deliveryId, row);
    await h.ctx.agentPresets.mount(h.teacher.ctx, 'worker-general');
    await rejectsBoth(h, h.home, h.teacher);
    await h.ctx.agentPresets.mount(h.teacher.ctx, 'notara-teacher');
    value(await send(h, h.home, h.teacher)); await h.teacher.whenIdle();
  });

  const stoppable = async t => {
    let heldId, entered;
    const h = await delivered(t, { direct: false, respond: async function* (options) {
      if (options.sessionId === heldId) {
        entered();
        await new Promise(resolve => { if (options.signal.aborted) resolve(); else options.signal.addEventListener('abort', resolve, { once: true }); });
        throw new DOMException('fixture user stop', 'AbortError');
      }
      yield { type: 'finish', reason: { kind: 'stop' } };
    } });
    h.stop = async agent => {
      heldId = agent.id; const started = new Promise(resolve => { entered = resolve; });
      agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '先停下本次工作。' }] }));
      await Promise.race([started,agent.whenIdle().then(()=>{throw new Error('Fixture ended before stream: '+JSON.stringify(agent.session.snapshotEvents().slice(-4)));})]); await h.ctx.sessionController.cancel({ sessionId: agent.id }); await agent.whenIdle(); heldId = null;
    };
    return h;
  };

  test('correction relay: user stop during prompt assembly blocks a queued wake before pre-step', { timeout: 30000 }, async t => {
    const h = await delivered(t);
    let entered, release;
    const started = new Promise(resolve => { entered = resolve; }), hold = new Promise(resolve => { release = resolve; });
    const off = h.teacher.ctx.on('system-prompt/assemble', async (a, c, next) => {
      const result = await next(); entered(); await hold; return result;
    });
    try {
      h.teacher.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '先看一下。' }] }));
      await started;
      const turns = h.teacher.session.snapshotEvents().filter(e => e.type === 'turn/start').length;
      await h.ctx.sessionController.cancel({ sessionId: h.teacher.id });
      await rejectsBoth(h, h.home, h.teacher);
      assert.equal(h.teacher.inbox.nextTurn.length, 0);
      release(); await h.teacher.whenIdle();
      assert.equal(h.teacher.session.snapshotEvents().filter(e => e.type === 'turn/start').length, turns);
    } finally { release(); off(); await h.teacher.whenIdle(); }
  });

  for (const side of ['sender', 'recipient']) test(`correction relay: ${side} role change after async authorization cannot reach followup`, { timeout: 30000 }, async t => {
    const h = await delivered(t), service = h.ctx.notaraTopics;
    const canSend = service.canSend.bind(service), composedPreset = h.ctx.agentPresets.composedPreset.bind(h.ctx.agentPresets);
    let resumed = false, changed = false;
    const resume = service.resume.bind(service);
    service.resume = async id => { const target = await resume(id); resumed = true; return target; };
    const affected = side === 'sender' ? h.home : h.teacher;
    h.ctx.agentPresets.composedPreset = ctx => changed && ctx === affected.ctx ? 'worker-general' : composedPreset(ctx);
    service.canSend = async (...args) => {
      const allowed = await canSend(...args);
      if (resumed && allowed) queueMicrotask(() => { changed = true; });
      return allowed;
    };
    const before = h.requests.length;
    assert.equal((await send(h, h.home, h.teacher, 'ROLE_RACE_MUST_NOT_ARRIVE')).isError, true);
    assert.equal(changed, true);
    await h.teacher.whenIdle(); assert.equal(h.requests.length, before);
  });

  for (const side of ['sender', 'recipient']) test(`correction relay: ${side} stop survives agent messages and cold recovery until a real user continues`, { timeout: 30000 }, async t => {
    const h = await stoppable(t), stopped = side === 'sender' ? h.home : h.teacher;
    await h.stop(stopped);
    let resumes = 0; const resume = h.ctx.notaraTopics.resume.bind(h.ctx.notaraTopics);
    h.ctx.notaraTopics.resume = async id => { resumes++; return resume(id); };
    const count = h.requests.length;
    await rejectsBoth(h, h.home, h.teacher); assert.equal(resumes, 0); assert.equal(h.requests.length, count);
    stopped.followup(createUserMessage({ source: { kind: 'agent-message', form: 'relay', senderSessionId: side === 'sender' ? h.teacher.id : h.home.id }, content: [{ type: 'text', text: '内部消息不能解除用户停止。' }] }));
    await stopped.whenIdle();
    await rejectsBoth(h, h.home, h.teacher); assert.equal(resumes, 0);
    if (side === 'recipient') { await h.ctx.notaraTopics.release(stopped.id); await rejectsBoth(h, h.home, h.teacher); assert.equal(resumes, 0); }
    await user(await resume(stopped.id));
    value(await send(h, h.home, h.teacher)); await h.ctx.agents.get(h.teacher.id).whenIdle();
  });

  test('correction relay: an accepted user stop blocks relay before delayed turn cleanup records its end', { timeout: 30000 }, async t => {
    let stoppedId, entered, release;
    const started = new Promise(resolve => { entered = resolve; }), cleanup = new Promise(resolve => { release = resolve; });
    const h = await delivered(t, { direct: false, respond: async function* (options) {
      if (options.sessionId === stoppedId) {
        entered();
        await new Promise(resolve => { if (options.signal.aborted) resolve(); else options.signal.addEventListener('abort', resolve, { once: true }); });
        await cleanup; throw new DOMException('fixture delayed stop cleanup', 'AbortError');
      }
      yield { type: 'finish', reason: { kind: 'stop' } };
    } });
    try {
      stoppedId = h.teacher.id;
      h.teacher.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '等待取消清理。' }] }));
      await started; await h.ctx.sessionController.cancel({ sessionId: stoppedId });
      await rejectsBoth(h, h.home, h.teacher);
      assert.equal(h.teacher.inbox.nextTurn.length, 0, 'relay must not queue a wake behind the cancelled turn');
    } finally { stoppedId = null; release(); await h.teacher.whenIdle(); }
  });

  for (const side of ['sender', 'recipient']) test(`correction relay: archived ${side} blocks new work while the same RPC returns its old message without resume`, { timeout: 30000 }, async t => {
    const h = await delivered(t, { direct: false }), first = value(await send(h, h.home, h.teacher, '已经发送的核对请求。', 'archive-replay'));
    await h.teacher.whenIdle(); await h.ctx.notaraTopics.release(h.teacher.id);
    await h.ctx.workspaceRegistry.archiveSession(side === 'sender' ? h.home.id : h.teacher.id, { stopActivity: true });
    let resumes = 0; const resume = h.ctx.notaraTopics.resume.bind(h.ctx.notaraTopics);
    h.ctx.notaraTopics.resume = async id => { resumes++; return resume(id); };
    const count = h.requests.length;
    assert.equal(value(await send(h, h.home, h.teacher, '已经发送的核对请求。', 'archive-replay')).messageId, first.messageId);
    await rejectsBoth(h, h.home, h.teacher);
    assert.equal(resumes, 0); assert.equal(h.requests.length, count); assert.equal(h.ctx.agents.get(h.teacher.id), undefined);
  });

  for (const action of ['stop', 'archive']) for (const side of ['sender', 'recipient']) test(`correction relay: ${side} ${action} during resume prevents followup`, { timeout: 30000 }, async t => {
    const h = await stoppable(t), service = h.ctx.notaraTopics, resume = service.resume.bind(service);
    let raced = false;
    service.resume = async id => {
      const target = await resume(id);
      if (!raced) {
        raced = true; const agent = side === 'sender' ? h.home : target;
        if (action === 'stop') await h.stop(agent);
        else await h.ctx.workspaceRegistry.archiveSession(agent.id, { stopActivity: true });
      }
      return target;
    };
    const before = h.teacher.session.snapshotEvents().filter(e => e.type === 'user/message' && e.data.source?.rpcId?.startsWith('notara-relay:')).length;
    assert.equal((await send(h, h.home, h.teacher, 'RESUME_RACE_MUST_NOT_ARRIVE')).isError, true);
    assert.equal(raced, true);
    await h.teacher.whenIdle();
    assert.equal(h.teacher.session.snapshotEvents().filter(e => e.type === 'user/message' && e.data.source?.rpcId?.startsWith('notara-relay:')).length, before);
  });

  test('correction relay: replay preserves completed receipts while revised reports supersede old acknowledgments', { timeout: 30000 }, async t => {
    const h = await delivered(t), service = h.ctx.notaraSummaryDeliveries;
    h.value(await h.invoke(h.home, { action: 'decide', deliveryId: h.receipt.deliveryId, version: h.receipt.version, targets: [], note: '画像和路线保持原安排。' }));
    const count = h.requests.length;
    const replay = h.value(await h.invoke(h.teacher, { action: 'deliver', path: h.path }));
    await h.home.whenIdle();
    assert.equal(replay.version, h.receipt.version); assert.equal(replay.complete, true); assert.equal(h.requests.length, count);
    const original = await readFile(join(h.root, h.path), 'utf8');
    await writeFile(join(h.root, h.path), original.replace('提示后完成判号', '经核对，原判号结论需要更正'));
    const revised = h.value(await h.invoke(h.teacher, { action: 'deliver', path: h.path })); await h.home.whenIdle();
    assert.equal(revised.deliveryId, h.receipt.deliveryId); assert.equal(revised.version, h.receipt.version + 1); assert.equal(revised.complete, false);
    const stale = await h.invoke(h.home, { action: 'acknowledge', deliveryId: revised.deliveryId, version: h.receipt.version, target: 'profile', outcome: 'retryable', note: '迟到的旧版本回执。' });
    assert.equal(stale.isError, true); assert.match(JSON.stringify(stale), /summary_version_conflict/);
    assert.equal(service.store.get(revised.deliveryId).decision.state, 'pending');
  });
}
