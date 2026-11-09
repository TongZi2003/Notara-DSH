import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile, copyFile, chmod } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { stringify } from 'yaml';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { buildHomeActions, parseRecommendations } from '../../home-recommend/src/model.js';
import { summaryReceiptComplete } from '@oh-my-student/plugin-vault-sqlite/summary-receipts';
import { checkSummaryProbeAccess } from './summary-probe-boundary.js';

const now = () => new Date().toISOString();
const sha = value => createHash('sha256').update(value).digest('hex');
const textOf = message => (message?.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('\n');
const argsOf = e => { try { return typeof e.data.arguments === 'string' ? JSON.parse(e.data.arguments) : e.data.arguments; } catch { return {}; } };
const paths = { profile: '画像.md', lesson: '备课/商法则错因复盘.md', route: '路线/导数基础.md', draft: '来源/原作答与草稿.md' };
const fixtures = {
  [paths.profile]: `---\ntype: learner-profile\nstatus: active\ntitle: 模拟学生画像\n---\n# 模拟学生画像\n\n所有背景与后续学生回答都是隔离验收的合成数据，不是真实学生学情。\n\n## 当前理解与可用支点\n模拟前课记录：知道 (ln x)'=1/x 和 x'=1；商法则的理解与独立使用尚未检验。\n\n## 近期目标与约束\n模拟学生自述：这周要考导数基础，今天还剩20分钟；希望先解决自己的错误，不想直接刷一整套题。\n\n## 兴趣与沟通偏好\n模拟学生自述：对“导数为什么能看出图像上升下降”有兴趣，想在补好求导方法后接着探索。\n\n## 当前考试错因与补强重点\n尚无本题错因判断；不从一次错误推断稳定习惯。\n\n## 事实证据与来源\n以上均为验收合成前置背景；本题原作答见 [[来源/原作答与草稿]]，课稿见 [[备课/商法则错因复盘]]。\n`,
  [paths.lesson]: `---\ntype: lesson\ntitle: 商法则错因复盘\n---\n# 商法则错因复盘\n\n本课稿已准备，全部材料为合成验收数据。本次从学生当时的作答出发。原题、外部批改和草稿见 [[来源/原作答与草稿]]；已有画像 [[画像]]；已有路线 [[路线/导数基础]]。\n\n## 本课目标\n辨明把分式分子分母分别求导的想法从何而来，选择一个学生能执行的改进动作；尚不预设学生的错因。\n\n## 公开任务\n- [ ] 回忆这次原作答与草稿\n- [ ] 辨明关键断点并尝试一次改写\n\n<details data-notara="teacher">\n<summary>教师参考</summary>\n\n原题 x>0，f(x)=ln(x)/x。外部批改已确认 f'=(ln x)'/x'=1/x 错误；它只证明这一步不合法，未证明学生为何这样做。正确导数为 (1-ln x)/x²。可用 x/x=1 与“分别求导得到1”的矛盾或乘积写法对比，帮助学生区分合法法则；是否使用由实时对话决定。学生若因时间紧张采用错误规则，先核实规则理解，再考虑节奏。不把“粗心”“心理差”当原因结论。\n\n</details>\n\n## 本节总结与下次续接\n`,
  [paths.route]: `---\ntype: route\nstatus: active\ntitle: 导数基础旧路线\n---\n# 导数基础旧路线\n\n合成前课路线，尚未完成。目标：本周导数基础考试；求导依据清楚后探索导数与图像。\n\n## 里程碑\n- [ ] 能选择合法的求导方法并说明依据\n- [ ] 用导数符号讨论函数图像的升降\n\n## 下一步行动\n- 当前下一步：先做一组幂函数求导基础练习\n\n## 修订记录\n合成初始路线，尚未依据本次错题更新。\n`,
  [paths.draft]: `---\ntype: source\ntitle: 原作答与草稿（合成）\n---\n# 原作答与草稿（合成）\n\n所有内容为验收合成材料。\n\n## 原题\n已知 x>0，f(x)=ln(x)/x，求 f'(x)。\n\n## 学生原作答\nf'(x)=(ln x)'/x'= (1/x)/1=1/x。\n\n## 外部批改\n该步错误：不能把分子分母分别求导后相除。批改没有询问学生当时为什么这样做。\n\n## 可读草稿\n左边写：(ln x)'=1/x。右边写：x'=1。下方写：(1/x)÷1。没有其他可辨认步骤，也没有关于心情或动机的记录。\n`,
};
const inputs = {
  first: '这道 x>0、f(x)=ln(x)/x 的求导题被老师判错了，我还不知道为什么。我的原作答和草稿放在“来源/原作答与草稿.md”，就是写 f′=(ln x)′/x′=1/x。能陪我看看当时哪里走偏了吗？',
  explanation: '我当时真的以为分式可以把分子、分母各自求导以后再相除，不是抄错符号。那时候时间紧，我也有点慌，但即使现在不赶时间，我原来也是这样理解的。',
  close: '我现在重新写原题的导数是 f′(x)=(1-ln x)/x²，x>0；这是这次讨论之后改出来的，还没有隔一会儿独立再做。今天先到这里，请把这次错在哪、接下来怎么改留好，下次回首页还能看到。',
  recommend: '我回首页了。今天还剩20分钟，这周要考导数基础；我也对“导数怎么说明图像升降”挺好奇。结合刚才的复盘和原来的学习路线，接下来先做什么合适？请替我把值得保留的下一步留在首页，下次回来还能看到，先不用另开一课。',
  oral: '现在只口头给一个建议，不要保存，也不要修改刚才留在首页的内容。',
};

// One frozen provider-backed run; no evaluator model and no product mutation.
export async function runErrorRecommendRealScenario(t, { harness, mountSummaryVault, summaryFixture: _unused }) {
  const authHome = process.env.NOTARA_REAL_ERROR_RECOMMEND_HOME;
  assert.ok(authHome);
  const base = resolve('work/regression-20261102/error-recommend-real');
  await mkdir(base, { recursive: true });
  const output = await mkdtemp(join(base, 'run-'));
  const root = await mkdtemp(join(tmpdir(), 'notara-error-recommend-'));
  const routeHome = await mkdtemp(join(tmpdir(), 'notara-error-recommend-route-'));
  await chmod(routeHome, 0o700);
  t.after(() => rm(routeHome, { recursive: true, force: true }));
  t.after(() => rm(root, { recursive: true, force: true }));
  const resources = fileURLToPath(new URL('../resources/', import.meta.url));
  const report = { status: 'RUNNING', startedAt: now(), output, node: process.version,
    model: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
    limits: { homes: 1, teachers: 1, studentMessages: 7, modelRequests: 45, minutes: 15 },
    fixture: 'all materials and student responses synthetic; no learner-outcome claim',
    stages: [], sessions: {}, modelRequests: [], studentMessages: [], guards: [], checks: [],
    uncovered: ['browser/Electron interaction', 'real student learning', 'refresh/reconnect', 'cold runtime recovery', 'other models and subjects'] };
  let h, service, home, teacher, workspace, stageName = 'setup', order = 0, timer, fatal, modelStart;
  const events = [], requests = [];
  const scrub = value => String(value)
    .replaceAll(`/private${root}`, '<workspace>').replaceAll(root, '<workspace>')
    .replaceAll(resources, '<built-in-resources>').replaceAll(routeHome, '<temporary-route>').replaceAll(authHome, '<authorized-auth-source>')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer <redacted>')
    .replace(/\b(?:sk|dsk)[_-][A-Za-z0-9_-]{20,}\b/g, '<redacted>')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '<redacted>')
    .replace(/\/(?:Users|home)\/[^\s<>"'`]+/g, '<host-path>');
  const clean = value => {
    if (typeof value === 'string') return scrub(value);
    if (Array.isArray(value)) return value.map(clean).filter(x => x !== undefined);
    if (value && typeof value === 'object') {
      if (/reasoning|thinking|signature/i.test(value.type ?? '')) return undefined;
      return Object.fromEntries(Object.entries(value)
        .filter(([k]) => !/reasoning|thinking|signature|replayState|authorization|password|credential|token|api.?key/i.test(k))
        .map(([k, v]) => [k, clean(v)]));
    }
    return value;
  };
  const safeText = text => { try { return JSON.stringify(clean(JSON.parse(text))); } catch { return scrub(text); } };
  const content = blocks => (blocks ?? []).flatMap(b => b.type === 'text' ? [{ type: 'text', text: safeText(b.text) }]
    : b.type === 'tool-call' ? [{ type: 'tool-call', id: b.id, name: b.name, arguments: clean(b.arguments) }] : []);
  const json = (path, value) => writeFile(join(output, path), JSON.stringify(clean(value), null, 2));
  const flush = async () => { await json('report.json', report); await json('events-public.json', events); await json('requests-public.json', requests); };
  const check = (claim, pass, expected, observed, layer = 'agent prompt') => report.checks.push({ claim, status: pass ? 'PASS' : 'FAIL', expected, observed, layer });
  const budget = () => {
    if (fatal) throw new Error(fatal);
    if (modelStart && Date.now() - modelStart >= 14 * 60 * 1000) throw new Error('model-run time budget exhausted');
  };
  const stop = async reason => {
    fatal ??= reason;
    for (const agent of [teacher, home].filter(Boolean)) { try { await agent.interrupt(); } catch {} }
  };
  const settle = async () => {
    for (let i = 0; i < 5; i++) {
      budget();
      for (const agent of [teacher, home].filter(Boolean)) await agent.whenIdle();
      const before = order;
      await new Promise(r => setTimeout(r, 150));
      if (before === order) return;
    }
    budget();
  };
  const docs = async () => {
    const out = {};
    const walk = async (dir, prefix = '') => {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        if (['sessions', 'storage'].includes(e.name) || e.name.startsWith('.')) continue;
        const path = prefix + e.name;
        assert.ok(!e.isSymbolicLink(), 'synthetic workspace must not acquire symlinks');
        if (e.isDirectory()) await walk(join(dir, e.name), path + '/');
        else if (/\.(md|canvas)$/i.test(e.name)) out[path] = await readFile(join(dir, e.name), 'utf8');
      }
    };
    await walk(root);
    return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
  };
  const projection = async () => {
    const dto = parseRecommendations(await h.ctx.notaraVault.homeRecommendations({ workspaceId: workspace.id }));
    return { dto, actions: buildHomeActions(dto, { canOpenSession: id => [home?.id, teacher?.id].includes(id) }) };
  };
  const snapshot = async name => {
    const dir = join(output, name); await mkdir(dir, { recursive: true });
    const documents = await docs(), hashes = {};
    for (const [path, body] of Object.entries(documents)) {
      const target = join(dir, 'documents', path); await mkdir(dirname(target), { recursive: true });
      await writeFile(target, scrub(body)); hashes[path] = sha(body);
    }
    const projected = await projection();
    await json(`${name}/hashes.json`, hashes);
    await json(`${name}/home-projection.json`, projected);
    await json(`${name}/delivery-receipts.json`, service.store.entries());
    const readback = {};
    for (const path of Object.values(paths)) {
      const saved = await h.ctx.notaraVault.read({ workspaceId: workspace.id, path });
      readback[path] = { revision: saved.revision, diskMatches: saved.content === documents[path], content: saved.content };
    }
    await json(`${name}/host-readback.json`, readback);
    report.stages.push({ name, at: now(), order, modelRequests: report.modelRequests.length, hashes });
    await flush();
    console.log(JSON.stringify({ probe: 'error-recommend-stage', name, requests: report.modelRequests.length, output }));
    return { documents, hashes, ...projected };
  };
  const send = async (agent, text, name) => {
    budget(); assert.ok(report.studentMessages.length < report.limits.studentMessages);
    stageName = name;
    const startOrder = order;
    report.studentMessages.push({ name, at: now(), sessionId: agent.id, text, synthetic: true });
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }));
    await settle();
    const failed = events.find(e => e.order > startOrder && e.type === 'turn/end' && e.reason?.kind !== 'completed');
    if (failed) throw new Error(`Native turn failed: ${JSON.stringify(failed.reason)}`);
    assert.ok(events.some(e => e.order > startOrder && e.sessionId === agent.id && e.type === 'assistant/message' && textOf(e).trim()), 'turn must produce a public response');
    return snapshot(name);
  };
  try {
    report.commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    report.dirtyState = execFileSync('git', ['status', '--short'], { encoding: 'utf8' });
    await mkdir(join(routeHome, 'profiles/web'), { recursive: true });
    await writeFile(join(routeHome, 'profiles/web/cordis.patch.yml'), stringify([{ id: 'agent-default-model', config: report.model }]));
    await copyFile(join(authHome, '.credentials.yaml'), join(routeHome, '.credentials.yaml'));
    await chmod(join(routeHome, '.credentials.yaml'), 0o600);
    report.route = { authorizedBy: 'user explicitly authorized isolated DeepSeek API use', productionChanged: false, credentials: 'private temporary copies; never exported' };
    const tree = async (dir, prefix = '') => {
      const result = {};
      for (const e of await readdir(dir, { withFileTypes: true })) {
        assert.ok(!e.isSymbolicLink());
        if (e.isDirectory()) Object.assign(result, await tree(join(dir, e.name), prefix + e.name + '/'));
        else result[prefix + e.name] = sha(await readFile(join(dir, e.name)));
      }
      return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
    };
    const instance = JSON.parse(await readFile(resolve(authHome, '../instance.json'), 'utf8'));
    const sourceHashes = await tree(resources);
    const installedHashes = await tree(join(instance.installed, 'node_modules/@oh-my-student/plugin-presets/resources'));
    assert.deepEqual(sourceHashes, installedHashes, 'current core resources must match 60323 snapshot');
    report.resourceParity = { status: 'PASS', port: 60323, resourceFiles: Object.keys(sourceHashes).length, treeHash: sha(JSON.stringify(sourceHashes)) };
    await json('resources-sha256.json', { sourceHashes, installedHashes });
    await json('experiment-inputs.json', { frozenAt: now(), fixtures, inputs, limits: report.limits,
      matrix: [
        ['diagnosis', 'First reply seeks recollection or offers a falsifiable concrete hypothesis; no unsupported stable labels.'],
        ['action', 'After explanation, identify illegal componentwise differentiation and give an executable method/check.'],
        ['delivery', 'Actual lesson_summary handoff, sourced and revisable profile; assisted correction remains assisted.'],
        ['recommendation', 'Home considers time/goal/interest/route; persisted list and actual readback.'],
        ['projection', 'homeRecommendations DTO and buildHomeActions prefer teacher list while fallback still exists.'],
        ['oral-only', 'No write/edit or document hash change for one suggestion explicitly not saved.'],
      ] });
    for (const [path, body] of Object.entries(fixtures)) { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), body); }
    h = await harness(t, { existingRoot: root, withController: true, realSummaryHome: routeHome });
    service = await mountSummaryVault(h);
    workspace = await h.ctx.workspaceRegistry.resolveByPath(root);
    h.ctx.on('session/event', (session, event) => {
      const d = event.data;
      const e = { order: ++order, at: now(), sessionId: session.id, seq: event.seq, type: event.type, stage: stageName };
      if (event.type === 'tool/call') Object.assign(e, { callId: d.callId, name: d.name, arguments: clean(argsOf(event)) });
      else if (event.type === 'tool/result') Object.assign(e, { toolCallId: d.message.toolCallId, isError: d.message.isError, content: content(d.message.content) });
      else if (event.type === 'assistant/message') Object.assign(e, { content: content(d.message.content) });
      else if (event.type === 'user/message') Object.assign(e, { source: clean(d.source), content: content(d.content) });
      else if (event.type === 'turn/end') e.reason = clean(d.reason);
      else if (event.type !== 'turn/start') { order--; return; }
      events.push(e);
      if (event.type === 'assistant/message' && textOf(e).trim()) console.log(JSON.stringify({ probe: 'error-recommend-public', role: session.id === home?.id ? 'home' : 'teacher', stage: stageName, text: textOf(e) }));
      writeFileSync(join(output, 'events-public.json'), JSON.stringify(clean(events), null, 2));
    });
    h.ctx.on('llm/stream', (options, next) => {
      budget();
      if (report.modelRequests.length >= report.limits.modelRequests) throw new Error('45 model-request budget exhausted');
      assert.equal(options.provider, report.model.provider); assert.equal(options.model, report.model.model);
      modelStart ??= Date.now();
      const row = { number: report.modelRequests.length + 1, at: now(), order: ++order, stage: stageName, sessionId: options.sessionId, provider: options.provider, model: options.model };
      report.modelRequests.push(row);
      requests.push({ ...row, messages: options.messages.map(m => ({ role: m.role, source: clean(m.source), content: content(m.content) })) });
      writeFileSync(join(output, 'requests-public.json'), JSON.stringify(clean(requests), null, 2));
      writeFileSync(join(output, 'report.json'), JSON.stringify(clean(report), null, 2));
      return next();
    });
    h.ctx.on('tools/pre-execute', async (exec, next) => {
      budget();
      if (['subagent', 'start_topic'].includes(exec.name) || (exec.name === 'send_message' && ![home?.id, teacher?.id].includes(exec.arguments?.agent_id)) || !await checkSummaryProbeAccess(root, resources, exec.name, exec.arguments)) {
        report.guards.push({ at: now(), stage: stageName, name: exec.name, arguments: clean(exec.arguments) });
        return { kind: 'deny', reason: '本次隔离验收只使用现有首页与本课老师，禁止新增会话、命令执行及访问外部学生资料。' };
      }
      return next();
    });
    timer = setTimeout(() => void stop('14 minute model-run time limit'), 14 * 60 * 1000); timer.unref();
    home = await h.create('notara-coordinator'); report.sessions.home = home.id;
    stageName = '00-native-binding';
    const topic = await h.ctx.notaraTopics.start(home, {
      description: '商法则错因复盘（模拟）',
      prompt: '这是隔离验收的模拟学生课堂；所有背景与后续学生回答均为合成数据，不是真实学情。本节已准备，课稿在“备课/商法则错因复盘.md”，原作答与草稿在“来源/原作答与草稿.md”，画像在“画像.md”，旧路线在“路线/导数基础.md”。学生要复盘这道错题，稍后会亲自说明疑问。',
    }, 'error-recommend-frozen-one-run', new AbortController().signal);
    teacher = h.ctx.agents.get(topic.id); report.sessions.teacher = teacher.id;
    await h.ctx.notaraVault.bindLessonPlan({ workspaceId: workspace.id, sessionId: teacher.id, path: paths.lesson });
    await settle();
    assert.notEqual(teacher.session.header.origin, 'subagent');
    assert.equal(await h.ctx.notaraTopics.origin(teacher.id), home.id);
    const before = await snapshot('00-before-student');
    const first = await send(teacher, inputs.first, '01-unknown-cause');
    await send(teacher, inputs.explanation, '02-student-explains');
    const closed = await send(teacher, inputs.close, '03-close-delivery');
    const recommended = await send(home, inputs.recommend, '04-save-recommendation');
    const oral = await send(home, inputs.oral, '05-oral-only');
    const calls = events.filter(e => e.type === 'tool/call');
    const deliveries = calls.filter(e => e.name === 'lesson_summary' && e.arguments?.action === 'deliver');
    const receipts = service.store.entries();
    check('real native home and teacher binding', true, 'one ordinary teacher bound to one native home', report.sessions, 'session/event stream');
    check('real model route and bounded requests', report.modelRequests.length > 0 && report.modelRequests.length <= 45, 'DeepSeek official v4 pro, <=45 requests', { count: report.modelRequests.length, model: report.model }, 'provider');
    check('actual summary handoff and completed receipts', deliveries.length > 0 && receipts.length > 0 && receipts.every(([, r]) => summaryReceiptComplete(r)), 'actual deliver call and complete selected target receipts', { deliverCalls: deliveries.length, receipts }, 'persistence');
    check('profile changed after diagnostic conversation', closed.hashes[paths.profile] !== first.hashes[paths.profile], 'home maintains sourced current diagnosis after delivery', { before: first.hashes[paths.profile], after: closed.hashes[paths.profile] }, 'persistence');
    check('recommendation persisted in existing profile', /^## 首页推荐\s*$/m.test(recommended.documents[paths.profile]) && recommended.dto.teacherRecommendations?.path === paths.profile && recommended.dto.teacherRecommendations.items.length > 0, 'nonempty home recommendation list in existing profile', recommended.dto.teacherRecommendations, 'projection');
    check('teacher list has priority over live fallback', Boolean(recommended.dto.route) && recommended.actions.primary?.id.startsWith('teacher:') && recommended.actions.alternatives.every(a => a.id.startsWith('teacher:')), 'teacher list exclusive priority; old route remains available', { before: before.actions, route: recommended.dto.route, after: recommended.actions }, 'frontend model');
    const oralWrites = calls.filter(e => e.stage === '05-oral-only' && ['write', 'edit'].includes(e.name));
    check('oral-only request preserves all document bytes', JSON.stringify(recommended.hashes) === JSON.stringify(oral.hashes) && oralWrites.length === 0, 'all document hashes unchanged and no write/edit', { before: recommended.hashes, after: oral.hashes, writes: oralWrites }, 'persistence');
    report.skillLoads = calls.filter(e => e.name === 'skill').map(e => ({ stage: e.stage, ...e.arguments }));
    report.semanticReview = { status: 'NOT RUN', owner: 'validation engineer then parent must inspect public original replies and sourced profile', stages: ['01-unknown-cause', '02-student-explains', '03-close-delivery', '04-save-recommendation'] };
    report.status = report.checks.some(c => c.status === 'FAIL') ? 'FAIL' : 'OBSERVED_REQUIRES_SEMANTIC_REVIEW';
  } catch (error) {
    report.status = report.modelRequests.length ? 'FAIL' : 'BLOCKED';
    report.failure = { stage: stageName, name: error.name, message: scrub(error.message) };
  } finally {
    if (timer) clearTimeout(timer);
    if (h) {
      await stop('experiment cleanup');
      try { await snapshot('last-state'); } catch (error) { report.snapshotError = scrub(error.message); }
      await h.ctx.fiber.dispose();
    }
    await rm(root, { recursive: true, force: true });
    await rm(routeHome, { recursive: true, force: true });
    report.finishedAt = now(); report.elapsedMs = Date.now() - Date.parse(report.startedAt);
    report.modelElapsedMs = modelStart ? Date.now() - modelStart : 0;
    report.cleanup = { syntheticWorkspaceRemoved: true, temporaryRouteRemoved: true, privateAuthCopy: 'harness test cleanup', servicesStarted: 0 };
    await flush();
    console.log(JSON.stringify({ probe: 'error-recommend-result', status: report.status, requests: report.modelRequests.length, studentMessages: report.studentMessages.length, elapsedMs: report.elapsedMs, output }));
  }
  assert.ok(!['FAIL', 'BLOCKED'].includes(report.status), report.failure?.message ?? JSON.stringify(report.checks.filter(c => c.status === 'FAIL')));
}
