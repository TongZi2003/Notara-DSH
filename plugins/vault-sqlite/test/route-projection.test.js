import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSessionReference, sessionReferenceMarkdown, validateSessionId } from '../file-reference.js';
import { extractFollowUpSnippet, extractLineLinks, projectRouteDocument } from '../route-projection.js';
import { createVaultStore } from '../vault-indexer.js';

test('route progress reads exploration evidence without requiring examination or changing checkbox meaning', () => {
  const projected = projectRouteDocument([
    '## 里程碑与进展',
    '- [x] 比较两种解释并提出自己的猜想',
    '  - 阶段依据：在老师提示下发现两种解释的条件不同，见 [[日记/2026-11-02#探索记录]]',
    '- [ ] 用一个具体例子继续探索',
    '  - 阶段依据：尝试把猜想应用到新的情境',
    '## 下一步行动',
    '- 选择一个反例，看看猜想的适用范围',
  ].join('\n'));
  assert.match(projected.milestones[0].criteria, /在老师提示下发现两种解释的条件不同/);
  assert.equal(projected.milestones[0].summaries[0].path, '日记/2026-11-02.md');
  assert.equal(projected.milestones[0].needsRemediation, false);
  assert.equal(projected.completed, 1);
  assert.equal(projected.total, 2);
  assert.equal(projected.nextAction.text, '选择一个反例，看看猜想的适用范围');
});

test('session reference grammar parses wiki and markdown session links while rejecting unsafe session ids', () => {
  assert.deepEqual(parseSessionReference('[[session:sess_01-abc|导数第一课]]'), {
    sessionId: 'sess_01-abc',
    label: '导数第一课',
  });
  assert.deepEqual(parseSessionReference('[校验课堂](session:verify.42)'), {
    sessionId: 'verify.42',
    label: '校验课堂',
  });
  assert.deepEqual(parseSessionReference('__notara_session__/sess_01-abc'), {
    sessionId: 'sess_01-abc',
    label: '打开关联课堂',
  });
  assert.equal(sessionReferenceMarkdown({ sessionId: 'sess_01-abc', label: '导数第一课' }), '[导数第一课](<__notara_session__/sess_01-abc>)');
  assert.equal(parseSessionReference('[[session:../evil|坏链接]]'), null);
  assert.equal(parseSessionReference('[[session:bad/slash|坏链接]]'), null);
  assert.equal(validateSessionId(''), null);
  assert.equal(validateSessionId('bad/slash'), null);
});

for (const [href, path, subpath] of [
  ['第一课.md', '专题/第一课.md'],
  ['单元/第一课.md', '专题/单元/第一课.md'],
  ['./第一课.md', '专题/第一课.md'],
  ['../备课/第一课.md', '备课/第一课.md'],
  ['%E7%AC%AC%E4%B8%80%E8%AF%BE%20%23%E7%BB%83%E4%B9%A0.md', '专题/第一课 #练习.md'],
  ['第一课.md#%E6%9C%AC%E8%8A%82%E6%80%BB%E7%BB%93', '专题/第一课.md', '#本节总结'],
  ['第一课', '专题/第一课.md'],
]) {
  test(`route Markdown link resolves relative to its document: ${href}`, () => {
    assert.deepEqual(extractLineLinks(`[第一课](${href})`, '专题/路线.md').references, [
      { path, ...(subpath ? { subpath } : {}), label: '第一课' },
    ]);
  });
}

test('route Markdown links reject escaping and invalid targets while preserving wiki and session contracts', () => {
  for (const href of ['../../外部.md', '%2e%2e/%2e%2e/外部.md', '/外部.md', '单元/../../../外部.md', '%5c外部.md', '坏%ZZ.md', '#本节总结']) {
    assert.deepEqual(extractLineLinks(`[拒绝](${href})`, '专题/路线.md').references, [], href);
  }
  const links = extractLineLinks('[[备课/第一课]] · [[第一课]] · [[session:wiki-1|课堂甲]] · [课堂乙](session:md-2) · [课堂丙](<__notara_session__/native-3>)', '专题/路线.md');
  assert.deepEqual(links.references.map(ref => ref.path), ['备课/第一课.md', '第一课.md']);
  assert.ok(links.sessions.some(ref => ref.sessionId === 'wiki-1'));
  assert.ok(links.sessions.some(ref => ref.sessionId === 'md-2'));
});

test('projectRouteDocument keeps same-directory Markdown lesson and summary links with their bound classroom', () => {
  const path = '专题/第一课.md';
  const projected = projectRouteDocument([
    '## 里程碑',
    '- [ ] 检验链式法则',
    '  - 关联课堂：[第一课](第一课.md)',
    '  - 已有证据：[下午总结](第一课.md#下午总结)',
    '## 下一步行动',
    '- 继续 [第一课](第一课.md) · [校验课堂](session:verify-1)',
  ].join('\n'), {
    path: '专题/路线.md',
    existingPaths: new Set([path]),
    documentsByPath: new Map([[path, { type: 'lesson', title: '第一课' }]]),
    validSessionIds: new Set(['bound-1', 'verify-1']),
    bindings: [{ path, sessionId: 'bound-1', title: '第一课课堂' }],
  });
  assert.equal(projected.milestones[0].lessonRefs[0]?.path, path);
  assert.equal(projected.milestones[0].summaries[0]?.subpath, '#下午总结');
  assert.equal(projected.milestones[0].sessions[0]?.sessionId, 'bound-1');
  assert.equal(projected.nextAction?.references[0]?.path, path);
  assert.deepEqual(projected.nextAction?.sessions.map(ref => ref.sessionId), ['verify-1', 'bound-1']);
});

test('diary follow-up uses the appended afternoon summary and ignores later prose and private examples', () => {
  assert.deepEqual(extractFollowUpSnippet([
    '# 2026-10-31',
    '## 上午散打',
    '- 下次起点：补齐商法则负号',
    '## 下午散打总结',
    '- 实际表现：商法则负号已独立检验通过',
    '- 待补缺口：无',
    '- 下次起点：从含参分类讨论继续',
    '后续普通正文，不是续接建议。',
    '### 教师参考',
    '- 下次起点：隐藏教师答案',
    '## 随手记',
    '```md',
    '- 下次起点：代码示例',
    '```',
  ].join('\n'), 'diary'), { kind: 'diary', snippet: '从含参分类讨论继续' });
});

for (const docType of ['lesson', 'diary']) {
  test(`${docType} follow-up does not revive an old gap after an explicit afternoon clearance`, () => {
    const heading = docType === 'lesson' ? '## 本节总结与下次续接' : '## 散打总结';
    for (const clearance of ['待补缺口：无', '下次起点建议：暂无', '待补缺口：无待补缺口。']) {
      assert.equal(extractFollowUpSnippet([
        '# 课堂记录',
        `${heading}（上午）`,
        '- 待补缺口：商法则负号',
        '- 下次起点建议：补齐商法则负号',
        `${heading}（下午）`,
        '- 实际表现：无提示独立完成商法则校验',
        `- ${clearance}`,
        '本次已解决，不应重新推荐上午卡点。',
      ].join('\n'), docType), null, clearance);
    }
  });
}

for (const docType of ['diary', 'lesson']) {
  test(`${docType} explicit next start takes priority over gap fields in either order`, () => {
    const next = docType === 'diary' ? '下次起点' : '下次起点建议';
    for (const gap of ['无', '参数边界仍需练习']) {
      const fields = [`- ${next}：下一章检验`, `- 待补缺口：${gap}`];
      for (const ordered of [fields, [...fields].reverse()]) {
        const content = ['## 本节总结与下次续接（上午）', `- ${next}：已经解决的旧卡点`, '## 本节总结与下次续接（下午）', ...ordered].join('\n');
        assert.deepEqual(extractFollowUpSnippet(content, docType), {
          kind: docType === 'diary' ? 'diary' : 'lesson-summary', snippet: '下一章检验',
        });
      }
    }
  });
}

test('lesson follow-up uses the latest public summary with next-start priority within that summary', () => {
  assert.deepEqual(extractFollowUpSnippet([
    '## 本节总结与下次续接（上午）',
    '- 下次起点建议：补齐商法则负号',
    '## 本节总结与下次续接（下午）',
    '- 实际表现：上午缺口已独立检验通过',
    '- 下次起点建议：先核对参数边界，再继续分类讨论',
    '- 尚未检查与暴露缺口：参数边界',
    '普通正文：今天到此结束。',
    '### 教师参考',
    '- 下次起点建议：教师专属解法',
    '## 其他资料',
    '- 下次起点建议：普通正文中的示例字段',
    '```md',
    '## 本节总结与下次续接（示例）',
    '- 下次起点建议：代码示例',
    '```',
  ].join('\n'), 'lesson'), { kind: 'lesson-summary', snippet: '先核对参数边界，再继续分类讨论' });
});

test('lesson follow-up takes a new gap from an appended summary subsection instead of an old next start', () => {
  assert.deepEqual(extractFollowUpSnippet([
    '## 本节总结与下次续接',
    '### 上午总结',
    '- 下次起点建议：补齐商法则负号',
    '### 下午总结',
    '- 尚未检查与暴露缺口：含参边界尚未独立检查',
    '## 本节总结与下次续接（空白模板）',
    '<!-- 下次起点建议：模板中的旧示例 -->',
    '- 下次起点建议：待填写',
  ].join('\n'), 'lesson'), { kind: 'lesson-summary', snippet: '含参边界尚未独立检查' });
});

test('card next-discussion remains the first unchecked to-do rather than the last appended item', () => {
  assert.deepEqual(extractFollowUpSnippet([
    '## 学生理解',
    '### 下次探讨',
    '- [x] 已解决的旧卡点',
    '- [ ] 先检验参数边界',
    '- [ ] 再讨论不同方法',
    '## 参考理解',
    '### 下次探讨',
    '- 隐藏答案',
  ].join('\n'), 'card'), { kind: 'card-next', snippet: '先检验参数边界' });
});

for (const [docType, path, heading, field, kind] of [
  ['lesson', '备课/第一课.md', '## 本节总结与下次续接', '下次起点建议', 'lesson-summary'],
  ['diary', '日记/2026-10-31.md', '## 散打总结', '下次起点', 'diary'],
]) {
  test(`homeRecommendations rereads appended ${docType} summaries without recommending the resolved morning gap`, async t => {
    const root = await mkdtemp(join(tmpdir(), `notara-route-append-${docType}-`));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, path.split('/')[0]), { recursive: true });
    const morning = `---\ntype: ${docType}\n---\n# 课堂记录\n${heading}（上午）\n- ${field}：补齐商法则负号\n`;
    await writeFile(join(root, path), morning);
    const store = createVaultStore({ root, cachePath: ':memory:' });
    t.after(() => store.close());
    await store.scan();
    assert.equal(store.homeRecommendations().followUp?.snippet, '补齐商法则负号');

    await appendFile(join(root, path), `\n${heading}（下午）\n- 实际表现：商法则负号已独立检验通过\n- ${field}：继续含参分类讨论\n`);
    await store.scan();
    assert.equal(store.homeRecommendations().followUp?.kind, kind);
    assert.equal(store.homeRecommendations().followUp?.snippet, '继续含参分类讨论');

    await appendFile(join(root, path), `\n${heading}（收尾）\n- 待补缺口：无\n- ${field}：暂无\n`);
    await store.scan();
    assert.equal(store.homeRecommendations().followUp, null);
  });
}

test('projectRouteDocument excludes hidden teacher folds/fences and blocks auto-pass when remediation gaps exist', () => {
  const routeMd = [
    '---',
    'title: 导数进阶路线',
    'type: route',
    'status: active',
    'lessons:',
    '  - 备课/导数第一课.md',
    '---',
    '# 导数进阶路线',
    '',
    '## 里程碑',
    '- [x] 里程碑 1：理解导数几何意义与切线方程 ^ms1',
    '  - 相关材料：[[卡片/导数与切线斜率]]',
    '  - 关联课堂：[[备课/导数第一课]] · [[session:cls-1|切线课堂]]',
    '  - 校验依据：无提示独立写出过曲线外一点的切线方程',
    '  - 已有证据：[[备课/导数第一课#本节总结与下次续接|第一课课后总结]]（无提示独立完成切点设元）',
    '- [x] 里程碑 2：极值点偏移对称构造 ^ms2',
    '  - 相关材料：[[卡片/极值点偏移母题]] · [[卡片/不存在的旧卡]]',
    '  - 关联课堂：[[备课/极值点偏移-60min]]',
    '  - 校验依据：不看提示独立构造对称差函数并完成商法则求导',
    '  - 已有证据：[[日记/2026-10-31#L8|散打复盘段落]]（提示后完成构造，商法则符号仍出错）',
    '  - 待补内容：商法则分子符号与复合函数求导负号尚未独立通过校验',
    '',
    '<details data-notara="teacher">',
    '- [ ] 隐藏教师里程碑草案（不应进入学生路线投影）',
    '</details>',
    '',
    '```md',
    '- [ ] 代码块示例任务',
    '```',
    '',
    '## 下一步行动',
    '- 当前下一步：围绕 [[备课/导数第二课-符号修补]] 先补齐商法则与复合求导检验，再复核里程碑 2',
  ].join('\n');

  const existingPaths = new Set([
    '路线/导数进阶路线.md',
    '卡片/导数与切线斜率.md',
    '卡片/极值点偏移母题.md',
    '备课/导数第一课.md',
    '备课/极值点偏移-60min.md',
    '备课/导数第二课-符号修补.md',
    '日记/2026-10-31.md',
    '笔记/无关散打随笔.md',
  ]);
  const validSessionIds = new Set(['cls-1', 'cls-2']);
  const bindings = [
    {
      sessionId: 'cls-2',
      path: '备课/极值点偏移-60min.md',
      title: '极值点偏移课堂',
      progressLabel: '已完成 1 / 2 项',
      missing: false,
    },
  ];

  const projected = projectRouteDocument(routeMd, {
    path: '路线/导数进阶路线.md',
    revision: 'rev-route-1',
    existingPaths,
    validSessionIds,
    bindings,
  });

  assert.equal(projected.total, 2, 'hidden teacher details and fenced code tasks must be excluded');
  assert.equal(projected.checkedCount, 2);
  assert.equal(projected.completed, 1, 'checked milestone with pending remediation must NOT count as completed');
  assert.equal(projected.needsRemediation, true);
  assert.equal(projected.nextMilestone?.anchorId, 'ms2');
  assert.match(projected.nextMilestone?.remediation ?? '', /商法则分子符号/);

  // Milestone 1 has explicit session link and lesson summary locator.
  const m1 = projected.milestones[0];
  assert.equal(m1.sessions[0].sessionId, 'cls-1');
  assert.equal(m1.summaries[0].path, '备课/导数第一课.md');
  assert.equal(m1.summaries[0].subpath, '#本节总结与下次续接');

  // Milestone 2 resolves bound classroom session from lessonBindings, filters missing card, and keeps relevant ad-hoc diary locator while unrelated ad-hoc notes stay out.
  const m2 = projected.milestones[1];
  assert.deepEqual(m2.materialRefs.map(r => r.path), ['卡片/极值点偏移母题.md']);
  assert.equal(m2.sessions[0].sessionId, 'cls-2');
  assert.equal(m2.summaries[0].path, '日记/2026-10-31.md');
  assert.equal(m2.summaries[0].subpath, '#L8');
  assert.ok(!JSON.stringify(projected).includes('无关散打随笔'));

  assert.ok(projected.nextAction);
  assert.equal(projected.nextAction.references[0].path, '备课/导数第二课-符号修补.md');
});

test('store.homeRecommendations projects active route without extra disk fileReads and ignores missing action targets', async t => {
  const root = await mkdtemp(join(tmpdir(), 'notara-route-store-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, '路线'), { recursive: true });
  await mkdir(join(root, '备课'), { recursive: true });
  await writeFile(join(root, '备课/第一课.md'), '---\ntype: lesson\ntitle: 第一课\n---\n# 第一课\n- [ ] 任务一\n');
  await writeFile(join(root, '路线/主路线.md'), [
    '---',
    'title: 主路线',
    'type: route',
    'status: active',
    '---',
    '# 主路线',
    '## 里程碑',
    '- [ ] 里程碑甲',
    '  - 关联课堂：[[备课/第一课]]',
    '## 下一步行动',
    '- 当前下一步：先看 [[备课/已删除课稿]]',
    '- 备选下一步：打开 [[备课/第一课]] 开始推进',
  ].join('\n'));

  const store = createVaultStore({ root, cachePath: ':memory:' });
  t.after(() => store.close());
  await store.scan();

  const beforeMetrics = { ...store.metrics };
  const home = store.homeRecommendations({
    bindings: [
      {
        sessionId: 'sess-live-1',
        path: '备课/第一课.md',
        title: '第一课课堂',
        progressLabel: '待处理 1 项',
        counts: { total: 1, completed: 0, inProgress: 0, pending: 1 },
        currentTask: null,
        nextTask: { line: 6, content: '任务一' },
        missing: false,
      },
    ],
  });
  assert.deepEqual(store.metrics, beforeMetrics, 'homeRecommendations must not incur extra disk scans, stats, or reads');
  assert.ok(home.route);
  assert.equal(home.route.path, '路线/主路线.md');
  assert.equal(home.route.nextAction?.references[0]?.path, '备课/第一课.md', 'broken target line is skipped in favor of valid target');
  assert.equal(home.route.nextAction?.references[0]?.title, '第一课');
  assert.equal(home.route.nextAction?.sessions[0]?.sessionId, 'sess-live-1');
  assert.equal(home.continuation?.sessionId, 'sess-live-1');
  assert.equal(home.continuation?.nextTask?.content, '任务一');
});

test('projectRouteDocument and store.homeRecommendations preserve exact 1-based milestone.line and nextAction.line with earlier next-action checkboxes and nested sub-tasks', async t => {
  const root = await mkdtemp(join(tmpdir(), 'notara-route-lines-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, '路线'), { recursive: true });
  await mkdir(join(root, '备课'), { recursive: true });
  await writeFile(join(root, '备课/第一课.md'), '---\ntype: lesson\ntitle: 第一课\n---\n# 第一课\n- [ ] 任务一\n');

  const routeMd = [
    '---',                                                       // 1
    'title: 行号精度路线',                                         // 2
    'type: route',                                               // 3
    'status: active',                                            // 4
    'tags:',                                                     // 5
    '  - 微积分',                                                 // 6
    '---',                                                       // 7
    '# 行号精度路线',                                              // 8
    '',                                                          // 9
    '## 下一步行动',                                               // 10
    '- [x] 当前下一步：已完成旧行动 [[备课/第一课]]',                // 11
    '- [ ] 当前下一步：推进 [[备课/第一课]] 第二节',                // 12
    '',                                                          // 13
    '## 里程碑',                                                  // 14
    '- [ ] 里程碑甲 ^ms1',                                        // 15
    '  - [ ] 缩进子检查项（不计入顶层里程碑但存在于 tasks 索引）',      // 16
    '  - 关联课堂：[[备课/第一课]]',                                // 17
    '- [ ] 里程碑乙 ^ms2',                                        // 18
  ].join('\n');
  await writeFile(join(root, '路线/行号精度路线.md'), routeMd);

  const direct = projectRouteDocument(routeMd, { path: '路线/行号精度路线.md' });
  assert.equal(direct.nextAction?.line, 12);
  assert.deepEqual(direct.milestones.map(m => [m.anchorId, m.line]), [['ms1', 15], ['ms2', 18]]);

  const store = createVaultStore({ root, cachePath: ':memory:' });
  t.after(() => store.close());
  store.scan();
  const home = store.homeRecommendations();
  assert.equal(home.route?.nextAction?.line, 12);
  assert.deepEqual(home.route?.milestones.map(m => [m.anchorId, m.line]), [['ms1', 15], ['ms2', 18]]);
});

test('extractFollowUpSnippet and homeRecommendations exclude teacher folds, hidden tasks, and completed classrooms', async t => {
  const lessonBody = [
    '# 极值点偏移课',
    '<details data-notara="teacher">',
    '## 本节总结与下次续接',
    '- 下次起点建议：隐藏教师答案对数均值定理直接证法',
    '</details>',
    '## 参考理解',
    '- 下次起点建议：隐藏在参考理解中的答案',
    '## 本节总结与下次续接',
    '- 尚未检查与暴露缺口：商法则分子符号与复合求导负号尚未独立校验',
  ].join('\n');
  assert.deepEqual(extractFollowUpSnippet(lessonBody, 'lesson'), {
    kind: 'lesson-summary',
    snippet: '商法则分子符号与复合求导负号尚未独立校验',
  });
  assert.deepEqual(
    extractFollowUpSnippet('# 2026-10-31\n- 下次起点：从 [[卡片/链式法则]] 补齐负号检验\n', 'diary'),
    { kind: 'diary', snippet: '从 链式法则 补齐负号检验' },
  );
  assert.deepEqual(
    extractFollowUpSnippet('## 学生理解\n### 下次探讨\n- 检验含参参数 $a<0$ 时导数符号翻转\n## 参考理解\n### 下次探讨\n- 隐藏答案\n', 'card'),
    { kind: 'card-next', snippet: '检验含参参数 $a<0$ 时导数符号翻转' },
  );

  const root = await mkdtemp(join(tmpdir(), 'notara-home-followup-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, '备课'), { recursive: true });
  await writeFile(join(root, '备课/已完成课.md'), [
    '---',
    'type: lesson',
    'title: 已完成课',
    'status: completed',
    '---',
    '# 已完成课',
    '- [ ] 未勾可选延伸题',
    '<details data-notara="teacher">',
    '- [ ] 隐藏教师内部备课任务',
    '</details>',
    '## 本节总结与下次续接',
    '- 下次起点建议：先核对复合求导负号，再进入含参讨论',
  ].join('\n'));

  const store = createVaultStore({ root, cachePath: ':memory:' });
  t.after(() => store.close());
  await store.scan();

  const home = store.homeRecommendations({
    bindings: [
      {
        sessionId: 'sess-done',
        path: '备课/已完成课.md',
        title: '已完成课',
        counts: { total: 1, completed: 0, inProgress: 0, pending: 1 },
        nextTask: { line: 7, content: '未勾可选延伸题' },
        missing: false,
      },
      {
        sessionId: 'sess-missing',
        path: '备课/不存在的课.md',
        title: '不存在',
        counts: { total: 2, completed: 0, inProgress: 0, pending: 2 },
        nextTask: { line: 3, content: '幽灵任务' },
        missing: false,
      },
    ],
  });
  assert.equal(home.continuation, null, 'completed or missing lessons must never be recommended as unfinished classrooms');
  assert.equal(home.continuations.length, 0);
  assert.equal(home.followUp?.kind, 'lesson-summary');
  assert.equal(home.followUp?.snippet, '先核对复合求导负号，再进入含参讨论');
  assert.ok(!JSON.stringify(home).includes('隐藏教师内部备课任务'));
});

test('projectRouteDocument and extractFollowUpSnippet preserve leading horizontal rules, skip checked-off items, and classify type:lesson outside 备课/', () => {
  const bodyWithRule = [
    '---',
    '',
    '# 导数路线正文',
    '',
    '---',
    '',
    '## 里程碑',
    '- [ ] 里程碑 1：函数单调性校验',
    '  - 关联课堂：[[专题课/单调性第一讲]]',
    '',
    '## 下一步行动',
    '- [x] 当前下一步：已完成 [[专题课/旧课稿]]',
    '- [ ] 当前下一步：推进 [[专题课/单调性第一讲]] 第二环节',
  ].join('\n');

  const documentsByPath = new Map([
    ['专题课/单调性第一讲.md', { path: '专题课/单调性第一讲.md', title: '单调性第一讲', revision: 'rev-lsn-1', type: 'lesson', status: 'active' }],
    ['专题课/旧课稿.md', { path: '专题课/旧课稿.md', title: '旧课稿', revision: 'rev-lsn-0', type: 'lesson', status: 'completed' }],
  ]);
  const projected = projectRouteDocument(bodyWithRule, {
    path: '路线/主路线.md',
    frontmatter: { title: '主路线', type: 'route', status: 'active' },
    existingPaths: new Set(documentsByPath.keys()),
    documentsByPath,
  });

  assert.equal(projected.total, 1, 'leading horizontal rules in frontmatter-stripped body must not blank out milestones');
  assert.deepEqual(projected.milestones[0].lessonRefs.map(r => r.path), ['专题课/单调性第一讲.md']);
  assert.deepEqual(projected.milestones[0].materialRefs, []);
  assert.equal(projected.nextAction?.references[0]?.path, '专题课/单调性第一讲.md', 'checked-off [x] items under 下一步行动 must be excluded');

  const rawDiaryWithRule = [
    '---',
    '',
    '# 2026-10-31 学习散打',
    '',
    '---',
    '- [x] 下次起点：已补齐切点设元',
    '- [ ] 下次起点：继续检验含参分类讨论边界',
  ].join('\n');
  assert.deepEqual(extractFollowUpSnippet(rawDiaryWithRule, 'diary'), {
    kind: 'diary',
    snippet: '继续检验含参分类讨论边界',
  });
});

test('store.homeRecommendations deprioritizes archived lessons behind active lessons and preserves body starting with ---', async t => {
  const root = await mkdtemp(join(tmpdir(), 'notara-home-priority-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, '课程'), { recursive: true });
  await mkdir(join(root, '路线'), { recursive: true });

  await writeFile(join(root, '课程/活跃课.md'), [
    '---',
    'type: lesson',
    'title: 活跃课',
    'status: active',
    '---',
    '---',
    '# 活跃课',
    '---',
    '## 本节总结与下次续接',
    '- 下次起点建议：从活跃课的链式法则错题继续',
  ].join('\n'));

  // Write archived lesson slightly later so its mtime is newer than active lesson.
  await new Promise(resolve => setTimeout(resolve, 20));
  await writeFile(join(root, '课程/归档旧课.md'), [
    '---',
    'type: lesson',
    'title: 归档旧课',
    'status: archived',
    '---',
    '# 归档旧课',
    '## 本节总结与下次续接',
    '- 下次起点建议：已归档旧课不应盖过活跃课',
  ].join('\n'));

  await writeFile(join(root, '路线/主路线.md'), [
    '---',
    'type: route',
    'title: 主路线',
    'status: active',
    '---',
    '---',
    '# 主路线',
    '---',
    '## 里程碑',
    '- [ ] 里程碑一',
    '  - 关联课堂：[[课程/活跃课]]',
    '## 下一步行动',
    '- [x] 已完成旧行动 [[课程/归档旧课]]',
    '- [ ] 继续推进 [[课程/活跃课]]',
  ].join('\n'));

  const store = createVaultStore({ root, cachePath: ':memory:' });
  t.after(() => store.close());
  await store.scan();

  const home = store.homeRecommendations({});
  assert.equal(home.route?.milestones[0]?.lessonRefs[0]?.path, '课程/活跃课.md');
  assert.equal(home.route?.nextAction?.references[0]?.path, '课程/活跃课.md');
  assert.equal(home.followUp?.path, '课程/活跃课.md', 'active lesson must take precedence over newer archived lesson');
  assert.equal(home.followUp?.snippet, '从活跃课的链式法则错题继续');
});

test('NotaraVaultRemote.homeRecommendations syncs brand-new route/lesson files before routeSessionRefs within Chokidar awaitWriteFinish window', async t => {
  const { NotaraVaultRemote } = await import('../index.js');
  const root = await mkdtemp(join(tmpdir(), 'notara-home-race-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, '路线'), { recursive: true });
  await mkdir(join(root, '备课'), { recursive: true });

  const store = createVaultStore({ root, cachePath: ':memory:' });
  await store.startWatching();
  t.after(() => store.close());

  const checkedCandidates = [];
  const fakeRemote = {
    ctx: { get: name => (name === 'sessions' ? {} : null) },
    forWorkspace: () => ({ root, store, ready: Promise.resolve() }),
    registry: () => ({
      get: () => ({ workspaceId: 'ws-live', path: root, sessionIds: ['parent-cls'], archivedSessionIds: [] }),
      archivedSessionIds: [],
    }),
    lessons: {
      async lessonBindings() { return { bindings: [] }; },
      async isActiveClassroom({ sessionId }) {
        checkedCandidates.push(sessionId);
        return sessionId === 'sub-cls-verify-1' || sessionId === 'parent-cls';
      },
    },
  };

  // Raw external write (matching @deepseek-ai/dsh-tool-fs write) with 0ms delay before Chokidar's 100ms awaitWriteFinish fires.
  await writeFile(join(root, '备课/补救课.md'), '---\ntype: lesson\ntitle: 补救课\n---\n# 补救课\n- [ ] 任务一\n');
  await writeFile(join(root, '路线/实时新路线.md'), [
    '---',
    'type: route',
    'title: 实时新路线',
    'status: active',
    '---',
    '# 实时新路线',
    '## 里程碑',
    '- [ ] 里程碑校验 · [[session:sub-cls-verify-1|校验子课堂]] · [[备课/补救课]]',
    '## 下一步行动',
    '- [ ] 当前下一步：进入 [[session:sub-cls-verify-1|校验子课堂]] 完成无提示校验',
  ].join('\n'));

  const result = await NotaraVaultRemote.prototype.homeRecommendations.call(fakeRemote, { workspaceId: 'ws-live' });
  assert.ok(checkedCandidates.includes('sub-cls-verify-1'), 'routeSessionRefs must see newly written route session link immediately');
  assert.equal(result.route?.path, '路线/实时新路线.md');
  assert.equal(result.route?.nextAction?.sessions[0]?.sessionId, 'sub-cls-verify-1');
  assert.equal(result.route?.milestones[0]?.lessonRefs[0]?.path, '备课/补救课.md');
});
