import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { buildHomeActions } from '../../home-recommend/src/model.js';

/** Synthetic AM-GM scenario; real native sessions, tools, delivery and provider. */
export async function runHomeActionsRealScenario(t, { harness, mountSummaryVault, untilSummary }) {
  const base = join(process.cwd(), 'work/home-authored-20261106/real');
  await mkdir(base, { recursive: true });
  const output = await mkdtemp(join(base, 'run-'));
  const root = await mkdtemp(join(tmpdir(), 'notara-home-actions-'));
  await writeFile(join(root, '画像.md'), '---\ntype: learner-profile\nstatus: active\n---\n# 模拟画像\n## 当前理解\n合成前课记录：学生在提示后用平方非负解释过均值不等式，还想弄清等号条件和最值的区别。\n## 偏好与目标\n模拟学生喜欢先用具体例子思考，一次约10分钟，暂不准备考试。\n');
  await writeFile(join(root, '均值不等式.md'), '---\ntype: concept\n---\n# 均值不等式\n## 内容\na,b≥0 时 a+b≥2√(ab)，等号当且仅当 a=b。证明来自 (√a-√b)²≥0。\n## 学生理解\n合成前课：在老师提示后说明平方非负与均值不等式的联系。\n### 下次探讨\n- [ ] 为什么求出上界后还要检查能不能取到？\n');
  const h = await harness(t, { existingRoot: root, withController: true, realSummaryHome: process.env.NOTARA_REAL_HOME_ACTIONS });
  t.after(async () => { await h.ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); });
  const service = await mountSummaryVault(h), ws = await h.ctx.workspaceRegistry.resolveByPath(root);
  const report = { status: 'RUNNING', synthetic: true, startedAt: new Date().toISOString(), requests: [], messages: [], checks: {} };
  const safe = text => String(text).replaceAll(root, '<workspace>').replaceAll(`/private${root}`, '<workspace>');
  h.ctx.on('llm/stream', (options, next) => {
    assert.ok(report.requests.length < 60, 'bounded real-model probe exhausted');
    report.requests.push({ provider: options.provider, model: options.model }); return next();
  });
  h.ctx.on('session/event', (session, event) => {
    if (event.type !== 'assistant/message' && event.type !== 'user/message') return;
    const message = event.type === 'assistant/message' ? event.data.message : event.data;
    if (event.type === 'user/message' && message.source?.kind !== 'user') return;
    const text = message.content?.filter(b => b.type === 'text').map(b => b.text).join('\n');
    if (text) report.messages.push({ sessionId: session.id, role: event.type.split('/')[0], text: safe(text) });
  });
  const send = async (agent, text) => {
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }));
    await agent.whenIdle();
    assert.equal(agent.session.snapshotEvents().findLast(e => e.type === 'turn/end')?.data.reason.kind, 'completed');
  };
  const recommendations = () => h.ctx.notaraVault.homeRecommendations({ workspaceId: ws.id });
  const saveDocuments = async (directory = root, relative = '') => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (['sessions', 'storage'].includes(entry.name) || entry.name.startsWith('.')) continue;
      const path = join(directory, entry.name), rel = join(relative, entry.name);
      if (entry.isDirectory()) await saveDocuments(path, rel);
      else if (entry.name.endsWith('.md')) { await mkdir(join(output, 'documents', relative), { recursive: true }); await writeFile(join(output, 'documents', rel), safe(await readFile(path, 'utf8'))); }
    }
  };
  try {
    const homeId = (await h.ctx.notaraVault.homeSession({ workspaceId: ws.id, open: true })).sessionId;
    const home = h.ctx.agents.get(homeId), teacher = await h.create('notara-teacher');
    report.homeId = homeId; report.teacherId = teacher.id;
    await h.ctx.notaraVault.save({ workspaceId: ws.id, path: '路线.md', expectedRevision: null,
      content: `---\ntype: route\nstatus: active\n---\n# 均值不等式学习路线\n## 里程碑\n- [ ] 说清等号与最值\n## 下一步行动\n继续 [[session:${teacher.id}|均值不等式讨论]]，用正数定和的例子理解等号条件。\n` });
    const initial = buildHomeActions(await recommendations(), { canOpenSession: id => id === teacher.id });
    assert.equal(initial.primary, null); assert.equal(initial.continuation.sessionId, teacher.id);
    report.checks.noInventedCards = true;
    await send(home, '我上次在提示后讲过均值不等式的推导，今天想用10分钟弄清等号条件为什么和最值有关。学习集里有均值不等式.md和原来的讨论课堂。请选一个具体的下一步，先不要启动课堂。');
    const first = await recommendations();
    assert.ok(first.teacherRecommendations?.items.length, 'a concrete next step is saved without asking to save');
    await writeFile(join(output, 'first-recommendations.json'), JSON.stringify(first.teacherRecommendations, null, 2));
    const firstActions = buildHomeActions(first, { canOpenSession: id => id === teacher.id });
    assert.ok(firstActions.primary);
    if (firstActions.primary.kind === 'open-session') assert.equal(firstActions.primary.sessionId, teacher.id);
    else { assert.ok(firstActions.primary.request.text.includes(firstActions.primary.title)); assert.ok(firstActions.primary.request.reference); }
    report.checks.automaticRecommendation = true;
    await send(teacher, '我们继续均值不等式的讨论。我现在会这样说：a,b>0 且 a+b=10 时，ab≤25；因为a=b=5满足题设，所以25能取到，是最大值。如果再加a≠b，那25仍是上界却取不到。这个区别我明白了。今天先到这里，下次我想研究a+b不固定而ab固定时，能不能反过来找和的最小值。');
    await untilSummary(() => service.store.entries().some(([, r]) => r.senderSessionId === teacher.id && r.recipientSessionId === homeId));
    await home.whenIdle();
    const after = await recommendations();
    assert.ok(after.teacherRecommendations?.items.length, 'delivery retains a concrete next action');
    assert.notDeepEqual(after.teacherRecommendations.items.map(i => i.text), first.teacherRecommendations.items.map(i => i.text), 'completed action is updated from actual delivery');
    report.checks.deliveryUpdatesNextStep = true;
    await writeFile(join(output, 'after-recommendations.json'), JSON.stringify(after.teacherRecommendations, null, 2));
    const beforeNoSave = await readFile(join(root, after.teacherRecommendations.path), 'utf8');
    await send(home, '先只讨论可能性：除了这些，我们以后能不能聊一点图像方面的联系？这条先别保存，也不要改原来的安排。');
    assert.equal(await readFile(join(root, after.teacherRecommendations.path), 'utf8'), beforeNoSave);
    report.checks.explicitNoSave = true;
    assert.equal((await h.ctx.notaraVault.homeSession({ workspaceId: ws.id, open: true })).sessionId, homeId);
    report.checks.sameLongTermTeacher = true; report.status = 'PASS';
  } catch (error) { report.status = 'FAIL'; report.error = safe(error.message); throw error; }
  finally { await saveDocuments(); report.endedAt = new Date().toISOString(); await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ output, status: report.status, requests: report.requests.length, checks: report.checks })); }
}
