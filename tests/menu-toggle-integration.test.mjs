import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {startNativeRuntime,workspaceRoot} from '../scripts/native-runtime.mjs';
import {openLibrary,chooseBaseView} from '../scripts/ui-navigation.mjs';

test('document, property, PDF and Canvas menus close when their trigger is clicked again',{timeout:60000},async()=>{
  const fixture=await mkdtemp(join(workspaceRoot,'work/menu-toggle-fixture-'));
  const document='---\ntype: concept\ntitle: 菜单验证文档\n---\n# 菜单验证文档\n正文保持不变。\n',canvas='{"nodes":[],"edges":[]}';
  await writeFile(join(fixture,'菜单验证文档.md'),document);await writeFile(join(fixture,'菜单验证白板.canvas'),canvas);
  const runtime=await startNativeRuntime({fixture,testModel:true}),browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1280,height:900}});
  page.setDefaultTimeout(8000);const errors=[],failures=[];page.on('pageerror',e=>errors.push(e.message));
  const toggle=async(name)=>{
    const trigger=page.getByRole('button',{name,exact:true});await trigger.click();await expect(page.getByRole('menu')).toBeVisible();
    await trigger.click();
    try{await expect(page.getByRole('menu')).toHaveCount(0,{timeout:600});}catch{failures.push(name);await page.keyboard.press('Escape');}
    await trigger.click();await expect(page.getByRole('menu')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('menu')).toHaveCount(0);await expect(trigger).toBeFocused();
  };
  const open=async name=>{await openLibrary(page);await chooseBaseView(page,'全部资料');await page.locator('.nv-base-workspace:visible').getByRole('button',{name,exact:true}).click();};
  try{
    await page.goto(runtime.authUrl);await page.getByRole('button',{name:/^(Continue|继续)$/}).click();await page.locator('[data-composer-input]:visible').waitFor();
    await open('菜单验证文档');await toggle('文档选项');await toggle('属性 type 的类型与操作');
    await open('集成测试讲义');await toggle('PDF 选项');
    await open('菜单验证白板');await toggle('更多白板工具');
    await page.getByRole('button',{name:'添加文件',exact:true}).click();await page.getByRole('dialog',{name:'添加文件到 Canvas',exact:true}).getByRole('button',{name:'新建文件',exact:true}).click();await toggle('新建文件类型');
    await page.getByRole('button',{name:'关闭添加文件',exact:true}).click();
    assert.deepEqual(failures,[],'menus that stayed open after a second trigger click');assert.deepEqual(errors,[]);
    assert.equal(await readFile(join(runtime.vault,'菜单验证文档.md'),'utf8'),document);assert.equal(await readFile(join(runtime.vault,'菜单验证白板.canvas'),'utf8'),canvas);
  }finally{await browser.close();await runtime.stop();await rm(fixture,{recursive:true,force:true});}
});
