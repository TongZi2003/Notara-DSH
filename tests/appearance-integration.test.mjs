import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {startNativeRuntime,workspaceRoot} from '../scripts/native-runtime.mjs';
import {openLibrary,openGraph,focusLibrary,graphSelect,chooseBaseView} from '../scripts/ui-navigation.mjs';

test('Claude and Obsidian styles switch with native light/dark, preserve drafts and survive reload', {timeout:90000},async()=>{
  await mkdir(join(workspaceRoot,'work'),{recursive:true});
  const fixture=await mkdtemp(join(workspaceRoot,'work/appearance-fixture-'));
  const original='---\ntype: card\ntitle: 主题笔记\ntags: [数学, 几何]\n---\n# 主题笔记\n\n保留正文 $x^2+y^2=1$。\n';
  await writeFile(join(fixture,'主题笔记.md'),original);
  const runtime=await startNativeRuntime({fixture,testModel:true}),browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1200,height:850}}),errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000);
  const output=join(workspaceRoot,'outputs/obsidian-theme-20261025');await mkdir(output,{recursive:true});
  const settings=async()=>{await page.getByRole('button',{name:/^(Account menu|账号菜单)$/}).click();await page.getByRole('menuitem',{name:/^(Settings|设置)/}).click();await page.getByRole('radio',{name:'Obsidian 风格',exact:true}).waitFor();};
  const closeSettings=()=>page.getByRole('dialog').getByRole('button',{name:/^(Close|关闭)$/}).click();
  const style=()=>page.evaluate(()=>({name:document.body.dataset.notaraTheme,dark:document.body.hasAttribute('data-ds-dark-theme'),background:getComputedStyle(document.body).backgroundColor,accent:getComputedStyle(document.body).getPropertyValue('--claude-clay').trim()}));
  try{
    await page.goto(runtime.authUrl);await page.getByRole('button',{name:/^(Continue|继续)$/}).click();await page.locator('[data-composer-input]:visible').waitFor();await page.waitForLoadState('networkidle');
    const composer=page.locator('.pI_x6G_centerCol [contenteditable=true]');await composer.pressSequentially('主题切换保留会话草稿');await expect(composer).toContainText('主题切换保留会话草稿');await openLibrary(page);await expect(composer,'draft after opening library').toContainText('主题切换保留会话草稿');
    await settings();await page.getByRole('radio',{name:'Claude 风格',exact:true}).click();await page.getByRole('button',{name:/^(Light|浅色)$/}).click();await closeSettings();
    const base=page.locator('.nv-base-workspace:visible'),strip=page.locator('[data-dockkit-strip]:visible').last(),active=strip.locator('[data-dockkit-tab][aria-selected="true"]');
    await expect(strip).toHaveCSS('background-color','rgb(244, 242, 234)');
    await expect(active).toHaveCSS('background-color','rgb(250, 249, 245)');
    await expect(active).toHaveCSS('border-bottom-left-radius','0px');
    const stripBox=await strip.boundingBox(),tabBox=await active.boundingBox();assert.ok(Math.abs(stripBox.y+stripBox.height-tabBox.y-tabBox.height)<1,'active tab joins the content below');
    await expect(base.locator('.nv-base-toolbar')).toHaveCSS('background-color','rgb(250, 249, 245)');await expect(base.locator('.nv-base-toolbar')).toHaveCSS('border-bottom-width','0px');
    await expect(page.locator('.pI_x6G_sidebarCol')).toHaveCSS('border-right-color','rgb(230, 227, 218)');
    for(const pane of await page.locator('[data-dockkit-host][data-dockkit-column] > [data-dockkit-content]:visible').all())await expect(pane).toHaveCSS('border-left-color','rgb(230, 227, 218)');
    const search=page.locator('.nv-left-files-body .nv-search');await expect(search).toHaveCSS('background-color','rgba(0, 0, 0, 0)');await search.hover();await expect(search).toHaveCSS('background-color','rgb(239, 237, 230)');
    await expect(base.locator('.nv-base-name')).toHaveCSS('font-size','13px');await expect(base.locator('.nv-base-name')).toHaveCSS('color','rgb(107, 105, 99)');
    await expect(base.getByRole('button',{name:'筛选',exact:true})).toHaveAttribute('data-active','false');await expect(base.getByRole('button',{name:'筛选',exact:true})).toHaveCSS('color','rgb(107, 105, 99)');
    await expect(page.getByRole('button',{name:/^(Account menu|账号菜单)$/})).toHaveCSS('font-size','13px');await expect(page.getByRole('button',{name:/^(Account menu|账号菜单)$/})).toHaveCSS('color','rgb(107, 105, 99)');
    for(const [theme,stripColor,contentColor] of [['Obsidian','rgb(24, 24, 27)','rgb(30, 30, 32)'],['Claude','rgb(18, 17, 15)','rgb(23, 22, 20)']]){
      await settings();await page.getByRole('radio',{name:`${theme} 风格`,exact:true}).click();await page.getByRole('button',{name:/^(Dark|深色)$/}).click();await closeSettings();
      await expect(strip).toHaveCSS('background-color',stripColor);await expect(active).toHaveCSS('background-color',contentColor);await expect(active).toHaveCSS('border-bottom-left-radius','0px');
      await expect(base.locator('.nv-base-toolbar')).toHaveCSS('background-color',contentColor);await expect(base.locator('.nv-base-toolbar')).toHaveCSS('border-bottom-width','0px');await expect(base.locator('.nv-base-data-grid').first()).toHaveCSS('background-color',contentColor);
      const s=await strip.boundingBox(),a=await active.boundingBox();assert.ok(Math.abs(s.y+s.height-a.y-a.height)<1,'dark active tab joins its toolbar');
      await expect(composer).toContainText('主题切换保留会话草稿');
    }
    await page.locator('.nv-left-files-body').getByRole('button',{name:'主题笔记',exact:true}).click();const document=page.locator('.nv-vault-doc-tab:visible');
    await document.getByRole('textbox',{name:'标题',exact:true}).fill('主题笔记草稿');await document.getByRole('textbox',{name:'标题',exact:true}).press('Tab');
    const editor=await document.locator('.nv-live-markdown .cm-content').elementHandle();const mode=await page.evaluate(()=>document.documentElement.dataset.notaraConversationMode);
    await expect(composer,'draft before settings').toContainText('主题切换保留会话草稿');
    await settings();await expect(composer,'draft after opening settings').toContainText('主题切换保留会话草稿');await page.getByRole('radio',{name:'Obsidian 风格',exact:true}).click();await expect(composer,'draft after changing style').toContainText('主题切换保留会话草稿');await page.getByRole('button',{name:/^(Light|浅色)$/}).click();await closeSettings();
    await expect.poll(style).toEqual({name:'obsidian',dark:false,background:'rgb(255, 255, 255)',accent:'#7d5daf'});await expect(document.getByRole('textbox',{name:'标题',exact:true})).toHaveValue('主题笔记草稿');assert.equal(await editor.evaluate(element=>element.isConnected),true);
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.notaraConversationMode),mode);await expect(composer).toContainText('主题切换保留会话草稿');await expect(page.locator('.uV2eYG_primary')).toHaveCSS('color','rgb(250, 249, 252)');
    await page.screenshot({path:join(output,'document-light.png')});
    await settings();await page.getByRole('button',{name:/^(Dark|深色)$/}).click();await closeSettings();await expect.poll(style).toEqual({name:'obsidian',dark:true,background:'rgb(30, 30, 32)',accent:'#bca7e8'});
    await expect(document.locator('.nv-document-toolbar')).toHaveCSS('background-color','rgb(30, 30, 32)');await expect(document.locator('.nv-document-toolbar')).toHaveCSS('border-bottom-width','0px');
    await expect(document.getByRole('button',{name:'保存',exact:true})).toBeEnabled();assert.equal(await editor.evaluate(element=>element.isConnected),true);await page.screenshot({path:join(output,'document-dark.png')});
    await settings();await page.getByRole('radio',{name:'Claude 风格',exact:true}).click();await closeSettings();await expect.poll(style).toEqual({name:'claude',dark:true,background:'rgb(23, 22, 20)',accent:'#e3987a'});
    await expect(document.locator('.nv-document-toolbar')).toHaveCSS('background-color','rgb(23, 22, 20)');await expect(document.locator('.nv-document-toolbar')).toHaveCSS('border-bottom-width','0px');
    await settings();await page.getByRole('radio',{name:'Obsidian 风格',exact:true}).click();await page.screenshot({path:join(output,'settings-dark.png')});await closeSettings();
    await page.reload();await expect.poll(style).toMatchObject({name:'obsidian',dark:true});await expect(page.locator('.nv-vault-doc-tab:visible').getByRole('textbox',{name:'标题',exact:true})).toHaveValue('主题笔记草稿');assert.equal(await readFile(join(runtime.vault,'主题笔记.md'),'utf8'),original);
    await openGraph(page);await graphSelect(page,page.locator('.nv-block-graph:visible'),'图谱视图','all');await page.locator('.nv-block-node').first().waitFor();await page.screenshot({path:join(output,'graph-dark.png')});
    await focusLibrary(page);await chooseBaseView(page,'全部资料');await page.locator('.nv-base-workspace:visible .nv-base-data-row').first().waitFor();await page.screenshot({path:join(output,'library-dark.png')});
    await page.locator('.nv-base-workspace:visible').getByRole('button',{name:'搜索',exact:true}).click();await page.getByRole('button',{name:'高级搜索',exact:true}).click();await expect(page.getByRole('dialog').getByRole('button',{name:'应用',exact:true})).toHaveCSS('background-color','rgb(113, 84, 147)');await expect(page.getByRole('dialog').getByRole('button',{name:'应用',exact:true})).toHaveCSS('color','rgb(250, 249, 252)');await page.getByRole('button',{name:'取消',exact:true}).click();
    await page.setViewportSize({width:460,height:746});await settings();await page.getByRole('radio',{name:'Obsidian 风格',exact:true}).scrollIntoViewIfNeeded();await expect(page.getByRole('radio',{name:'Obsidian 风格',exact:true})).toBeInViewport();await page.screenshot({path:join(output,'settings-narrow.png')});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.deepEqual(errors,[]);
  }catch(error){await page.screenshot({path:join(output,'failure.png')});throw error;}finally{await browser.close();await runtime.stop();await rm(fixture,{recursive:true,force:true});}
});
