import {graphAction,graphSelect} from '../scripts/ui-navigation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { startNativeRuntime, workspaceRoot } from '../scripts/native-runtime.mjs';
import { openLibrary, chooseBaseView, openGraph, focusLibrary } from '../scripts/ui-navigation.mjs';

test('native search dialogs preserve layout, draft filters and shared material views; graph supports intersection and multiple centers', { timeout: 90_000 }, async () => {
  const fixture = await mkdtemp(join(workspaceRoot, 'work/search-fixture-'));
  for (const [title, type, tags, due, link] of [['甲卡片','card','数学, 共同','2000-01-01','乙来源'],['乙来源','source','数学, 共同','','丙卡片'],['丙卡片','card','数学, 另一个','2099-01-01','丁卡片'],['丁卡片','card','共同','2099-01-01','']]) {
    const previousDay = due ? new Date(Date.parse(due) - 86400000).toISOString().slice(0,10) : '';
    await writeFile(join(fixture, title + '.md'), `---\ntype: ${type}\ntitle: ${title}\ntags: [${tags}]\n${due ? `learned: true\nmastery: 1\ninterval: 1\nlast_review: ${previousDay}\nnext_review: ${due}\n` : ''}---\n# ${title}\n\n正文\n\n${link ? `## 参考理解\n[[${link}]]` : ''}\n`);
  }
  const output = join(workspaceRoot, 'work/editor-validation'); await mkdir(output, { recursive: true });
  const runtime = await startNativeRuntime({ fixture, testModel: true }), browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } }), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const workspace = page.locator('.nv-vault-workspace:visible'), dialog = page.getByRole('dialog');
  const openSearch = () => workspace.getByRole('button', { name: '高级搜索', exact: true }).click();
  const mode = () => page.evaluate(() => document.documentElement.dataset.notaraConversationMode || 'parallel');
  try {
    await page.goto(runtime.authUrl); await page.getByRole('button', { name: /^(Continue|继续)$/ }).click();
    await page.locator('[data-composer-input]:visible').waitFor(); await openLibrary(page); await workspace.getByRole('button', { name: '乙来源', exact: true }).waitFor();
    const initialMode = await mode();
    await openSearch(); await expect(dialog).toHaveAttribute('aria-label', '资料高级搜索');
    await expect(dialog.getByLabel('资料搜索关键词')).toBeFocused();
    await expect(dialog.getByLabel('资料类型',{exact:true})).toHaveCSS('border-radius','10px');
    await expect(dialog.getByLabel('资料排序',{exact:true})).toHaveCSS('font-size','13px');
    await dialog.getByLabel('标签 数学', { exact: true }).check(); await dialog.getByLabel('标签 共同', { exact: true }).check();
    await expect(dialog.getByRole('status')).toHaveText('2 份符合条件');
    await dialog.getByRole('button',{name:'任一标签（并集）',exact:true}).click();await expect(dialog.getByRole('status')).toHaveText('4 份符合条件');
    await dialog.getByRole('button',{name:'全部标签（交集）',exact:true}).click();await expect(dialog.getByRole('status')).toHaveText('2 份符合条件');
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await expect(workspace.getByRole('button', { name: '丙卡片', exact: true })).toBeVisible();
    await expect(workspace.getByRole('button', { name: '高级搜索', exact: true })).toBeFocused();
    await openSearch(); await expect(dialog.getByLabel('标签 数学', { exact: true })).not.toBeChecked();
    await dialog.getByLabel('标签 数学', { exact: true }).check(); await dialog.getByLabel('标签 共同', { exact: true }).check();
    await dialog.getByRole('button', { name: '应用', exact: true }).click();
    await expect(workspace.getByRole('button', { name: '丙卡片', exact: true })).toHaveCount(0);
    await workspace.getByRole('button', { name: '卡片布局', exact: true }).click();
    await expect(workspace.getByRole('button', { name: '乙来源', exact: true })).toBeVisible();
    await expect(workspace.locator('.nv-vault-card')).toHaveCount(2);
    await openSearch();await dialog.getByRole('button',{name:'任一标签（并集）',exact:true}).click();await dialog.getByRole('button',{name:'应用',exact:true}).click();await expect(workspace.locator('.nv-vault-card')).toHaveCount(4);
    await openSearch();await expect(dialog.getByRole('button',{name:'任一标签（并集）',exact:true})).toHaveAttribute('aria-pressed','true');await dialog.getByRole('button',{name:'全部标签（交集）',exact:true}).click();await dialog.getByRole('button',{name:'应用',exact:true}).click();await expect(workspace.locator('.nv-vault-card')).toHaveCount(2);
    await chooseBaseView(page,'待复习');
    await expect(workspace.locator('.nv-vault-card')).toHaveCount(1);
    await expect(workspace.locator('.nv-base-conditions')).toContainText('已应用视图筛选');
    await openSearch(); await expect(dialog.getByRole('status')).toHaveText('1 份符合条件');
    await expect(dialog.getByLabel('复习期限')).toHaveValue('all'); await dialog.getByLabel('资料搜索关键词').press('Escape');
    await expect(dialog).toHaveCount(0); assert.equal(await mode(), initialMode);
    await chooseBaseView(page,'全部资料'); await expect(workspace.getByRole('button', { name: '乙来源', exact: true })).toBeVisible();
    // Sidebar dialogs use the same native focus/escape lifecycle.
    await page.getByRole('button', { name: '高级搜索文件', exact: true }).click();
    await expect(dialog).toHaveAttribute('aria-label', '文件高级搜索'); await dialog.getByLabel('PDF', { exact: true }).check();
    await dialog.getByRole('button', { name: '应用', exact: true }).click();
    await expect(page.locator('.nv-left-files-body').getByRole('button', { name: '甲卡片', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '高级搜索文件', exact: true }).click(); await dialog.getByRole('button', { name: '清空条件', exact: true }).click(); await dialog.getByRole('button', { name: '应用', exact: true }).click();
    await page.getByRole('tablist', { name: '工作区栏目' }).getByRole('tab', { name: '会话', exact: true }).click();
    await page.getByRole('button', { name: '筛选会话', exact: true }).click();
    await expect(dialog).toHaveAttribute('aria-label', '会话高级搜索'); await dialog.getByLabel('只看已归档', { exact: true }).check();
    await dialog.getByLabel('会话高级搜索关键词').press('Escape'); await expect(dialog).toHaveCount(0);
    await page.getByRole('button', { name: '筛选会话', exact: true }).click(); await expect(dialog.getByLabel('当前会话', { exact: true })).toBeChecked(); await dialog.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await mode(), initialMode);
    await openGraph(page);
    await page.locator('.nv-independent-graph').getByRole('button',{name:'全部联系',exact:true}).click();
    await expect(page.locator('.nv-block-node')).toHaveCount(5);
    const graph = page.locator('.nv-independent-graph');
    await graphAction(page,graph,{name:'标签筛选',exact:true});
    await expect(dialog).toHaveAttribute('aria-label','筛选标签');
    await expect(dialog.getByLabel('查找中心资料')).toHaveCount(0);
    await dialog.getByLabel('图谱标签 数学', { exact: true }).check(); await dialog.getByLabel('图谱标签 共同', { exact: true }).check();
    await dialog.getByRole('button',{name:'任一标签（并集）',exact:true}).click();await expect(dialog.getByRole('status')).toHaveText('4 份符合条件');await dialog.getByRole('button',{name:'应用',exact:true}).click();await expect(graph.locator('.nv-block-node')).toHaveCount(4);
    await graphAction(page,graph,{name:'标签筛选',exact:true});await expect(dialog.getByRole('button',{name:'任一标签（并集）',exact:true})).toHaveAttribute('aria-pressed','true');await dialog.getByRole('button',{name:'全部标签（交集）',exact:true}).click();
    await expect(dialog.getByRole('status')).toHaveText('2 份符合条件');
    await dialog.getByRole('button', { name: '应用', exact: true }).click(); await expect(page.locator('.nv-block-node')).toHaveCount(2);
    const canvasSize = await graph.locator('.nv-block-graph-canvas').boundingBox();
    await graphAction(page,graph,{name:'甲卡片，按回车打开',exact:true});
    await expect(graph.getByRole('complementary',{name:'选中节点'})).toBeVisible();
    const selectedSize = await graph.locator('.nv-block-graph-canvas').boundingBox();
    assert.equal(Math.round(selectedSize.width),Math.round(canvasSize.width));assert.equal(Math.round(selectedSize.height),Math.round(canvasSize.height));
    await graphAction(page,graph,{name:'以此为中心',exact:true});await expect(graph.locator('.nv-block-center')).toHaveCount(1);
    await graphSelect(page,graph,'中心联系范围','0');await expect(graph.locator('.nv-block-node')).toHaveCount(1);
    await graphAction(page,graph,{name:'退出中心',exact:true});await expect(graph.locator('.nv-block-node')).toHaveCount(2);
    await graph.getByRole('button',{name:'图谱选项',exact:true}).click();await expect(graph.getByRole('button',{name:'移除图谱标签 数学',exact:true})).toBeVisible();await expect(graph.getByRole('button',{name:'移除图谱标签 共同',exact:true})).toBeVisible();
    await graphAction(page,graph,{name:'中心节点',exact:true});await expect(dialog).toHaveAttribute('aria-label','中心节点');
    await expect(dialog.getByLabel('中心资料 丙卡片',{exact:true})).toHaveCount(0);await expect(dialog.getByLabel('中心资料 甲卡片',{exact:true})).toBeVisible();
    await dialog.getByRole('button',{name:'取消',exact:true}).click();await expect(graph.getByRole('button',{name:'图谱选项',exact:true})).toBeFocused();
    await graphAction(page,page.locator('.nv-independent-graph'),{name:/高级搜索/}); await dialog.getByRole('button', { name: '清空条件', exact: true }).click();
    await dialog.getByLabel('中心资料 甲卡片', { exact: true }).check(); await dialog.getByLabel('中心资料 丁卡片', { exact: true }).check(); await dialog.getByLabel('中心联系范围').selectOption('0');
    await expect(dialog.getByRole('status')).toHaveText('2 份符合条件');
    await dialog.getByRole('button', { name: '应用', exact: true }).click(); await expect(page.locator('.nv-block-center')).toHaveCount(2); await expect(page.locator('.nv-block-node')).toHaveCount(2);
    await graphAction(page,page.locator('.nv-independent-graph'),{name:/高级搜索/}); await dialog.getByLabel('中心联系范围').selectOption('1'); await expect(dialog.getByRole('status')).toHaveText('4 份符合条件');
    await dialog.getByRole('button', { name: '应用', exact: true }).click(); await expect(page.locator('.nv-block-node')).toHaveCount(4);
    assert.equal(await mode(), initialMode);
    await focusLibrary(page); await workspace.getByRole('button', { name: '表格布局', exact: true }).click();
    await openGraph(page);
    await expect(page.locator('.nv-block-center')).toHaveCount(2); await expect(page.locator('.nv-block-node')).toHaveCount(4);
    // Both search surfaces stay inside narrow viewports, without changing docking.
    await page.setViewportSize({ width: 460, height: 746 });
    await graphAction(page,page.locator('.nv-independent-graph'),{name:/高级搜索/});
    await expect(dialog).toHaveCSS('opacity', '1');
    const box = await dialog.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 460 && box.y + box.height <= 746);
    await expect(dialog.getByRole('button', { name: '应用', exact: true })).toBeVisible();
    await page.screenshot({ path: join(output, 'graph-search-narrow.png') });
    await dialog.getByLabel('查找中心资料').press('Escape');
    // At 460px the native tab strip can collapse behind its chrome. Use the
    // visible materials navigation instead of clicking a clipped tab label.
    const expandSidebar=page.getByRole('button',{name:'打开侧边栏',exact:true});
    if(await expandSidebar.isVisible())await expandSidebar.click();
    await openLibrary(page); await workspace.getByRole('button', { name: '表格布局', exact: true }).click(); await openSearch();
    await expect(dialog).toHaveCSS('opacity', '1');
    const libraryBox = await dialog.boundingBox(); assert.ok(libraryBox.x >= 0 && libraryBox.x + libraryBox.width <= 460);
    await page.screenshot({ path: join(output, 'library-search-narrow.png') });
    await dialog.getByRole('button', { name: '取消', exact: true }).click(); assert.deepEqual(errors, []);
  } catch (error) { await page.screenshot({ path: join(output, 'search-graph-failure.png') }); throw error; }
  finally { await browser.close(); await runtime.stop(); await rm(fixture, { recursive: true, force: true }); }
});
