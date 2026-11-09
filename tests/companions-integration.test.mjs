import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {startNativeRuntime,workspaceRoot} from '../scripts/native-runtime.mjs';
import {openLibrary} from '../scripts/ui-navigation.mjs';

test('classmate invitations preserve drafts, create native continuable peers and retain blind isolation',{timeout:120000},async()=>{
  const runtime=await startNativeRuntime({testModel:true,modelFixture:'tests/companions-model.mjs'});
  const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1414,height:850}}),errors=[];
  const out=join(workspaceRoot,'outputs/activity-deck-20261027');await mkdir(out,{recursive:true});page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);
  const input=page.locator('[data-composer-input]:not([data-sidebar-chat] [data-composer-input])'),send=()=>input.press('Enter');
  const childView=page.locator('[data-sidebar-chat]:visible');
  await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copiedStudentText=text;}}}));
  const activity=page.getByRole('complementary',{name:'本次活动',exact:true});
  const openChildTab=async title=>{await page.locator('.nv-activity-trigger:not(.nv-activity-child-conversation .nv-activity-trigger)').click();await activity.getByRole('region',{name:'子智能体'}).getByRole('button',{name:title,exact:true}).click();await expect(childView).toBeVisible();};
  try{
    await page.goto(runtime.authUrl);await page.getByRole('button',{name:/^(Continue|继续)$/}).click();await page.locator('[data-composer-input]:visible').waitFor();await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button',{name:'邀请同学',exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'首页学习助手',exact:true}).click();await page.getByRole('menuitem',{name:/^专题课堂老师/}).click();
    await input.fill('先留下一段课堂历史');await send();await expect(page.getByText('课堂历史中的教师解析：TEACHER_HISTORY_SECRET。',{exact:true})).toBeVisible();
    await input.fill('请解释 $y=x^2$ 在 $x=1$ 处的切线斜率。');
    await page.getByRole('button',{name:'邀请同学',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'邀请同学',exact:true});await expect(dialog).toBeVisible();await expect(dialog).toHaveCSS('opacity','1');
    await expect(dialog.locator('img')).toHaveCount(4);await expect.poll(()=>dialog.locator('img').evaluateAll(images=>images.every(image=>image.complete&&image.naturalWidth>0))).toBe(true);
    await page.screenshot({path:join(out,'invitation-picker.png')});
    await dialog.getByRole('button',{name:'邀请大小姐',exact:true}).click();
    await expect(input).toContainText('请解释');await expect(input).toContainText('大小姐');await expect(page.getByRole('button',{name:/个子智能体/})).toHaveCount(0);
    await page.reload();await expect(input).toContainText('大小姐');await expect(input).toContainText('请解释');
    await send();await expect(page.locator('.nv-companion-call').filter({hasText:'已邀请'})).toBeVisible();await expect(page.getByRole('button',{name:/1 (个子智能体|subagent)/})).toHaveCount(0);
    await expect(page.locator('.nv-companion-call')).toContainText('大小姐');
    const invitationMessage=page.locator('[data-user-markdown]').filter({hasText:'请解释'}).last();
    await expect(invitationMessage).toContainText('大小姐');
    assert.doesNotMatch(await invitationMessage.innerText(),/用户邀请|subagent|preset=|掌握证据|notara-reference-v1/);
    await invitationMessage.getByRole('button',{name:/^(Copy|复制)$/}).click();
    const copied=await page.evaluate(()=>window.__copiedStudentText);assert.match(copied,/大小姐/);assert.match(copied,/请解释/);assert.doesNotMatch(copied,/用户邀请|subagent|preset=|掌握证据|notara-reference-v1/);
    await page.screenshot({path:join(out,'classmate-invited.png')});
    await input.fill('老师这边未发出的草稿');await openChildTab('一起看切线');
    await expect(childView.getByText('同学回答：对',{exact:false})).toBeVisible();await expect(childView.getByRole('button',{name:'邀请同学',exact:true})).toHaveCount(0);
    const peerInput=childView.locator('[data-composer-input]');await peerInput.fill('能换个例子吗');await peerInput.press('Enter');await expect(childView.getByRole('button',{name:/^(Stop generating|停止生成)$/})).toBeVisible();await openLibrary(page);await expect(childView).toHaveCount(0);await expect.poll(async()=>Boolean(await readFile(join(runtime.home,'companion-reply-complete'),'utf8').catch(()=>''))).toBe(true);await expect(page.getByRole('tab',{name:/^一起看切线/})).toHaveAttribute('aria-selected','false');await openChildTab('一起看切线');await expect(childView.getByText('同学继续：例如',{exact:false})).toBeVisible();await expect(input).toHaveText('老师这边未发出的草稿');
    await peerInput.fill('同学草稿');await openLibrary(page);await openChildTab('一起看切线');await expect(peerInput).toHaveText('同学草稿');
    await page.screenshot({path:join(out,'classmate-conversation.png')});
    await page.getByRole('tab',{name:/^一起看切线/}).getByRole('button',{name:/^(Close|关闭)$/}).click();await expect(page.getByRole('tab',{name:/^一起看切线/})).toHaveCount(0);await openChildTab('一起看切线');await expect(peerInput).toHaveText('同学草稿');
    await openLibrary(page);await expect(childView).toHaveCount(0);await openChildTab('一起看切线');await expect(peerInput).toHaveText('同学草稿');await openLibrary(page);
    await input.fill('原题：求 y=x^2 在 x=1 处的导数。我的讲解：我想用平均变化率。');
    await page.getByRole('button',{name:'邀请同学',exact:true}).click();await page.getByRole('button',{name:'讲给同学听（不看解析）',exact:true}).click();await expect(dialog.locator('img')).toHaveCount(1);await dialog.getByRole('button',{name:'邀请大肥鱼',exact:true}).click();await send();
    await expect(page.locator('.nv-companion-call').filter({hasText:'不看解析'})).toBeVisible();
    await expect.poll(async()=>{const rows=(await readFile(join(runtime.home,'companion-requests.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);return rows.some(row=>JSON.stringify(row.messages).includes('BLIND_STUDENT_WORDS'));}).toBe(true);
    const rows=(await readFile(join(runtime.home,'companion-requests.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
    const child=rows.filter(row=>JSON.stringify(row.messages).includes('CLASSMATE_QUESTION')&&!JSON.stringify(row.messages).includes('用户邀请'));
    assert.ok(child.length>=2);assert.equal(new Set(child.map(row=>row.id)).size,1);for(const row of child)assert.doesNotMatch(JSON.stringify(row.messages),/TEACHER_HISTORY_SECRET/);
    const blind=rows.filter(row=>JSON.stringify(row.messages).includes('BLIND_STUDENT_WORDS')&&!JSON.stringify(row.messages).includes('用户邀请'));assert.ok(blind.length);for(const row of blind){assert.doesNotMatch(JSON.stringify(row.messages),/TEACHER_HISTORY_SECRET|CLASSMATE_QUESTION/);assert.deepEqual(row.tools,[]);}
    await expect(page.getByRole('button',{name:/^(Stop generating|停止生成)$/})).toHaveCount(0);await input.fill('再请核验员检查计算');await send();
    // Internal worker receipts stay hidden; the activity panel opens the real native record.
    await page.locator('.nv-activity-trigger:not(.nv-activity-child-conversation .nv-activity-trigger)').click();
    const worker=activity.getByRole('region',{name:'子智能体'}).locator('.nv-activity-agent').filter({has:page.getByRole('button',{name:'核验计算',exact:true})});
    await expect(worker.locator('.nv-activity-status')).toHaveText('可继续');await worker.getByRole('button',{name:'查看行为：核验计算',exact:true}).click();await worker.getByRole('button',{name:'打开记录 ↗',exact:true}).click();
    await expect(childView.getByText('核验记录：计算一致。',{exact:true})).toBeVisible();await expect(childView.locator('[data-composer-input]')).toBeVisible();
    await page.getByRole('tab',{name:/^一起看切线/}).click();await expect(peerInput).toHaveText('同学草稿');await expect(page.locator('.nv-activity-deck')).toHaveCount(0);
    await page.locator('[data-sidebar-right-open] button[data-notara-workspace-mode="fullscreen"]').click();await expect(page.getByRole('button',{name:'退出全屏',exact:true})).toBeVisible();await expect(peerInput).toHaveText('同学草稿');await page.screenshot({path:join(out,'tabs-exclusive.png')});await page.reload();await expect(peerInput).toHaveText('同学草稿');await page.getByRole('button',{name:'退出全屏',exact:true}).click();
    await page.setViewportSize({width:755,height:746});await page.getByRole('button',{name:'邀请同学',exact:true}).click();await expect(dialog).toHaveCSS('opacity','1');await page.screenshot({path:join(out,'invitation-picker-narrow.png')});await page.keyboard.press('Escape');
    assert.deepEqual(errors,[]);await writeFile(join(out,'browser-result.json'),JSON.stringify({status:'PASS',nativeInvitation:true,draftRefresh:true,peerContinuation:true,blindIsolation:true,avatarsLoaded:true,errors},null,2));
  }catch(error){await page.screenshot({path:join(out,'browser-failure.png')});await writeFile(join(out,'browser-failure.txt'),error.stack+'\nErrors: '+JSON.stringify(errors)+'\n'+await page.locator('body').innerText());throw error;}
  finally{await browser.close();await runtime.stop();}
});
