import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { startNativeRuntime, workspaceRoot } from '../scripts/native-runtime.mjs';

test('main preset menu hides subagent-only roles, keeps native selection and the complete settings roster', { timeout: 90_000 }, async () => {
  const runtime = await startNativeRuntime({ testModel: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1414, height: 746 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const output = join(workspaceRoot, 'outputs/preset-picker-20261026');
  try {
    await page.goto(runtime.authUrl); await page.getByRole('button', { name: /^(Continue|继续)$/ }).click();
    await page.locator('[data-composer-input]:visible').waitFor();
    await page.getByRole('button', { name: '首页学习助手', exact: true }).click();
    const menu = page.locator('.nv-preset-menu');
    await expect(menu).toBeVisible();
    for (const label of ['学习', '伙伴', '通用']) await expect(menu.getByText(label, { exact: true })).toBeVisible();
    for (const name of ['大肥鱼（不看解析）', '题目研究员', '核验员', '出题员', '资料研究员', '备课员']) await expect(menu.getByRole('menuitem', { name: new RegExp(name.replace(/[（）]/g, '\\$&')) })).toHaveCount(0);
    for (const name of ['首页学习助手', '专题课堂老师', '大肥鱼', '大小姐', '多动鬼', '后桌']) await expect(menu.getByRole('menuitem', { name: new RegExp('^' + name) })).toHaveCount(1);
    await mkdir(output, { recursive: true });
    await page.evaluate(async () => { await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))); });
    await page.screenshot({ path: join(output, 'main-menu.png') });
    await menu.getByRole('menuitem', { name: /^专题课堂老师/ }).click();
    await expect(page.getByRole('button', { name: '专题课堂老师', exact: true })).toBeVisible();
    await page.locator('[data-composer-input]').pressSequentially('验证角色选择');
    await page.getByRole('button', { name: /^(Send message|发送消息)$/ }).click();
    await expect(page.getByText('这是确定性集成测试输出，不是教学效果证据。', { exact: true })).toBeVisible();
    await expect(page.locator('header').getByText('专题课堂老师', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.locator('header').getByText('专题课堂老师', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /^(Account menu|账号菜单)$/ }).click();
    await page.getByRole('menuitem', { name: /^(Settings|设置)/ }).click();
    await page.getByRole('button', { name: /^(Agent presets|Agent 预设)$/ }).click();
    const settings = page.getByRole('dialog');
    await expect(settings.getByText('题目研究员', { exact: true })).toBeVisible();
    await expect(settings.getByText('大肥鱼（不看解析）', { exact: true })).toBeVisible();
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await runtime.stop(); }
});
