import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { fileURLToPath } from 'node:url';
import { checkSummaryProbeAccess } from './summary-probe-boundary.js';

// Opt-in provider-backed acceptance. Only a synthetic isolated learning set is
// written; the configured adapter reads a private temporary credential copy.
export async function runSummaryRealScenario(t, { harness, mountSummaryVault }) {
  const base = resolve(process.env.NOTARA_REAL_SUMMARY_OUTPUT || 'work/summary-delivery-real-20261101');
  await mkdir(base, { recursive: true });
  const output = await mkdtemp(join(base, 'run-')), root = join(output, 'workspace');
  await mkdir(join(root, '备课'), { recursive: true }); await mkdir(join(root, '路线'), { recursive: true });
  const paths = { lesson: '备课/本课.md', profile: '画像.md', route: '路线/当前.md' };
  const initial = {
    lesson: '---\ntype: lesson\ntitle: 商法则与判号复测\n---\n# 商法则与判号复测\n这是模拟学生验收材料。\n- [ ] 复测 f(x)=ln(x)/x 的求导\n- [ ] 下次独立检查商法则并练习判号\n\n## 本节总结与下次续接\n',
    profile: '---\ntype: learner-profile\n---\n# 模拟学生画像\n高二，会 ln(x) 的导数；商法则分子符号不稳定。尚未有独立完成本课求导的记录。每次约20分钟，偏好从自己的错步开始。\n',
    route: '---\ntype: route\nstatus: active\n---\n# 导数基础路线（模拟）\n## 里程碑\n- [ ] 商法则与定义域：无提示完成一题求导并解释分子减号\n- [ ] 单调性：独立求出导数的符号区间\n## 下一步行动\n- [ ] 进入 [[备课/本课.md]] 检查商法则\n',
  };
  for (const [key, body] of Object.entries(initial)) await writeFile(join(root, paths[key]), body);
  const report = { status: 'RUNNING', startedAt: new Date().toISOString(), output, stages: [], sessions: {}, modelRequests: [] };
  let h, home, teacher, service;
  const events = new Map(), notices = [];
  const argsOf = event => typeof event.data.arguments === 'string' ? JSON.parse(event.data.arguments) : event.data.arguments;
  const textOf = event => event?.data.content.filter(b => b.type === 'text').map(b => b.text).join('\n') ?? '';
  const lastReply = id => textOf(events.get(id)?.findLast(e => e.type === 'assistant/message' && textOf(e).trim()));
  const completed = agent => {
    assert.equal(events.get(agent.id)?.findLast(e => e.type === 'turn/end')?.data.reason.kind, 'completed', 'idle after an error is not a successful model turn');
    assert.ok(lastReply(agent.id).trim(), 'the completed turn must leave a real response');
  };
  const delivers = () => (events.get(report.sessions.teacher) ?? []).filter(e => e.type === 'tool/call' && e.data.name === 'lesson_summary' && argsOf(e).action === 'deliver');
  const safeEvent = e => {
    if (e.type === 'tool/call') return { seq: e.seq, type: e.type, data: { callId: e.data.callId, name: e.data.name, arguments: e.data.arguments } };
    if (e.type === 'tool/result') return { seq: e.seq, type: e.type, data: e.data };
    if (e.type === 'user/message') return { seq: e.seq, type: e.type, data: { source: e.data.source, content: e.data.content.filter(b => b.type === 'text') } };
    if (e.type === 'assistant/message') return { seq: e.seq, type: e.type, data: { content: e.data.message.content.filter(b => b.type === 'text' || b.type === 'tool-call') } };
    if (e.type === 'turn/end') return { seq: e.seq, type: e.type, data: e.data };
    return null;
  };
  const mount = async () => {
    h = await harness(t, { existingRoot: root, withController: true, realSummaryHome: process.env.NOTARA_REAL_SUMMARY_HOME });
    service = await mountSummaryVault(h);
    h.ctx.on('session/event', (session, event) => {
      const clean = safeEvent(event); if (!clean) return;
      if (!events.has(session.id)) events.set(session.id, []);
      events.get(session.id).push(clean);
      if (event.type === 'user/message' && event.data.source?.summaryDeliveryId) notices.push({ sessionId: session.id, id: event.data.id, ...event.data.source });
      if (event.type === 'tool/call') console.log(JSON.stringify({ probe: 'summary-real-tool', session: session.id === report.sessions.home ? 'home' : 'teacher', tool: event.data.name, action: event.data.arguments?.action }));
    });
    h.ctx.on('llm/stream', (options, next) => {
      report.modelRequests.push({ provider: options.provider, model: options.model, sessionId: options.sessionId, at: new Date().toISOString() });
      assert.ok(report.modelRequests.length <= 100, 'provider acceptance call budget exhausted');
      return next();
    });
  };
  const snapshot = async name => {
    const dir = join(output, name); await mkdir(dir, { recursive: true });
    const bodies = {};
    for (const [key, path] of Object.entries(paths)) {
      bodies[key] = await readFile(join(root, path), 'utf8'); await writeFile(join(dir, `${key}.md`), bodies[key]);
    }
    await writeFile(join(dir, 'receipts.json'), JSON.stringify(service.store.entries(), null, 2));
    return bodies;
  };
  const stage = async (name, details = {}) => {
    report.stages.push({ name, at: new Date().toISOString(), ...details });
    await snapshot(name); await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ probe: 'summary-real-stage', name, ...details }));
  };
  const send = async (agent, text) => {
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }));
    await agent.whenIdle();
    completed(agent);
  };
  const onlyReceipt = () => { const rows = service.store.entries(); assert.equal(rows.length, 1); return { id: rows[0][0], row: rows[0][1] }; };
  const sha = body => createHash('sha256').update(body).digest('hex');
  try {
    await mount();
    home = await h.create('notara-coordinator'); report.sessions.home = home.id;
    const topic = await h.ctx.notaraTopics.start(home, { description: '商法则复测（模拟验收）', prompt: '这是隔离学习集中的模拟学生课堂，所有学生记录须保留模拟标记。现有画像在 画像.md，路线在 路线/当前.md，备课在 备课/本课.md。本课很短：先让学生求 f(x)=ln(x)/x 的导数，再根据实际回答继续。暂不委派、不扩展新课，学生还没有下课。' }, 'summary-real-class', new AbortController().signal);
    teacher = h.ctx.agents.get(topic.id); report.sessions.teacher = teacher.id; await teacher.whenIdle();
    await send(teacher, '我算的是 f′(x)=(1+ln x)/x²，x>0。我把分子的符号记成加号了，能只提醒我这一步吗？');
    assert.equal(service.store.entries().length, 0, 'ordinary teaching/waiting cannot deliver a completion summary');
    await stage('01-before-close');
    await send(teacher, '按你的提示我改成 (1-ln x)/x²，x>0。这个是提示后改对的，还没有重新独立检验。今天先学到这里，帮我把学习情况和下次该练什么留好。');
    await home.whenIdle();
    completed(home);
    const first = onlyReceipt();
    assert.equal(first.row.targets.profile.state, 'updated'); assert.equal(first.row.targets.route.state, 'updated');
    const normal = await snapshot('02-normal-close');
    assert.notEqual(normal.profile, initial.profile); assert.notEqual(normal.route, initial.route);
    assert.match(normal.profile, /提示/); assert.match(normal.profile, /模拟/);
    assert.match(normal.lesson, /提示后|提醒后/); assert.match(normal.profile, /未.{0,16}(独立|检验|检查)|尚.{0,16}(独立|检验|检查)/);
    assert.match(normal.route, /^- \[ \] 商法则/m); assert.match(normal.route, /^- \[ \] 单调性/m);
    assert.match(normal.route.split('## 下一步行动')[1] ?? '', /(无提示|不看提示|独立).*(求导|商法则)/);
    assert.equal(notices.length, 1);
    await stage('02-normal-close', { receiptId: first.id, version: first.row.version, profileHash: sha(normal.profile), routeHash: sha(normal.route) });

    const beforeRepeat = delivers().length;
    await send(teacher, '请把刚才同一份已保存的课后总结再交给首页，内容不改，也没有新的学习表现；只是确认这份交付。');
    await home.whenIdle();
    const duplicate = onlyReceipt();
    assert.equal(duplicate.id, first.id); assert.equal(duplicate.row.version, first.row.version); assert.equal(notices.length, 1);
    const repeated = await snapshot('03-duplicate');
    assert.equal(repeated.profile, normal.profile); assert.equal(repeated.route, normal.route);
    assert.equal(delivers().length, beforeRepeat + 1, 'the real teacher must actually redeliver; merely saying it was already sent is not duplicate coverage');
    const repeatedCall = delivers().at(-1).data.callId;
    const repeatResult = events.get(teacher.id).find(e => e.type === 'tool/result' && e.data.message.toolCallId === repeatedCall);
    assert.equal(repeatResult?.data.message.isError, false, 'the duplicate deliver call must succeed');
    await stage('03-duplicate', { notifications: notices.length, unchangedDocuments: true });

    let failRoute = true, injectedFailures = 0;
    h.ctx.on('tools/execute', async (exec, next) => {
      if (failRoute && exec.agent?.id === home.id && ['write', 'edit'].includes(exec.name)) {
        const args = exec.arguments, path = args.file_path ?? args.path ?? '';
        let body = ''; try { body = await readFile(resolve(root, path), 'utf8'); } catch {}
        if (path.includes('路线') || /^type:\s*route\s*$/m.test(body) || /^type:\s*route\s*$/m.test(args.content ?? '')) {
          injectedFailures++;
          throw new Error('EIO: 路线文档存储暂不可写；本次请求内重试也不可用。保留其他已保存结果，稍后恢复后再续接。');
        }
      }
      return next();
    });
    await send(teacher, '补充一条今天结束前的模拟作答：我刚才没有看提示，独立又算了 g(x)=(ln x)²/x，得出 g′(x)=[2ln x-(ln x)²]/x²，x>0；但还不会从这个式子求导数为正的区间。把这条补到同一份课后总结，下次先补判号。今天不再讲新内容。');
    await home.whenIdle();
    completed(home);
    const partial = onlyReceipt();
    assert.ok(injectedFailures > 0, 'the real home must attempt a route update before recovery is tested');
    assert.equal(partial.row.version, first.row.version + 1); assert.equal(partial.row.targets.profile.state, 'updated');
    assert.equal(partial.row.targets.route.state, 'retryable');
    const savedPartial = await snapshot('04-route-failed');
    assert.equal(savedPartial.route, normal.route); assert.notEqual(savedPartial.profile, normal.profile);
    assert.match(savedPartial.profile, /g\s*(?:\(|'|′)/); assert.match(savedPartial.profile, /未看提示|没有看提示|无新提示|独立/);
    assert.match(savedPartial.profile, /(不会|未|尚).{0,45}(判号|符号|区间)/);
    assert.match(lastReply(home.id), /路线[\s\S]{0,120}(未|失败|错误|恢复|受阻)/, 'failure response must explain the unfinished route');
    await stage('04-route-failed', { injectedFailures, complete: false, savedProfileHash: sha(savedPartial.profile) });

    failRoute = false;
    await h.ctx.sessions.flush(home.session); await h.ctx.sessions.flush(teacher.session); await h.ctx.fiber.dispose();
    await mount();
    assert.equal(onlyReceipt().row.targets.profile.state, 'updated'); assert.equal(onlyReceipt().row.targets.route.state, 'retryable');
    home = await h.ctx.notaraTopics.resume(report.sessions.home);
    await send(home, '继续处理上次没有完成的课后收尾，先不开始新课堂。');
    const recovered = onlyReceipt();
    assert.equal(recovered.row.targets.profile.state, 'updated'); assert.equal(recovered.row.targets.route.state, 'updated');
    const final = await snapshot('05-recovered');
    assert.equal(final.profile, savedPartial.profile, 'recovery must preserve the already completed profile byte-for-byte');
    assert.notEqual(final.route, savedPartial.route); assert.match(final.route, /判号|符号|为正/);
    assert.match(final.route, /^- \[ \] 单调性/m, 'unperformed sign analysis cannot complete the milestone');
    assert.match(final.route.split('## 下一步行动')[1] ?? '', /先.{0,70}(判号|符号|正区间)/);
    assert.match(final.route, /(不会|未|尚).{0,45}(判号|符号|区间)/);
    await stage('05-recovered', { complete: true, profilePreserved: true, routeHash: sha(final.route) });
    assert.ok(report.modelRequests.length > 0 && report.modelRequests.every(r => r.provider !== 'fixture'));
    const allEvents = [...events.values()].flat();
    assert.ok(allEvents.filter(e => e.type === 'turn/end').every(e => e.data.reason.kind === 'completed'));
    for (const call of allEvents.filter(e => e.type === 'tool/call')) {
      assert.ok(await checkSummaryProbeAccess(root, fileURLToPath(new URL('../resources/', import.meta.url)), call.data.name, argsOf(call)), `probe file boundary violated by ${call.data.name}`);
    }
    report.audit = { completedTurns: allEvents.filter(e => e.type === 'turn/end').length, realDeliverCalls: delivers().length, fileAccessWithinProbe: true };
    report.status = 'PASS';
  } catch (error) {
    report.status = 'FAIL'; report.error = error.message; throw error;
  } finally {
    report.finishedAt = new Date().toISOString(); report.notifications = notices;
    if (service) { try { await snapshot('last-state'); } catch {} }
    await writeFile(join(output, 'events.json'), JSON.stringify(Object.fromEntries(events), null, 2));
    await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ probe: 'summary-real-result', status: report.status, output, modelRequests: report.modelRequests.length }));
  }
}
