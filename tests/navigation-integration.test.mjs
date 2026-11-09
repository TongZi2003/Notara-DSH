import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { startNativeRuntime } from '../scripts/native-runtime.mjs';
import { openLibrary, openPluginManager, chooseBaseView, openGraph } from '../scripts/ui-navigation.mjs';

test('one material navigation path, explicit fullscreen, narrow split and session recovery', { timeout: 90_000 }, async () => {
  const runtime = await startNativeRuntime({ testModel: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(runtime.authUrl);
    await page.getByRole('button', { name: /^(Continue|继续)$/ }).click();
    await page.locator('[data-composer-input]:visible').waitFor();
    const input = page.locator('[contenteditable=true]');
    await page.waitForLoadState('networkidle');
    await input.pressSequentially('导航验收草稿，不发送');
    for (const [name, view] of [['资料库', '表格'], ['卡片', '卡片'], ['导读', '导读'], ['复习', '复习'], ['图谱', '图谱']]) {
      await openPluginManager(page);
      await openLibrary(page);
      if (view === '导读' || view === '复习') await chooseBaseView(page, view === '导读' ? '导读资料' : '待复习');
      else if(view==='图谱') await openGraph(page); else await page.locator('.nv-base-toolbar').getByRole('button', {name:view+'布局',exact:true}).click();
      await page.locator(view==='图谱'?'.nv-independent-graph:visible':'.nv-vault-workspace:visible').waitFor();
      assert.equal(await page.locator('[data-slot="main"] > .nv-vault-workspace').count(), 0, 'No fallback workspace replaces the conversation');
      assert.equal(await page.locator('.pI_x6G_centerCol .wSkVaW_root').count(), 1);
      await expect(input, `Draft after navigating from Plugins to ${name}`).toHaveText('导航验收草稿，不发送');
      if (view === '导读' || view === '复习') await expect(page.getByRole('button',{name:'切换保存的视图'})).toContainText(view === '导读' ? '导读资料' : '待复习');
      else if(view==='图谱')await expect(page.locator('.nv-independent-graph:visible')).toHaveCount(1);else await expect(page.locator('.nv-base-toolbar').getByRole('button',{name:view+'布局',exact:true})).toHaveAttribute('aria-pressed','true');
    }
    await page.setViewportSize({ width: 610, height: 746 });
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-notara-materials-split'));
    await page.waitForFunction(() => { const a = document.querySelector('.pI_x6G_centerCol .wSkVaW_root').getBoundingClientRect(), b = document.querySelector('[data-sidebar-right-open]').getBoundingClientRect(); return a.right <= b.left + 1; });
    // Read final geometry after the real sidebar transition, not a transient
    // frame between the independent left-column and right-pane animations.
    await page.evaluate(async () => { await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))); });
    assert.equal(await page.locator('.nv-conversation-chip').count(), 0);
    const { panel, chat } = await page.evaluate(() => ({ panel: document.querySelector('[data-sidebar-right-open]').getBoundingClientRect().toJSON(), chat: document.querySelector('.pI_x6G_centerCol .wSkVaW_root').getBoundingClientRect().toJSON() }));
    assert.ok(panel.width >= 250 && panel.width <= 310 && chat.x + chat.width <= panel.x + 1, JSON.stringify({ panel, chat }));
    await page.getByRole('button', { name: '全屏', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.dataset.notaraConversationMode === 'floating');
    await expect(page.locator('.nv-conversation-chip')).toHaveCount(1);
    await page.getByRole('button', { name: '独占显示会话', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.dataset.notaraConversationMode === 'exclusive');
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.waitForFunction(() => document.querySelector('[data-sidebar-right-open]')?.dataset.sidebarRightPanel === 'fullscreen');
    assert.equal(await page.locator('[data-dockkit-tab][aria-selected="true"] .nv-conversation-chip').count(), 1);
    const strip = page.getByRole('tablist').filter({ has: page.locator('.nv-conversation-chip') });
    const assertConversationFirst = async () => expect(strip.locator('[data-dockkit-tab]').first().locator('.nv-conversation-chip')).toHaveCount(1);
    await assertConversationFirst();
    await page.getByRole('tablist', { name: '工作区栏目' }).getByRole('tab', { name: '资料', exact: true }).click();
    await page.locator('.nv-left-files-body').getByRole('button', { name: '奇异值分解SVD的几何意义与构造推导', exact: true }).click();
    await page.locator('.nv-vault-doc-tab:visible').waitFor();
    await assertConversationFirst();
    const selectedMaterial = await strip.locator('[aria-selected="true"]').getAttribute('data-dockkit-tab');
    const first = await strip.locator('[data-dockkit-tab]').first().boundingBox();
    const last = await strip.locator('[data-dockkit-tab]').last().boundingBox();
    await page.mouse.move(last.x + last.width / 2, last.y + last.height / 2); await page.mouse.down();
    await page.mouse.move(first.x + 2, first.y + first.height / 2, { steps: 12 }); await page.mouse.up();
    await assertConversationFirst();
    await expect(strip.locator('[aria-selected="true"]')).toHaveAttribute('data-dockkit-tab', selectedMaterial);
    const title = await strip.locator('.nv-conversation-chip > span').first().boundingBox();
    await page.mouse.move(title.x + title.width / 2, title.y + title.height / 2); await page.mouse.down();
    await page.mouse.move(last.x + last.width - 2, title.y + title.height / 2, { steps: 12 }); await page.mouse.up();
    await assertConversationFirst();
    await strip.locator('.nv-conversation-chip > span').first().click();
    await page.waitForFunction(() => document.documentElement.dataset.notaraConversationMode === 'exclusive');
    await page.reload(); await page.locator('[data-dockkit-tab][aria-selected="true"] .nv-conversation-chip').waitFor();
    await assertConversationFirst();
    await page.waitForFunction(() => document.documentElement.dataset.notaraConversationMode === 'exclusive');
    await page.getByRole('button', { name: '退出全屏', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.nv-conversation-chip'));
    assert.equal(await page.locator('.nv-vault-workspace:visible').count(), 1, 'Exit selects a real material tab after reload');
    assert.equal(await input.innerText(), '导航验收草稿，不发送');
    await page.getByRole('button', { name: '全屏', exact: true }).click();
    await page.getByRole('button', { name: /^(Collapse right sidebar|收起右侧边栏)$/ }).click();
    await page.getByRole('button', { name: /^(Open right sidebar|打开右侧边栏)$/ }).click();
    await expect(page.locator('.nv-conversation-chip')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '全屏', exact: true })).toBeVisible();
    for (const [marker, owner] of [['home', 'home-recommend'], ['vault-views', 'vault-views'], ['graph-blocks', 'graph-and-blocks']]) {
      assert.equal(await page.locator(`style[data-notara-${marker}]`).getAttribute('data-plugin'), `@oh-my-student/plugin-${owner}`);
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await runtime.stop(); }
});
