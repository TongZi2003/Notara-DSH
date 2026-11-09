import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { startNativeRuntime, workspaceRoot } from '../scripts/native-runtime.mjs';
import { openLibrary } from '../scripts/ui-navigation.mjs';

for (const width of [755, 1414]) test(`fresh session rightbar survives adoption, switching and reload at ${width}px`, { timeout: 90_000 }, async () => {
  const runtime = await startNativeRuntime({ testModel: true, modelFixture: 'tests/file-child-model.mjs' });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1414, height: 746 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const output = join(workspaceRoot, 'outputs/sidebar-fix-20261027');
  const panel = () => page.locator('[data-sidebar-right-open]:visible');
  const sections = page.getByRole('tablist', { name: '工作区栏目' });
  const switchRoom = async () => {
    await sections.getByRole('tab', { name: '会话', exact: true }).click();
    const expand = page.getByRole('button', { name: /^(Open sidebar|Expand sidebar|打开侧边栏|展开侧边栏)$/ });
    if (await expand.isVisible()) await expand.click();
    await page.locator('.nv-session-row[data-selected="false"]').locator('button').first().click();
  };
  const documentTab = () => page.locator('.nv-doc-tab-chip:visible').filter({ hasText: /^奇异值分解SVD的几何意义与构造推导$/ });
  const composer = page.locator('[data-composer-input]');
  try {
    await mkdir(output, { recursive: true });
    await page.goto(runtime.authUrl);
    await page.getByRole('button', { name: /^(Continue|继续)$/ }).click();
    await page.locator('[data-composer-input]:visible').waitFor();
    await page.waitForLoadState('networkidle');
    await composer.pressSequentially('请创建文件引用课堂。');
    await page.getByRole('button', { name: /^(Send message|发送消息)$/ }).click();
    await expect(page.getByText('文件引用课堂已打开。', { exact: true })).toBeVisible();
    await page.locator('[data-sidebar-right-expand]').click();
    await expect(panel()).toBeVisible();
    await openLibrary(page);
    await page.locator('.nv-left-files-body').getByRole('button', { name: '奇异值分解SVD的几何意义与构造推导', exact: true }).click();
    await expect(page.locator('.nv-vault-doc-tab:visible .cm-editor')).toBeVisible();
    const sessionA = await panel().getAttribute('data-sidebar-right-session');
    await composer.fill('A 的未发送草稿');
    await page.setViewportSize({ width, height: 746 });
    await switchRoom();
    // B has never opened its native rightbar. This first expansion was the crash trigger.
    await page.locator('[data-sidebar-right-expand]').click();
    await expect(panel()).toBeVisible();
    const sessionB = await panel().getAttribute('data-sidebar-right-session');
    assert.notEqual(sessionA, sessionB);
    await expect(documentTab()).toHaveCount(1);
    await documentTab().click();
    await expect(page.locator('.nv-vault-doc-tab:visible .cm-editor')).toBeVisible();
    await composer.fill('B 的未发送草稿');
    await page.screenshot({ path: join(output, `first-expand-${width}.png`) });
    for (let i = 0; i < 4; i++) {
      await switchRoom();
      await expect(panel()).toBeVisible();
      await expect(panel()).toHaveAttribute('data-sidebar-right-session', i % 2 ? sessionB : sessionA);
      await expect(composer).toHaveText(i % 2 ? 'B 的未发送草稿' : 'A 的未发送草稿');
      await expect(documentTab()).toHaveCount(1);
      await documentTab().click();
      await expect(page.locator('.nv-vault-doc-tab:visible .cm-editor')).toBeVisible();
    }
    // Closing and reopening the column must leave its handle usable.
    await page.locator('[data-sidebar-right-toggle]:visible').click();
    await expect(page.locator('[data-sidebar-right-expand]')).toBeVisible();
    await page.locator('[data-sidebar-right-expand]').click();
    await expect(panel()).toBeVisible();
    await page.reload();
    await expect(panel()).toBeVisible();
    await expect(documentTab()).toHaveCount(1);
    await expect(composer).toHaveText('B 的未发送草稿');
    await expect(page.locator('[data-slot-error]')).toHaveCount(0);
    await page.screenshot({ path: join(output, `reloaded-${width}.png`) });
    assert.deepEqual(errors, []);
    await writeFile(join(output, `browser-${width}.json`), JSON.stringify({ width, firstExpansion: true, switches: 4, draftsPreserved: true, reload: true, errors }, null, 2));
  } catch (error) {
    await page.screenshot({ path: join(output, `failure-${width}.png`) });
    await writeFile(join(output, `failure-${width}.json`), JSON.stringify({ error: error.message, errors }, null, 2));
    throw error;
  } finally { await browser.close(); await runtime.stop(); }
});
