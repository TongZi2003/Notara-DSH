import { chromium } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { startNativeRuntime, workspaceRoot } from './native-runtime.mjs';
import { openLibrary, chooseWorkspace } from './ui-navigation.mjs';

const fixture = await mkdtemp(join(workspaceRoot, 'work/feedback-fixture-'));
const formula = String.raw`# 公式检查
## 内容
行内 $x^2+\frac{1}{2}$，单行显示 $$\sqrt{x}+\frac{a}{b}$$。

$$
\begin{aligned}
a&=\frac{1}{2}\\

b&=\sqrt{3}
\end{aligned}
$$

<details>
<summary>展开公式</summary>

$$
\sum_{i=1}^{n}i=\frac{n(n+1)}{2}
$$

![[来源/集成测试讲义.pdf#page=1&rect=0.1,0.1,0.2,0.2]]

</details>
## 参考理解
TEACHER_HIDDEN_FIXTURE
## 学生理解
`;
await writeFile(join(fixture, '公式检查.md'), formula);
await writeFile(join(fixture, '00-公式导读.md'), '# 公式导读\n## 任务\n- [ ] 解释 $\\frac{1}{2}$ 和 $$\\sqrt{3}$$\n');
await writeFile(join(fixture, '同名.md'), '# 工作区甲\n');
const runtime = await startNativeRuntime({ fixture });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
page.setDefaultTimeout(12000);
const errors = [], calls = [], checks = {};
page.on('pageerror', e => errors.push(e.message));
page.on('response', async response => {
  if (response.url().includes('/api/notaraVault/')) calls.push({ method: response.url().split('/').at(-1), input: response.request().postDataJSON()?.payload?.args?.input, result: (await response.json()).result });
});
try {
  await page.goto(runtime.authUrl); await page.waitForLoadState('networkidle');
  const notice = page.getByRole('button', { name: /^(Continue|继续)$/ });
  try { await notice.waitFor({ state: 'visible', timeout: 4000 }); await notice.click(); } catch { /* Already dismissed. */ }
  const skip = page.getByRole('button', { name: /Configure later|稍后配置/ });
  try { await skip.waitFor({ state: 'visible', timeout: 4000 }); await skip.click(); } catch { /* Already configured. */ }
  await page.locator('[data-composer-input]:visible').waitFor();
  if (await skip.isVisible()) await skip.click();
  assert.equal(await page.locator('.nr-home').count(), 0);
  checks.homeWithdrawn = true;
  const editor = page.locator('[contenteditable=true]').first();
  await editor.fill('UI验收草稿，不发送');
  await openLibrary(page);
  assert.equal(await page.getByLabel('资料类型', { exact: true }).count(), 0);
  await page.getByRole('button', { name: '高级搜索', exact: true }).click();
  await page.getByLabel('资料类型', { exact: true }).selectOption('source');
  await page.waitForFunction(() => document.querySelectorAll('.nv-vault-table-scroll tbody tr').length === 1);
  await page.getByLabel('搜索资料', { exact: true }).fill('公式');
  await page.getByRole('button', { name: '重置筛选', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.nv-vault-table-scroll tbody tr').length === 2);
  assert.equal(await page.getByLabel('搜索资料', { exact: true }).inputValue(), '公式');
  await page.setViewportSize({ width: 610, height: 746 });
  await page.waitForFunction(() => [...document.querySelectorAll('.nv-search-options select, .nv-search-options input')].every(element => { const box = element.getBoundingClientRect(); return box.width >= 100 && box.right <= innerWidth && box.left >= 0; }));
  const fontSizes = await page.locator('.nv-vault-filters input,.nv-vault-filters select').evaluateAll(elements => [...new Set(elements.map(element => getComputedStyle(element).fontSize))]);
  assert.deepEqual(fontSizes, ['13px']);
  await page.screenshot({ path: join(workspaceRoot, 'work/ui-search-narrow.png') });
  await page.getByLabel('搜索资料', { exact: true }).press('Escape');
  assert.equal(await page.getByLabel('资料类型', { exact: true }).count(), 0);
  await page.getByRole('button', { name: '清除搜索资料', exact: true }).click();
  await page.setViewportSize({ width: 1200, height: 800 });
  checks.unifiedSearchAndNarrowFilters = true;
  await page.locator('.nv-left-files-body').getByRole('button', { name: '公式检查', exact: true }).click();
  const document = page.locator('.nv-vault-doc-tab:visible').last();
  await document.locator('.katex').first().waitFor();
  assert.ok(await document.locator('.katex').count() >= 3);
  await document.getByText('展开公式', { exact: true }).click();
  assert.ok(await document.locator('details[open] .katex').count() >= 1);
  assert.equal(await document.locator('.katex-error').count(), 0);
  assert.equal(await document.getByText('TEACHER_HIDDEN_FIXTURE', { exact: true }).isVisible(), false);
  checks.documentKatexAndFolds = true;
  await page.locator('[data-sidebar-right-open] button[data-notara-workspace-mode="fullscreen"]').click();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-composer-seat]')).position === 'fixed');
  assert.equal(await page.locator('[contenteditable=true]').count(), 1);
  assert.equal(await editor.innerText(), 'UI验收草稿，不发送');
  await editor.fill('UI验收草稿，全屏继续编辑');
  const reading = await document.locator('.nv-vault-markdown').evaluate(article => {
    const box = article.getBoundingClientRect(), pane = article.parentElement.getBoundingClientRect(), style = getComputedStyle(article), p = article.querySelector('p');
    return { width: box.width, centered: Math.abs((box.left - pane.left) - (pane.left + article.parentElement.clientWidth - box.right)) < 2, padding: parseFloat(style.paddingLeft), font: style.fontSize, paragraph: getComputedStyle(p).fontSize };
  });
  assert.ok(reading.width <= 860 && reading.centered && reading.padding >= 40, JSON.stringify(reading));
  assert.equal(reading.font, reading.paragraph);
  checks.typoraReadingLayout = true;
  await page.screenshot({ path: join(workspaceRoot, 'work/ui-feedback-fullscreen.png') });
  await page.waitForFunction(() => { const frame = document.querySelector('.pI_x6G_frame'); return frame.hasAttribute('data-rightbar-fullscreen') && !frame.hasAttribute('data-animating') && !document.documentElement.hasAttribute('data-notara-materials-split'); });
  await page.evaluate(() => {
    window.sidebarTransitions = [];
    const frame = document.querySelector('.pI_x6G_frame');
    window.sidebarTransitionStart = { html: frame.outerHTML.slice(0,400), css: getComputedStyle(frame).transition, columns: getComputedStyle(frame).gridTemplateColumns };
    document.querySelector('.pI_x6G_frame').addEventListener('transitionrun', event => {
      if (event.target.matches('.pI_x6G_frame')) window.sidebarTransitions.push(event.propertyName);
    });
  });
  await page.locator('button.hHd-Xa_toggle').click();
  await page.waitForFunction(() => window.sidebarTransitions.includes('grid-template-columns'));
  await page.locator('button.hHd-Xa_toggle').click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('button.hHd-Xa_toggle').click();
  assert.equal(await page.locator('.pI_x6G_frame').evaluate(element => getComputedStyle(element).transitionDuration), '0s');
  await page.locator('button.hHd-Xa_toggle').click();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  checks.sidebarAnimation = true;
  await page.locator('[data-sidebar-right-open] button[data-notara-workspace-mode]').click();
  assert.equal(await editor.innerText(), 'UI验收草稿，全屏继续编辑');
  checks.sameNativeEditor = true;
  // The chooser is exercised from the files tab, where the native session tree is hidden.
  const second = join(runtime.root, '第二工作区'); await mkdir(second);
  await writeFile(join(second, '同名.md'), '# 工作区乙\n');
  await writeFile(join(second, '仅乙.md'), '# 仅乙\n');
  const original = await page.getByLabel('切换工作区').getAttribute('data-workspace-id');
  await page.getByRole('button', { name: '选择文件夹作为工作区' }).click();
  await page.getByRole('button', { name: /^(Edit path|编辑路径)$/ }).click();
  const pathInput = page.getByRole('textbox', { name: /^(Edit path|编辑路径)$/ });
  await pathInput.fill(second); await pathInput.press('Enter');
  await page.getByRole('button', { name: /^(Open|打开)$/ }).click();
  await page.locator('.nv-left-files-body').getByRole('button', { name: '仅乙', exact: true }).waitFor();
  assert.equal(await page.locator('.nv-left-files-body').getByRole('button', { name: '公式检查', exact: true }).count(), 0);
  const secondId = await page.getByLabel('切换工作区').getAttribute('data-workspace-id');
  assert.notEqual(secondId, original);
  assert.ok(calls.some(call => call.method === 'query' && call.input?.workspaceId === secondId && call.result?.value?.documents?.some(doc => doc.title === '仅乙')));
  await page.locator('.nv-left-files-body').getByRole('button', { name: '工作区乙', exact: true }).click();
  await page.locator('.nv-vault-doc-tab:visible').getByRole('heading', { name: '工作区乙', exact: true }).waitFor();
  await chooseWorkspace(page, original);
  await page.locator('.nv-left-files-body').getByRole('button', { name: '公式检查', exact: true }).waitFor();
  assert.equal(await page.locator('.nv-left-files-body').getByRole('button', { name: '仅乙', exact: true }).count(), 0);
  assert.equal(await editor.innerText(), 'UI验收草稿，全屏继续编辑');
  checks.workspaceSwitchAndDraft = true;
  await page.getByRole('button', { name: /Collapse right sidebar|收起右侧边栏/i }).click();
  await page.setViewportSize({ width: 610, height: 746 });
  await page.locator('[data-conversation-scroll]').evaluate(element => { element.scrollTop = 0; });
  const title = await page.locator('.pXSMma_headline').boundingBox();
  assert.ok(title && title.y >= 0 && title.y < 746, JSON.stringify(title));
  await page.screenshot({ path: join(workspaceRoot, 'work/ui-feedback-narrow.png') });
  checks.narrowHeroReachable = true;
  assert.deepEqual(errors, []);
  await writeFile(join(workspaceRoot, 'work/ui-feedback-evidence.json'), JSON.stringify({ status: 'PASS', checks, errors }, null, 2));
  console.log(JSON.stringify({ status: 'PASS', checks }));
} catch (error) {
  console.error(JSON.stringify({ checks, errors, frame: await page.locator('.pI_x6G_frame').evaluate(e => ({ start:window.sidebarTransitionStart, transitions:window.sidebarTransitions, html: e.outerHTML.slice(0,400), css: getComputedStyle(e).transition, columns:getComputedStyle(e).gridTemplateColumns, dataset:document.documentElement.dataset })), rpcErrors: calls.filter(call => call.result?.ok === false), body: (await page.locator('body').innerText()).slice(-1000) }));
  throw error;
} finally { await browser.close(); await runtime.stop(); await rm(fixture, { recursive: true, force: true }); }
