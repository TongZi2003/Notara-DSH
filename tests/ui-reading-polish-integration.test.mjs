import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { startNativeRuntime, workspaceRoot } from '../scripts/native-runtime.mjs';
import { blurDocumentEditor, openLibrary, chooseBaseView } from '../scripts/ui-navigation.mjs';
import { defaultLibraryBase, serializeBase } from '../plugins/vault-sqlite/bases.js';

test('reading polish preserves links, folds, source views and PDF navigation', { timeout: 150000 }, async t => {
  const fixture = await mkdtemp(join(workspaceRoot, 'work/ui-reading-fixture-'));
  const baseConfig = defaultLibraryBase();
  baseConfig.views.push({ name: '自定义来源', type: 'table', order: ['file.name', 'note.tags'], notara: { scope: 'sources', sourcePath: '讲义.md' } });
  const files = {
    '资料库.base': serializeBase(baseConfig),
    '讲义.md': '---\ntype: source\n---\n# 讲义\n原始资料。',
    '另一份讲义.md': '---\ntype: source\n---\n# 另一份讲义\n另外的来源。',
    '笔记.md': '# 笔记\n链接目的地。',
    '卡片.md': '---\ntype: concept\ntags: [不等式]\n---\n# 卡片\n\n由 [[笔记.md|此前的笔记与条件分析]]，可以解释 **结论**。\n\n<details><summary>参考理解与 $a>0$</summary>\n\n折叠正文包含 [[笔记.md|笔记]]。\n\n</details>\n\n## 来源\n[[讲义.md]]\n![[来源/集成测试讲义.pdf#page=1&rect=0,0,1,1]]\n',
    '路线.md': '---\ntype: route\n---\n# 路线\n\n## 阶段里程碑\n- [ ] 解释 $ab>0$\n  - 待补：比较 $\\sqrt{ab}$ 与 **上界**，回看 [[笔记.md|笔记]]。\n\n## 下一步行动\n- 继续讨论 $a>0$ 的条件\n',
  };
  for (const [path, content] of Object.entries(files)) await writeFile(join(fixture, path), content);
  const runtime = await startNativeRuntime({ fixture, testModel: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1150, height: 800 } });
  page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const output = join(workspaceRoot, 'outputs/ui-reading-polish-regression'); await mkdir(output, { recursive: true });
  const doc = page.locator('.nv-vault-doc-tab:visible');
  const open = async path => {
    await page.evaluate(path => window.dispatchEvent(new CustomEvent('notara:open-document', { detail: { path } })), path);
    if (path.endsWith('.md')) { await expect(doc.locator('.nv-vault-doc-path')).toHaveAttribute('title', path); await blurDocumentEditor(page, doc); }
  };
  try {
    await page.goto(runtime.authUrl);
    await page.getByRole('button', { name: /^(Continue|继续)$/ }).click();
    await page.locator('[data-composer-input]:visible').waitFor();
    await open('卡片.md'); await page.getByRole('button', { name: '全屏', exact: true }).click();
    await t.test('inline references fit the prose line and folds remain keyboard operable', async () => {
      const link = doc.getByRole('button', { name: '此前的笔记与条件分析', exact: true });
      await expect(link).toBeVisible();
      const style = await link.evaluate(el => { const s = getComputedStyle(el); return { padding: s.padding, minHeight: s.minHeight, background: s.backgroundColor, height: el.getBoundingClientRect().height, lineHeight: parseFloat(s.lineHeight) }; });
      assert.equal(style.padding, '0px'); assert.equal(style.background, 'rgba(0, 0, 0, 0)');
      assert.ok(style.height <= style.lineHeight + 1, JSON.stringify(style));
      const summary = doc.locator('summary').filter({ hasText: '参考理解与' });
      assert.equal(await summary.evaluate(el => getComputedStyle(el.parentElement).borderTopWidth), '0px');
      assert.ok(await summary.evaluate(el => parseFloat(getComputedStyle(el).paddingRight) >= 48), 'HTML fold titles reserve the edit action width too');
      await expect(doc.getByText('折叠正文包含', { exact: false })).not.toBeVisible();
      await summary.press('Enter'); await expect(doc.getByText('折叠正文包含', { exact: false })).toBeVisible();
      await summary.press('Space'); await expect(doc.getByText('折叠正文包含', { exact: false })).not.toBeVisible();
      await link.click(); await expect(doc.locator('.nv-vault-doc-path')).toHaveAttribute('title', '笔记.md');
    });
    await t.test('route overview uses the same formula and reference renderer', async () => {
      await open('路线.md');
      const bar = doc.getByRole('region', { name: '路线里程碑概览' });
      await expect(bar.locator('.nv-route-next-description')).not.toBeVisible();
      await bar.locator('summary').click();
      await expect(bar.locator('.nv-route-remediation-note .katex')).toHaveCount(1);
      await expect(bar.locator('.nv-route-milestone-title .katex')).toHaveCount(1);
      await expect(bar.locator('.nv-route-next-description .katex')).toHaveCount(1);
      await expect(bar.locator('.nv-route-remediation-note strong')).toHaveText('上界');
      // The route projection deliberately removes link syntax from field text;
      // explicit navigation actions remain separate from its rendered prose.
      await expect(bar.locator('.nv-route-remediation-note')).toContainText('笔记');
    });
    await t.test('PDF badges sit outside the source selection including at page edges', async () => {
      await open('来源/集成测试讲义.pdf');
      const badge = doc.getByRole('button', { name: '关联卡片：卡片 1', exact: true }); await expect(badge).toBeVisible();
      const rect = await badge.evaluate(el => { const b = el.getBoundingClientRect(), r = el.parentElement.getBoundingClientRect(), s = el.closest('.nv-vault-pdf-scroll').getBoundingClientRect(); return { right: b.right, left: b.left, regionLeft: r.left, viewportLeft: s.left }; });
      assert.ok(rect.right <= rect.regionLeft && rect.left >= rect.viewportLeft, JSON.stringify(rect));
      await badge.click(); await expect(doc.locator('.nv-vault-doc-path')).toHaveAttribute('title', '卡片.md');
    });
    await t.test('default sources use their title rather than an empty tag column', async () => {
      await openLibrary(page); const base = page.locator('.nv-base-workspace:visible');
      await expect(base.getByRole('button', { name: '讲义', exact: true })).toBeVisible();
      await expect(base.getByRole('columnheader', { name: '标签', exact: true })).toHaveCount(0);
      await base.getByRole('button', { name: '讲义', exact: true }).click();
      await expect(base.getByRole('columnheader', { name: '标签', exact: true })).toBeVisible();
      await expect(base.getByRole('button', { name: '筛选来源', exact: true })).toHaveCount(0);
      await expect(base.getByRole('button', { name: '返回原始资料', exact: true })).toBeVisible();
      await chooseBaseView(page, '全部资料');
      await expect(base.getByRole('columnheader', { name: '标签', exact: true })).toBeVisible();
      await chooseBaseView(page, '自定义来源');
      await expect(base.getByRole('columnheader', { name: '标签', exact: true })).toBeVisible();
      await base.getByRole('button', { name: '筛选', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: '筛选来源', exact: true }).click();
      await page.getByRole('dialog').getByLabel('来源 另一份讲义', { exact: true }).click();
      await expect(base.locator('.nv-library-source-heading strong')).toHaveText('另一份讲义');
    });
    await t.test('floating controls keep the end of materials reachable without moving on scroll', async () => {
      await open('卡片.md');
      const seat = page.locator('.pI_x6G_centerCol [data-composer-seat]');
      const bubble = page.getByRole('button', { name: '展开悬浮会话', exact: true });
      if (await bubble.isVisible()) await bubble.click();
      await expect(seat).toBeVisible();
      await expect.poll(() => page.evaluate(() => parseFloat(document.documentElement.style.getPropertyValue('--nv-materials-bottom-inset')))).toBeGreaterThan(100);
      const size = await seat.boundingBox();
      const spacer = await doc.locator('.nv-editable-document').evaluate(el => parseFloat(getComputedStyle(el, '::after').height));
      assert.ok(spacer >= size.height);
      await page.getByRole('button', { name: '最小化会话', exact: true }).click();
      await expect(bubble).toBeVisible(); const before = await bubble.boundingBox();
      await doc.locator('.nv-vault-main').evaluate(el => { el.scrollTop = el.scrollHeight; });
      assert.deepEqual(await bubble.boundingBox(), before);
      await page.screenshot({ path: join(output, 'reader.png') });
    });
    await t.test('narrow sidebar expands over content without squeezing the reading column', async () => {
      await page.setViewportSize({ width: 642, height: 746 });
      const sidebar = page.locator('.hHd-Xa_root');
      await expect(sidebar).toHaveClass(/hHd-Xa_collapsed/);
      await page.getByRole('button', { name: /^(Open sidebar|打开侧边栏)$/ }).click();
      await expect(sidebar).not.toHaveClass(/hHd-Xa_collapsed/);
      const column = page.locator('.pI_x6G_sidebarCol');
      await expect.poll(async () => (await column.boundingBox()).width).toBeLessThan(60);
      await expect.poll(async () => (await sidebar.boundingBox()).width).toBeGreaterThan(200);
      await page.setViewportSize({ width: 680, height: 746 });
      await expect(sidebar).not.toHaveClass(/hHd-Xa_collapsed/);
      await page.getByRole('button', { name: /^(Collapse sidebar|收起侧边栏)$/ }).click();
      await expect.poll(async () => (await doc.boundingBox()).width).toBeGreaterThan(600);
      await page.screenshot({ path: join(output, 'narrow-reader.png') });
    });
    for (const [path, content] of Object.entries(files)) assert.equal(await readFile(join(runtime.vault, path), 'utf8'), content);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: join(output, 'result.png') });
  } finally { await browser.close(); await runtime.stop(); await rm(fixture, { recursive: true, force: true }); }
});
