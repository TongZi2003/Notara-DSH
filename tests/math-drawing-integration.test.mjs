import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {startNativeRuntime,workspaceRoot} from '../scripts/native-runtime.mjs';
import {makeDrawingElements} from '../plugins/vault-sqlite/drawing-sync.js';
import {mathDefinition,MATH_EXAMPLES} from '../plugins/graph-and-blocks/src/domain/drawing-math.js';

test('math objects edit parameters, free points and 3D camera in Excalidraw; chat keeps its original snapshot',{timeout:150000},async()=>{
  const fixture=await mkdtemp(join(workspaceRoot,'work/math-flow-fixture-')),out=join(workspaceRoot,'outputs/math-flow-20261028');await mkdir(out,{recursive:true});
  const initial={type:'excalidraw',version:2,elements:makeDrawingElements([{kind:'math',x:0,y:0,math:mathDefinition(MATH_EXAMPLES['函数']).data}],()=> 'math-first'),files:{},appState:{viewBackgroundColor:'#ffffff'}};
  await writeFile(join(fixture,'数学共绘.excalidraw'),JSON.stringify(initial));
  const runtime=await startNativeRuntime({fixture,testModel:true,modelFixture:'tests/math-drawing-model.mjs'}),browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1414,height:1000}});page.setDefaultTimeout(15000);
  const path=join(runtime.vault,'数学共绘.excalidraw'),read=async()=>JSON.parse(await readFile(path,'utf8')),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const block=page.locator('.nv-chat-drawing:visible'),drawing=block.locator('.nv-drawing-editor'),dialog=page.getByRole('dialog');
  const selectAll=async()=>{await drawing.locator('canvas.interactive').click({position:{x:30,y:180}});await page.keyboard.press('ControlOrMeta+a');};
  const fingerprint=()=>block.locator('svg image').first().evaluate(e=>{const svg=new DOMParser().parseFromString(atob((e.getAttribute('href')||e.getAttribute('xlink:href')).split(',')[1]),'image/svg+xml');return [...svg.querySelectorAll('path')].map(p=>p.getAttribute('d')).join('|');});
  try{
    await page.goto(runtime.authUrl);await page.getByRole('button',{name:/^(Continue|继续)$/}).click();await page.locator('[data-composer-input]:visible').waitFor();await page.waitForLoadState('networkidle');
    await page.getByRole('button',{name:'首页学习助手',exact:true}).click();await page.getByRole('menuitem',{name:/^专题课堂老师/}).click();
    const input=page.locator('[data-composer-input]:visible');await input.fill('在白板里给我看看函数，我想自己调一调。');await input.press('Enter');
    await expect(block.getByText('当时的板书')).toBeVisible();await block.locator('.nv-drawing-preview svg image').waitFor({state:'attached'});await expect(block.locator('.nv-drawing-preview>svg')).toBeVisible();
    const frozen=await fingerprint();
    await page.screenshot({path:join(out,'inline-before.png')});
    await block.getByRole('button',{name:'动手画',exact:true}).click();await drawing.locator('canvas.interactive').waitFor();await selectAll();
    await drawing.getByRole('button',{name:'编辑数学图',exact:true}).click();await dialog.locator('[data-status="ready"]').waitFor();
    const slider=dialog.getByRole('slider',{name:'参数 a',exact:true});await slider.press('ArrowRight');await expect(slider).toHaveValue('1.1');
    await dialog.getByRole('button',{name:'修改定义',exact:true}).click();const definition=dialog.getByRole('textbox',{name:'数学图定义',exact:true});await definition.fill((await definition.inputValue())+'\n');await expect(slider).toHaveValue('1.1');
    await dialog.getByRole('button',{name:'应用到白板',exact:true}).click();await expect(dialog).toHaveCount(0);
    await expect.poll(async()=>(await read()).elements[0].customData.notaraMath.values.a).toBe(1.1);
    // Disk visibility can precede the save receipt. Continue from the acknowledged
    // save so a stale opening record cannot silently reset the next edit's base.
    await expect(drawing.getByRole('button',{name:'保存',exact:true})).toBeDisabled();await expect(drawing.locator('.nv-markdown-status')).toBeEmpty();
    assert.equal((await read()).elements[0].type,'embeddable');assert.equal(Object.keys((await read()).files).length,0);
    await selectAll();await drawing.locator('.excalidraw').press('Shift+h');await expect.poll(async()=>{const data=(await read()).elements[0].customData;return {a:data.notaraMath.values.a,scale:data.notaraMathView?.scale?.[0]};}).toEqual({a:1.1,scale:-1});
    await expect(drawing.getByRole('button',{name:'保存',exact:true})).toBeDisabled();await expect(drawing.locator('.nv-markdown-status')).toBeEmpty();await expect(drawing.locator('.nv-markdown-conflict')).toHaveCount(0);
    await drawing.getByRole('button',{name:'编辑数学图',exact:true}).click();await dialog.locator('[data-status="ready"]').waitFor();await dialog.getByRole('slider',{name:'参数 a',exact:true}).press('ArrowRight');await dialog.getByRole('button',{name:'应用到白板',exact:true}).click();await expect(dialog).toHaveCount(0);await expect.poll(async()=>(await read()).elements[0].customData.notaraMath.values.a).toBe(1.2);assert.equal((await read()).elements[0].customData.notaraMathView.scale[0],-1);
    await drawing.getByTitle(/矩形|Rectangle/).first().click();const canvas=await drawing.locator('canvas.interactive').boundingBox();
    await page.mouse.move(canvas.x+canvas.width*.65,canvas.y+canvas.height*.55);await page.mouse.down();await page.mouse.move(canvas.x+canvas.width*.8,canvas.y+canvas.height*.75,{steps:8});await page.mouse.up();await page.keyboard.press('Escape');
    await expect.poll(async()=>(await read()).elements.filter(e=>!e.isDeleted).length).toBe(2);
    await drawing.getByRole('button',{name:'数学图',exact:true}).click();await dialog.getByRole('button',{name:'平面几何',exact:true}).click();await dialog.locator('[data-status="ready"]').waitFor();
    const point=dialog.locator('.nv-block-figure-board svg ellipse').nth(1);await point.waitFor();const p=await point.boundingBox();await page.mouse.move(p.x+p.width/2,p.y+p.height/2);await page.mouse.down();await page.mouse.move(p.x+p.width/2-45,p.y+p.height/2-35,{steps:7});await page.mouse.up();
    await dialog.getByRole('button',{name:'应用到白板',exact:true}).click();await expect(dialog).toHaveCount(0);await expect.poll(async()=>(await read()).elements.filter(e=>!e.isDeleted).length).toBe(3);
    assert.ok((await read()).elements.find(e=>e.customData?.notaraMath?.source.includes('midpoint')).customData.notaraMath.drags.B);
    await drawing.locator('canvas.interactive').click({position:{x:20,y:180}});await page.keyboard.press('Escape');await drawing.getByRole('button',{name:'数学图',exact:true}).click();
    await dialog.getByRole('button',{name:'立体几何',exact:true}).click();const space=dialog.locator('.nv-block-space-svg');await space.waitFor();const b=await space.boundingBox();
    await page.mouse.move(b.x+b.width*.5,b.y+b.height*.5);await page.mouse.down();await page.mouse.move(b.x+b.width*.65,b.y+b.height*.55,{steps:8});await page.mouse.up();
    await page.screenshot({path:join(out,'space-edit.png')});await dialog.getByRole('button',{name:'应用到白板',exact:true}).click();await expect(dialog).toHaveCount(0);
    await expect.poll(async()=>(await read()).elements.filter(e=>!e.isDeleted).length).toBe(4);
    const spaceData=(await read()).elements.find(e=>e.customData?.notaraMath?.source.includes('pyramid')).customData.notaraMath;assert.notEqual(spaceData.camera.yaw,-.72);
    await block.getByRole('button',{name:'结束绘图',exact:true}).click();await block.locator('.nv-drawing-preview svg image').waitFor({state:'attached'});
    assert.equal(await fingerprint(),frozen);
    await page.reload();await block.locator('.nv-drawing-preview svg image').waitFor({state:'attached'});assert.equal(await fingerprint(),frozen);
    await block.getByRole('button',{name:'动手画',exact:true}).click();await drawing.locator('canvas.interactive').waitFor();assert.equal((await read()).elements.length,4);assert.equal((await read()).elements[0].customData.notaraMathView.scale[0],-1);
    await selectAll();await drawing.getByRole('button',{name:'讨论选区',exact:true}).click();await expect(page.locator('[data-composer-input]:visible').first()).toContainText('画布快照');
    await page.screenshot({path:join(out,'inline-edit.png')});
    await block.getByRole('button',{name:'结束绘图',exact:true}).click();
    let release,arrive;const hold=new Promise(r=>release=r),arrived=new Promise(r=>arrive=r);const prior=await readFile(path,'utf8');
    await page.route('**/api/notaraVault/read',async route=>{const response=await route.fetch();arrive();await hold;await route.fulfill({response});},{times:1});
    await block.getByRole('button',{name:'动手画',exact:true}).click();await arrived;
    try{await page.getByRole('button',{name:/新建会话|新会话|New [Ss]ession/}).first().click();await page.locator('[data-composer-input]:visible').waitFor();}finally{release();}
    await page.waitForLoadState('networkidle');await expect(page.locator('.nv-chat-drawing .nv-drawing-editor:visible')).toHaveCount(0);assert.equal(await readFile(path,'utf8'),prior);
    assert.deepEqual(errors,[]);
  }catch(e){await page.screenshot({path:join(out,'failure.png')});await writeFile(join(out,'failure.json'),JSON.stringify({error:e.message,errors,file:await read(),text:(await page.locator('body').innerText()).slice(-4500)},null,2));throw e;}
  finally{await browser.close();await runtime.stop();await rm(fixture,{recursive:true,force:true});}
});
