import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {startNativeRuntime,workspaceRoot} from '../scripts/native-runtime.mjs';

test('native reference display, copy, reload and queue editing preserve model instructions without whole source text',{timeout:120000},async()=>{
  const fixture=await mkdtemp(join(workspaceRoot,'work/user-reference-fixture-'));
  await writeFile(join(fixture,'讲义.md'),'# 讲义\n\nWHOLE_DOCUMENT_MUST_NOT_BE_SENT\n');
  const runtime=await startNativeRuntime({fixture,testModel:true,modelFixture:'tests/user-references-model.mjs'});
  const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1414,height:900}}),errors=[];
  const out=join(workspaceRoot,'outputs/user-references-20261030');await mkdir(out,{recursive:true});
  const input=page.locator('[data-composer-input]:not([data-sidebar-chat] [data-composer-input])');
  const clean=value=>assert.doesNotMatch(value,/用户邀请|subagent|preset=|资料定位|版本：|notara-reference-v1|WHOLE_DOCUMENT_MUST_NOT_BE_SENT/);
  const invite=async()=>{await page.getByRole('button',{name:'邀请同学',exact:true}).click();await page.getByRole('button',{name:'邀请大小姐',exact:true}).click();};
  const bring=async()=>{
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('notara:open-document',{detail:{path:'讲义.md'}})));
    await page.locator('.nv-vault-doc-tab:visible').getByRole('button',{name:'带入当前对话',exact:true}).click();
    // Wait for the real reference occurrence, not a same-name word in prose.
    await expect(input.locator('[data-composer-chip="notara-vault-reference"]')).toHaveText('讲义');
  };
  const requests=async()=>readFile(join(runtime.home,'reference-requests.jsonl'),'utf8').then(text=>text.trim().split('\n').map(JSON.parse));
  page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(12000);
  await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copiedStudentText=text;}}}));
  try{
    await page.goto(runtime.authUrl);await page.getByRole('button',{name:/^(Continue|继续)$/}).click();await page.locator('[data-composer-input]:visible').waitFor();await page.waitForLoadState('networkidle');
    await page.getByRole('button',{name:'首页学习助手',exact:true}).click();await page.getByRole('menuitem',{name:/^专题课堂老师/}).click();
    await input.fill('先开始一课。');await input.press('Enter');await expect(page.locator('[data-chat-node-key]').getByText('请求已收悉。',{exact:true})).toBeVisible();
    await input.fill('这是我自己写的提问。');await bring();await invite();clean(await input.innerText());
    await page.reload();await expect(input).toContainText('大小姐');await expect(input).toContainText('讲义');await expect(input).toContainText('我自己写的提问');
    await input.press('Enter');const message=page.locator('[data-user-markdown]').filter({hasText:'我自己写的提问'}).last();
    await expect(message.getByRole('button',{name:'讲义',exact:true})).toBeVisible();clean(await message.innerText());
    await message.getByRole('button',{name:/^(Copy|复制)$/}).click();const copied=await page.evaluate(()=>window.__copiedStudentText);clean(copied);assert.match(copied,/大小姐/);assert.match(copied,/讲义/);assert.match(copied,/我自己写的提问/);
    await expect.poll(async()=>JSON.stringify(await requests())).toContain('preset=companion-claude');
    const row=(await requests()).at(-1),modelText=JSON.stringify(row.messages.filter(value=>value.role==='user').at(-1));
    assert.match(modelText,/讲义\.md/);assert.match(modelText,/revision/);assert.match(modelText,/subagent/);assert.doesNotMatch(modelText,/WHOLE_DOCUMENT_MUST_NOT_BE_SENT/);
    await expect(page.getByRole('button',{name:/^(Stop generating|停止生成)$/})).toHaveCount(0);
    await page.reload();await expect(message.getByRole('button',{name:'讲义',exact:true})).toBeVisible();clean(await message.innerText());
    await input.fill('未发送草稿');await message.getByRole('button',{name:'讲义',exact:true}).click();await expect(page.locator('.nv-vault-doc-tab:visible .cm-editor')).toBeVisible();await expect(input).toHaveText('未发送草稿');
    await input.fill('HOLD_REFERENCE_QUEUE');await input.press('Enter');await expect(page.locator('[data-chat-node-key]').getByText('队列测试正在等待释放。',{exact:true})).toBeVisible();
    await input.fill('排队的学生正文：请解释【讲义】中的概念。');await bring();await invite();await input.press('Enter');
    const queue=page.locator('[data-queue-dock]');await expect(queue).toContainText('大小姐');clean(await queue.innerText());
    await queue.getByRole('button',{name:/^(编辑排队消息|Edit queued message)$/}).click();const editor=queue.getByRole('textbox');clean(await editor.inputValue());
    await editor.fill((await editor.inputValue())+'（补充条件）');await queue.getByRole('button',{name:/^(保存|Save)/}).click();clean(await queue.innerText());
    await writeFile(join(runtime.home,'release-reference-queue'),'release');
    await expect.poll(async()=>JSON.stringify(await requests())).toContain('补充条件');
    const edited=JSON.stringify((await requests()).at(-1).messages.filter(value=>value.role==='user').at(-1));assert.match(edited,/preset=companion-claude/);assert.match(edited,/讲义\.md/);assert.match(edited,/补充条件/);assert.match(edited,/请解释【讲义】中的概念/);assert.doesNotMatch(edited,/WHOLE_DOCUMENT_MUST_NOT_BE_SENT/);
    await expect(queue).toHaveCount(0);await page.setViewportSize({width:755,height:746});clean(await page.locator('[data-user-markdown]').last().innerText());
    await page.screenshot({path:join(out,'clean-reference-narrow.png')});assert.deepEqual(errors,[]);
    await writeFile(join(out,'browser-result.json'),JSON.stringify({status:'PASS',copy:true,refresh:true,addressOnly:true,queueEditPreservesWire:true,errors},null,2));
  }catch(error){await page.screenshot({path:join(out,'failure.png')});await writeFile(join(out,'failure.txt'),error.stack+'\n'+await page.locator('body').innerText());throw error;}
  finally{await browser.close();await runtime.stop();await rm(fixture,{recursive:true,force:true});}
});
