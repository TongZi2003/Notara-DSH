import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {startNativeRuntime,workspaceRoot} from '../scripts/native-runtime.mjs';
import {openLibrary,chooseBaseView} from '../scripts/ui-navigation.mjs';

test('native save success leaves no toolbar row; failure stays and unsaved draft is preserved',{timeout:60000},async()=>{
 const fixture=await mkdtemp(join(workspaceRoot,'work/success-feedback-fixture-'));
 await writeFile(join(fixture,'提示验收.md'),'---\ntype: source\n---\n# 提示验收\n\n保留原始正文。\n');
 const runtime=await startNativeRuntime({fixture,testModel:true}),browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1150,height:746}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 const out=join(workspaceRoot,'outputs/success-feedback-native-20261108');await mkdir(out,{recursive:true});
 try{
  await page.goto(runtime.authUrl);await page.getByRole('button',{name:/^(Continue|继续)$/}).click();await page.locator('[data-composer-input]:visible').waitFor();await openLibrary(page);await chooseBaseView(page,'全部资料');
  await page.locator('.nv-base-workspace:visible').getByRole('button',{name:'提示验收',exact:true}).click();
  const doc=page.locator('.nv-editable-document:visible'),editor=doc.getByRole('textbox',{name:'Markdown 实时预览编辑器'});
  await editor.press('ControlOrMeta+End');await editor.pressSequentially('追加正文');await editor.press('ControlOrMeta+s');
  const receipt=page.getByRole('alert').filter({hasText:/^已保存$/});await expect(receipt).toBeVisible();assert.equal(await receipt.evaluate(e=>getComputedStyle(e).position),'fixed');
  await page.screenshot({path:join(out,'saved.png')});await expect(doc.locator('.nv-markdown-status')).toBeEmpty();
  await expect(receipt).toHaveCount(0,{timeout:6000});await expect(doc.getByRole('button',{name:'保存',exact:true})).toBeDisabled();
  const saved=await readFile(join(runtime.vault,'提示验收.md'),'utf8');assert.match(saved,/追加正文/);
  await page.route('**/api/notaraVault/save',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({result:{ok:false,error:{message:'fixture_save_failure'}}})}));
  await editor.press('ControlOrMeta+End');await editor.pressSequentially('尚未保存的修改');await editor.press('ControlOrMeta+s');
  const failure=doc.getByRole('alert').filter({hasText:'保存失败，草稿已保留，请重试'});await expect(failure).toBeVisible();await page.waitForTimeout(4200);await expect(failure).toBeVisible();await expect(editor).toContainText('尚未保存的修改');assert.equal(await readFile(join(runtime.vault,'提示验收.md'),'utf8'),saved);
  await page.screenshot({path:join(out,'error-retained.png')});assert.deepEqual(errors,[]);
 }finally{await browser.close();await runtime.stop();await rm(fixture,{recursive:true,force:true});}
});
