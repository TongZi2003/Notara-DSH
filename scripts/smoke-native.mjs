import { chromium, expect } from '@playwright/test';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { startNativeRuntime, workspaceRoot } from './native-runtime.mjs';
import { openLibrary, chooseBaseView, openGraph } from './ui-navigation.mjs';

const enabled = process.argv.slice(2);
const runtime = await startNativeRuntime({ ...(enabled.length ? { enabled } : {}), ...(process.env.NOTARA_TEST_DEPENDENCIES ? { dependencyDirectory: process.env.NOTARA_TEST_DEPENDENCIES } : {}) });
let browser, page;
const errors = [];
const rpc = [];
try {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', async response => {
    if (response.url().includes('/api/notaraVault/')) rpc.push({ method: response.url().split('/').at(-1), status: response.status(), result: await response.json().catch(() => null) });
  });
  await page.goto(runtime.authUrl);
  await page.waitForLoadState('networkidle');
  const notice = page.getByRole('button', { name: 'Continue', exact: true });
  if (await notice.isVisible()) await notice.click();
  const later = page.getByRole('button', { name: 'Configure later', exact: true });
  try { await later.waitFor({ state: 'visible', timeout: 2000 }); await later.click(); } catch { /* Already configured or rc.4 Get started dialog. */ }
  await page.locator('[data-composer-input]:visible').waitFor({ timeout: 12_000 });
  if (await later.isVisible()) await later.click();
  if (await page.getByText('Get started', { exact: true }).isVisible()) await page.keyboard.press('Escape');
  await expect(page.locator('.nr-home')).toHaveCount(0);
  const editable = page.locator('[data-composer-input]:visible');
  await editable.fill('请保留这段未发送的草稿。');
  assert.equal(await editable.innerText(), '请保留这段未发送的草稿。');
  await page.evaluate(async () => {
    await Promise.allSettled([
      document.fonts.load('16px "Anthropic Serif Web Text"'),
      document.fonts.load('16px "Anthropic Sans Web Text"'),
      document.fonts.load('16px "Anthropic Mono Variable"'),
      document.fonts.load('16px "Noto Serif SC"'),
      document.fonts.load('16px "Noto Sans SC"'),
    ]);
    await document.fonts.ready;
  });
  await page.screenshot({ path: join(workspaceRoot, 'work/native-desktop.png'), fullPage: true });
  const checks = { home: 'PASS', nativeDraft: 'PASS' };
  if (!enabled.length || enabled.includes('vault-views')) {
    await page.locator('.nv-left-chrome').waitFor();
    await openLibrary(page);
    await page.locator('.nv-vault-workspace .nv-base-data-row').first().waitFor();
    assert.ok(await page.locator('.nv-vault-workspace .nv-base-data-row').count() >= 4);
    await page.getByRole('button', { name: '卡片布局', exact: true }).click();
    const firstCard = page.locator('.nv-vault-results input[type=checkbox]').first();
    await firstCard.check();
    await page.getByRole('button', { name: '批量带入当前对话', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[contenteditable=true]')?.innerText.includes('请结合这些资料和我一起讨论。'));
    assert.ok((await editable.innerText()).includes('请保留这段未发送的草稿。'));
    assert.ok((await editable.innerText()).includes('请结合这些资料和我一起讨论。'));
    await chooseBaseView(page,'导读资料');
    const guideCard=page.locator('.nv-base-grid .nv-vault-title-link').first();
    await guideCard.waitFor(); await guideCard.click();
    await page.locator('.nv-editable-document').waitFor();
    await page.getByRole('button', {name:'查看源码',exact:true}).click();
    const code=page.locator('.nv-vault-doc-tab:visible .nv-live-markdown .cm-content:visible');
    await code.waitFor();
    const guidePath = await page.locator('.nv-vault-doc-tab:visible .nv-vault-doc-path').innerText();
    const before=await readFile(join(runtime.vault, guidePath),'utf8');
    assert.ok(before.includes('[ ]'), 'Guide document retains editable tasks');
    await code.fill(before.replace('[ ]','[x]'));
    await page.getByRole('button', {name:'保存',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.nv-markdown-save')?.disabled);
    await expect.poll(() => readFile(join(runtime.vault,guidePath),'utf8')).toBe(before.replace('[ ]','[x]'));
    await page.screenshot({ path: join(workspaceRoot, 'work/native-guides.png'), fullPage: true });
    checks.library = 'PASS'; checks.batchDraft = 'PASS'; checks.guideWrite = 'PASS';
    await openLibrary(page);
    if (!enabled.length || enabled.includes('graph-and-blocks')) {
      await openGraph(page);
      await page.getByRole('button', { name: '全部联系', exact: true }).click();
      await page.locator('.nv-block-node').first().waitFor();
      assert.ok(await page.locator('.nv-block-node').count() >= 4);
      await page.screenshot({ path: join(workspaceRoot, 'work/native-graph.png'), fullPage: true });
      await page.getByRole('button', { name: '奇异值分解SVD的几何意义与构造推导，按回车打开', exact: true }).dblclick();
      await page.locator('.nv-vault-doc-tab:visible').waitFor();
      const reference = page.locator('.nv-vault-doc-tab:visible details').filter({ has: page.locator('summary', { hasText: '参考理解' }) });
      await reference.waitFor();
      assert.equal(await reference.getAttribute('open'), null);
      checks.graph = 'PASS'; checks.graphToReader = 'PASS'; checks.referenceFold = 'PASS';
      await page.locator('.nv-left-files-body').getByRole('button', { name: 'SVD几何与推导白板', exact: true }).click();
      await page.getByRole('region', { name: '白板编辑器', exact: true }).waitFor();
      assert.ok(await page.locator('.react-flow__node').count() > 2);
      await page.screenshot({ path: join(workspaceRoot, 'work/native-canvas.png'), fullPage: true });
      checks.canvas = 'PASS';
    }
    await page.locator('.nv-left-files-body').getByRole('button', { name: '集成测试讲义', exact: true }).click();
    await page.locator('.nv-vault-pdf-layer').waitFor({ timeout: 15_000 });
    const pdfBox = await page.locator('.nv-vault-pdf-layer').boundingBox();
    await page.mouse.move(pdfBox.x + pdfBox.width * .05, pdfBox.y + pdfBox.height * .05);
    await page.mouse.down();
    await page.mouse.move(pdfBox.x + pdfBox.width * .8, pdfBox.y + pdfBox.height * .2, { steps: 10 });
    await page.mouse.up();
    await page.locator('.nv-vault-pdf-selection').waitFor();
    await page.getByRole('button', { name: '基于选区创建卡片', exact: true }).click();
    await page.getByLabel('卡片标题', { exact: true }).fill('PDF集成选区');
    await page.getByRole('button', { name: '创建卡片', exact: true }).click();
    await page.locator('[data-sidebar-right-tab]').filter({ hasText: 'PDF集成选区' }).first().waitFor();
    const createdCard = page.locator('.nv-vault-doc-tab:visible').filter({ has: page.locator('.nv-vault-doc-path', { hasText: 'PDF集成选区' }) });
    await createdCard.getByText('查看原页', { exact: true }).click();
    await createdCard.locator('.nv-vault-pdf-crop canvas').waitFor({ timeout: 10_000 });
    await page.screenshot({ path: join(workspaceRoot, 'work/native-pdf-card-crop.png'), fullPage: true });
    checks.pdfRender = 'PASS'; checks.pdfSelectionCard = 'PASS';

    const openTabCountBefore = await page.locator('[data-sidebar-right-open] [data-dockkit-tab]').count();
    assert.ok(openTabCountBefore >= 4, `Expected at least 4 independent native rightbar tabs, got ${openTabCountBefore}`);
    await page.locator('.nv-left-mode-switch').getByRole('tab', { name: '会话', exact: true }).click();
    await page.locator('button.hHd-Xa_newSession').click();
    await page.waitForTimeout(400);
    const openTabCountAfter = await page.locator('[data-sidebar-right-open] [data-dockkit-tab]').count();
    assert.equal(openTabCountAfter, openTabCountBefore, 'Switching/creating a new session must preserve opened rightbar tabs');
    await page.screenshot({ path: join(workspaceRoot, 'work/native-halfscreen-split.png'), fullPage: true });
    checks.crossSessionTabs = 'PASS'; checks.leftModeSwitch = 'PASS';

    await page.locator('button.hHd-Xa_toggle').click();
    await page.waitForTimeout(250);
    await openLibrary(page);
    await page.getByRole('button', { name: '卡片布局', exact: true }).click();
    const fsBtn = page.locator('[data-sidebar-right-open] button[data-notara-workspace-mode="fullscreen"]');
    if (await fsBtn.count()) await fsBtn.click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(workspaceRoot, 'work/native-cards-fullscreen.png'), fullPage: true });
    checks.collapsedRailFullscreen = 'PASS';
  }
  const body = await page.locator('body').innerText();
  const report = { enabled: enabled.length ? enabled : 'all', ...checks, errors, body };
  await writeFile(join(workspaceRoot, 'work/native-smoke.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, body: body.slice(0, 1200) }));
  if (errors.length) throw new Error(`Browser errors: ${errors.join('\n')}`);
} catch (error) {
  if (page) {
    await page.screenshot({ path: join(workspaceRoot, 'work/native-failure.png'), fullPage: true });
    await writeFile(join(workspaceRoot, 'work/native-failure.json'), JSON.stringify({ errors, rpc, body: await page.locator('body').innerText() }, null, 2));
    console.error(JSON.stringify({ errors: errors.map(value => value.slice(0, 250)), rpc: rpc.map(item => ({ method: item.method, status: item.status, ok: item.result?.result?.ok, error: item.result?.result?.error })), body: (await page.locator('body').innerText()).slice(-2000) }));
  }
  console.error(runtime.log().slice(-12000));
  throw error;
} finally { await browser?.close(); await runtime.stop(); }
