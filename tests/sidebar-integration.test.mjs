import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { startNativeRuntime } from '../scripts/native-runtime.mjs';
import { openLibrary, openPluginManager } from '../scripts/ui-navigation.mjs';

test('workspace-first sidebar keeps sections separate from split/fullscreen navigation', { timeout: 90_000 }, async () => {
  const runtime = await startNativeRuntime({ testModel: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1150, height: 746 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const sections = page.getByRole('tablist', { name: '工作区栏目' });
  const snapshot = () => page.evaluate(() => ({
    mode: document.documentElement.dataset.notaraConversationMode ?? 'split',
    tabs: [...document.querySelectorAll('[data-dockkit-tab]')].map(e => [e.dataset.dockkitTab, e.getAttribute('aria-selected')]),
    session: document.querySelector('[data-sidebar-right-open]')?.dataset.sidebarRightSession,
    editor: document.querySelector('[data-composer-input]')?.textContent,
  }));
  try {
    await page.goto(runtime.authUrl); await page.getByRole('button', { name: /^(Continue|继续)$/ }).click();
    await page.locator('[data-composer-input]:visible').waitFor(); await page.waitForLoadState('networkidle');
    await page.locator('[data-composer-input]').pressSequentially('左栏切换测试草稿');
    const picker = await page.getByLabel('切换工作区').boundingBox();
    const newChat = await page.locator('.nv-left-ws-header').getByRole('button',{name:'新会话',exact:true}).boundingBox();
    assert.ok(Math.abs(picker.y-newChat.y)<10, 'Workspace and new conversation share the quiet top row');
    const openWorkspaceMenu = async () => {
      await page.getByRole('button', { name: '切换工作区', exact: true }).click();
      await expect(page.locator('.nv-workspace-menu')).toBeVisible();
      const menu = await page.locator('.nv-workspace-menu').boundingBox();
      assert.ok(menu.x >= 0 && menu.x + menu.width <= page.viewportSize().width, JSON.stringify(menu));
      await expect(page.locator('.nv-workspace-menu [data-current="true"]')).toHaveCount(1);
      await page.getByRole('textbox',{name:'搜索学习集',exact:true}).press('ArrowDown');
      await expect(page.getByRole('menuitem').filter({ has: page.locator('[data-current="true"]') })).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(page.getByRole('menuitem', { name: '添加工作区…', exact: true })).toBeFocused();
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('Enter');
      await expect(page.locator('.nv-workspace-menu')).toHaveCount(0);
      await page.getByRole('button', { name: '切换工作区', exact: true }).click();
      await page.keyboard.press('Escape');
      await expect(page.locator('.nv-workspace-menu')).toHaveCount(0);
      await expect(page.getByRole('button', { name: '切换工作区', exact: true })).toBeFocused();
    };
    await openWorkspaceMenu();
    await expect(page.locator('.hHd-Xa_panelList')).toBeHidden();
    await expect(sections.getByRole('tab')).toHaveCount(2);
    await openLibrary(page);
    await page.locator('.nv-vault-workspace:visible').waitFor();
    const fileBounds = await page.locator('.nv-left-files-body').evaluate(element => {
      const nav = element.querySelector('.nv-vault-sidebar'), field = nav.querySelector('.nv-search');
      return { width: element.clientWidth, scroll: element.scrollWidth, containerRight: element.getBoundingClientRect().right, navRight: nav.getBoundingClientRect().right, fieldRight: field.getBoundingClientRect().right };
    });
    assert.ok(fileBounds.scroll <= fileBounds.width && fileBounds.navRight <= fileBounds.containerRight && fileBounds.fieldRight < fileBounds.containerRight, JSON.stringify(fileBounds));
    await page.getByLabel('查找文件', { exact: true }).fill('SVD');
    await page.getByRole('button', { name: /^(Collapse sidebar|收起侧边栏)$/ }).click();
    await expect(page.locator('.hHd-Xa_root')).toHaveClass(/hHd-Xa_collapsed/);
    await sections.getByRole('tab', { name: '资料', exact: true }).click();
    await expect(page.getByLabel('查找文件', { exact: true })).toHaveValue('SVD');
    const parallel = await snapshot();
    await openWorkspaceMenu();
    assert.deepEqual(await snapshot(), parallel, 'Opening and dismissing workspace menu preserves layout and draft');
    await sections.getByRole('tab', { name: '会话', exact: true }).click();
    await expect(page.locator('.nv-left-sessions-body')).toBeVisible();
    await expect(page.locator('.hHd-Xa_regionArea')).toBeHidden();
    const checkSearchBounds = async () => {
      const bounds = await page.locator('.nv-left-sessions-body').evaluate(container => {
        const field = container.querySelector('.nv-search'), button = field.querySelector('.nv-search-advanced');
        return { container: container.getBoundingClientRect().toJSON(), field: field.getBoundingClientRect().toJSON(), button: button.getBoundingClientRect().toJSON(), scroll: field.scrollWidth, client: field.clientWidth };
      });
      assert.ok(bounds.field.right <= bounds.container.right && bounds.button.right < bounds.field.right && bounds.scroll <= bounds.client, JSON.stringify(bounds));
    };
    await checkSearchBounds();
    assert.deepEqual(await snapshot(), parallel);
    await sections.getByRole('tab', { name: '资料', exact: true }).click();
    await expect(page.getByLabel('查找文件', { exact: true })).toHaveValue('SVD');
    assert.deepEqual(await snapshot(), parallel);
    const rowStyle = await page.locator('.nv-left-files-body li button span').first().evaluate(e => ({ nowrap: getComputedStyle(e).whiteSpace, overflow: getComputedStyle(e).textOverflow, tooltip: e.parentElement.title }));
    assert.equal(rowStyle.nowrap, 'nowrap'); assert.equal(rowStyle.overflow, 'ellipsis'); assert.ok(rowStyle.tooltip);
    await page.getByRole('button', { name: '全屏', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.dataset.notaraConversationMode === 'floating');
    await expect(page.locator('.nv-conversation-chip')).toHaveCount(1);
    const fullscreen = await snapshot();
    await sections.getByRole('tab', { name: '会话', exact: true }).click();
    assert.deepEqual(await snapshot(), fullscreen);
    await sections.getByRole('tab', { name: '资料', exact: true }).click();
    assert.deepEqual(await snapshot(), fullscreen);
    await page.getByLabel('查找文件', { exact: true }).fill('');
    await page.locator('.nv-left-files-body').getByRole('button', { name: '奇异值分解SVD的几何意义与构造推导', exact: true }).click();
    await page.locator('.nv-vault-doc-tab:visible').waitFor();
    assert.equal((await snapshot()).mode, 'floating', 'Opening a file preserves fullscreen');
    await page.getByRole('button', { name: '独占显示会话', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.dataset.notaraConversationMode === 'exclusive');
    const conversation = await snapshot();
    await sections.getByRole('tab', { name: '会话', exact: true }).click();
    await sections.getByRole('tab', { name: '资料', exact: true }).click();
    assert.deepEqual(await snapshot(), conversation);
    await openPluginManager(page);
    await expect(page.getByRole('button', { name: /^(Add plugin|Add plugins|添加插件)$/ })).toBeVisible();
    await page.getByRole('button', { name: '返回工作区', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.dataset.notaraConversationMode === 'exclusive');
    assert.deepEqual(await snapshot(), conversation, 'Settings/plugin management returns to the existing layout and draft');
    await page.getByRole('button', { name: '退出全屏', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.nv-conversation-chip'));
    for (const width of [900, 610]) {
      await page.setViewportSize({ width, height: 746 });
      if (width === 900) await expect(page.locator('.hHd-Xa_root')).toHaveClass(/hHd-Xa_collapsed/);
      await expect(page.locator('[data-sidebar-right-open]')).toBeVisible();
      const narrow = await snapshot();
      await sections.getByRole('tab', { name: '会话', exact: true }).click();
      await expect(page.getByLabel('切换工作区')).toBeVisible();
      await openWorkspaceMenu();
      await checkSearchBounds();
      await expect(page.locator('[data-sidebar-right-open]')).toBeVisible();
      assert.deepEqual(await snapshot(), narrow, `Navigation leaves both columns open at ${width}px`);
      await sections.getByRole('tab', { name: '资料', exact: true }).click();
      assert.deepEqual(await snapshot(), narrow);
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await runtime.stop(); }
});
