import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {startNativeRuntime,workspaceRoot} from '../scripts/native-runtime.mjs';
import {openLibrary,chooseBaseView} from '../scripts/ui-navigation.mjs';
import {scheduleReviewContent} from '../plugins/vault-sqlite/review.js';

test('review board puts questions first, preserves ordinary summaries and continues the existing teacher draft',{timeout:120000},async()=>{
 const fixture=await mkdtemp(join(workspaceRoot,'work/review-question-board-'));await mkdir(join(fixture,'日记'));await mkdir(join(fixture,'卡片'));
 const question='求导以后，怎样判断 $f\'(x)$ 的正负？为什么要先整理式子？';
 const date=new Date('2026-11-06T12:00:00+08:00');
 const card='---\ntype: method\ntitle: 导函数与单调性\nsummary: 普通视图继续显示这段卡片简介。\n---\n# 导函数与单调性\n\n## 学生理解\n老师提示因式分解后，学生完成了符号分析。\n';
 await writeFile(join(fixture,'卡片/导函数.md'),scheduleReviewContent(card,{followUp:{question,afterDays:0,reason:'不应在看板显示的内部安排依据'}},date));
 let diary='---\ntype: diary\ntitle: 今天的讨论\n---\n## 循环边界\n学生提出空输入的问题。\n## 化学条件\n学生比较了两种溶液。\n## 以后再说\n暂时留着。\n';
 for(const [heading,question,afterDays] of [['循环边界','空列表会进入循环吗？',0],['化学条件','换一种溶液后，原来的条件还成立吗？',0],['以后再说','未来的问题不提前出现',30]])diary=scheduleReviewContent(diary,{heading,followUp:{question,afterDays,reason:'保存续接问题'}},date);
 await writeFile(join(fixture,'日记/今天.md'),diary);
 await writeFile(join(fixture,'卡片/旧卡.md'),'---\ntype: card\ntitle: 此前安排的卡片\nmastery: 1\ninterval: 1\nlast_review: 2026-11-05\nnext_review: 2026-11-06\n---\n旧历史保留。');
 const runtime=await startNativeRuntime({fixture,testModel:true}),browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1240,height:850}});
 const output=join(workspaceRoot,'outputs/review-question-board-20261107');await mkdir(output,{recursive:true});const errors=[],homeInputs=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().endsWith('/api/notaraVault/homeSession'))homeInputs.push(r.postDataJSON()?.payload?.args?.input);});
 try{
  await page.goto(runtime.authUrl);await page.getByRole('button',{name:/^(Continue|继续)$/}).click();const composer=page.locator('[data-composer-input]:visible');await composer.waitFor();await page.waitForLoadState('networkidle');
  await composer.fill('长期教师，记住我们接着学习。');await composer.press('Enter');await page.getByRole('button',{name:/1 turns 1 steps|1 轮.*1 步/}).waitFor();await composer.fill('长期教师原有草稿');
  await page.getByRole('button',{name:/^(New session|新会话|新建会话)$/}).click();await expect(composer).toBeEmpty();await composer.fill('另一会话未发送的草稿');
  await openLibrary(page);await page.getByRole('button',{name:'全屏',exact:true}).click();await chooseBaseView(page,'全部资料');await page.getByRole('button',{name:'卡片布局',exact:true}).click();await expect(page.locator('.nv-vault-card-summary')).toContainText(['普通视图继续显示这段卡片简介。']);
  await chooseBaseView(page,'待复习');const list=page.locator('.nv-base-results:visible');
  await expect(list.locator('.nv-review-question')).toHaveCount(3);await expect(list.locator('.nv-vault-card-summary')).toHaveCount(0);await expect(page.getByRole('button',{name:'开始复习',exact:true})).toHaveCount(0);
  await expect(list).not.toContainText('内部安排依据');await expect(list).not.toContainText('未来的问题不提前出现');await expect(list.getByRole('button',{name:'此前安排的卡片',exact:true})).toBeVisible();await expect(list.locator('.katex')).toHaveCount(1);
  await page.screenshot({path:join(output,'review-cards.png')});
  await page.getByRole('button',{name:'表格布局',exact:true}).click();await expect(list.getByRole('columnheader',{name:'问题与来源'})).toBeVisible();await expect(list.locator('.nv-review-question')).toHaveCount(3);assert.ok(await list.locator('.nv-review-questions,.nv-review-question-legacy').evaluateAll(elements=>elements.every(el=>{const cell=el.closest('[role=gridcell]'),box=el.getBoundingClientRect(),outer=cell.getBoundingClientRect();return box.top>=outer.top&&box.bottom<=outer.bottom;})),'question text and source/date stay inside the table row');await page.screenshot({path:join(output,'review-table.png')});
  await page.getByRole('button',{name:'卡片布局',exact:true}).click();await page.setViewportSize({width:650,height:780});await expect.poll(()=>list.locator('.nv-vault-card').evaluateAll(elements=>elements.every(el=>el.getBoundingClientRect().right<=innerWidth+1))).toBe(true);await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});await page.screenshot({path:join(output,'review-cards-narrow.png')});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.setViewportSize({width:1240,height:850});await expect(list).toBeVisible();await list.getByRole('button',{name:'空列表会进入循环吗？',exact:true}).click();
  await expect(composer).toContainText('长期教师原有草稿');await expect(composer).toContainText('空列表会进入循环吗？');await expect(composer).toContainText('循环边界');await expect(composer).not.toContainText('另一会话未发送的草稿');await expect(page.getByRole('button',{name:/1 turns 1 steps|1 轮.*1 步/})).toBeVisible();
  assert.ok(homeInputs.length>0);assert.ok(homeInputs.every(input=>input.open===undefined));await page.screenshot({path:join(output,'teacher-draft.png')});
  await page.getByRole('button',{name:/^(New session|新会话|新建会话)$/}).click();await expect(composer).toContainText('另一会话未发送的草稿');
  await page.reload();await expect(composer).toContainText('另一会话未发送的草稿');assert.deepEqual(errors,[]);
  assert.equal(await readFile(join(runtime.vault,'日记/今天.md'),'utf8'),diary);
 }catch(e){await page.screenshot({path:join(output,'failure.png')});await writeFile(join(output,'failure.txt'),(await page.locator('body').innerText())+'\n'+runtime.log());throw e;}
 finally{await browser.close();await runtime.stop();await rm(fixture,{recursive:true,force:true});}
});
