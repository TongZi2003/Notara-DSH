import assert from 'node:assert/strict';
import test from 'node:test';
import { buildHomeActions, createRecommendationLoader, isRecommendationHero, parseRecommendations, supportLabel, taskLabel, QUICK_REQUESTS } from '../src/model.js';
import { canOpenSession, openContinuationSession, prefillComposer, registerReference, REFERENCE_SOURCE } from '../src/composer.js';

const empty = () => ({ due: { total: 0, cards: [] }, guide: null, diary: { path: '日记/2026-10-24.md', exists: false } });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test('only authored recommendations become cards; classroom fallback is navigation, never filler', () => {
  const doc = { path: '材料.md', title: '均值不等式', revision: 'r1' };
  const data = { ...empty(), due: { total: 1, cards: [doc] },
    guide: { ...doc, completed: 0, total: 1, nextTask: { line: 8, text: '教师安排' } },
    revisits: [{ ...doc, kind: 'card-next', snippet: '需要追问' }],
    route: { ...doc, status: 'active', completed: 0, total: 1, nextAction: {
      text: '教师内部的进度判断', references: [], sessions: [{ sessionId: 's_class', label: '均值不等式讨论' }],
    } },
  };
  assert.deepEqual(buildHomeActions(data), { primary: null, alternatives: [], continuation: null });
  const result = buildHomeActions(data, { canOpenSession: id => id === 's_class' });
  assert.equal(result.primary, null);
  assert.deepEqual(result.alternatives, []);
  assert.deepEqual(result.continuation, { kind: 'open-session', sessionId: 's_class', title: '均值不等式讨论' });
  assert.doesNotMatch(JSON.stringify(result), /教师内部|需要追问|教师安排/);
  assert.equal(buildHomeActions({ ...data, route: { ...data.route, status: 'archived' } }, { canOpenSession: () => true }).continuation, null);
});

test('four task entries hand off exploration, exam support and purposeful practice', () => {
  assert.deepEqual(QUICK_REQUESTS.map(item => [item.id, item.label]), [
    ['exam-diagnosis', '试卷诊断与补强'], ['school-notes', '笔记整理与拓展'],
    ['exam-cram', '考前复习与状态准备'], ['practice-design', '题库提高练习'],
  ]);
  assert.match(QUICK_REQUESTS[0].text, /实际作答/);
  assert.match(QUICK_REQUESTS[1].text, /拓展/);
  assert.match(QUICK_REQUESTS[2].text, /状态/);
  assert.match(QUICK_REQUESTS[3].text, /知识标签/);
});

test('validates shared DTO, retaining unknown support without asserting mastery', () => {
  assert.deepEqual(parseRecommendations(empty()), empty());
  assert.throws(() => parseRecommendations({}), TypeError);
  assert.throws(() => parseRecommendations({ ...empty(), due: { total: 1, cards: [{ path: '/private/file', title: 'x', revision: 'a' }] } }), TypeError);
  assert.throws(() => parseRecommendations({ ...empty(), guide: { path: '导读.md', title: '导读', revision: 'r1', completed: 4, total: 2, nextTask: null } }));
  assert.equal(supportLabel(null), '上次帮助情况未记录');
  assert.equal(supportLabel('hint'), '上次有提示');
  assert.equal(taskLabel('尝试 [[卡片/求导.md|求导]]'), '尝试 求导');
  assert.equal(QUICK_REQUESTS.length, 4);
});

test('native RemoteResult success unwraps; remote failure and malformed envelopes fail explicitly', async () => {
  for (const [result, phase] of [
    [{ ok: true, value: empty() }, 'ready'],
    [{ ok: false, error: new Error('PRIVATE_HOST_ERROR') }, 'error'],
    [{ ok: false, value: empty(), error: new Error('failure wins') }, 'error'],
    [{ ok: true, value: {} }, 'error'],
    [{ ok: 'true', value: empty() }, 'error'],
    [empty(), 'error'],
  ]) {
    const updates = [];
    await createRecommendationLoader(() => result, value => updates.push(value)).load();
    assert.equal(updates.at(-1).phase, phase);
    if (phase === 'ready') assert.deepEqual(updates.at(-1).data, empty());
    else assert.deepEqual(updates.at(-1), { phase: 'error' });
  }
});

test('latest recommendation response wins; disposed requests cannot publish', async () => {
  const old = deferred(), latest = deferred(), updates = [];
  let calls = 0;
  const loader = createRecommendationLoader(() => (++calls === 1 ? old.promise : latest.promise), value => updates.push(value));
  const first = loader.load(), second = loader.load();
  latest.resolve({ ok: true, value: empty() }); await second;
  old.resolve({ ok: true, value: { ...empty(), due: { total: 10, cards: [] } } }); await first;
  assert.deepEqual(updates.map(value => value.phase), ['loading', 'loading', 'ready']);
  assert.equal(updates.at(-1).data.due.total, 0);
  const pending = deferred();
  const other = createRecommendationLoader(() => pending.promise, value => updates.push(value));
  const load = other.load(); other.dispose(); pending.reject(new Error('late')); await load;
  assert.equal(updates.at(-1).phase, 'loading');
});

test('errors are recoverable and malformed responses do not render an empty state', async () => {
  let fail = true; const updates = [];
  const loader = createRecommendationLoader(() => ({ ok: true, value: fail ? {} : empty() }), value => updates.push(value));
  await loader.load(); assert.equal(updates.at(-1).phase, 'error');
  fail = false; await loader.load(); assert.equal(updates.at(-1).phase, 'ready');
});

test('recommendations only occupy the native empty-session hero', () => {
  const blank = { blank: true, running: false, promptAttempted: false, awaitingFirstTurn: false, removed: false };
  assert.equal(isRecommendationHero(blank, false), true);
  assert.equal(isRecommendationHero(blank, true), false);
  for (const patch of [{ running: true }, { promptAttempted: true }, { removed: true }, { blank: false }]) {
    assert.equal(isRecommendationHero({ ...blank, ...patch }, false), false);
  }
});

function nativeProbe({ phase = 'plain', active = 's1', blocked = false, accept = true } = {}) {
  let state = { phase, draft: '我的尝试【已有资料】', draftRev: 7, occurrences: [{ source: 'old-source', ref: 'old', length: 6 }] };
  const calls = [];
  const input = { state: { getSnapshot: () => state }, insertReference(reference, span) {
    calls.push({ kind: 'reference', reference, span });
    state = { ...state, draft: state.draft + reference.clipboardText, draftRev: state.draftRev + 1,
      occurrences: [...state.occurrences, { ...reference, length: reference.clipboardText.length }] };
    return true;
  } };
  const scope = { bail(_scope, event, payload) { calls.push({ event, payload }); if (accept) state = { ...state, draft: state.draft + payload.text, draftRev: state.draftRev + 1 }; return accept; } };
  const ctx = { sessions: { scope: () => scope, list: { getSnapshot: () => ({ byId: { [active]: { id: active, retainedBy: { mainView: 1 } } } }) } },
    conversation: { input: { for: () => input }, blocks: { storeFor: () => ({ getSnapshot: () => blocked }) } } };
  return { ctx, calls, state: () => state };
}

test('native prefill preserves existing text and reference tokens and never sends', () => {
  const probe = nativeProbe();
  const request = { text: '请带我复习', reference: { path: '卡片/定义.md', title: '定义', revision: 'r1' } };
  assert.equal(prefillComposer(probe.ctx, 's1', request), true);
  assert.equal(probe.calls[0].reference.source, REFERENCE_SOURCE);
  assert.equal(probe.calls[0].span.start, 5);
  assert.equal(probe.calls[1].payload.span.draftRev, 8);
  assert.equal(probe.calls[1].payload.text, '\n\n请带我复习');
  assert.ok(probe.state().draft.startsWith('我的尝试【已有资料】'));
  assert.equal(probe.state().occurrences[0].ref, 'old');
  assert.equal(prefillComposer(probe.ctx, 's1', request), true);
  assert.equal(probe.calls.length, 2, 'repeated click does not duplicate request or reference');
  assert.deepEqual(probe.calls.filter(call => call.event).map(call => call.event), ['slash/input-insert-text']);
});

test('prefill refuses wrong session, blocked input, invalid paths, and rejected edits', () => {
  for (const options of [{ active: 's2' }, { blocked: true }, { phase: 'slash' }]) {
    const probe = nativeProbe(options);
    assert.equal(prefillComposer(probe.ctx, 's1', { text: '试试' }), false);
    assert.equal(probe.calls.length, 0);
  }
  assert.equal(prefillComposer(nativeProbe({ accept: false }).ctx, 's1', { text: '试试' }), false);
  assert.equal(prefillComposer(nativeProbe().ctx, 's1', { text: '试试', reference: { path: '../private', title: 'x', revision: 'r' } }), false);
});

test('native reference codec serializes a bounded locator without reading answers', async () => {
  let source; const dispose = () => {};
  assert.equal(registerReference({ inputTriggers: { registerSource(value) { source = value; return dispose; } } }), dispose);
  const serialized = await source.codec.serialize(JSON.stringify({ path: '卡片/定义.md', title: '定义', revision: 'r' }));
  assert.match(serialized, /先读取原文/);
  assert.match(serialized, /卡片\/定义.md/);
  await assert.rejects(() => source.codec.serialize('{"path":"/private"}'));
  await assert.rejects(() => source.codec.serialize('{}', AbortSignal.abort()));
});

test('candidate DTO validation remains intact without turning teacher inputs into recommendations', () => {
  const continuation = {
    sessionId: 's_class_1',
    path: '备课/导数第一课.md',
    title: '导数第一课',
    revision: 'rev-l1',
    progressLabel: '已完成 1 / 3 项',
    counts: { total: 3, completed: 1, inProgress: 1, pending: 1 },
    currentTask: { line: 12, content: '尝试 [[卡片/求导.md|商法则求导]]' },
    nextTask: { line: 14, content: '对数均值比较' },
  };
  const route = {
    path: '路线/导数主线.md',
    title: '导数主线',
    revision: 'rev-rt',
    status: 'active',
    completed: 1,
    total: 3,
    nextMilestone: {
      text: '极值点偏移对称构造',
      remediation: '商法则分子符号待补',
      lessonRefs: [{ path: '备课/导数第二课.md', title: '导数第二课', revision: 'rev-l2' }],
      materialRefs: [],
      sessions: [],
    },
    nextAction: {
      text: '进入 [[备课/导数第二课|导数第二课]] 完成符号修补',
      references: [{ path: '备课/导数第二课.md', title: '导数第二课', revision: 'rev-l2' }],
      sessions: [],
    },
  };
  const followUp = {
    path: '备课/导数第一课.md',
    title: '导数第一课',
    revision: 'rev-l1',
    kind: 'lesson-summary',
    snippet: '先补复合函数求导负号检验',
  };
  const dueCards = [
    { path: '卡片/导数.md', title: '导数的定义', revision: 'r1', lastSupport: 'hint' },
    { path: '卡片/单调性.md', title: '函数的单调性', revision: 'r2', lastSupport: 'independent' },
  ];

  const full = parseRecommendations({
    ...empty(),
    due: { total: 5, cards: dueCards },
    continuation,
    continuations: [continuation],
    route,
    followUp,
  });
  assert.equal(full.continuation.sessionId, 's_class_1');

  assert.throws(() => parseRecommendations({ ...empty(), continuation: { ...continuation, sessionId: '../bad' } }), TypeError);
  assert.throws(() => parseRecommendations({ ...empty(), route: { ...route, completed: 4, total: 2 } }), TypeError);
  assert.throws(() => parseRecommendations({ ...empty(), followUp: { ...followUp, kind: 'unknown' } }), TypeError);

  const result = buildHomeActions(full, { canOpenSession: id => id === 's_class_1' });
  assert.equal(result.primary, null);
  assert.deepEqual(result.alternatives, []);
  assert.equal(result.continuation.sessionId, 's_class_1');
  assert.equal(buildHomeActions(full).continuation, null);
  assert.equal(full.route.nextMilestone.remediation, '商法则分子符号待补');
});

test('raw guide, diary, revisit and task paragraphs never become cards or drafts', () => {
  const doc = { path: '材料.md', title: '均值不等式', revision: 'r1' };
  const internal = '教师内部：无提示是否完成仍未知；送达不表示掌握；根据交付再更新里程碑。';
  const cases = [
    { guide: { ...doc, completed: 0, total: 1, nextTask: { line: 8, text: internal } } },
    { followUp: { ...doc, kind: 'diary', snippet: internal } },
    { revisits: [{ ...doc, kind: 'card-next', snippet: internal }] },
    { route: { ...doc, completed: 0, total: 1, nextMilestone: { text: internal, remediation: internal }, nextAction: { text: internal, references: [], sessions: [] } } },
    { continuation: { ...doc, sessionId: 'class-1', counts: { completed: 0, total: 1 }, currentTask: { line: 8, content: internal }, nextTask: null } },
  ];
  for (const scenario of cases) {
    const data = { ...empty(), ...scenario }, before = JSON.stringify(data);
    const result = buildHomeActions(data, { canOpenSession: () => true });
    assert.equal(result.primary, null);
    assert.deepEqual(result.alternatives, []);
    assert.doesNotMatch(JSON.stringify(result), /教师内部|无提示是否|送达不表示|交付再更新/);
    assert.equal(JSON.stringify(data), before, 'do not rewrite or truncate teacher source records');
  }
});

const profile = { path: '画像/学习画像.md', title: '我的学习画像', revision: 'profile-r1' };
const teacherItem = (text, overrides = {}) => ({ line: 12, text, reason: '上次已经能解释关键步骤，可以试着比较两种方法。', references: [], sessions: [], ...overrides });
const teacherData = items => ({ ...empty(), teacherRecommendations: { ...profile, items } });
const dueCard = { path: '卡片/旧题.md', title: '固定复习候选', revision: 'card-r1' };

test('teacher recommendations override unfinished classrooms and due cards without filling alternatives from fixed rules', () => {
  const items = [
    teacherItem('比较 [[卡片/两种方法.md|两种方法]] 的适用条件', { references: [{ path: '卡片/两种方法.md', title: '两种方法', revision: 'r1' }] }),
    teacherItem('为什么同一条曲线有两种解释？', { line: 13 }),
    teacherItem('从一张照片探索对称', { line: 14 }),
    teacherItem('不应显示的第四条', { line: 15 }),
  ];
  const data = parseRecommendations({
    ...teacherData(items),
    due: { total: 1, cards: [dueCard] },
    continuation: { sessionId: 's_unfinished', path: '备课/旧课.md', title: '未完成的旧课', revision: 'lesson-r1', counts: { total: 3, completed: 1 }, currentTask: null, nextTask: null },
  });
  const actions = buildHomeActions(data, { canOpenSession: () => true });
  assert.equal(actions.primary.title, '比较 两种方法 的适用条件');
  assert.equal(actions.primary.badge, '老师建议');
  assert.equal(actions.primary.kind, 'prefill');
  assert.equal(actions.primary.detail, items[0].reason);
  assert.deepEqual(actions.primary.request.reference, items[0].references[0]);
  assert.deepEqual(actions.alternatives.map(item => item.title), items.slice(1, 3).map(item => item.text));
  assert.ok(actions.alternatives.every(item => item.badge === '老师建议'));
  const single = buildHomeActions({ ...data, teacherRecommendations: { ...profile, items: items.slice(0, 1) } });
  assert.deepEqual(single.alternatives, [], 'one teacher recommendation must not invite fixed-rule alternatives');
});

test('unlinked teacher explorations keep distinct questions, the profile reference and the full request', () => {
  const text = `我想弄清楚：${'从图像比较变化趋势，'.repeat(40)}最后解释两种直觉为什么一致。`;
  const reason = `${'此前的讨论已经能说出局部规律，'.repeat(30)}这次尝试联系整体变化。`;
  const actions = buildHomeActions(teacherData([
    teacherItem(text, { reason }),
    teacherItem('为什么不同文化会出现相似的对称图案？', { line: 13 }),
    teacherItem('声音和图形的周期有什么联系？', { line: 14 }),
  ]));
  assert.equal(actions.primary.kind, 'prefill');
  assert.equal(actions.primary.title, text);
  assert.equal(actions.primary.detail, reason);
  assert.ok(actions.primary.request.text.includes(text));
  assert.equal(actions.primary.request.recommendation.reason, reason);
  assert.ok(!actions.primary.request.text.includes(reason));
  assert.deepEqual(actions.primary.request.reference, profile);
  assert.equal(actions.alternatives.length, 2, 'shared fallback profile must not merge unrelated explorations');
  assert.ok(actions.alternatives.every(item => item.request.reference.path === profile.path));
});

test('teacher recommendations open the first known classroom and prefill when no linked classroom can open', () => {
  const source = { path: '卡片/比较.md', title: '方法比较', revision: 'source-r1' };
  const data = teacherData([teacherItem('继续 [[session:s_known|方法比较课]] 的讨论', {
    reason: '上次留下了 [[卡片/比较.md|方法比较]]，这次从这里接着探讨。',
    references: [source],
    sessions: [null, { sessionId: '../bad', label: '无效' }, { sessionId: 's_missing', label: '未加载' }, { sessionId: 's_known', label: '方法比较课' }],
  })]);
  const checked = [];
  const actions = buildHomeActions(data, { canOpenSession: id => { checked.push(id); return id === 's_known'; } });
  assert.equal(actions.primary.kind, 'open-session');
  assert.equal(actions.primary.sessionId, 's_known');
  assert.equal(actions.primary.title, '继续 方法比较课 的讨论');
  assert.match(actions.primary.detail, /上次留下了 方法比较/);
  assert.deepEqual(checked, ['s_missing', 's_known']);
  assert.equal(actions.primary.request, undefined);
  const fallback = buildHomeActions(data);
  assert.equal(fallback.primary.kind, 'prefill');
  assert.deepEqual(fallback.primary.request.reference, source);
  assert.match(fallback.primary.request.text, /继续 方法比较课 的讨论/);
  assert.match(fallback.primary.request.recommendation.reason, /上次留下了 方法比较/);
});

test('teacher recommendations skip malformed items and links while using the first valid material reference', () => {
  const source = { path: '资料/数学与音乐.pdf', title: '数学与音乐', revision: 'source-r2' };
  const data = teacherData([
    null, {}, teacherItem('   '), teacherItem('无效行', { line: -1 }), teacherItem('无效依据', { reason: {} }),
    teacherItem('无效引用集合', { references: {} }), teacherItem('无效课堂集合', { sessions: null }),
    teacherItem('探索音乐中的比例', { references: [null, { ...source, path: '../private' }, { ...source, revision: '' }, source] }),
  ]);
  assert.doesNotThrow(() => parseRecommendations(data));
  const actions = buildHomeActions(data);
  assert.equal(actions.primary.title, '探索音乐中的比例');
  assert.deepEqual(actions.primary.request.reference, source);
  assert.deepEqual(actions.alternatives, []);
});

test('teacher recommendation deduplication covers sessions, materials and equivalent question labels across alternatives', () => {
  const material = { path: '卡片/比例.md', title: '比例', revision: 'r1' };
  const otherMaterial = { path: '资料/比例.pdf', title: '另一份材料', revision: 'r2' };
  const data = teacherData([
    teacherItem('先探索节奏', { sessions: [{ sessionId: 's_music', label: '音乐课' }] }),
    teacherItem('重复课堂应忽略', { line: 13, sessions: [{ sessionId: 's_music', label: '同一课' }] }),
    teacherItem('比较两种比例', { line: 14, references: [material] }),
    teacherItem('重复资料应忽略', { line: 15, references: [material] }),
    teacherItem('比较两种比例', { line: 16, references: [otherMaterial] }),
    teacherItem('先探索节奏', { line: 17 }),
    teacherItem('  先探索[[卡片/节奏.md|节奏]]  ', { line: 18 }),
    teacherItem('最后探索建筑', { line: 19 }),
  ]);
  const actions = buildHomeActions(data, { canOpenSession: id => id === 's_music' });
  assert.deepEqual([actions.primary, ...actions.alternatives].map(item => item.title), ['先探索节奏', '比较两种比例', '最后探索建筑']);
  assert.equal(new Set([actions.primary, ...actions.alternatives].map(item => item.id)).size, 3);
});

test('missing, malformed and empty teacher blocks do not manufacture recommendations', async () => {
  const fallback = { ...empty(), due: { total: 1, cards: [dueCard] } };
  const expected = { primary: null, alternatives: [], continuation: null };
  const malformed = [
    undefined, null, false, 'invalid', [], {},
    { ...profile, path: '/private/profile.md', items: [teacherItem('无效画像')] },
    { ...profile, revision: '', items: [teacherItem('无效版本')] },
    { ...profile, items: null }, { ...profile, items: 'invalid' }, { ...profile, items: [] },
    { ...profile, items: [teacherItem('无效目标', { references: [{ path: '/private/missing.md' }], sessions: [{ sessionId: '../invalid', label: '无效课堂' }] })] },
    { ...profile, items: [null, {}, teacherItem(''), teacherItem('无效集合', { references: null })] },
  ];
  for (const teacherRecommendations of malformed) {
    const data = { ...fallback, teacherRecommendations };
    assert.deepEqual(buildHomeActions(parseRecommendations(data)), expected);
    const updates = [];
    await createRecommendationLoader(() => ({ ok: true, value: data }), state => updates.push(state)).load();
    assert.equal(updates.at(-1).phase, 'ready', 'an invalid optional teacher block must not fail the whole home response');
    assert.deepEqual(buildHomeActions(updates.at(-1).data), expected);
  }
});

test('openContinuationSession navigates to real classroom session without touching Home draft and rejects invalid/archived/subagent sessions', () => {
  const opened = [];
  const makeCtx = ({ sessionMeta = { id: 's_class' }, archived = [], sessionIds = ['s1', 's_class'] } = {}) => ({
    sessions: { list: { getSnapshot: () => ({ byId: { s1: { id: 's1', retainedBy: { mainView: 1 } }, ...(sessionMeta ? { [sessionMeta.id]: sessionMeta } : {}) } }) } },
    get(service) {
      if (service === 'uiWorkspace') return { openSession: id => opened.push(id) };
      if (service === 'workspaces') return { list: { getSnapshot: () => ({ archivedSessionIds: archived, items: [{ workspaceId: 'ws-1', sessionIds }] }) } };
      return undefined;
    },
  });

  assert.equal(canOpenSession(makeCtx(), 's_class', 'ws-1'), true);
  assert.equal(openContinuationSession(makeCtx(), 's_class', 'ws-1'), true);
  assert.deepEqual(opened, ['s_class']);

  assert.equal(openContinuationSession(makeCtx({ archived: ['s_class'] }), 's_class', 'ws-1'), false);
  assert.equal(openContinuationSession(makeCtx({ sessionMeta: { id: 's_class', projectionValues: { agentPreset: 'notara-coordinator' } } }), 's_class', 'ws-1'), false, 'non-classroom top-level presets must be rejected');
  assert.equal(openContinuationSession(makeCtx({ sessionMeta: { id: 's_class', origin: 'subagent' } }), 's_class', 'ws-1'), false, 'one-shot/untyped subagents must be rejected');

  // Continuable notara-teacher child classroom attached to ws-1 via s1 must open via durable subagent address!
  const childCtx = {
    sessions: {
      list: {
        getSnapshot: () => ({
          byId: {
            s1: { id: 's1', retainedBy: { mainView: 1 } },
            s_child: { id: 's_child', origin: 'subagent', parentId: 's1' },
            s_companion: { id: 's_companion', origin: 'subagent', parentId: 's1', projectionValues: { agentPreset: 'companion-xiaolin', subagent: { mode: 'continuable' } } },
          },
          projectionsBySession: {
            s1: { values: { subagentCatalog: [{ id: 's_child', mode: 'continuable' }, { id: 's_companion', mode: 'continuable' }] } },
          },
        }),
      },
    },
    get(service) {
      if (service === 'uiWorkspace') return { openSession: target => opened.push(target) };
      if (service === 'workspaces') return { list: { getSnapshot: () => ({ archivedSessionIds: [], items: [{ workspaceId: 'ws-1', sessionIds: ['s1'] }] }) } };
      return undefined;
    },
  };
  assert.equal(canOpenSession(childCtx, 's_child', 'ws-1'), true);
  assert.equal(openContinuationSession(childCtx, 's_child', 'ws-1'), true);
  assert.deepEqual(opened.at(-1), { parentSessionId: 's1', childSessionId: 's_child', mode: 'continuable' });
  assert.equal(canOpenSession(childCtx, 's_companion', 'ws-1'), false);

  assert.equal(openContinuationSession(makeCtx({ sessionMeta: { id: 's_class', removed: true } }), 's_class', 'ws-1'), false);
  assert.equal(openContinuationSession(makeCtx({ sessionIds: ['s1'] }), 's_class', 'ws-1'), false);
  assert.equal(canOpenSession(makeCtx(), 's_class', null), false, 'unresolved null workspaceId must fail closed');
  assert.equal(canOpenSession(makeCtx(), 's_class', undefined), false, 'missing workspaceId when workspaces service exists must fail closed');
  const unhydratedCtx = {
    sessions: { list: { getSnapshot: () => ({ byId: { s_class: { id: 's_class' } } }) } },
    get(service) {
      if (service === 'uiWorkspace') return { openSession: id => opened.push(id) };
      if (service === 'workspaces') return { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } };
      return undefined;
    },
  };
  assert.equal(canOpenSession(unhydratedCtx, 's_class', 'ws-1'), false, 'unhydrated registry.items must fail closed');
  assert.equal(openContinuationSession(unhydratedCtx, 's_class', 'ws-1'), false);
  assert.equal(opened.length, 2);

  // Cold-reload DSH subagentAddress returning mode: 'unknown' before parent projectionStores hydrate:
  // Host-verified Home recommendations (verifiedClassroom: true) still open continuable child classrooms
  // while multi-hop archived/other-workspace ancestors and companion presets fail closed.
  const coldReloadCtx = {
    sessions: {
      list: {
        getSnapshot: () => ({
          byId: {
            root_ok: { id: 'root_ok' },
            root_archived: { id: 'root_archived' },
            root_other_ws: { id: 'root_other_ws' },
            mid_sub: { id: 'mid_sub', origin: 'subagent', parentId: 'root_ok' },
            deep_child: { id: 'deep_child', origin: 'subagent', parentId: 'mid_sub' },
            archived_anc_child: { id: 'archived_anc_child', origin: 'subagent', parentId: 'root_archived' },
            other_ws_child: { id: 'other_ws_child', origin: 'subagent', parentId: 'root_other_ws' },
            companion_child: { id: 'companion_child', origin: 'subagent', parentId: 'root_ok', agentPreset: 'companion-deepseek' },
          },
          projectionsBySession: {},
        }),
      },
      subagentAddress(id) {
        const parentMap = {
          mid_sub: 'root_ok',
          deep_child: 'mid_sub',
          archived_anc_child: 'root_archived',
          other_ws_child: 'root_other_ws',
          companion_child: 'root_ok',
        };
        return parentMap[id] ? { parentSessionId: parentMap[id], childSessionId: id, mode: 'unknown' } : null;
      },
    },
    get(service) {
      if (service === 'uiWorkspace') return { openSession: target => opened.push(target) };
      if (service === 'workspaces') {
        return {
          list: {
            getSnapshot: () => ({
              archivedSessionIds: ['root_archived'],
              items: [
                { workspaceId: 'ws-1', sessionIds: ['root_ok', 'root_archived'] },
                { workspaceId: 'ws-2', sessionIds: ['root_other_ws'] },
              ],
            }),
          },
        };
      }
      return undefined;
    },
  };
  assert.equal(canOpenSession(coldReloadCtx, 'deep_child', 'ws-1'), false, 'unverified cold-reload subagent without mode fails closed');
  assert.equal(canOpenSession(coldReloadCtx, 'deep_child', 'ws-1', { verifiedClassroom: true }), true);
  assert.equal(canOpenSession(coldReloadCtx, 'archived_anc_child', 'ws-1', { verifiedClassroom: true }), false);
  assert.equal(canOpenSession(coldReloadCtx, 'other_ws_child', 'ws-1', { verifiedClassroom: true }), false);
  assert.equal(canOpenSession(coldReloadCtx, 'companion_child', 'ws-1', { verifiedClassroom: true }), false);
  assert.equal(openContinuationSession(coldReloadCtx, 'deep_child', 'ws-1', { verifiedClassroom: true }), true);
  assert.deepEqual(opened.at(-1), { parentSessionId: 'mid_sub', childSessionId: 'deep_child', mode: 'continuable' });
});

test('silent refresh updates ready state in place without emitting loading flicker', async () => {
  let step = 0;
  const updates = [];
  const loader = createRecommendationLoader(() => ({
    ok: true,
    value: { ...empty(), due: { total: ++step, cards: [] } },
  }), value => updates.push(value));
  await loader.load();
  await loader.refresh();
  assert.deepEqual(updates.map(u => u.phase), ['loading', 'ready', 'ready']);
  assert.equal(updates.at(-1).data.due.total, 2);
});
