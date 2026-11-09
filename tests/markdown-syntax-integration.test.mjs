import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {startNativeRuntime,workspaceRoot} from '../scripts/native-runtime.mjs';
import {openLibrary} from '../scripts/ui-navigation.mjs';

test('live syntax renders CJK emphasis, GFM and entities while retaining code literals and exact source', {timeout:90000},async()=>{
  const fixture=await mkdtemp(join(workspaceRoot,'work/syntax-fixture-'));
  const original=['---','title: 语法回归','tags: [测试]','---','# 语法回归 ###','','开场**「中文标点 $x$」**继续；**粗体中有 *斜体***，~~删除线~~。','','字符 &amp; 和 \\*原样星号\\*。','','前面<br>后面。','','`**代码原样** $x$`','','- [ ] 学习任务','- [x] 已完成任务','','下划线标题','====','','[普通链接](https://example.com) 和 [参考链接][ref]','','| A | B |','| --- | --- |','| 1 | 2 |','','```md','**代码里的星号**','<br />','- [ ] 代码里的任务','```','','[ref]: https://example.org',''].join('\r\n');
  await writeFile(join(fixture,'语法回归.md'),original);
  const runtime=await startNativeRuntime({fixture,testModel:true}),browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1200,height:1000}}),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
  const doc=page.locator('.nv-vault-doc-tab:visible'),read=()=>readFile(join(runtime.vault,'语法回归.md'),'utf8');
  const output=join(workspaceRoot,'outputs/inline-formula-20261026');await mkdir(output,{recursive:true});
  try{
    await page.goto(runtime.authUrl);await page.getByRole('button',{name:/^(Continue|继续)$/}).click();await page.locator('[data-composer-input]:visible').waitFor();await page.waitForLoadState('networkidle');await openLibrary(page);await page.locator('.nv-vault-workspace:visible').getByRole('button',{name:'语法回归',exact:true}).click();await page.getByRole('button',{name:'全屏',exact:true}).click();await page.getByRole('button',{name:'最小化会话',exact:true}).click();
    await expect(doc.locator('.nv-live-strong').filter({hasText:'中文标点'})).toBeVisible();await expect(doc.locator('.nv-live-emphasis')).toContainText('斜体');await expect(doc.locator('.nv-live-delete')).toHaveCSS('text-decoration-line','line-through');
    await expect(doc.locator('.nv-live-text').filter({hasText:'开场'})).not.toContainText('**');
    await expect(doc.locator('.nv-live-inline-literal').filter({hasText:'&'})).toBeVisible();await expect(doc.locator('.nv-live-code')).toContainText('**代码原样** $x$');await expect(doc.locator('.nv-live-inline-math')).toHaveCount(1);await expect(doc.locator('.nv-live-line-break')).toHaveCount(1);await expect(doc.locator('.nv-live-text').filter({hasText:'前面'})).not.toContainText('<br>');
    await expect(doc.getByRole('heading',{name:'语法回归',exact:true})).toBeVisible();await expect(doc.getByRole('heading',{name:'下划线标题',exact:true})).toBeVisible();
    await expect(doc.locator('a[href="https://example.com"]')).toBeVisible();await expect(doc.locator('a[href="https://example.org"]')).toBeVisible();await expect(doc.locator('.nv-live-preview-block table')).toBeVisible();
    await expect(doc.locator('.nv-live-preview-block[data-kind="code"]')).toContainText('**代码里的星号**');assert.equal(await read(),original);
    const checkbox=doc.getByRole('checkbox',{name:'完成任务：学习任务',exact:true});await checkbox.check();await expect(checkbox).toBeChecked();assert.equal(await read(),original);
    await doc.getByRole('button',{name:'保存',exact:true}).click();await expect.poll(read).toBe(original.replace('- [ ] 学习任务','- [x] 学习任务'));
    await doc.getByRole('button',{name:'撤销',exact:true}).click();await expect(checkbox).not.toBeChecked();await doc.getByRole('button',{name:'保存',exact:true}).click();await expect.poll(read).toBe(original);
    await page.screenshot({path:join(output,'syntax-wide.png')});assert.deepEqual(errors,[]);
  }catch(error){await page.screenshot({path:join(output,'syntax-failure.png')});throw error;}finally{await browser.close();await runtime.stop();await rm(fixture,{recursive:true,force:true});}
});
