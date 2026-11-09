import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVaultStore } from '../../vault-sqlite/vault-indexer.js';
import { readLearningContext } from '../learning-context.js';

const profile = body => `---\ntype: learner-profile\n---\n${body}`;
const route = body => `---\ntype: route\nstatus: active\n---\n${body}`;
const currentProfile = '# 学习画像\n\n## 当前学情结论与未知边界\n\n- 基础：已学二次函数；极限证明尚未检验。\n- 卡点：商法则负号仍需提示。\n\n## 沟通与教学偏好\n\n- 每步慢讲，先让我尝试；只用高中方法。\n';
const currentRoute = '# 导数路线\n\n## 里程碑与校验\n\n- [x] 看过商法则例题\n- [ ] 独立检查商法则负号\n  - 校验依据：无提示写出完整步骤。\n  - 待补内容：仍需区分提示后完成与独立完成。\n\n## 下一步行动\n\n- 当前下一步：独立完成一道判号题，再讨论含参分类。\n';

function fixture(t, files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'notara-learning-context-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  const store = createVaultStore({ root, cachePath: ':memory:' });
  store.scan();
  t.after(async () => { await store.close(); rmSync(root, { recursive: true, force: true }); });
  const agent = { id: 'classroom-a', ctx: {}, session: { header: { cwd: root, agentPreset: 'notara-teacher' } } };
  const calls = [];
  const services = {
    agentPresets: { composedPreset: scope => { assert.equal(scope, agent.ctx); return agent.session.header.agentPreset; } },
    workspaceRegistry: {
      resolveByPath: async path => { calls.push({ method: 'resolveByPath', path }); assert.equal(path, root); return { id: 'workspace-a', path: root }; },
      get current() { throw Error('must not use the UI workspace'); },
    },
    notaraVault: Object.fromEntries(['query', 'read', 'homeRecommendations'].map(method => [method, async input => {
      calls.push({ method, ...input });
      assert.equal(input.workspaceId, 'workspace-a', `${method} must bind the session workspace`);
      const { workspaceId, ...request } = input;
      return store[method](request);
    }])),
    sessionQuery: { readSurface() { throw Error('must not load classroom history'); } },
  };
  return { root, store, calls, agent, services, ctx: { get: name => services[name] }, assembly: { agent, scope: agent } };
}

test('current profile and route templates carry exploration supports, questions and recent state into real learner context', async t => {
  const template = name => readFileSync(new URL(`../../../templates/base-files/${name}.md`, import.meta.url), 'utf8')
    .replace(/^template: true\r?\n/m, '');
  const profileDocument = template('learner-profile')
    .replace('## 当前理解与可用支点', '## 当前理解与可用支点\n\n学生比较了两组锰性质的条件；AI负责整理资料，学生提出解释并修正原想法。')
    .replace('## 正在追问的问题', '## 正在追问的问题\n\n继续追问：酸碱条件改变后，解释是否仍成立？')
    .replace('## 近期目标与约束', '## 近期目标与约束\n\n本次自述考前紧张，来源为今日课堂；下次自述已恢复，按当前状态安排。');
  const routeDocument = template('route')
    .replace('- [ ] 里程碑 1：目标说明', '- [ ] 比较条件并完善解释')
    .replace('阶段依据（看什么认识、作品或表现）：', '阶段依据（看什么认识、作品或表现）：保留一份带来源的条件比较图，不要求独立短测。')
    .replace('- 当前下一步：', '- 当前下一步：沿学生的新问题核对条件，保留共同完成的贡献。');
  const files = { '画像/当前.md': profileDocument, '路线/探索.md': routeDocument };
  const f = fixture(t, files);
  for (const preset of ['notara-teacher', 'notara-coordinator']) {
    f.agent.session.header.agentPreset = preset;
    const { text } = await readLearningContext(f.ctx, f.assembly);
    for (const excerpt of ['AI负责整理资料，学生提出解释并修正原想法', '酸碱条件改变后，解释是否仍成立', '下次自述已恢复', '带来源的条件比较图，不要求独立短测', '保留共同完成的贡献']) assert.ok(text.includes(excerpt), excerpt);
  }
  for (const [path, content] of Object.entries(files)) assert.equal(readFileSync(join(f.root, path), 'utf8'), content);
});

test('ordinary teacher and coordinator get existing preferences, current gaps and route progress from the real session workspace', async t => {
  const files = { '画像/数学.md': profile(currentProfile), '路线/导数.md': route(currentRoute), '卡片/不应读取.md': '# 不应自动读取', '日记/2026-11-01.md': '# 不应自动读取日记' };
  const f = fixture(t, files);
  for (const preset of ['notara-teacher', 'notara-coordinator']) {
    f.agent.session.header.agentPreset = preset;
    const result = await readLearningContext(f.ctx, f.assembly);
    assert.equal(result.name, 'notara-learning-context');
    assert.equal(result.interpolate, false);
    for (const text of ['每步慢讲', '极限证明尚未检验', '商法则负号仍需提示', '1/2', '独立完成一道判号题']) assert.ok(result.text.includes(text), text);
    for (const path of ['画像/数学.md', '路线/导数.md']) {
      assert.ok(result.text.includes(path));
      assert.ok(result.text.includes(f.store.read({ path }).revision));
    }
    assert.match(result.text, /已有记录/);
    assert.match(result.text, /不是.*(?:本轮|新).*学生.*表达/);
    assert.match(result.text, /不代表.*掌握/);
  }
  assert.ok(f.calls.filter(call => call.method === 'read').every(call => ['画像/数学.md', '路线/导数.md'].includes(call.path)));
  assert.ok(f.calls.filter(call => call.method === 'query').every(call => call.type === 'learner-profile'));
  for (const [path, content] of Object.entries(files)) assert.equal(readFileSync(join(f.root, path), 'utf8'), content, 'helper must not write documents');
});

test('only the long-term teacher receives indexed revisit pointers, without copying whole cards or requiring review history', async t => {
  const f = fixture(t, { '问题.md': '---\ntype: concept\n---\n## 内容\n不是自动注入的题干\n## 学生理解\n学生经提示提出先分解。\n### 下次探讨\n- 如果不能分解呢？\n' });
  f.agent.session.header.agentPreset = 'notara-coordinator';
  const main = await readLearningContext(f.ctx, f.assembly);
  assert.match(main.text, /如果不能分解呢/); assert.match(main.text, /问题.md/);
  assert.doesNotMatch(main.text, /不是自动注入的题干/);
  f.agent.session.header.agentPreset = 'notara-teacher';
  const teacher = await readLearningContext(f.ctx, f.assembly);
  assert.ok(!teacher || !teacher.text.includes('如果不能分解呢'));
});

test('scope-only native assemblies are accepted, while missing cwd and mismatched agent/scope return null without reads', async t => {
  const f = fixture(t, { '画像.md': profile(currentProfile) });
  assert.match((await readLearningContext(f.ctx, { scope: f.agent })).text, /每步慢讲/);
  f.calls.length = 0;
  for (const context of [{}, { agent: f.agent, scope: { ...f.agent } }, { agent: { session: { header: {} } } }]) assert.equal(await readLearningContext(f.ctx, context), null);
  assert.equal(f.calls.length, 0);
});

test('worker, organizer, companion, blind and unknown presets never receive the context, including stale teacher headers', async t => {
  const f = fixture(t, { '画像.md': profile(currentProfile) });
  for (const preset of ['worker-general', 'worker-review', 'notara-material-organizer', 'companion-gpt', 'companion-deepseek-blind', 'unknown', undefined]) {
    f.services.agentPresets.composedPreset = () => preset;
    assert.equal(await readLearningContext(f.ctx, f.assembly), null, String(preset));
  }
  assert.equal(f.calls.length, 0);
});

test('long explicit history is replaced by a source locator and never crowds out later current foundations, gaps or preferences', async t => {
  const history = '- 旧课堂证据：曾经被提示过，不代表当前掌握。\n'.repeat(3000);
  const body = '# 画像\n\n## 历史记录\n\n' + history + '\n### 去年旧观察\n\n旧结论。\n\n## 当前基础与卡点\n\n- 分式通分已学，负号仍需提示。\n\n## 沟通与教学偏好\n\n- 慢讲，先独立尝试，不要直接揭答案。\n';
  const f = fixture(t, { '画像.md': profile(body) });
  const result = await readLearningContext(f.ctx, f.assembly);
  assert.match(result.text, /分式通分已学，负号仍需提示/);
  assert.match(result.text, /慢讲，先独立尝试，不要直接揭答案/);
  assert.doesNotMatch(result.text, /旧课堂证据|去年旧观察|旧结论/);
  assert.ok(result.text.includes('画像.md#L6'), 'omitted section locator uses original file lines');
  assert.match(result.text, /省略.*历史/);
  assert.match(result.text, /read/);
  assert.ok(result.text.includes(f.store.read({ path: '画像.md' }).revision));
});

test('very long current sections, final paragraphs, list lines and multiline formulas are retained in full without a character budget', async t => {
  const formula = String.raw`$$
\begin{aligned}
f'(x)&=\frac{u'(x)v(x)-u(x)v'(x)}{v(x)^2}\\
&\text{这里仍需独立核对负号与定义域。}
\end{aligned}
$$`;
  const overview = '当前基础与限制：仍需逐项核对条件。'.repeat(900);
  const preference = '- 沟通偏好：先给完整题面，等待我尝试，再按需要提示。'.repeat(600);
  const body = `# 画像\n\n## 当前学情\n\n${overview}\n\n${formula}\n\n当前概况最后一段必须完整。\n\n## 教学偏好\n\n${preference}\n\n最后的偏好也必须保留。\n`;
  const next = `## 下一步行动\n\n- 先完整解释下式：\n\n${formula}\n\n- 再让我独立核对，暂不增加新题。\n`;
  const f = fixture(t, { '画像.md': profile(body), '路线.md': route('# 路线\n\n' + next) });
  const result = await readLearningContext(f.ctx, f.assembly);
  assert.ok(result.text.includes(body));
  assert.ok(result.text.includes(next));
  assert.ok(result.text.includes(overview));
  assert.ok(result.text.includes(preference));
  assert.equal(result.text.split(formula).length - 1, 2, 'both formulas remain whole');
});

test('unstructured and unfamiliar sections remain whole, including their final paragraph and CRLF math', async t => {
  const body = ('没有标题的当前自述，需要保留全部条件。\r\n\r\n'.repeat(600)) + '## 历史学科基础\r\n\r\n历史课已学到明代；不是归档区。\r\n\r\n最后一段：$a^2+b^2=c^2$，熟练度未知。\r\n';
  const f = fixture(t, { '画像.md': profile(body) });
  assert.ok((await readLearningContext(f.ctx, f.assembly)).text.includes(body));
});

test('only actual history sections are omitted; heading-looking text inside formulas and fenced examples stays intact', async t => {
  const body = '# 画像\n\n## 当前概况\n\n$$\n## 历史记录\n\\text{公式中的标题不是分节}\n$$\n\n\\[\n## 归档记录\n\\text{仍是当前公式}\n\\]\n\n```markdown\n## 历史记录\n示例中的标题不是分节\n```\n\n- 当前偏好仍是完整列表行。\n\n## 历史记录\n\n真实旧历史应省略。\n\n## 当前未知\n\n无提示完成情况未知。\n';
  const f = fixture(t, { '画像.md': profile(body) });
  const result = await readLearningContext(f.ctx, f.assembly);
  assert.match(result.text, /公式中的标题不是分节/);
  assert.match(result.text, /仍是当前公式/);
  assert.match(result.text, /示例中的标题不是分节/);
  assert.match(result.text, /当前偏好仍是完整列表行/);
  assert.doesNotMatch(result.text, /真实旧历史应省略/);
  assert.match(result.text, /无提示完成情况未知/);
});

test('explicit archived details can be omitted as a whole while current details and evidence are preserved', async t => {
  const body = '# 画像\n\n<details>\n<summary>演进记录</summary>\n\n旧归档证据。\n<details><summary>更早记录</summary>\n旧嵌套证据。\n</details>\n</details>\n\n<details>\n<summary>当前卡点</summary>\n\n负号尚需提示。\n</details>\n\n## 事实证据与原话记录\n\n学生明确说“请慢讲”；独立检验未知。\n';
  const f = fixture(t, { '画像.md': profile(body) });
  const result = await readLearningContext(f.ctx, f.assembly);
  assert.doesNotMatch(result.text, /旧归档证据|旧嵌套证据/);
  assert.match(result.text, /负号尚需提示/);
  assert.match(result.text, /学生明确说“请慢讲”；独立检验未知/);
});

test('mixed current/history headings and details with literal tags never discard necessary current content', async t => {
  const mixed = '## 历史记录与当前偏好\n\n我现在要求慢讲；保留完整的新偏好。\n';
  const folded = '<details>\n<summary>当前概况</summary>\n\n```html\n</details>\n## 历史记录\n这里是当前示例，不能当成归档删掉。\n```\n\n最后一个当前条件。\n</details>\n';
  const noSummary = '<details>\n\n当前条件在没有 summary 的折叠里。\n<details><summary>历史记录</summary>\n旧例子。\n</details>\n</details>\n';
  const f = fixture(t, { '画像.md': profile('# 画像\n\n' + mixed + '\n' + folded + '\n' + noSummary) });
  const result = await readLearningContext(f.ctx, f.assembly);
  assert.ok(result.text.includes(mixed));
  assert.ok(result.text.includes(folded));
  assert.ok(result.text.includes(noSummary));
});

test('multiple profiles keep distinct provenance and conflicting preferences; templates and archived files are not current evidence', async t => {
  const f = fixture(t, {
    '画像/数学.md': profile('# 数学\n\n偏好先自行尝试；范围未知。\n'),
    '画像/物理.md': profile('# 物理\n\n偏好先看完整示范；独立能力未知。\n'),
    '模板/画像.md': profile('# 模板虚构偏好\n'),
    '自定义模板.md': '---\ntype: learner-profile\ntemplate: true\n---\n不是真实学情。\n',
    '旧画像.md': '---\ntype: learner-profile\nstatus: archived\n---\n旧画像的失效偏好。\n',
  });
  const result = await readLearningContext(f.ctx, f.assembly);
  for (const path of ['画像/数学.md', '画像/物理.md']) {
    assert.ok(result.text.includes(path));
    assert.ok(result.text.includes(f.store.read({ path }).revision));
  }
  assert.match(result.text, /偏好先自行尝试/);
  assert.match(result.text, /偏好先看完整示范/);
  assert.match(result.text, /(?:分别|独立).*来源|不.*合并/);
  assert.doesNotMatch(result.text, /模板虚构偏好|不是真实学情|失效偏好/);
});

test('empty Vault produces no invented learning state and does not create documents', async t => {
  const f = fixture(t);
  const result=await readLearningContext(f.ctx, f.assembly);
  assert.equal(result.text,'');assert.deepEqual(result.documents,[]);assert.equal(result.complete,true);
  assert.equal(f.store.query({}).total, 0);
  assert.equal(f.calls.filter(call => call.method === 'read').length, 0);
});

test('multiple active routes keep full learner background but expose only candidate locators until associated', async t => {
  const f=fixture(t,{'画像.md':profile(currentProfile),'数学.md':route('# 数学\n数学专用教学细节'),'化学.md':route('# 化学\n化学专用教学细节')});
  const result=await readLearningContext(f.ctx,f.assembly);
  assert.ok(result.text.includes(currentProfile));
  assert.match(result.text,/候选定位/);
  assert.match(result.text,/数学.md/);assert.match(result.text,/化学.md/);
  assert.doesNotMatch(result.text,/数学专用教学细节|化学专用教学细节/);
  assert.deepEqual(f.calls.find(call=>call.method==='homeRecommendations').routeContext,{sessionId:'classroom-a'});
});

test('durable explicit handoff route and existing session links guide context without losing complete profiles',async t=>{
  const f=fixture(t,{'画像.md':profile(currentProfile),'数学.md':route('# 数学\n数学专用教学细节\n[[session:classroom-a|本课]]'),'化学.md':route('# 化学\n化学专用教学细节')});
  const first=await readLearningContext(f.ctx,f.assembly);
  assert.match(first.text,/数学专用教学细节/);assert.doesNotMatch(first.text,/化学专用教学细节/);
  f.agent.session.snapshotEvents=()=>[{type:'user/message',data:{source:{kind:'notara-topic-handoff',routePath:'化学.md'}}}];
  const explicit=await readLearningContext(f.ctx,f.assembly);
  assert.match(explicit.text,/化学专用教学细节/);assert.doesNotMatch(explicit.text,/数学专用教学细节/);
  assert.ok(explicit.text.includes(currentProfile));
  f.agent.session.snapshotEvents=()=>[{type:'user/message',data:{source:{kind:'notara-topic-handoff',routePath:'已删除.md'}}}];
  const missing=await readLearningContext(f.ctx,f.assembly);
  assert.match(missing.text,/已缺失或非活跃/);assert.doesNotMatch(missing.text,/数学专用教学细节|化学专用教学细节/);
});

test('profile metadata pagination does not become a hidden cap on current profiles', async t => {
  const files = Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`画像/${index}.md`, profile(`# 画像 ${index}\n\n当前偏好来源 ${index}。\n`)]));
  const f = fixture(t, files);
  const result = await readLearningContext(f.ctx, f.assembly);
  assert.equal(f.calls.filter(call => call.method === 'query').length, 2);
  assert.equal(f.calls.filter(call => call.method === 'read').length, 101);
  for (let index = 0; index < 101; index++) assert.ok(result.text.includes(`当前偏好来源 ${index}。`));
});

test('a route changed since its recommendation uses the latest document revision without repeating stale progress', async t => {
  const f = fixture(t, { '路线.md': route(currentRoute) });
  const recommendations = f.services.notaraVault.homeRecommendations;
  f.services.notaraVault.homeRecommendations = async input => {
    const previous = await recommendations(input);
    f.store.save({ path: '路线.md', expectedRevision: previous.route.revision, content: route('# 新路线\n\n- [ ] 新的待验证任务\n\n## 下一步行动\n\n- 先确认新的目标与范围。\n') });
    return previous;
  };
  const result = await readLearningContext(f.ctx, f.assembly);
  assert.ok(result.text.includes(f.store.read({ path: '路线.md' }).revision));
  assert.match(result.text, /先确认新的目标与范围/);
  assert.match(result.text, /(?:更新|变更)/);
  assert.doesNotMatch(result.text, /1\/2|独立完成一道判号题/);
});

test('inactive routes, due cards, unrelated summaries and already-bound lesson state are not injected', async t => {
  const f = fixture(t, { '画像.md': profile(currentProfile), '路线.md': '---\ntype: route\nstatus: paused\n---\n旧路线不应推荐。\n' });
  const recommend = f.services.notaraVault.homeRecommendations;
  f.services.notaraVault.homeRecommendations = async input => ({ ...await recommend(input),
    due: { total: 99, cards: [{ title: '不能由排期推断掌握' }] },
    followUp: { path: '日记/别课.md', snippet: '别课总结不重复注入' },
    continuation: { path: '备课/本课.md', currentTask: { content: '已绑定本课状态另有context' } },
  });
  const result = await readLearningContext(f.ctx, f.assembly);
  assert.doesNotMatch(result.text, /旧路线不应推荐|不能由排期推断掌握|别课总结不重复注入|已绑定本课状态另有context/);
  assert.match(result.text, /极限证明尚未检验/);
  assert.doesNotMatch(result.text, /已掌握极限|掌握率|BKT/);
});

test('profile read failure is explicit and preserves readable route state without leaking host error details', async t => {
  const f = fixture(t, { '画像.md': profile(currentProfile), '路线.md': route(currentRoute) });
  const read = f.services.notaraVault.read;
  f.services.notaraVault.read = input => input.path === '画像.md' ? Promise.reject(Object.assign(Error('private-host-error-do-not-echo'), { code: 'EACCES' })) : read(input);
  const result = await readLearningContext(f.ctx, f.assembly);
  assert.match(result.text, /画像\.md/);
  assert.match(result.text, /暂不可读|读取失败/);
  assert.match(result.text, /独立完成一道判号题/);
  assert.doesNotMatch(result.text, /private-host-error|无学情|没有学习记录/);
});

test('a raced missing file is distinguished from unreadable data and never becomes an empty profile', async t => {
  const f = fixture(t, { '画像.md': profile(currentProfile) });
  const query = f.services.notaraVault.query;
  f.services.notaraVault.query = async input => { const found = await query(input); unlinkSync(join(f.root, '画像.md')); return found; };
  const result = await readLearningContext(f.ctx, f.assembly);
  assert.match(result.text, /画像\.md/);
  assert.match(result.text, /缺失|不存在/);
  assert.doesNotMatch(result.text, /每步慢讲|已掌握/);
});

test('missing workspace and failed queries/recommendations are reported as unavailable rather than fake empty learning state', async t => {
  const f = fixture(t, { '画像.md': profile(currentProfile) });
  f.services.workspaceRegistry.resolveByPath = async () => null;
  assert.match((await readLearningContext(f.ctx, f.assembly)).text, /暂不可读|未能读取/);
  assert.equal(f.calls.length, 0, 'must never fall back to the default Vault');
  f.services.workspaceRegistry.resolveByPath = async () => ({ id: 'workspace-a' });
  f.services.notaraVault.query = async () => { throw Error('query failed'); };
  f.services.notaraVault.homeRecommendations = async () => { throw Error('recommendation failed'); };
  const result = await readLearningContext(f.ctx, f.assembly);
  assert.match(result.text, /暂不可读|未能读取/);
  assert.doesNotMatch(result.text, /没有学习记录|无学情/);
});

test('malformed source responses remain unavailable instead of disappearing or injecting unversioned evidence', async t => {
  for (const failure of ['query', 'route', 'read']) {
    const f = fixture(t, { '画像.md': profile(currentProfile) });
    if (failure === 'query') f.services.notaraVault.query = async () => ({ documents: null, total: 1 });
    if (failure === 'route') {
      f.services.notaraVault.query = async () => ({ documents: [], total: 0 });
      f.services.notaraVault.homeRecommendations = async () => ({ route: {} });
    }
    if (failure === 'read') f.services.notaraVault.read = async input => ({ path: input.path, content: profile('无版本的证据不应注入。'), revision: 7 });
    const result = await readLearningContext(f.ctx, f.assembly);
    assert.ok(result, failure);
    assert.match(result.text, /暂不可读|未能读取/, failure);
    assert.doesNotMatch(result.text, /无版本的证据不应注入/);
  }
});

test('abort before or during any read boundary propagates and stops subsequent work', async t => {
  for (const phase of ['before', 'resolveByPath', 'query', 'read', 'homeRecommendations']) {
    const f = fixture(t, { '画像.md': profile(currentProfile), '路线.md': route(currentRoute) });
    const controller = new AbortController();
    if (phase === 'before') controller.abort();
    else {
      const service = phase === 'resolveByPath' ? f.services.workspaceRegistry : f.services.notaraVault;
      const original = service[phase];
      service[phase] = async input => { const result = await original(input); controller.abort(); return result; };
    }
    await assert.rejects(readLearningContext(f.ctx, { ...f.assembly, signal: controller.signal }), { name: 'AbortError' }, phase);
    if (phase === 'before') assert.equal(f.calls.length, 0);
    else assert.equal(f.calls.at(-1).method, phase);
  }
  const f = fixture(t);
  f.services.notaraVault.query = async () => { throw new DOMException('cancelled', 'AbortError'); };
  await assert.rejects(readLearningContext(f.ctx, f.assembly), { name: 'AbortError' });
});
