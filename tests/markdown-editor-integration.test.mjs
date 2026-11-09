import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { startNativeRuntime, workspaceRoot } from '../scripts/native-runtime.mjs';
import { openLibrary, openDocumentSource, blurDocumentEditor } from '../scripts/ui-navigation.mjs';

test('CodeMirror edits real Markdown, preserves CRLF, restores drafts and detects external changes', { timeout: 90_000 }, async () => {
  const fixture = await mkdtemp(join(workspaceRoot, 'work/editor-fixture-'));
  await writeFile(join(fixture, '可编辑文档.md'), '# 可编辑文档\r\n\r\n原始内容 $x^2$。\r\n');
  const runtime = await startNativeRuntime({ fixture, testModel: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [], rpcErrors = []; page.on('pageerror', error => errors.push(error.message));
  page.on('response', async response => { if (response.url().includes('/api/notaraVault/')) { const body = await response.json().catch(() => null); if (body?.result?.ok === false) rpcErrors.push(body.result.error); } });
  try {
    await page.goto(runtime.authUrl); await page.getByRole('button', { name: /^(Continue|继续)$/ }).click();
    await page.locator('[data-composer-input]:visible').waitFor(); await page.waitForLoadState('networkidle');
    await openLibrary(page);
    await page.locator('.nv-vault-workspace:visible').getByRole('button', { name: '可编辑文档', exact: true }).click();
    await page.getByRole('button', { name: '全屏', exact: true }).click();
    await openDocumentSource(page);
    const editor = page.getByRole('textbox', { name: 'Markdown 正文编辑器', exact: true });
    await editor.press('ControlOrMeta+End'); await editor.pressSequentially('新增内容。');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
    let saved = await readFile(join(runtime.vault, '可编辑文档.md'), 'utf8');
    assert.ok(saved.includes('新增内容。')); assert.equal(saved.replaceAll('\r\n', '').includes('\n'), false);
    await editor.pressSequentially('未保存草稿。'); await page.reload();
    await openDocumentSource(page);
    await expect(editor).toContainText('未保存草稿。');
    await writeFile(join(runtime.vault, '可编辑文档.md'), saved + '\r\n外部更改。\r\n');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByText('文件已有更新，当前草稿未覆盖文件。', { exact: true })).toBeVisible();
    assert.ok((await readFile(join(runtime.vault, '可编辑文档.md'), 'utf8')).includes('外部更改。'));
    await expect(editor).toContainText('未保存草稿。');
    await page.getByRole('button', { name: '返回正文', exact: true }).click();
    await expect(page.locator('.nv-vault-doc-tab:visible .katex')).toHaveCount(1);
    assert.deepEqual(errors, []);
  } catch (error) { console.error(JSON.stringify({ rpcErrors, errors })); throw error; }
  finally { await browser.close(); await runtime.stop(); await rm(fixture, { recursive: true, force: true }); }
});
