import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { startNativeRuntime } from '../scripts/native-runtime.mjs';
import { openLibrary } from '../scripts/ui-navigation.mjs';

test('native session/assistant renderer: fixed adapter, interactive blocks, prediction gate and draft', { timeout: 60_000 }, async () => {
  const runtime = await startNativeRuntime({ testModel: true });
  let browser, page;
  const errors = [];
  const rpc = [];
  try {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text().slice(0, 300)); });
    page.on('response', async response => {
      if (response.url().includes('/api/session/')) {
        const result = await response.json().catch(() => null);
        if (result?.result?.ok === false) rpc.push({ method: response.url().split('/').at(-1), error: result.result.error });
      }
    });
    await page.goto(runtime.authUrl);
    const notice = page.getByRole('button', { name: 'Continue', exact: true });
    await notice.waitFor(); await notice.click();
    await page.locator('[data-composer-input]:visible').waitFor();
    await page.getByRole('region', { name: '建议下一步', exact: true }).waitFor();
    await page.getByText('固定测试输出', { exact: true }).waitFor();
    await page.waitForLoadState('networkidle');
    const input = page.locator('[contenteditable=true]');
    await input.fill('请展示集成测试题卡。我的理解是 **长度平方** $x^Tx=25$。\n\n$$\\frac{1}{2}+\\sqrt{x}$$\n\n`$literal$`');
    assert.match(await input.innerText(), /请展示集成测试题卡/);
    await input.press('Enter');
    await page.locator('section.nv-block-flow').waitFor({ timeout: 20_000 });
    await page.locator('.nv-user-markdown .katex').first().waitFor();
    assert.equal(await page.locator('.nv-user-markdown strong').innerText(), '长度平方');
    assert.equal(await page.locator('.nv-user-markdown code').innerText(), '$literal$');
    assert.equal(await page.locator('.nv-user-markdown .katex-error').count(), 0);
    await page.locator('section.nv-block-flow').getByRole('textbox', { name: '补全步骤 B', exact: true }).fill('先说明成立条件');
    await page.locator('section.nv-block-flow').getByRole('button', { name: '交给老师', exact: true }).click();
    assert.match(await input.innerText(), /先说明成立条件/);
    assert.equal(await page.getByText('NATIVE_FUTURE_SECRET', { exact: true }).count(), 0);
    await page.locator('section.nv-block-frames').getByRole('button', { name: '下一帧', exact: true }).click();
    assert.equal(await page.getByText('NATIVE_FUTURE_SECRET', { exact: true }).count(), 0);
    await page.getByRole('textbox', { name: '我的预测', exact: true }).fill('下一步说明为什么');
    await page.locator('section.nv-block-frames').getByRole('button', { name: '交给老师', exact: true }).click();
    await page.getByText('NATIVE_FUTURE_SECRET', { exact: true }).waitFor();
    assert.match(await input.innerText(), /下一步说明为什么/);
    const draft = await input.innerText();
    await page.evaluate(() => { window.originalEditor = document.querySelector('[contenteditable=true]'); });
    await openLibrary(page);
    await page.locator('.nv-vault-workspace .nv-base-data-row').first().waitFor();
    await page.locator('[data-sidebar-right-open] button[data-notara-workspace-mode="fullscreen"]').click();
    await page.waitForFunction(() => document.documentElement.dataset.notaraConversationMode === 'floating');
    await page.evaluate(async () => { await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))); });
    const materialBox = await page.locator('.nv-vault-workspace:visible').boundingBox();
    await page.getByRole('button', { name: '最小化会话', exact: true }).click();
    await page.getByRole('button', { name: '展开悬浮会话', exact: true }).waitFor();
    assert.equal(await input.isVisible(), false);
    assert.deepEqual(await page.locator('.nv-vault-workspace:visible').boundingBox(), materialBox, 'Minimize must not reflow materials');
    await page.getByRole('button', { name: '展开悬浮会话', exact: true }).click();
    for (const [mode, label] of [['left', '展开到左侧'], ['right', '展开到右侧']]) {
      await page.getByRole('button', { name: '会话操作', exact: true }).click();
      await page.getByRole('menuitem', { name: label, exact: true }).click();
      await page.waitForFunction(mode => document.documentElement.dataset.notaraConversationMode === mode, mode);
      assert.equal(await page.locator('[contenteditable=true]').count(), 1);
      assert.equal(await input.innerText(), draft);
      assert.equal(await page.evaluate(() => document.querySelector('[contenteditable=true]') === window.originalEditor), true);
      assert.equal(await page.locator('section.nv-block-flow').isVisible(), true, 'Expanded window keeps native history');
    }
    await page.getByRole('button', { name: '独占显示会话', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.dataset.notaraConversationMode === 'exclusive');
    assert.equal(await page.locator('[contenteditable=true]').count(), 1);
    const chatTab = page.locator('[data-dockkit-tab]').filter({ has: page.locator('.nv-conversation-chip') });
    assert.equal(await chatTab.locator(':scope > button:visible').count(), 0, 'Conversation tab has no close button');
    await page.getByRole('button', { name: '会话标签操作', exact: true }).click();
    await page.getByRole('menuitem', { name: '置顶会话', exact: true }).click();
    await page.getByRole('button', { name: '会话标签操作', exact: true }).click();
    await page.getByRole('menuitem', { name: '取消置顶', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: /资料库/ }).click();
    await page.waitForFunction(() => document.documentElement.dataset.notaraConversationMode === 'right');
    assert.equal(await input.innerText(), draft);
    assert.deepEqual(await page.locator('.nv-vault-workspace:visible').boundingBox(), materialBox);
    await page.locator('[data-sidebar-right-open] button[data-notara-workspace-mode]').click();
    await page.waitForFunction(() => !document.documentElement.dataset.notaraConversationMode);
    assert.equal(await input.innerText(), draft);
    assert.deepEqual(errors, []);
  } catch (error) {
    console.error(JSON.stringify({ errors, rpc, body: page ? (await page.locator('body').innerText()).slice(-4000) : '', host: runtime.log().slice(-2500) }));
    throw error;
  } finally { await browser?.close(); await runtime.stop(); }
});
