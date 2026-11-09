import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { startNativeRuntime, workspaceRoot } from '../scripts/native-runtime.mjs';
import { chooseWorkspace, openLibrary, chooseBaseView } from '../scripts/ui-navigation.mjs';
const output = join(workspaceRoot, 'outputs/switch-fix-20261027');
async function setup() {
  await mkdir(output, { recursive: true });
  const runtime = await startNativeRuntime({ testModel: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1414, height: 850 } });
  page.setDefaultTimeout(8_000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(runtime.authUrl); await page.getByRole('button', { name: /^(Continue|继续)$/ }).click();
  await page.locator('[data-composer-input]:visible').waitFor(); await page.waitForLoadState('networkidle');
  return { runtime, browser, page, errors, stop: async () => { await browser.close(); await runtime.stop(); } };
}
async function retain(page, text) {
  const input = page.locator('[data-composer-input]'); await input.fill(text); await input.press('Enter');
  await page.locator('section.nv-block-flow:visible').waitFor();
  await expect(page.getByRole('button', { name: /^(Stop generating|停止生成)$/ })).toHaveCount(0);
}

test('closing the only graph tab should clear the shared workspace snapshot', { timeout: 60_000 }, async () => {
  const f = await setup(), { page } = f;
  try {
    await retain(page, '创建审计会话A');
    await page.getByRole('button', { name: /^(New session|新会话|新建会话)$/ }).click();
    await page.locator('[data-composer-input]:visible').waitFor(); await retain(page, '创建审计会话B');
    const switchRoom = async () => {
      await page.getByRole('tablist', { name: '工作区栏目' }).getByRole('tab', { name: '会话', exact: true }).click();
      await page.locator('.nv-session-row[data-selected="false"] button.nv-session-open').click();
    };
    await switchRoom();
    await page.locator('[data-sidebar-right-expand]').click();
    await page.locator('[data-sidebar-right-guide-entry="notara-graph"]').click();
    await page.locator('.nv-independent-graph:visible').waitFor();
    await expect(page.locator('[data-dockkit-tab]:visible')).toHaveCount(1);
    await page.locator('[data-dockkit-tab]:visible').getByRole('button', { name: /^(Close|关闭)$/ }).click();
    await expect(page.locator('[data-sidebar-right-expand]')).toBeVisible();
    await switchRoom();
    await page.locator('[data-sidebar-right-expand]').click();
    await expect(page.locator('[data-sidebar-right-open]:visible')).toBeVisible();
    const tabs = await page.locator('[data-dockkit-tab]:visible').allTextContents();
    await page.screenshot({ path: join(output, 'closed-graph-final.png') });
    await writeFile(join(output, 'closed-graph-result.json'), JSON.stringify({ tabs, errors: f.errors, closedGraphReturned: tabs.some(text => text.includes('知识图谱')) }, null, 2));
    assert.ok(!tabs.some(text => text.includes('知识图谱')), 'Closed graph must not be resurrected in B');
    await page.reload();
    await expect(page.locator('[data-sidebar-right-open]:visible')).toBeVisible();
    await expect(page.locator('.nv-doc-tab-chip:visible').filter({ hasText: /^知识图谱$/ })).toHaveCount(0);
    assert.deepEqual(f.errors, []);
  } finally { await f.stop(); }
});

test('library search and selection should survive switching workspace away and back', { timeout: 60_000 }, async () => {
  const f = await setup(), { page, runtime } = f;
  try {
    await retain(page, '资料库状态审计A');
    const picker = page.getByLabel('切换工作区'), a = await picker.getAttribute('data-workspace-id');
    await openLibrary(page);await chooseBaseView(page,'全部资料');
    const library = page.locator('.nv-base-workspace:visible'), search = library.locator('input[type="search"]');
    await library.getByRole('button',{name:'搜索',exact:true}).click();
    await search.fill('SVD');
    const title=library.getByRole('button',{name:'奇异值分解SVD的几何意义与构造推导',exact:true}),selected=library.getByRole('row').filter({has:page.getByRole('button',{name:'奇异值分解SVD的几何意义与构造推导',exact:true})});
    await title.click({modifiers:['ControlOrMeta']});
    const before = { search: await search.inputValue(), selected: await selected.getAttribute('aria-selected') };
    assert.equal(before.selected,'true');
    await page.screenshot({ path: join(output, 'library-before-switch.png') });
    const second = join(runtime.root, '资料库状态审计乙'); await mkdir(second);
    await writeFile(join(second, '乙资料.md'), '# 乙资料\n');
    await picker.click(); await page.getByRole('menuitem', { name: '添加工作区…', exact: true }).click();
    await page.getByRole('button', { name: /^(编辑路径|Edit path)$/ }).click();
    const path = page.getByRole('textbox', { name: /^(编辑路径|Edit path)$/ });
    await path.fill(second); await path.press('Enter'); await page.getByRole('button', { name: /^(打开|Open)$/ }).click();
    await expect(picker).not.toHaveAttribute('data-workspace-id', a); await page.locator('[data-composer-input]:visible').waitFor();
    await openLibrary(page);await chooseBaseView(page,'全部资料'); await expect(library).toContainText('乙资料');
    await chooseWorkspace(page, a);
    await expect(picker).toHaveAttribute('data-workspace-id', a); await expect(selected).toBeVisible();
    const after = { search: await search.inputValue(), selected: await selected.getAttribute('aria-selected') };
    await page.screenshot({ path: join(output, 'library-after-switch.png') });
    await writeFile(join(output, 'library-state-result.json'), JSON.stringify({ before, after, errors: f.errors }, null, 2));
    assert.deepEqual(after, before, 'Search and selection should remain in A');
    assert.deepEqual(f.errors, []);
  } finally { await f.stop(); }
});
