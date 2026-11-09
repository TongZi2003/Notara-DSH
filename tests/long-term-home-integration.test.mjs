import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { startNativeRuntime, workspaceRoot } from '../scripts/native-runtime.mjs';

test('withdrawn home leaves new and existing native conversations usable without redirects', { timeout: 90000 }, async () => {
  const fixture = await mkdtemp(join(workspaceRoot, 'work/home-withdrawal-fixture-'));
  const profile = '---\ntype: learner-profile\n---\n# 模拟画像\n## 首页推荐\n- [ ] 原来的学习建议保留在文档里\n';
  await writeFile(join(fixture, '画像.md'), profile);
  const runtime = await startNativeRuntime({ fixture, testModel: true });
  const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1150, height: 850 } });
  const errors = [], homeCalls = [];
  page.on('pageerror', e => errors.push(e.stack || e.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => { if (/homeSession|homeRecommendations/.test(request.url())) homeCalls.push(request.url()); });
  page.setDefaultTimeout(10000);
  const out = join(workspaceRoot, 'work/home-withdrawal-20261106/screenshots'); await mkdir(out, { recursive: true });
  const absent = async () => {
    await expect(page.locator('.nr-home, .nr-home-page, .nr-home-dock, style[data-notara-home]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '学习首页', exact: true })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: '首页', exact: true })).toHaveCount(0);
  };
  try {
    await page.goto(runtime.authUrl); await page.getByRole('button', { name: /^(Continue|继续)$/ }).click();
    await expect(page.getByRole('button', { name: /^(Continue|继续)$/ })).toBeHidden();
    const editor = page.locator('[data-composer-input]:visible');
    await expect(editor).toBeVisible(); await absent();
    await expect(page.locator('.pXSMma_headline')).toBeVisible();
    await editor.fill('保留这一节课的记录'); await editor.press('Enter');
    await page.getByRole('button', { name: /1 turns 1 steps|1 轮.*1 步/ }).waitFor();
    await editor.fill('原课堂未发送的草稿');
    await page.getByRole('button', { name: /^(New session|新会话|新建会话)$/ }).click();
    await expect(editor).toBeEmpty(); await absent();
    await editor.fill('新会话未发送的草稿');
    await page.reload(); await expect(editor).toContainText('新会话未发送的草稿'); await absent();
    await page.getByRole('tablist', { name: '工作区栏目' }).getByRole('tab', { name: '会话', exact: true }).click();
    await page.locator('.nv-session-row[data-selected="false"] .nv-session-open').first().click();
    await expect(editor).toContainText('原课堂未发送的草稿');
    await expect(page.locator('[data-conversation-scroll]').getByText('保留这一节课的记录', { exact: true })).toBeVisible();
    await absent();
    await page.getByRole('button', { name: /^(New session|新会话|新建会话)$/ }).click();
    await expect(editor).toContainText('新会话未发送的草稿');
    await page.setViewportSize({ width: 642, height: 746 }); await absent();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: join(out, 'native-new-conversation.png') });
    assert.equal(await readFile(join(runtime.vault, '画像.md'), 'utf8'), profile);
    assert.deepEqual(homeCalls, [], 'view changes do not look up or open a home session');
    assert.deepEqual(errors, []);
  } catch (error) {
    await page.screenshot({ path: join(out, 'failure.png') });
    await writeFile(join(out, 'failure.txt'), (await page.locator('body').innerText()) + '\n' + JSON.stringify(errors) + '\n' + runtime.log());
    throw error;
  } finally { await browser.close(); await runtime.stop(); await rm(fixture, { recursive: true, force: true }); }
});
