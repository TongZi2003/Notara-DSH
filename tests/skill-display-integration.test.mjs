import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {startNativeRuntime,workspaceRoot} from '../scripts/native-runtime.mjs';

test('native skill menu uses Chinese faces; selected chips persist and send original names and complete instructions',{timeout:120000},async()=>{
  const runtime=await startNativeRuntime({testModel:true,modelFixture:'tests/skill-display-model.mjs'}),browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1050,height:850}});
  const out=join(workspaceRoot,'outputs/skill-display-20261108');await mkdir(out,{recursive:true});const errors=[],prompts=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().endsWith('/api/session/prompt'))prompts.push(r.postData());});
  try{
    await page.goto(runtime.authUrl);await page.getByRole('button',{name:/^(Continue|继续)$/}).click();const input=page.locator('[data-composer-input]:visible');await input.waitFor();await page.waitForLoadState('networkidle');
    await input.fill('/');const menu=page.locator('[data-trigger-menu]');await expect(menu.getByRole('option').filter({hasText:'错因分析'})).toHaveCount(1);
    await expect(menu).not.toContainText('notara-');await expect(menu).not.toContainText('时加载');await expect(menu).not.toContainText('type:');
    await expect(menu.getByRole('option').filter({hasText:'白板教学'})).toHaveCount(2,'native on/off commands remain, but not the non-invocable skill');
    await menu.getByRole('option').filter({hasText:'错因分析'}).scrollIntoViewIfNeeded();await page.screenshot({path:join(out,'menu-wide.png')});
    await input.fill('/错因');await expect(menu.getByRole('option')).toHaveCount(1);
    await menu.getByRole('option').click();const chip=input.locator('[data-composer-chip=skill]');await expect(chip).toHaveText('错因分析');await expect(chip.locator('svg')).toHaveCount(1);await expect(input).not.toContainText('notara-');assert.equal(prompts.length,0);
    await input.press('End');await input.pressSequentially(' 请先看看我的草稿');
    await page.reload();await expect(chip).toHaveText('错因分析');await expect(input).toContainText('请先看看我的草稿');
    await page.setViewportSize({width:642,height:746});await page.screenshot({path:join(out,'selected-narrow.png')});
    await input.press('ControlOrMeta+Enter');await expect(page.getByText('技能引用测试完成。',{exact:true})).toBeVisible();
    assert.equal(prompts.length,1);assert.match(prompts[0],/\/notara-error-analysis/);assert.match(prompts[0],/请先看看我的草稿/);
    const calls=(await readFile(join(runtime.home,'skill-display-requests.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
    const messageText=JSON.stringify(calls.filter(c=>!c.purpose));assert.match(messageText,/# 错因分析/);assert.match(messageText,/先看完整题设、学生原作答、批改和可用草稿/);
    await expect(page.locator('[data-chat-node-kind="user"],.nv-user-message').filter({hasText:'notara-error-analysis'})).toHaveCount(0);
    await page.reload();await expect(page.getByText('技能引用测试完成。',{exact:true})).toBeVisible();await expect(page.getByText('错因分析',{exact:true}).first()).toBeVisible();
    await input.fill('/notara-error-analysis');await expect(menu.getByRole('option')).toHaveCount(1);await expect(menu).toContainText('错因分析');await page.screenshot({path:join(out,'menu-narrow.png')});
    assert.deepEqual(errors,[]);
  }catch(error){await page.screenshot({path:join(out,'failure.png')});await writeFile(join(out,'failure.txt'),error.stack+'\n'+await page.locator('body').innerText());throw error;}
  finally{await browser.close();await runtime.stop();}
});
