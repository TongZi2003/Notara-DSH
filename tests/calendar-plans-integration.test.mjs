import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {startNativeRuntime,workspaceRoot} from '../scripts/native-runtime.mjs';
import {scheduleReviewContent} from '../plugins/vault-sqlite/review.js';
import {parseMarkdown} from '../plugins/vault-sqlite/frontmatter.js';
import {reviewPlans} from '../plugins/vault-sqlite/review-schedule.js';
import {dayInZone,shiftDay} from '../plugins/calendar/model.js';
import {chooseBaseView,openLibrary} from '../scripts/ui-navigation.mjs';

test('calendar has two to-do types, retains overdue work, reschedules and continues the teacher draft',{timeout:120000},async()=>{
 const today=dayInZone(),future=shiftDay(today,3),previous=shiftDay(today,-40),question="求导后，为什么先整理 $f'(x)$？";
 const fixture=await mkdtemp(join(workspaceRoot,'work/calendar-plan-fixture-'));await mkdir(join(fixture,'卡片'));
 const plan=`---\ntype: plan\ntitle: 导数学习计划\n---\n# 导数学习计划\n- [ ] 开始学习 · [[卡片/导函数|导函数的符号]] 📅 ${previous}\n- [ ] 已经执行 📅 ${previous}\n- [ ] 日期尚未约定\n<details data-notara="teacher"><summary>教师参考</summary>\n\n- [ ] 隐藏任务 📅 ${today}\n\n</details>\n`.replace('- [ ] 已经执行','- [x] 已经执行');
 await writeFile(join(fixture,'学习计划.md'),plan);
 await writeFile(join(fixture,'旧导读.md'),`---\ntype: guide\n---\n# 原导读\n- [ ] 继续原计划 📅 ${today}\n`);
 for(const type of ['note','source','route','lesson'])await writeFile(join(fixture,type+'.md'),`---\ntype: ${type}\n---\n- [ ] 普通勾选-${type} 📅 ${today}\n`);
 const card=scheduleReviewContent('---\ntype: method\ntitle: 导函数与单调性\n---\n# 导函数与单调性\n老师提示后学生完成定号。\n',{followUp:{question,afterDays:0,reason:'内部安排理由不展示'}},new Date(previous+'T12:00:00'));
 await writeFile(join(fixture,'卡片/导函数.md'),card);
 const runtime=await startNativeRuntime({fixture,testModel:true}),browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1280,height:850}});
 const out=join(workspaceRoot,'outputs/calendar-ui-20261108');await mkdir(out,{recursive:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(runtime.authUrl);await page.getByRole('button',{name:/^(Continue|继续)$/}).click();const composer=page.locator('[data-composer-input]:visible');await composer.waitFor();
  await page.waitForLoadState('networkidle');await composer.fill('长期教师，我们接着学习。');await page.getByRole('button',{name:/^(Send message|发送消息)$/}).click();await page.getByText('这是确定性集成测试输出，不是教学效果证据。',{exact:true}).waitFor();await composer.fill('原有草稿');
  await page.getByRole('button',{name:'日历',exact:true}).click();const cal=page.getByRole('region',{name:'学习日历'});
  await expect(cal.locator('[data-kind=plan]')).toHaveCount(2);await expect(cal.locator('[data-kind=question]')).toHaveCount(1);
  await expect(cal).not.toContainText('普通勾选');await expect(cal).not.toContainText('日期尚未约定');await expect(cal).not.toContainText('隐藏任务');await expect(cal).not.toContainText('内部安排理由');
  await expect(cal.locator('[data-kind=question] .katex')).toHaveCount(1);await expect(cal.locator('[data-kind=plan]').first()).not.toContainText('[[');
  await page.getByRole('button',{name:'全屏',exact:true}).click();await page.getByRole('button',{name:'最小化会话',exact:true}).click();
  await expect.poll(()=>cal.locator('.nc-agenda-item').evaluateAll(rows=>rows.every(row=>row.getBoundingClientRect().height<130))).toBe(true);
  await expect(cal.locator('.nc-item-meta .nc-overdue')).toHaveText(['逾期 40 天','逾期 40 天']);await expect(cal).not.toContainText('未处理');
  await expect(cal.locator('[data-kind=plan] .nc-item-text').first()).toHaveText('开始学习');await expect(cal.locator('[data-kind=plan] .nc-item-meta').first()).toContainText('导函数的符号');
  await expect(cal.locator('.nc-selected-date')).toHaveAttribute('datetime',today);await cal.getByRole('button',{name:'后一天',exact:true}).click();await expect(cal.locator('.nc-selected-date')).toHaveAttribute('datetime',shiftDay(today,1));await cal.getByRole('button',{name:'前一天',exact:true}).click();await expect(cal.locator('.nc-selected-date')).toHaveAttribute('datetime',today);
  const questionRow=cal.locator('[data-kind=question]'),actions=questionRow.locator('.nc-item-actions');
  await cal.locator('header').hover();await expect(actions).toHaveCSS('opacity','0');await questionRow.hover();await expect(actions).toHaveCSS('opacity','1');
  await expect.poll(()=>questionRow.evaluate(row=>Math.abs(row.querySelector('.nc-item-text').getBoundingClientRect().top-row.querySelector('.nc-item-actions').getBoundingClientRect().top)<2)).toBe(true);
  await expect(questionRow).toHaveCSS('border-bottom-width','0px');
  await cal.locator('header').hover();await questionRow.getByRole('button',{name:'继续讨论',exact:true}).focus();await expect(actions).toHaveCSS('opacity','1');
  await page.screenshot({path:join(out,'calendar-two-types.png')});
  await page.reload();await expect(cal.locator('[data-kind=plan]')).toHaveCount(2);await expect(cal.locator('[data-kind=question]')).toHaveCount(1);
  const first=cal.locator('[data-kind=plan]').filter({hasText:'导函数的符号'});
  const trigger=first.getByRole('button',{name:/^改期：/}),dialog=page.getByRole('dialog',{name:'改期',exact:true});
  await trigger.click();await expect(dialog).toBeVisible();await expect(dialog.getByRole('button')).toHaveText(['明天','3 天后','下周','选日期…']);await expect(page.locator('input[type=date]')).toHaveCount(0);
  await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(trigger).toBeFocused();
  await trigger.click();await cal.locator('.nc-selected-date').click();await expect(dialog).toBeHidden();
  await trigger.click();await dialog.getByRole('button',{name:'选日期…',exact:true}).click();
  if(future.slice(0,7)!==today.slice(0,7))await dialog.getByRole('button',{name:'下个月',exact:true}).click();
  if(future.slice(0,7)===today.slice(0,7))await expect(dialog.getByRole('button',{name:today,exact:true})).toBeEnabled();
  await dialog.getByRole('button',{name:future,exact:true}).click();await expect.poll(()=>readFile(join(runtime.vault,'学习计划.md'),'utf8')).toBe(plan.replace('📅 '+previous,'📅 '+future));
  await expect(cal.locator('[data-kind=plan]')).toHaveCount(1);
  await cal.getByRole('button',{name:'改期：'+question,exact:true}).click();await dialog.getByRole('button',{name:'3 天后',exact:true}).click();
  await expect.poll(async()=>reviewPlans(parseMarkdown(await readFile(join(runtime.vault,'卡片/导函数.md'),'utf8')).fields)[0].nextReview).toBe(future);await expect(cal.locator('[data-kind=question]')).toHaveCount(0);
  const saved=parseMarkdown(await readFile(join(runtime.vault,'卡片/导函数.md'),'utf8')).fields.review_history;assert.deepEqual(saved.slice(0,-1),parseMarkdown(card).fields.review_history);assert.equal(saved.at(-1).kind,'continuation');
  // Future appointments remain visible on their own day after reopening.
  await page.reload();await cal.getByRole('button',{name:future,exact:true}).click();await expect(cal.locator('[data-kind=plan]')).toHaveCount(1);await expect(cal.locator('[data-kind=question]')).toHaveCount(1);
  await cal.locator('[data-kind=plan] input[type=checkbox]').click();await expect.poll(()=>readFile(join(runtime.vault,'学习计划.md'),'utf8')).toContain('- [x] 开始学习');await expect(cal.locator('[data-kind=plan] input[type=checkbox]')).toBeChecked();
  await page.setViewportSize({width:642,height:746});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await cal.locator('.nc-layout').evaluate(el=>{el.scrollTop=el.scrollHeight;});await expect(cal.locator('.nc-selected-date')).toBeInViewport();
  await expect.poll(()=>questionRow.evaluate(row=>Math.abs(row.querySelector('.nc-item-text').getBoundingClientRect().top-row.querySelector('.nc-item-actions').getBoundingClientRect().top)<2)).toBe(true);
  await page.screenshot({path:join(out,'calendar-narrow.png')});
  const touch=await browser.newPage({hasTouch:true,viewport:{width:642,height:746},storageState:await page.context().storageState()});
  try{await touch.goto(new URL('/',runtime.authUrl).href);const touchCal=touch.getByRole('region',{name:'学习日历'});await expect(touchCal).toBeVisible();await touchCal.getByRole('button',{name:'今天',exact:true}).click();await expect(touchCal.locator('.nc-item-actions').first()).toHaveCSS('opacity','1');}finally{await touch.close();}
  await cal.getByRole('button',{name:'继续讨论',exact:true}).click();await expect(composer).toContainText('原有草稿');await expect(composer).toContainText('为什么先整理');await expect(page.getByText('这是确定性集成测试输出，不是教学效果证据。',{exact:true})).toHaveCount(1);
  assert.equal(reviewPlans(parseMarkdown(await readFile(join(runtime.vault,'卡片/导函数.md'),'utf8')).fields)[0].nextReview,future,'opening a question does not complete it');
  await page.setViewportSize({width:1280,height:850});await openLibrary(page);const fullscreen=page.getByRole('button',{name:'全屏',exact:true});if(await fullscreen.isVisible())await fullscreen.click();await expect(page.getByRole('button',{name:'退出全屏',exact:true})).toBeVisible();await chooseBaseView(page,'学习计划');await expect(page.locator('.nv-base-workspace:visible')).toContainText('导数学习计划');await expect(page.locator('.nv-base-workspace:visible')).toContainText('原导读');
  assert.deepEqual(errors,[]);
 }catch(error){await page.screenshot({path:join(out,'failure.png')});await writeFile(join(out,'failure.txt'),error.stack+'\n'+await page.locator('body').innerText());throw error;}
 finally{await browser.close();await runtime.stop();await rm(fixture,{recursive:true,force:true});}
});
