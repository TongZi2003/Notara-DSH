import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {startNativeRuntime,workspaceRoot} from '../scripts/native-runtime.mjs';
import {openLibrary,chooseBaseView} from '../scripts/ui-navigation.mjs';
import {scheduleReviewContent} from '../plugins/vault-sqlite/review.js';

test('native reader presents a plain Markdown continuations track teacher rescheduling and cancellation without extra controls',{timeout:90000},async()=>{
 const fixture=await mkdtemp(join(workspaceRoot,'work/followup-reader-'));
 const body='---\ntype: concept\ntitle: 循环边界\ntags: [Python]\n---\n# 循环边界\n\n`range(1, n)` 包含起点 1，但不包含终点 n。\n\n## 今天想明白的\n\n老师问“最后一次循环取到几”，我才注意到漏了 n，改成 `range(1, n + 1)`。随后我自己用 n = 3 验算得到 6，又想到 n = 0 时循环为空，和为 0。\n';
 await writeFile(join(fixture,'循环边界.md'),scheduleReviewContent(body,{followUp:{question:'不运行代码，能判断最后一次循环取到几吗？换成空列表时又会怎样？',afterDays:3,reason:'今天已修正边界，隔三天换一个输入再比较。'}},new Date('2026-11-07T12:00:00+08:00')));
 const runtime=await startNativeRuntime({fixture,testModel:true}),browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1200,height:850}});
 const output=join(workspaceRoot,'outputs/learning-followup-20261107');await mkdir(output,{recursive:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(runtime.authUrl);await page.getByRole('button',{name:/^(Continue|继续)$/}).click();await page.locator('[data-composer-input]:visible').waitFor();await page.waitForLoadState('networkidle');
  await openLibrary(page);await chooseBaseView(page,'全部资料');await page.locator('.nv-vault-workspace:visible').getByRole('button',{name:'循环边界',exact:true}).click();
  const full=page.getByRole('button',{name:'全屏',exact:true});if(await full.isVisible())await full.click();
  const minimize=page.getByRole('button',{name:'最小化会话',exact:true});if(await minimize.isVisible())await minimize.click();
  await page.getByRole('button',{name:/文档属性/}).click();
  const text=page.locator('.nv-followup-text:visible');await expect(text).toBeVisible();
  await expect(text).toContainText('11 月 10 日');await expect(text.getByRole('button')).toHaveCount(0);await expect(text.locator('input,textarea,select')).toHaveCount(0);
  await expect(text.getByRole('heading',{name:'下次可以继续'})).toBeVisible();
  assert.ok(await text.locator('p').last().evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=14),'continuation uses readable document typography');
  await page.screenshot({path:join(output,'native-text.png')});
  await page.setViewportSize({width:650,height:780});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:join(output,'native-text-narrow.png')});
  const path=join(runtime.vault,'循环边界.md');let content=await readFile(path,'utf8');
  const originalQuestion='不运行代码，能判断最后一次循环取到几吗？换成空列表时又会怎样？';
  await writeFile(path,scheduleReviewContent(content,{followUp:{question:originalQuestion,afterDays:10,reason:'学生这周较忙，延后再继续。'}},new Date('2026-11-07T12:00:00+08:00')));
  await expect(text).toContainText('11 月 17 日');await expect(text).toContainText(originalQuestion);
  await page.reload();await expect(text).toContainText('11 月 17 日');
  content=await readFile(path,'utf8');await writeFile(path,scheduleReviewContent(content,{followUp:null},new Date('2026-11-07T12:00:00+08:00')));
  await expect(text).toHaveCount(0);assert.deepEqual(errors,[]);
 }catch(e){await page.screenshot({path:join(output,'native-reader-failure.png')});throw e;}
 finally{await browser.close();await runtime.stop();await rm(fixture,{recursive:true,force:true});}
});
