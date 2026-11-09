import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createUserMessage } from '@deepseek-ai/dsh-llm';

/** Opt-in to the existing isolated native harness; no real learner files. */
export async function runRevisitRealScenario(t, { harness, mountSummaryVault }) {
  const output = await mkdtemp(join(process.env.NOTARA_REAL_REVISIT_OUTPUT, 'run-'));
  const root = await mkdtemp(join(tmpdir(), 'notara-revisit-real-'));
  const profile = '---\ntype: learner-profile\n---\n# 模拟画像\n## 当前情况\n学生自述会多项式求导和平方差公式，正学习用导数判断单调性。\n## 偏好\n先让我尝试，卡住时一次只给一个关键提示。每次约10分钟。\n';
  const card = '---\ntype: exercise\ntitle: 求导后怎样判号\n---\n# 求导后怎样判号\n## 内容\n研究 f(x)=x^3-3x 在实数范围内的单调区间。\n## 参考理解\nf\'(x)=3(x-1)(x+1)。在 (-∞,-1)、(1,+∞) 为正，在 (-1,1) 为负。\n## 学生理解\n';
  await writeFile(join(root, '画像.md'), profile); await writeFile(join(root, '判号.md'), card);
  await writeFile(join(root, '仅导入.md'), '---\ntype: concept\n---\n# 极限概念\n## 内容\n这只是新导入的参考资料，学生没有学习。\n## 学生理解\n');
  const h = await harness(t, { existingRoot: root, withController: true, realSummaryHome: process.env.NOTARA_REAL_REVISIT_HOME });
  t.after(async () => { await h.ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); });
  const service = await mountSummaryVault(h), ws = await h.ctx.workspaceRegistry.resolveByPath(root);
  const report = { status: 'RUNNING', startedAt: new Date().toISOString(), synthetic: true, requests: [], messages: [], checks: {} };
  const safeText = text => String(text).replaceAll(root, '<workspace>').replaceAll(`/private${root}`, '<workspace>').replace(/Bearer\s+\S+|\b(?:sk|dsk)[_-][A-Za-z0-9_-]{20,}/g, '<redacted>');
  h.ctx.on('llm/stream', (options, next) => {
    assert.ok(report.requests.length < 45, 'bounded model probe exhausted');
    report.requests.push({ provider: options.provider, model: options.model, at: new Date().toISOString() });
    return next();
  });
  h.ctx.on('session/event', (session, event) => {
    if (event.type === 'assistant/message' || event.type === 'user/message') {
      const message = event.type === 'assistant/message' ? event.data.message : event.data;
      const text = message.content?.filter(block => block.type === 'text').map(block => block.text).join('\n');
      // Export only visible prose, not reasoning, tool results or runtime prompts.
      if (text && (event.type === 'assistant/message' || message.source?.kind === 'user')) report.messages.push({ sessionId: session.id, role: event.type.split('/')[0], text: safeText(text) });
    }
  });
  const send = async (agent, text) => {
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }));
    await agent.whenIdle();
    const end = agent.session.snapshotEvents().findLast(event => event.type === 'turn/end');
    assert.equal(end?.data.reason.kind, 'completed', 'real turn must complete');
  };
  const teachers = () => ws.sessionIds.map(id => h.ctx.agents.get(id)).filter(agent => agent && h.ctx.agentPresets.composedPreset(agent.ctx) === 'notara-teacher');
  const saveDocuments = async (directory = root, relative = '') => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (['sessions', 'storage'].includes(entry.name) || entry.name.startsWith('.')) continue;
      const path = join(directory, entry.name), rel = join(relative, entry.name);
      if (entry.isDirectory()) await saveDocuments(path, rel);
      else if (entry.name.endsWith('.md')) { await mkdir(join(output, 'documents', relative), { recursive: true }); await writeFile(join(output, 'documents', rel), safeText(await readFile(path, 'utf8'))); }
    }
  };
  try {
    const homeId = (await h.ctx.notaraVault.homeSession({ workspaceId: ws.id, open: true })).sessionId;
    const home = h.ctx.agents.get(homeId); report.homeId = homeId;
    await send(home, '今天想弄明白学习集里“判号.md”这道题。我已经求出导数 3x²-3，但不知道下一步怎么判断它的正负。今天约10分钟，请接到讨论老师那里，让他先给一个提示我再接着想，不用完整备课。');
    assert.equal(teachers().length, 1, 'home hands off to one actual teacher');
    const teacher = teachers()[0]; report.teacherId = teacher.id; await teacher.whenIdle();
    await send(teacher, '按提示，我想到了平方差：3x²-3=3(x-1)(x+1)。两个因子的零点是-1和1，我按三个区间分别看正负，所以在(-∞,-1)和(1,+∞)递增，在(-1,1)递减。我现在想追问：如果换成x³-ax，a改变会发生什么？今天先到这里。');
    await home.whenIdle();
    const learned = await readFile(join(root, '判号.md'), 'utf8');
    assert.notEqual(learned, card, 'meaningful discussion is saved without asking to record');
    assert.match(learned.split('## 学生理解')[1] ?? '', /提示|帮助/);
    assert.doesNotMatch(learned, /review_history:|review_next:/);
    const rec = await h.ctx.notaraVault.homeRecommendations({ workspaceId: ws.id });
    assert.ok(rec.revisits.some(item => item.path === '判号.md'));
    assert.ok(!rec.revisits.some(item => item.path === '仅导入.md'));
    const receipts = service.store.entries().map(([, row]) => row);
    assert.ok(receipts.some(row => row.senderSessionId === teacher.id && row.recipientSessionId === homeId && row.journal?.version === row.version && row.delivery.messageId));
    report.checks = { learningSaved: true, revisitWithoutReview: true, importExcluded: true, sameHomeDelivery: true };
    await send(home, '接着刚才那次讨论，今天推荐做什么？我有10分钟，想继续探索，不想重新刷一套题。把值得下次继续看到的建议留在首页就好，先别启动课堂。');
    const recommendations = await h.ctx.notaraVault.homeRecommendations({ workspaceId: ws.id });
    assert.ok(recommendations.teacherRecommendations?.items.length, 'teacher maintains grounded homepage recommendations');
    assert.equal((await h.ctx.notaraVault.homeSession({ workspaceId: ws.id, open: true })).sessionId, homeId);
    await send(home, '好，回到刚才的讨论老师，继续追问把x³-3x换成x³-ax时会怎样，还是先让我自己想。');
    await teacher.whenIdle();
    assert.equal(teachers().length, 1, 'continuing the same subject does not create duplicate teachers');
    report.checks.recommendationsSaved = true; report.checks.originalClassroomReused = true;
    report.status = 'PASS';
  } catch (error) { report.status = 'FAIL'; report.error = safeText(error.message); throw error; }
  finally { await saveDocuments(); report.endedAt = new Date().toISOString(); await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ output, status: report.status, requests: report.requests.length, checks: report.checks })); }
}
