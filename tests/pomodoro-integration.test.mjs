import test from 'node:test';import assert from 'node:assert/strict';import {readFile,mkdir} from 'node:fs/promises';import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';import {startNativeRuntime,workspaceRoot} from '../scripts/native-runtime.mjs';
test('host timer reaches its original classroom after switching, with no page timer or student prompt',{timeout:90000},async()=>{
  const runtime=await startNativeRuntime({testModel:true,modelFixture:'tests/pomodoro-model.mjs'}),browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1414,height:850}}),errors=[];
  const out=join(workspaceRoot,'outputs/notara-plugin-group-20261027');await mkdir(out,{recursive:true});page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.goto(runtime.authUrl);await page.getByRole('button',{name:/^(Continue|继续)$/}).click();await page.locator('[data-composer-input]:visible').waitFor();await page.waitForLoadState('networkidle');
    const input=page.locator('[data-composer-input]');await input.fill('课堂A 开始学导数');await input.press('Enter');await expect(page.getByText('老师已经收到消息。',{exact:true})).toBeVisible();
    const first=(await readFile(join(runtime.home,'pomodoro-requests.jsonl'),'utf8')).trim().split('\n').map(JSON.parse)[0].id;
    await expect(page.getByRole('button',{name:'课堂番茄钟',exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'插件',exact:true})).toBeVisible();
    const openClock=async()=>{const panel=page.locator('#nv-activity-panel');if(!await panel.isVisible())await page.getByRole('button',{name:'本次活动',exact:true}).click();await panel.getByRole('button',{name:'课堂番茄钟',exact:true}).click();};
    await openClock();const dialog=page.getByRole('dialog',{name:'课堂番茄钟',exact:true});
    await expect(dialog.getByLabel('课堂时长（分钟）')).toHaveValue('45');await expect(dialog.getByLabel('提醒间隔（分钟）')).toHaveValue('10');
    await dialog.getByLabel('课堂时长（分钟）').fill('5');await dialog.getByLabel('提醒间隔（分钟）').fill('5');await dialog.getByRole('button',{name:'开始计时',exact:true}).click();await expect(dialog.getByText('每 5 分钟提醒老师 · 已送达 0 次',{exact:true})).toBeVisible();
    await page.screenshot({path:join(out,'pomodoro.png')});await page.keyboard.press('Escape');
    await page.getByRole('button',{name:/^(New session|新会话|新建会话)$/}).click();await page.locator('[data-composer-input]:visible').waitFor();await input.fill('课堂B 保持当前焦点');await input.press('Enter');
    await expect.poll(async()=>{const rows=(await readFile(join(runtime.home,'pomodoro-requests.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);return rows.some(row=>row.id===first&&JSON.stringify(row.messages).includes('【Notara课堂番茄钟】'));},{timeout:15000}).toBe(true);
    const rows=(await readFile(join(runtime.home,'pomodoro-requests.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.ok(rows.filter(row=>JSON.stringify(row.messages).includes('【Notara课堂番茄钟】')).every(row=>row.id===first));
    await expect(page.getByText('课堂B 保持当前焦点',{exact:true})).toBeVisible();await expect(page.getByText('【Notara课堂番茄钟】',{exact:false})).toHaveCount(0);
    await openClock();await expect(dialog.getByText('当前没有进行中的计时',{exact:true})).toBeVisible();await dialog.getByRole('button',{name:'开始计时',exact:true}).click();await expect(dialog.getByRole('button',{name:'停止计时',exact:true})).toBeVisible();await dialog.getByRole('button',{name:'停止计时',exact:true}).click();await expect(dialog.getByRole('button',{name:'开始计时',exact:true})).toBeVisible();
    await page.keyboard.press('Escape');await page.getByRole('tablist',{name:'工作区栏目'}).getByRole('tab',{name:'会话',exact:true}).click();await page.locator('.nv-session-open[title="课堂A"]').click();await expect(page.getByText('课堂节奏已调整，请按当前进度继续。',{exact:true})).toBeVisible();await expect(page.getByText('【Notara课堂番茄钟】',{exact:false})).toHaveCount(0);
    assert.deepEqual(errors,[]);
  }catch(error){await page.screenshot({path:join(out,'pomodoro-failure.png')});throw error;}finally{await browser.close();await runtime.stop();}
});
