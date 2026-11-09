import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {startNativeRuntime,workspaceRoot} from '../scripts/native-runtime.mjs';
test('Canvas exposes marquee, click-to-connect, searchable files and create-and-add formats',{timeout:120000},async()=>{
  const fixture=await mkdtemp(join(workspaceRoot,'work/canvas-tools-fixture-')),out=join(workspaceRoot,'outputs/shared-drawing-20261028');await mkdir(out,{recursive:true});
  await writeFile(join(fixture,'操作.canvas'),JSON.stringify({nodes:[{id:'a',type:'text',text:'# 题设',x:0,y:0,width:300,height:220},{id:'b',type:'text',text:'# 推导',x:360,y:0,width:300,height:220}],edges:[]}));await writeFile(join(fixture,'可搜索的笔记.md'),'# 搜索命中');
  const runtime=await startNativeRuntime({fixture,testModel:true}),browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1414,height:900}});page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
    await page.goto(runtime.authUrl);await page.getByRole('button',{name:/^(Continue|继续)$/}).click();await page.locator('[data-composer-input]:visible').waitFor();await page.waitForLoadState('networkidle');
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('notara:open-document',{detail:{path:'操作.canvas'}})));await page.locator('.react-flow__node').first().waitFor();await page.getByRole('button',{name:'全屏',exact:true}).click();
    const canvas=page.locator('.nv-canvas-editor:visible'),nodes=canvas.locator('.react-flow__node');
    await canvas.getByRole('button',{name:'框选',exact:true}).click();const a=await nodes.nth(0).boundingBox(),b=await nodes.nth(1).boundingBox();
    await page.mouse.move(Math.min(a.x,b.x)-15,Math.min(a.y,b.y)-15);await page.mouse.down();await page.mouse.move(Math.max(a.x+a.width,b.x+b.width)+15,Math.max(a.y+a.height,b.y+b.height)+15,{steps:10});await page.mouse.up();await expect(canvas.locator('.react-flow__node.selected')).toHaveCount(2);
    await canvas.getByRole('button',{name:'更多白板工具'}).click();await page.getByRole('menuitem',{name:'分组',exact:true}).click();await expect(canvas.locator('.nv-flow-group')).toHaveCount(1);await canvas.getByRole('button',{name:'撤销',exact:true}).click();await expect(nodes).toHaveCount(2);
    await canvas.getByRole('button',{name:'连线',exact:true}).click();await nodes.filter({hasText:'题设'}).locator('.nv-flow-node-header').click();await nodes.filter({hasText:'推导'}).locator('.nv-flow-node-header').click();await expect(canvas.locator('.react-flow__edge')).toHaveCount(1);
    await canvas.getByRole('button',{name:'添加文件',exact:true}).click();const picker=page.getByRole('dialog',{name:'添加文件到 Canvas'});await picker.getByRole('textbox',{name:'搜索文件名或路径'}).fill('可搜索');await expect(picker.locator('.nv-canvas-picker-results button')).toHaveCount(1);await picker.locator('.nv-canvas-picker-results button').click();await expect(nodes).toHaveCount(3);
    for(const [kind,label] of [['md','Markdown 文档'],['canvas','Canvas 白板'],['excalidraw','Excalidraw 共绘'],['base','资料库视图']]){
      await canvas.getByRole('button',{name:'添加文件',exact:true}).click();await picker.getByRole('button',{name:'新建文件',exact:true}).click();await picker.getByRole('textbox',{name:'新文件名称'}).fill(`画布内新建-${kind}`);await picker.getByRole('button',{name:'新建文件类型'}).click();await page.getByRole('menuitem',{name:label,exact:true}).click();await picker.getByRole('button',{name:'创建并添加'}).click();await expect(picker).toBeHidden();assert.ok((await readFile(join(runtime.vault,`画布内新建-${kind}.${kind}`),'utf8')).length);
    }
    await expect(nodes).toHaveCount(7);await canvas.getByRole('button',{name:'保存',exact:true}).click();await expect.poll(async()=>JSON.parse(await readFile(join(runtime.vault,'操作.canvas'),'utf8')).edges.length).toBe(1);const saved=JSON.parse(await readFile(join(runtime.vault,'操作.canvas'),'utf8'));assert.equal(saved.edges[0].fromNode,'a');assert.equal(saved.edges[0].toNode,'b');
    await canvas.getByRole('button',{name:'添加文件',exact:true}).click();await picker.getByRole('textbox',{name:'搜索文件名或路径'}).fill('excalidraw');await expect(picker.locator('.nv-canvas-picker-results button')).toHaveCount(1);await page.screenshot({path:join(out,'canvas-file-picker.png')});
    assert.deepEqual(errors,[]);
  }catch(error){await page.screenshot({path:join(out,'canvas-tools-failure.png')});throw error;}finally{await browser.close();await runtime.stop();await rm(fixture,{recursive:true,force:true});}
});
