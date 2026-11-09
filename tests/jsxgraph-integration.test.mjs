import test from 'node:test';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';import {startNativeRuntime,workspaceRoot} from '../scripts/native-runtime.mjs';
test('teacher-created constructions persist student glider edits while chat keeps the original picture',{timeout:120000},async()=>{
  const fixture=await mkdtemp(join(workspaceRoot,'work/jsxgraph-fixture-')),out=join(workspaceRoot,'outputs/jsxgraph-20261028');await mkdir(out,{recursive:true});
  const runtime=await startNativeRuntime({fixture,testModel:true,modelFixture:'tests/jsxgraph-model.mjs'}),browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1414,height:950}});page.setDefaultTimeout(15000);
  const path=join(runtime.vault,'几何联动.excalidraw'),read=async()=>JSON.parse(await readFile(path,'utf8')),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const block=page.locator('.nv-chat-drawing:visible'),drawing=block.locator('.nv-drawing-editor'),dialog=page.locator('.nv-math-dialog');
  const selectAll=async()=>{await drawing.locator('canvas.interactive').click({position:{x:30,y:180}});await page.keyboard.press('ControlOrMeta+a');};
  const picture=async()=>createHash('sha256').update(await block.locator('.nv-drawing-preview svg image').first().evaluate(e=>{const svg=new DOMParser().parseFromString(atob((e.getAttribute('href')||e.getAttribute('xlink:href')).split(',')[1]),'image/svg+xml');return JSON.stringify([...svg.querySelectorAll('path,ellipse,circle,line,text')].map(n=>[n.tagName,...['d','cx','cy','rx','ry','r','x','y','x1','y1','x2','y2','display'].map(a=>n.getAttribute(a)),n.tagName==='text'?n.textContent:'']));})).digest('hex');
  const drag=async(name,dx,dy)=>{const box=await dialog.locator(`[aria-label="动点 ${name}"]`).boundingBox();assert.ok(box);await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+dx,box.y+box.height/2+dy,{steps:10});await page.mouse.up();};
  try{
    await page.goto(runtime.authUrl);await page.getByRole('button',{name:/^(Continue|继续)$/}).click();await page.locator('[data-composer-input]:visible').waitFor();await page.waitForLoadState('networkidle');
    await page.getByRole('button',{name:'首页学习助手',exact:true}).click();await page.getByRole('menuitem',{name:/^专题课堂老师/}).click();
    const input=page.locator('[data-composer-input]:visible');await input.fill('画个三角形的外接圆，让我拖动看看切线。');await input.press('Enter');
    await block.locator('.nv-drawing-preview svg image').first().waitFor({state:'attached'});const frozen=await picture(),original=await read();assert.ok(original.elements[0].customData.notaraMath.source.includes('tangent tP'));
    await block.getByRole('button',{name:'动手画',exact:true}).click();await drawing.locator('canvas.interactive').waitFor();await selectAll();await drawing.getByRole('button',{name:'编辑数学图',exact:true}).click();await dialog.locator('[data-status="ready"]').waitFor();
    await drag('C',35,-25);await drag('P',-30,-45);assert.deepEqual(await read(),original,'unapplied editor changes must stay local');
    const before=await dialog.locator('[aria-label="动点 P"]').boundingBox();await page.screenshot({path:join(out,'native-edit.png')});await dialog.getByRole('button',{name:'应用到白板',exact:true}).click();await expect(dialog).toHaveCount(0);
    await expect.poll(async()=>(await read()).elements[0].customData.notaraMath.drags.P?.position).not.toBeUndefined();
    const saved=(await read()).elements[0].customData.notaraMath;assert.ok(saved.drags.C);assert.ok(saved.drags.Q);assert.equal((await read()).elements[0].type,'embeddable');
    await block.getByRole('button',{name:'结束绘图',exact:true}).click();await block.locator('.nv-drawing-preview svg image').first().waitFor({state:'attached'});assert.equal(await picture(),frozen);
    await page.reload();await block.locator('.nv-drawing-preview svg image').first().waitFor({state:'attached'});assert.equal(await picture(),frozen);
    await block.getByRole('button',{name:'动手画',exact:true}).click();await drawing.locator('canvas.interactive').waitFor();await selectAll();await drawing.getByRole('button',{name:'编辑数学图',exact:true}).click();await dialog.locator('[data-status="ready"]').waitFor();
    const after=await dialog.locator('[aria-label="动点 P"]').boundingBox();assert.ok(Math.abs(before.x-after.x)<1&&Math.abs(before.y-after.y)<1,'glider returns to the saved position');
    await expect(dialog.getByRole('status')).toHaveCount(0);await dialog.getByRole('button',{name:'关闭数学图',exact:true}).click();
    await drawing.getByRole('button',{name:'讨论选区',exact:true}).click();await expect(page.locator('[data-composer-input]:visible').first()).toContainText('画布快照');
    assert.deepEqual(errors,[]);await writeFile(join(out,'native-evidence.json'),JSON.stringify({saved,before,after,pageErrors:errors},null,2));
  }catch(error){await page.screenshot({path:join(out,'native-failure.png')});await writeFile(join(out,'native-failure.json'),JSON.stringify({error:error.message,errors,text:(await page.locator('body').innerText()).slice(-4500)},null,2));throw error;}finally{await browser.close();await runtime.stop();await rm(fixture,{recursive:true,force:true});}
});
