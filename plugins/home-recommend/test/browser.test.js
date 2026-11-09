import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const withContinuation = {
  due: { total: 3, cards: [
    { path: '卡片/导数.md', title: '导数的定义', revision: 'r1', lastSupport: 'hint' },
    { path: '卡片/函数.md', title: '函数的单调性', revision: 'r2', lastSupport: 'independent' },
    { path: '卡片/极限.md', title: '不应显示的第三项', revision: 'r3', lastSupport: null },
  ] },
  continuation: {
    sessionId: 's_class',
    path: '备课/极值点偏移第一课.md',
    title: '极值点偏移第一课',
    revision: 'l1',
    progressLabel: '已完成 1 / 3 项',
    counts: { total: 3, completed: 1, inProgress: 1, pending: 1 },
    currentTask: { line: 8, content: '尝试 [[卡片/导数.md|商法则与对称差求导]]' },
    nextTask: { line: 9, content: '比较对数均值条件' },
  },
  guide: { path: '00-微积分导读.md', title: '微积分导读', revision: 'g1', completed: 3, total: 8,
    nextTask: { line: 12, text: '从 [[卡片/导数.md|导数的定义]] 开始' } },
  diary: { path: '日记/2026-10-24.md', exists: false },
};
const sample = {
  due: withContinuation.due,
  continuation: null,
  guide: withContinuation.guide,
  diary: withContinuation.diary,
  teacherRecommendations: { path: '画像.md', title: '学习画像', revision: 'p1', items: [
    { line: 12, text: '从图像解释导数的意义', reason: '', references: [withContinuation.guide], sessions: [] },
    { line: 13, text: '导数的定义能解释瞬时速度吗？', reason: '', references: [withContinuation.due.cards[0]], sessions: [] },
  ] },
};
const empty = { due: { total: 0, cards: [] }, guide: null, continuation: null, route: null, followUp: null, diary: sample.diary };
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const bundle = await build({ entryPoints: [fileURLToPath(new URL('./browser-fixture.jsx', import.meta.url))], bundle: true, write: false,
  format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' });

test('component browser: real classroom continuation, live Vault refresh, scenario pills, retry, late responses, clean empty state, narrow/dark view and cleanup', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1080, height: 850 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const reset = async () => {
    await page.goto('about:blank');
    await page.setContent(`<html lang="zh-CN"><head><style>body{margin:24px;font-family:system-ui;--dsw-alias-label-primary:#202020;--dsw-alias-label-secondary:#666;--dsw-alias-bg-layer-1:#fafafa;--dsw-alias-border-l1:#ddd;--dsw-alias-interactive-bg-hover:#eee}${styles}</style></head><body><div id="root"></div></body></html>`);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => fixture.mount());
    await page.getByText('正在读取学习进展…').waitFor();
  };
  try {
    await reset();
    // 1. Unfinished classroom is a separate navigation entry; clicking it opens the exact native classroom session without touching Home draft!
    await page.evaluate(value => fixture.resolve(value, 0), withContinuation);
    await page.locator('.nr-home-resume').waitFor();
    const resumeSize = await page.locator('.nr-home-resume').evaluate(node => ({ height: node.getBoundingClientRect().height,
      width: node.getBoundingClientRect().width, parentWidth: node.parentElement.getBoundingClientRect().width }));
    assert.ok(resumeSize.height >= 80 && resumeSize.width >= resumeSize.parentWidth - 2, JSON.stringify(resumeSize));
    assert.ok(await page.locator('.nr-home-resume-title').evaluate(node => parseFloat(getComputedStyle(node).fontSize) >= 18));
    await page.setViewportSize({ width: 642, height: 746 });
    const scenarios = await page.locator('.nr-home-pills').evaluate(node => ({ columns: getComputedStyle(node).gridTemplateColumns.split(' ').length,
      heights: [...node.children].map(child => child.getBoundingClientRect().height),
      sizes: [...node.children].map(child => parseFloat(getComputedStyle(child).fontSize)) }));
    assert.equal(scenarios.columns, 2);
    assert.ok(scenarios.heights.every(h => h >= 44) && scenarios.sizes.every(s => s >= 14), JSON.stringify(scenarios));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.setViewportSize({ width: 1080, height: 850 });
    await page.getByRole('button', { name: '继续上次课堂', exact: true }).click();
    let state = await page.evaluate(() => fixture.getState());
    assert.deepEqual(state.openedSessions, ['s_class']);
    assert.equal(state.draft, '保留我的草稿【已选资料】', 'opening real continuation classroom must not prefill or mutate Home draft');
    assert.equal(state.calls.length, 0);

    // 2. Session state updates and Vault changes both refresh Home live; continuable child classrooms open via durable subagent address!
    await page.evaluate(() => fixture.emitSessionUpdate());
    await page.waitForFunction(() => fixture.getState().pending === 2);
    await page.evaluate(value => fixture.resolve({
      ...value,
      continuation: { ...value.continuation, sessionId: 's_child', title: '导数专题子课堂' },
    }, 1), withContinuation);
    await page.locator('.nr-home-resume').filter({ hasText: '导数专题子课堂' }).waitFor();
    assert.equal(await page.locator('.nr-home-actions').count(), 0);
    await page.getByRole('button', { name: '继续上次课堂', exact: true }).click();
    state = await page.evaluate(() => fixture.getState());
    assert.deepEqual(state.openedSessions.at(-1), { parentSessionId: 's1', childSessionId: 's_child', mode: 'continuable' });

    await page.evaluate(() => fixture.emitVaultUpdate('备课/极值点偏移第一课.md'));
    await page.waitForFunction(() => fixture.getState().pending === 3);
    await page.evaluate(value => fixture.resolve(value, 2), sample);
    await page.getByRole('button', { name: '带入对话', exact: true }).waitFor();

    // 3. Clicking authored primary/alternative actions, and scenario entry pills preserves existing draft & references and never auto-sends.
    await page.getByRole('button', { name: /导数的定义/ }).click();
    await page.getByRole('button', { name: '带入对话', exact: true }).click();
    await page.getByRole('button', { name: '题库提高练习' }).click();
    state = await page.evaluate(() => fixture.getState());
    assert.ok(state.draft.startsWith('保留我的草稿【已选资料】'));
    assert.equal(state.occurrences[0].ref, 'original');
    assert.equal(state.occurrences.length, 3);
    assert.equal(state.calls.filter(call => call.event === 'slash/input-insert-text').length, 3);
    assert.equal(state.calls.some(call => /send|submit/.test(call.event)), false);
    assert.equal(await page.getByText('不应显示的第三项').count(), 0);
    assert.ok((await page.locator('.nr-home').innerText()).includes('导数的定义'));
    assert.equal(await page.locator('.nr-home-next, .nr-home-review small').count(), 0, 'absent reasons have no filler');
    assert.equal(await page.getByText(/卡片\/导数.md/).count(), 0);
    await page.getByRole('button', { name: '试卷诊断与补强' }).focus();
    await page.keyboard.press('Enter');
    assert.ok((await page.evaluate(() => fixture.getState().draft)).includes('试卷诊断与补强'));
    for (const label of ['试卷诊断与补强', '笔记整理与拓展', '考前复习与状态准备', '题库提高练习']) {
      assert.equal(await page.getByRole('button', { name: label, exact: true }).count(), 1);
      await page.getByRole('button', { name: label, exact: true }).click();
    }
    for(const text of ['实际作答','拓展','状态','知识标签'])assert.ok((await page.evaluate(() => fixture.getState().draft)).includes(text));

    const evidence = new URL('../output/playwright/', import.meta.url);
    await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: fileURLToPath(new URL('home-desktop.png', evidence)), fullPage: true });
    await page.setViewportSize({ width: 375, height: 850 });
    await page.evaluate(() => { document.body.style.cssText = 'background:#171717;--dsw-alias-label-primary:#eee;--dsw-alias-label-secondary:#aaa;--dsw-alias-bg-layer-1:#202020;--dsw-alias-border-l1:#444;--dsw-alias-interactive-bg-hover:#333'; });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    const columns = await page.locator('.nr-home-actions').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length);
    assert.equal(columns, 1);
    await page.screenshot({ path: fileURLToPath(new URL('home-narrow-dark.png', evidence)), fullPage: true });
    await page.evaluate(() => fixture.unmount());
    assert.equal(await page.evaluate(() => fixture.getState().subscriptions), 0);

    // 4. Error recovery and clean ungrounded empty state (no filler prose, scenario pills & free input ready)
    await reset();
    await page.evaluate(() => fixture.resolveResult({ ok: false, error: { code: 'gateway/internal', message: 'INTERNAL_PRIVATE_PATH' } }));
    await page.getByRole('button', { name: '重新读取' }).click();
    await page.evaluate(value => fixture.resolve(value, 1), empty);
    await page.waitForFunction(() => !document.querySelector('.nr-home-status'));
    const emptyText = await page.locator('.nr-home').innerText();
    assert.equal(emptyText.includes('INTERNAL_PRIVATE_PATH'), false);
    assert.equal(emptyText.includes('当前范围还没有'), false);
    assert.equal(emptyText.includes('今天没有到期卡片'), false);
    assert.equal(await page.locator('.nr-home-primary').count(), 0);
    assert.equal(await page.getByRole('button', { name: '笔记整理与拓展', exact: true }).isEnabled(), true);

    await page.reload();
    await reset();
    await page.evaluate(() => fixture.switchSession());
    await page.waitForFunction(() => fixture.getState().pending === 2);
    await page.evaluate(value => fixture.resolve(value, 1), empty);
    await page.waitForFunction(() => !document.querySelector('.nr-home-status'));
    await page.evaluate(value => fixture.resolve(value, 0), sample);
    assert.equal(await page.getByText('导数的定义', { exact: true }).count(), 0);
    await page.evaluate(() => fixture.unmount());

    await reset();
    await page.evaluate(() => { fixture.unmount(); fixture.mountDock(); });
    await page.waitForFunction(() => fixture.getState().pending === 2);
    await page.evaluate(value => fixture.resolve(value, 1), sample);
    await page.getByRole('button', { name: '带入对话', exact: true }).waitFor();
    assert.equal(await page.getByRole('heading', { level: 1 }).count(), 1, 'bound home owns its learning heading');
    await page.evaluate(() => fixture.beginConversation());
    await page.waitForFunction(() => !document.querySelector('.nr-home'));
    await page.evaluate(value => fixture.resolve(value, 0), sample);
    assert.equal(await page.locator('.nr-home').count(), 0);
    assert.equal(await page.locator('.nr-home-dock').count(), 0, 'conversation has no persistent recommendation footer');
    await page.evaluate(() => fixture.unmount());
    assert.equal(await page.evaluate(() => fixture.getState().subscriptions), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('component browser: teacher text and reasons, referenced prefill without sending, direct classroom open and empty/malformed fallback', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1080, height: 850 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const profile = { path: '画像/学习画像.md', title: '我的学习画像', revision: 'profile-r1' };
  const material = { path: '卡片/变化率.md', title: '变化率', revision: 'material-r1' };
  const recommendations = {
    ...profile,
    items: [
      { line: 12, text: '比较 [[卡片/变化率.md|变化率]] 的两种解释', reason: '上次能算出结果，这次试着用图像说明为什么。', references: [material], sessions: [] },
      { line: 13, text: '为什么声音和图形都可以有周期？', reason: '从你最近对音乐的兴趣出发，试着联系不同学科。', references: [], sessions: [] },
      { line: 14, text: '到 [[session:s_class|变化率讨论课]] 试另一种解释', reason: '沿用上次讨论中留下的问题。', references: [withContinuation.continuation], sessions: [{ sessionId: 's_class', label: '变化率讨论课' }] },
    ],
  };
  const refresh = async (value, index) => {
    await page.evaluate(() => fixture.emitVaultUpdate('画像/学习画像.md'));
    await page.waitForFunction(count => fixture.getState().pending === count, index + 1);
    await page.evaluate(({ value, index }) => fixture.resolve(value, index), { value, index });
  };
  try {
    await page.setContent(`<html lang="zh-CN"><head><style>body{margin:24px;font-family:system-ui;--dsw-alias-label-primary:#202020;--dsw-alias-label-secondary:#666;--dsw-alias-bg-layer-1:#fafafa;--dsw-alias-border-l1:#ddd;--dsw-alias-interactive-bg-hover:#eee}${styles}</style></head><body><div id="root"></div></body></html>`);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => fixture.mount());
    await page.getByText('正在读取学习进展…').waitFor();
    await page.evaluate(value => fixture.resolve(value), { ...withContinuation, teacherRecommendations: recommendations });
    await page.getByRole('heading', { name: '比较 变化率 的两种解释', exact: true }).waitFor();
    assert.equal(await page.getByText(recommendations.items[0].reason, { exact: true }).isVisible(), true);
    assert.equal(await page.locator('.nr-home-secondary li').count(), 2);
    assert.ok((await page.locator('.nr-home-secondary').innerText()).includes(recommendations.items[1].reason));
    const homeText = await page.locator('.nr-home').innerText();
    assert.ok(homeText.includes('老师建议'));
    assert.equal(homeText.includes('极值点偏移第一课'), false);
    assert.equal(homeText.includes('导数的定义'), false);
    assert.equal(homeText.includes('session:s_class'), false);
    assert.equal(homeText.includes('卡片/变化率.md'), false);

    await page.locator('.nr-home-primary button').click();
    let state = await page.evaluate(() => fixture.getState());
    assert.ok(state.draft.startsWith('保留我的草稿【已选资料】'));
    assert.ok(state.draft.includes('比较 变化率 的两种解释'));
    assert.ok(!state.draft.includes(recommendations.items[0].reason));
    const { recommendation, ...materialRef } = JSON.parse(state.occurrences[1].ref);
    assert.deepEqual(materialRef, material); assert.equal(recommendation.reason, recommendations.items[0].reason);
    assert.equal(state.occurrences[0].ref, 'original');
    assert.equal(state.calls.filter(call => call.event === 'slash/input-insert-text').length, 1);
    assert.equal(state.calls.some(call => /send|submit/.test(call.event)), false);
    await page.locator('.nr-home-primary button').click();
    assert.deepEqual(await page.evaluate(() => fixture.getState()), state, 'repeated teacher clicks do not duplicate draft text or references');

    await page.getByRole('button', { name: /为什么声音和图形都可以有周期/ }).click();
    state = await page.evaluate(() => fixture.getState());
    assert.ok(state.draft.includes(recommendations.items[1].text));
    assert.ok(!state.draft.includes(recommendations.items[1].reason));
    const { recommendation: secondRec, ...profileRef } = JSON.parse(state.occurrences[2].ref);
    assert.deepEqual(profileRef, profile); assert.equal(secondRec.reason, recommendations.items[1].reason);
    const beforeOpen = state;
    await page.getByRole('button', { name: /变化率讨论课/ }).click();
    state = await page.evaluate(() => fixture.getState());
    assert.deepEqual(state.openedSessions, ['s_class']);
    assert.equal(state.draft, beforeOpen.draft);
    assert.deepEqual(state.calls, beforeOpen.calls);
    assert.deepEqual(state.occurrences, beforeOpen.occurrences);

    await page.setViewportSize({ width: 375, height: 850 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await refresh({ ...withContinuation, teacherRecommendations: { ...profile, items: [] } }, 1);
    await page.locator('.nr-home-resume').filter({ hasText: '极值点偏移第一课' }).waitFor();
    assert.equal(await page.locator('.nr-home-actions').count(), 0);
    assert.equal(await page.getByRole('button', { name: '继续上次课堂', exact: true }).isVisible(), true);
    assert.equal(await page.getByText('老师建议', { exact: true }).count(), 0);

    await refresh({ ...sample, teacherRecommendations: { ...profile, items: 'invalid' } }, 2);
    await page.waitForFunction(() => !document.querySelector('.nr-home-actions, .nr-home-resume, .nr-home-status'));
    assert.equal(await page.getByRole('heading', { name: '今天推荐做的事情' }).count(), 0);
    assert.equal(await page.getByRole('button', { name: '重新读取', exact: true }).count(), 0);
    await refresh({ ...empty, teacherRecommendations: { ...profile, items: [] } }, 3);
    await page.waitForFunction(() => !document.querySelector('.nr-home-primary'));
    assert.equal(await page.getByRole('button', { name: '笔记整理与拓展', exact: true }).isEnabled(), true);
    state = await page.evaluate(() => fixture.getState());
    assert.equal(state.calls.some(call => /send|submit/.test(call.event)), false);
    assert.ok(state.draft.startsWith('保留我的草稿【已选资料】'));
    await page.evaluate(() => fixture.unmount());
    assert.equal(await page.evaluate(() => fixture.getState().subscriptions), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
