import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import { startNativeRuntime, workspaceRoot } from '../scripts/native-runtime.mjs';

test('chat classroom links hide wire syntax and open original sessions without losing drafts', { timeout: 90000 }, async () => {
  const fixture = await mkdtemp(join(workspaceRoot, 'work/chat-reference-fixture-'));
  await writeFile(join(fixture, '笔记.md'), '# 原笔记\n普通文件仍能打开。\n');
  await writeFile(join(fixture, '示意.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"><rect width="100" height="40" fill="#8c9bb4"/></svg>');
  const runtime = await startNativeRuntime({ fixture, testModel: true, modelFixture: 'tests/session-reference-model.mjs' });
  const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1150, height: 850 } });
  const out = join(workspaceRoot, 'work/chat-references-20261106/screenshots'); await mkdir(out, { recursive: true });
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.setDefaultTimeout(10000);
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const call = async (method, args = {}) => {
    const result = await page.request.post(new URL(`/api/${method}`, runtime.authUrl).href, { data: { type: 'client-request', rpcId: randomUUID(), method, payload: { args } } });
    const body = (await result.json()).result; assert.equal(body.ok, true); return body.value;
  };
  try {
    await page.goto(runtime.authUrl); await page.getByRole('button', { name: /^(Continue|继续)$/ }).click();
    await expect(page.getByRole('button', { name: /^(Continue|继续)$/ })).toBeHidden();
    await page.waitForLoadState('networkidle');
    const input = page.locator('[data-composer-input]:visible'); await input.waitFor();
    await input.fill('原课堂'); await input.press('Enter');
    await page.getByRole('button', { name: /1 turns 1 steps|1 轮.*1 步/ }).waitFor();
    const sessions = (await call('session/list', { _request: {} })).items; assert.equal(sessions.length, 1);
    const target = sessions[0].sessionId;
    await writeFile(join(runtime.home, 'reference-target.txt'), target);
    await input.fill('原课堂草稿');
    await page.getByRole('button', { name: /^(New session|新会话|新建会话)$/ }).click();
    await expect(input).toBeEmpty();
    await input.fill('展示课堂链接'); await input.press('Enter');
    const content = page.locator('[data-conversation-scroll]');
    await content.getByRole('button', { name: '均值不等式课堂', exact: true }).waitFor();
    await page.getByRole('button', { name: /1 turns 1 steps|1 轮.*1 步/ }).waitFor();
    assert.ok(!(await content.innerText()).includes(target));
    assert.equal(await content.getByRole('button', { name: '均值不等式课堂', exact: true }).getAttribute('title'), '均值不等式课堂');
    const expectClassroomIcon = async link => {
      await expect(link).toHaveAttribute('data-notara-reference', 'session');
      const icon = await link.evaluate(button => ({
        native: getComputedStyle(button.querySelector(':scope > svg')).display,
        session: button.querySelector('.nv-session-link-icon svg')?.getAttribute('viewBox'),
      }));
      assert.equal(icon.native, 'none'); assert.equal(icon.session, '0 0 16 16');
      await expect(link.locator('.nv-session-link-icon svg')).toBeVisible();
    };
    await expectClassroomIcon(content.getByRole('button', { name: '均值不等式课堂', exact: true }));
    await expect(content.getByRole('button', { name: '查看笔记', exact: true }).locator('svg')).toBeVisible();
    await expect(content.getByRole('img', { name: '本课示意', exact: true })).toBeVisible();
    await expect(content.getByRole('button', { name: '课堂入口', exact: true })).toBeVisible();
    await expect(content.getByText('[[session:code-example|代码示例保留]]', { exact: true })).toBeVisible();
    await input.fill('保留这段未发送的草稿');
    await content.getByRole('button', { name: '查看笔记', exact: true }).click();
    await page.locator('.nv-vault-doc-tab:visible .cm-editor').waitFor();
    await expect(input).toHaveText('保留这段未发送的草稿');
    await content.getByRole('button', { name: '旧课堂', exact: true }).click();
    await expect(content.getByText('这节课暂时无法打开，请从会话列表查看。', { exact: true })).toBeVisible();
    await content.getByRole('button', { name: '均值不等式课堂', exact: true }).click();
    await expect(content.getByText('原课堂内容：继续讨论均值不等式。', { exact: true })).toBeVisible();
    assert.equal((await call('session/list', { _request: {} })).items.length, 2, 'navigation never creates another classroom');
    await page.getByRole('tablist', { name: '工作区栏目' }).getByRole('tab', { name: '会话', exact: true }).click();
    await page.locator('.nv-session-row[data-selected="false"] .nv-session-open').first().click();
    await expect(input).toHaveText('保留这段未发送的草稿');
    await page.reload();
    await expect(input).toHaveText('保留这段未发送的草稿');
    await content.getByRole('button', { name: '回到原课堂', exact: true }).waitFor();
    await page.screenshot({ path: join(out, 'native-chat-references.png') });
    const paste = text => input.evaluate((element, text) => {
      const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', text);
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
    }, text);
    await input.fill('我想继续：'); await input.press('End');
    await paste(`[[session:${target}|原课堂]] 和 [[笔记.md|笔记]]`);
    await expect(input.locator('[data-composer-chip="notara-wiki-reference"]')).toHaveCount(2);
    assert.ok(!(await input.innerText()).includes(target));
    await input.press('Meta+z');
    await expect.poll(() => input.locator('[data-composer-chip="notara-wiki-reference"]').count()).toBeLessThan(2);
    await expect(input).toContainText('我想继续：');
    await input.press('Meta+Shift+z');
    await expect(input.locator('[data-composer-chip="notara-wiki-reference"]')).toHaveCount(2);
    await page.reload();
    await expect(input.locator('[data-composer-chip="notara-wiki-reference"]')).toHaveCount(2);
    await page.screenshot({ path: join(out, 'native-composer-reference-chips.png') });
    const pin = { path: '笔记.md', title: '旧资料引用', revision: 'r1' };
    const legacy = `\n学习资料引用：${JSON.stringify(pin)}\n这是资料定位信息。请先读取原文并核对版本；仅带入引用不代表学生已读或掌握。\n我真正的问题`;
    await input.press('End'); await paste(legacy); await input.press('Enter');
    const user = page.locator('[data-user-markdown]').filter({ hasText: '我真正的问题' });
    await expect(user.getByRole('button', { name: '旧资料引用', exact: true })).toBeVisible();
    await expect(user.getByRole('button', { name: '原课堂', exact: true })).toBeVisible();
    await expectClassroomIcon(user.getByRole('button', { name: '原课堂', exact: true }));
    assert.doesNotMatch(await user.innerText(), /学习资料引用|revision|资料定位信息|\[\[|session:/);
    await page.getByRole('button', { name: /2 turns 2 steps|2 轮.*2 步/ }).waitFor();
    await page.reload(); await expect(user.getByRole('button', { name: '原课堂', exact: true })).toBeVisible();
    await page.screenshot({ path: join(out, 'native-user-reference-chips.png') });
    await user.getByRole('button', { name: '原课堂', exact: true }).click();
    await expect(content.getByText('原课堂内容：继续讨论均值不等式。', { exact: true })).toBeVisible();
    assert.deepEqual(errors, []);
  } catch (error) { await page.screenshot({ path: join(out, 'failure.png') }); await writeFile(join(out, 'failure.txt'), await page.locator('body').innerText() + '\n' + JSON.stringify(errors)); throw error; }
  finally { await browser.close(); await runtime.stop(); await rm(fixture, { recursive: true, force: true }); }
});
