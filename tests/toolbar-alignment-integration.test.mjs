import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {startNativeRuntime,workspaceRoot} from '../scripts/native-runtime.mjs';
import {openLibrary} from '../scripts/ui-navigation.mjs';
import {EMPTY_DRAWING} from '../plugins/vault-sqlite/drawing-files.js';

test('all material top bars share the native 38px row in split, narrow and exclusive layouts',{timeout:120000},async()=>{
  const runtime=await startNativeRuntime({testModel:true}),browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1414,height:850}}),errors=[],measurements=[];
  const out=join(workspaceRoot,'outputs/unified-toolbars-20261028');await mkdir(out,{recursive:true});
  await writeFile(join(runtime.vault,'对齐检查.excalidraw'),EMPTY_DRAWING);
  page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
  const openDoc=path=>page.evaluate(path=>window.dispatchEvent(new CustomEvent('notara:open-document',{detail:{path}})),path);
  const check=async(label,selector)=>{
    const root=page.locator(selector+':visible'),bar=root.locator('.nv-surface-toolbar').first();await expect(bar).toBeVisible();
    await expect.poll(async()=>Math.round((await bar.boundingBox())?.height??0)).toBe(38);
    await expect.poll(async()=>Math.round((await bar.boundingBox())?.y??-1)).toBe(38);
    const dimensions=await bar.evaluate(el=>{const r=el.getBoundingClientRect();return{height:r.height,bottom:r.bottom,width:r.width,overflow:el.scrollWidth>el.clientWidth,controls:[...el.querySelectorAll('button,input,select')].map(n=>n.getBoundingClientRect()).filter(b=>b.width&&b.height).every(b=>b.top>=r.top-1&&b.bottom<=r.bottom+1&&b.left>=r.left-1&&b.right<=r.right+1)};});
    assert.equal(dimensions.overflow,false,label);assert.equal(dimensions.controls,true,label);assert.equal(Math.round(dimensions.bottom),76,label);
    if(label.includes('Canvas')||label.includes('Excalidraw')){await expect(root.locator('.nv-document-editbar')).toHaveCount(0);await expect(root.getByRole('button',{name:'保存',exact:true})).toHaveCount(1);}
    if(label.includes('Excalidraw')){const tools=root.locator('.excalidraw .App-toolbar-container');await expect(tools).toBeVisible();const host=await root.locator('.nv-excalidraw-host').boundingBox(),box=await tools.boundingBox();assert.ok(box.x>=host.x-1&&box.x+box.width<=host.x+host.width+1,JSON.stringify({host,box}));}
    measurements.push({label,...dimensions});
  };
  try{
    await page.goto(runtime.authUrl);await page.getByRole('button',{name:/^(Continue|继续)$/}).click();await page.locator('[data-composer-input]:visible').waitFor();await page.waitForLoadState('networkidle');
    await page.locator('[data-composer-input]').fill('顶栏对齐检查');await page.locator('[data-composer-input]').press('Enter');await page.locator('section.nv-block-flow:visible').waitFor();await expect(page.getByRole('button',{name:/^(Stop generating|停止生成)$/})).toHaveCount(0);
    for(const width of [1414,755]){
      await page.setViewportSize({width,height:850});
      const cases=[['Markdown','卡片/奇异值分解SVD的几何意义与构造推导.md','.nv-vault-doc-tab'],['PDF','来源/集成测试讲义.pdf','.nv-vault-doc-tab'],['Canvas','白板/SVD几何与推导白板.canvas','.nv-vault-doc-tab'],['Excalidraw','对齐检查.excalidraw','.nv-vault-doc-tab']];
      for(const [name,path,selector] of cases){await openDoc(path);await expect(page.locator(selector+':visible')).toBeVisible();if(name==='PDF')await page.locator('.nv-vault-pdf-layer:visible').waitFor();else await expect(page.locator(selector+':visible .nv-vault-doc-path')).toHaveAttribute('title',path);await check(`${name}-${width}`,selector);await page.screenshot({path:join(out,`${name}-${width}.png`)});}
      await openLibrary(page);await check(`Library-${width}`,'.nv-base-workspace');
      await page.evaluate(()=>window.dispatchEvent(new CustomEvent('notara:open-graph',{detail:{}})));await check(`Graph-${width}`,'.nv-independent-graph');
      await page.getByRole('button',{name:'图谱选项',exact:true}).click();await expect(page.getByRole('combobox',{name:'图谱资料类型',exact:true})).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('combobox',{name:'图谱资料类型',exact:true})).toBeHidden();
      await page.evaluate(()=>window.dispatchEvent(new CustomEvent('notara:open-calendar')));await check(`Calendar-${width}`,'.nc-calendar');
    }
    await page.getByRole('button',{name:'全屏',exact:true}).click();await check('Calendar-exclusive','.nc-calendar');
    await page.screenshot({path:join(out,'calendar-exclusive.png')});await writeFile(join(out,'measurements.json'),JSON.stringify(measurements,null,2));assert.deepEqual(errors,[]);
  }catch(error){await page.screenshot({path:join(out,'failure.png')});throw error;}finally{await browser.close();await runtime.stop();}
});
