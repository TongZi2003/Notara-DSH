import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { startNativeRuntime, workspaceRoot } from '../scripts/native-runtime.mjs';
import { samplePdf } from './sample-pdf.mjs';

test('native file upload stays a draft until sent, then imports one original and hides internal receipts across reload', { timeout: 120000 }, async () => {
  const runtime = await startNativeRuntime({ testModel: true });
  const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1414, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const name = '上传入库验证讲义.pdf', bytes = samplePdf(), path = join(runtime.vault, '来源', name);
  const output = join(workspaceRoot, 'output/playwright/attachment-import-20261101'); await mkdir(output, { recursive: true });
  let passed = false;
  try {
    await page.goto(runtime.authUrl); await page.getByRole('button', { name: /^(Continue|继续)$/ }).click();
    await page.locator('[data-composer-input]:visible').waitFor();
    await page.waitForLoadState('networkidle');
    const send = async text => {
      const input = page.locator('[data-composer-input]');
      await input.pressSequentially(text);
      await expect(input).toHaveText(text);
      await page.getByRole('button', { name: /^(Send message|发送消息)$/ }).click();
      await expect(page.getByRole('button', { name: /^(Stop generating|停止生成)$/ })).toHaveCount(0, { timeout: 20000 });
    };
    await send('准备上传一份讲义。');
    await expect(page.getByText('这是确定性集成测试输出，不是教学效果证据。', { exact: true })).toBeVisible({ timeout: 20000 });
    const upload = async () => {
      const trigger = page.getByRole('button', { name: '本次活动', exact: true }); await trigger.click();
      const panel = page.getByRole('complementary', { name: '本次活动', exact: true });
      await panel.getByRole('button', { name: '添加来源', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '添加来源', exact: true });
      await dialog.getByRole('button', { name: '上传文件', exact: true }).click();
      await dialog.getByLabel('上传来源文件').setInputFiles({ name, mimeType: 'application/pdf', buffer: bytes });
      await expect(dialog).toHaveCount(0);
      await expect(page.getByText(name, { exact: true }).last()).toBeVisible();
      await trigger.click();
    };
    await upload();
    await assert.rejects(readFile(path), { code: 'ENOENT' });
    await send('请结合刚上传的讲义。');
    await expect.poll(() => readFile(path).then(data => data.equals(bytes), () => false), { timeout: 20000 }).toBe(true);
    await expect(page.getByText('这是确定性集成测试输出，不是教学效果证据。', { exact: true })).toHaveCount(2);
    assert.doesNotMatch(await page.locator('body').innerText(), /notara-attachment-import|文档附件入库回执|attachment_import_failed/);
    await upload(); await send('仍然是同一份讲义。');
    await expect(page.getByText('这是确定性集成测试输出，不是教学效果证据。', { exact: true })).toHaveCount(3);
    assert.deepEqual((await readdir(join(runtime.vault, '来源'))).filter(file => file.startsWith('上传入库验证讲义')), [name]);
    assert.deepEqual(await readFile(path), bytes);
    await page.reload(); await page.locator('[data-composer-input]').waitFor();
    await expect(page.getByText('请结合刚上传的讲义。', { exact: true })).toBeVisible();
    assert.doesNotMatch(await page.locator('body').innerText(), /notara-attachment-import|文档附件入库回执/);
    await page.screenshot({ path: join(output, 'sent-and-reloaded.png') });
    assert.deepEqual(errors, []); passed = true;
  } catch (error) {
    await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {}); throw error;
  } finally {
    await browser.close(); await runtime.stop({ preserve: !passed });
    if (!passed) console.error('Isolated fixture:', runtime.home);
  }
});
