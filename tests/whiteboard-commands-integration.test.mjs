import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {startNativeRuntime,workspaceRoot} from '../scripts/native-runtime.mjs';

test('native slash whiteboard activation keeps draft, reuses the file and survives disable/reload',{timeout:120000},async()=>{
 const fixture=await mkdtemp(join(workspaceRoot,'work/whiteboard-command-fixture-'));
 const runtime=await startNativeRuntime({fixture,testModel:true}),browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1320,height:860}});
 const out=join(workspaceRoot,'outputs/whiteboard-feedback-20261108');await mkdir(out,{recursive:true});page.setDefaultTimeout(15000);
 const responses=[],errors=[],prompts=[],requestPaths=[],consoleErrors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'||m.text().startsWith('whiteboard-debug'))consoleErrors.push(m.text());});page.on('request',r=>requestPaths.push(new URL(r.url()).pathname));
 page.on('response',async response=>{if(response.url().endsWith('/api/notaraVault/setWhiteboard'))responses.push((await response.json()).result);});
 page.on('request',request=>{if(request.url().endsWith('/api/session/prompt'))prompts.push(request.postData());});
 const composer=page.locator('[data-composer-input]:visible');
 const success=page.getByRole('alert').filter({hasText:/^已(启用|停用)白板教学/});
 async function menuStatus(text){
  await page.getByRole('button',{name:'更多白板工具',exact:true}).click();
  await expect(page.getByRole('menuitem',{name:text,exact:true})).toBeVisible();
  await page.screenshot({path:join(out,text.includes('已停用')?'disabled-menu.png':'enabled-menu.png')});
  await page.keyboard.press('Escape');
 }
 async function transientReceipt(){
  await expect(success).toBeVisible();
  await expect(page.getByRole('status').filter({hasText:'已启用白板教学'})).toHaveCount(0);
  assert.equal(await success.evaluate(element=>getComputedStyle(element).position),'fixed');
  const before=await composer.boundingBox();
  await expect(success).toHaveCount(0,{timeout:6000});
  assert.deepEqual(await composer.boundingBox(),before,'toast expiry must not move the input');
 }
 async function command(enabled,draft=''){
  const before=responses.length;await composer.fill(`${draft}${draft?'\n':''}/whiteboard-${enabled?'on':'off'}`);
  const option=page.getByText(enabled?'启用白板教学':'停用白板教学',{exact:true});await expect(option).toBeVisible();
  if(enabled&&!before)await page.screenshot({path:join(out,'slash-menu.png')});await option.click();
  await expect.poll(()=>responses.length).toBe(before+1);assert.equal(responses.at(-1).ok,true,JSON.stringify(responses.at(-1)));
  if(draft)await expect(composer).toContainText(draft);return responses.at(-1).value;
 }
 try{
  await page.goto(runtime.authUrl);await page.getByRole('button',{name:/^(Continue|继续)$/}).click();await composer.waitFor();await page.waitForLoadState('networkidle');
  const first=await command(true,'先保留这段没有发送的想法');assert.equal(prompts.length,0);await expect(page.locator('.nv-canvas-editor:visible')).toBeVisible();
  await transientReceipt();await menuStatus('白板教学 · 已启用');
  const board=join(runtime.vault,first.path),sample={nodes:[{id:'problem',type:'text',text:'# 观察两种解法\n\n先保留题目和自己的想法，再逐步补充。',x:0,y:0,width:440,height:240}],edges:[]};
  await writeFile(board,JSON.stringify(sample));await expect(page.locator('.nv-canvas-editor:visible')).toContainText('观察两种解法');
  assert.equal((await command(true,'先保留这段没有发送的想法')).path,first.path);assert.equal((await command(false,'先保留这段没有发送的想法')).enabled,false);
  await transientReceipt();await menuStatus('白板教学 · 已停用');
  assert.deepEqual(JSON.parse(await readFile(board,'utf8')),sample);assert.equal((await readdir(join(runtime.vault,'白板'))).length,1);
  await page.reload();await expect(composer).toContainText('先保留这段没有发送的想法');await menuStatus('白板教学 · 已停用');await expect(success).toHaveCount(0);
  assert.equal((await command(true,'先保留这段没有发送的想法')).path,first.path);await menuStatus('白板教学 · 已启用');
  assert.equal(prompts.length,0);await expect(page.locator('.nv-canvas-editor:visible')).toContainText('观察两种解法');await page.screenshot({path:join(out,'enabled-board.png')});
  // Native New Session deliberately reuses an unsent draft. Start the first
  // conversation explicitly before asking the host for a distinct one.
  await composer.fill('现在开始讨论这个例子。');await composer.press('Enter');await page.getByRole('button',{name:/1 turns 1 steps|1 轮.*1 步/}).waitFor();
  const created=page.waitForResponse(r=>r.url().endsWith('/api/session/create'));await page.getByRole('button',{name:/^(New session|新会话|新建会话)$/}).click();await created;await page.waitForLoadState('networkidle');await expect(composer).toBeEmpty();const second=await command(true);assert.notEqual(second.path,first.path);assert.notEqual(second.sessionId,first.sessionId);assert.equal(prompts.length,1);
  assert.deepEqual(JSON.parse(await readFile(board,'utf8')),sample);assert.deepEqual(errors,[]);
 }catch(error){await page.screenshot({path:join(out,'failure.png')});await writeFile(join(out,'failure.txt'),(await page.locator('body').innerText())+'\n'+JSON.stringify({requestPaths,errors,consoleErrors})+'\n'+runtime.log());throw error;}
 finally{await browser.close();await runtime.stop();await rm(fixture,{recursive:true,force:true});}
});
