import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { startNativeRuntime, workspaceRoot } from '../scripts/native-runtime.mjs';

test('native chat folds source lists, opens wiki references and keeps retired choices read-only without sending', { timeout: 90_000 }, async () => {
  const runtime = await startNativeRuntime({ testModel: true, modelFixture: 'tests/chat-markup-model.mjs' });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1414, height: 850 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(runtime.authUrl); await page.getByRole('button', { name: /^(Continue|继续)$/ }).click();
    await page.locator('[data-composer-input]:visible').waitFor();
    await page.getByRole('button', { name: '首页学习助手', exact: true }).click();
    await page.getByRole('menuitem', { name: /^专题课堂老师/ }).click();
    const composer = page.locator('[data-composer-input]');
    await composer.pressSequentially('请展示资料清单和选择卡。');
    await page.getByRole('button', { name: /^(Send message|发送消息)$/ }).click();
    const fold = page.locator('.nv-chat-fold').first();
    await expect(fold.locator('summary')).toHaveText('已经落盘的文件（这轮先不用读）');
    assert.equal(await fold.evaluate(element => element.open), false);
    await expect(page.locator('.nv-chat-markdown .katex').first()).toBeVisible();
    assert.doesNotMatch(await page.locator('body').innerText(), /<details>|<summary>|\[\[/);
    assert.doesNotMatch(await page.locator('body').innerText(), /HTML_FUTURE_SECRET|SUMMARY_FUTURE_SECRET/);
    await page.getByText('互动内容', { exact: true }).click();
    assert.doesNotMatch(await page.locator('body').innerText(), /HTML_FUTURE_SECRET|SUMMARY_FUTURE_SECRET/);
    await fold.locator('summary').click();
    await expect(fold.getByRole('button', { name: '转置卡片', exact: true })).toBeVisible();
    await composer.pressSequentially('保留原来的草稿');
    await fold.getByRole('button', { name: '转置卡片', exact: true }).click();
    await expect(page.locator('.nv-vault-doc-tab:visible .cm-editor')).toBeVisible();
    await expect(composer).toHaveText('保留原来的草稿');
    const retired = page.locator('.nv-retired-component');
    await expect(retired).toBeVisible();
    await expect(retired.getByRole('radio')).toHaveCount(0);
    await expect(retired.getByRole('textbox')).toHaveCount(0);
    const note = '其实这段代码我都看不懂';
    // Enter sends in the native composer; Shift+Enter is its newline action.
    await composer.press('End');
    await composer.press('Shift+Enter');
    await composer.pressSequentially(note);
    const draft = await composer.innerText();
    assert.match(draft, /^保留原来的草稿/);
    assert.equal(draft.split(note).length, 2);
    assert.equal(await page.locator('[data-user-markdown]').count(), 1, 'Only the original request was sent');
    await mkdir(join(workspaceRoot, 'outputs/chat-markup-20261026'), { recursive: true });
    await page.evaluate(async () => { await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))); });
    await page.screenshot({ path: join(workspaceRoot, 'outputs/chat-markup-20261026/fold-and-note.png') });
    await page.reload();
    await expect(page.locator('.nv-retired-component')).toBeVisible();
    await expect.poll(async () => (await composer.innerText()).replace(/\s+/g, '')).toBe(draft.replace(/\s+/g, ''));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await runtime.stop(); }
});
