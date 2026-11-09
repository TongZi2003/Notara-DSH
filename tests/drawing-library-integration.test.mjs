import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {startNativeRuntime,workspaceRoot} from '../scripts/native-runtime.mjs';
import {makeDrawingElements} from '../plugins/vault-sqlite/drawing-sync.js';

test('ExcaliMath search, native/SVG insertion, coauthoring undo and reload preserve the board',{timeout:120000},async()=>{
  const fixture=await mkdtemp(join(workspaceRoot,'work/library-fixture-')),out=join(workspaceRoot,'outputs/excalimath-20261028');await mkdir(out,{recursive:true});
  const original=makeDrawingElements([{kind:'rectangle',x:0,y:0,width:180,height:120}],()=> 'student-original')[0];
  await writeFile(join(fixture,'图形库.excalidraw'),JSON.stringify({type:'excalidraw',version:2,elements:[original],files:{},appState:{viewBackgroundColor:'#ffffff'}}));
  const runtime=await startNativeRuntime({fixture,testModel:true}),browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1414,height:900}});page.setDefaultTimeout(15000);
  const path=join(runtime.vault,'图形库.excalidraw'),read=async()=>JSON.parse(await readFile(path,'utf8')),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const drawing=page.locator('.nv-drawing-editor:visible'),dialog=page.locator('.nv-library-dialog'),search=()=>dialog.getByRole('textbox',{name:'搜索图形'});
  try{
    await page.goto(runtime.authUrl);await page.getByRole('button',{name:/^(Continue|继续)$/}).click();await page.locator('[data-composer-input]:visible').waitFor();await page.waitForLoadState('networkidle');
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('notara:open-document',{detail:{path:'图形库.excalidraw'}})));await drawing.locator('canvas.interactive').waitFor();await page.getByRole('button',{name:'全屏',exact:true}).click();
    await drawing.getByRole('button',{name:'图形库',exact:true}).click();await dialog.locator('.nv-library-thumbnail svg').first().waitFor();await page.screenshot({path:join(out,'library.png')});
    await search().fill('三角形');await expect(dialog.locator('.nv-library-grid>button')).toHaveCount(3);
    await dialog.getByRole('button',{name:'插入直角三角形',exact:true}).click();await expect(dialog).toHaveCount(0);
    await expect.poll(async()=>(await read()).elements.filter(e=>e.customData?.notaraLibrary&&!e.isDeleted).length).toBe(2);
    const first=await read(),triangle=first.elements.filter(e=>e.customData?.notaraLibrary);assert.equal(new Set(triangle.flatMap(e=>e.groupIds)).size,1);assert.equal(first.elements.find(e=>e.id===original.id).width,original.width);
    await drawing.getByRole('button',{name:'图形库',exact:true}).click();await search().fill('AND Gate');await expect(dialog.locator('.nv-library-grid>button')).toHaveCount(2); // AND and NAND
    const teacher=makeDrawingElements([{kind:'text',x:0,y:200,text:'老师追加的说明'}],()=> 'teacher-added')[0];
    await writeFile(path,JSON.stringify({...first,elements:[...first.elements,teacher]}));
    await expect.poll(()=>drawing.locator('.nv-excalidraw-host').getAttribute('data-generation')).not.toBe('0');
    await dialog.getByRole('button',{name:'插入与门',exact:true}).click();await expect(dialog).toHaveCount(0);
    await expect.poll(async()=>(await read()).elements.filter(e=>e.type==='image'&&!e.isDeleted).length).toBe(1);
    const inserted=await read(),image=inserted.elements.find(e=>e.type==='image');assert.ok(inserted.files[image.fileId]);assert.ok(inserted.elements.some(e=>e.id==='teacher-added'));
    await drawing.locator('.excalidraw').press('ControlOrMeta+z');await expect.poll(async()=>(await read()).elements.find(e=>e.id===image.id)?.isDeleted).toBe(true);
    assert.ok((await read()).elements.some(e=>e.id==='teacher-added'&&!e.isDeleted));assert.ok((await read()).elements.some(e=>e.id===original.id&&!e.isDeleted));
    await drawing.locator('.excalidraw').press('ControlOrMeta+Shift+z');await expect.poll(async()=>(await read()).elements.find(e=>e.id===image.id)?.isDeleted).toBe(false);
    await page.reload();await drawing.locator('canvas.interactive').waitFor();await expect(drawing.getByRole('alert')).toHaveCount(0);assert.equal((await read()).files[image.fileId].dataURL,inserted.files[image.fileId].dataURL);
    await page.setViewportSize({width:691,height:746});await drawing.getByRole('button',{name:'图形库',exact:true}).click();await search().fill('与门');await dialog.locator('.nv-library-thumbnail svg image').first().waitFor({state:'attached'});
    const box=await dialog.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=692);await page.screenshot({path:join(out,'library-narrow.png')});
    await dialog.getByRole('button',{name:'关闭图形库',exact:true}).click();await drawing.getByRole('button',{name:'数学图',exact:true}).click();await expect(page.locator('.nv-math-dialog').getByRole('slider').first()).toBeVisible();
    assert.deepEqual(errors,[]);
  }catch(error){await page.screenshot({path:join(out,'failure.png')});await writeFile(join(out,'failure.json'),JSON.stringify({error:error.message,errors,file:await read(),text:(await page.locator('body').innerText()).slice(-4000)},null,2));throw error;}
  finally{await browser.close();await runtime.stop();await rm(fixture,{recursive:true,force:true});}
});
