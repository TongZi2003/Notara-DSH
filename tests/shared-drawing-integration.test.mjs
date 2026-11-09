import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {startNativeRuntime,workspaceRoot} from '../scripts/native-runtime.mjs';
import {makeDrawingElements} from '../plugins/vault-sqlite/drawing-sync.js';

test('shared drawing keeps human ink, teacher additions, local undo and a frozen image discussion',{timeout:120000},async()=>{
  const fixture=await mkdtemp(join(workspaceRoot,'work/shared-drawing-fixture-')),out=join(workspaceRoot,'outputs/shared-drawing-20261028');await mkdir(out,{recursive:true});
  const initial={type:'excalidraw',version:2,source:'test',elements:makeDrawingElements([{kind:'rectangle',x:0,y:0,width:180,height:120}],()=> 'teacher-original'),appState:{viewBackgroundColor:'#ffffff'},files:{}};
  await writeFile(join(fixture,'共绘.excalidraw'),JSON.stringify(initial));await writeFile(join(fixture,'课堂.canvas'),JSON.stringify({nodes:[{id:'drawing-file',type:'file',file:'共绘.excalidraw',x:0,y:0,width:600,height:450}],edges:[]}));
  const runtime=await startNativeRuntime({fixture,testModel:true,modelFixture:'tests/shared-drawing-model.mjs'}),browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1414,height:900}});page.setDefaultTimeout(12000);
  const path=join(runtime.vault,'共绘.excalidraw'),read=async()=>JSON.parse(await readFile(path,'utf8')),write=doc=>writeFile(path,JSON.stringify(doc,null,2)+'\n'),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const drawing=page.locator('.nv-drawing-editor:visible'),live=()=>drawing.locator('canvas.interactive'),open=path=>page.evaluate(path=>window.dispatchEvent(new CustomEvent('notara:open-document',{detail:{path}})),path);
  const draw=async()=>{await drawing.getByTitle(/矩形|Rectangle/).first().click();const b=await live().boundingBox();await page.mouse.move(b.x+b.width*.72,b.y+b.height*.65);await page.mouse.down();await page.mouse.move(b.x+b.width*.86,b.y+b.height*.78,{steps:8});await page.mouse.up();await page.keyboard.press('Escape');};
  try{
    await page.goto(runtime.authUrl);await page.getByRole('button',{name:/^(Continue|继续)$/}).click();await page.locator('[data-composer-input]:visible').waitFor();await page.waitForLoadState('networkidle');
    const input=page.locator('[data-composer-input]:visible');await input.fill('我们开始画图吧');await input.press('Enter');await page.getByText('我们开始共绘。',{exact:true}).waitFor();
    await open('共绘.excalidraw');await live().waitFor();await page.getByRole('button',{name:'全屏',exact:true}).click();
    await draw();await expect.poll(async()=>(await read()).elements.filter(e=>!e.isDeleted).length).toBe(2);
    const saved=await read(),human=saved.elements.find(e=>e.id!=='teacher-original');assert.ok(human);assert.ok(human.width>50&&human.height>50,'a completed shape, not its initial pointerdown size, must persist');
    const canvasIdentity=await live().getAttribute('class');
    const teacher=makeDrawingElements([{kind:'text',x:0,y:180,text:'老师新增：请画一条切线'}],()=> 'teacher-added')[0];await write({...saved,elements:[...saved.elements,teacher]});
    await expect.poll(()=>drawing.locator('.nv-excalidraw-host').getAttribute('data-generation')).not.toBe('0');
    await expect(drawing.getByRole('button',{name:'保存',exact:true})).toBeDisabled();assert.equal(await live().getAttribute('class'),canvasIdentity);
    await drawing.locator('.excalidraw').press('ControlOrMeta+z');
    await expect.poll(async()=>(await read()).elements.find(e=>e.id===human.id)?.isDeleted).toBe(true);
    assert.equal((await read()).elements.find(e=>e.id==='teacher-added').isDeleted,false,'undo must keep the teacher addition');
    await drawing.locator('.excalidraw').press('ControlOrMeta+Shift+z');await expect.poll(async()=>(await read()).elements.find(e=>e.id===human.id)?.isDeleted).toBe(false);
    await page.keyboard.press('ControlOrMeta+a');await drawing.getByRole('button',{name:'讨论选区',exact:true}).click();
    const draft=page.locator('[data-composer-input]:visible').first();await expect(draft).toContainText('画布快照');const frozen=await draft.innerText();assert.ok(frozen.includes('teacher-added'));
    const later=await read();later.elements.push(makeDrawingElements([{kind:'ellipse',x:400,y:0,width:80,height:80}],()=> 'after-snapshot')[0]);await write(later);
    assert.equal(await draft.innerText(),frozen,'snapshot text cannot follow subsequent live updates');
    await page.screenshot({path:join(out,'snapshot-draft.png')});
    await draft.press('Enter');await page.getByText('已收到画布快照图片和版本说明。',{exact:true}).waitFor();
    await open('课堂.canvas');await page.locator('.nv-flow-node-content .nv-drawing-preview svg').waitFor();const preview=page.locator('.nv-flow-node-content .nv-drawing-preview svg');await expect(preview).toContainText('老师新增');
    const newer=await read();newer.elements.find(e=>e.id==='teacher-added').text='预览也同步了';newer.elements.find(e=>e.id==='teacher-added').originalText='预览也同步了';newer.elements.find(e=>e.id==='teacher-added').version++;await write(newer);
    await expect(preview).toContainText('预览也同步了');
    await page.screenshot({path:join(out,'canvas-preview.png')});assert.deepEqual(errors,[]);
  }catch(error){await page.screenshot({path:join(out,'failure.png')});await writeFile(join(out,'failure.json'),JSON.stringify({errors,file:await read(),text:(await page.locator('body').innerText()).slice(-5000)},null,2));throw error;}finally{await browser.close();await runtime.stop();await rm(fixture,{recursive:true,force:true});}
});

test('a delayed save receipt arriving during the next stroke cannot erase teacher additions',{timeout:90000},async()=>{
  const fixture=await mkdtemp(join(workspaceRoot,'work/shared-drawing-race-'));
  await writeFile(join(fixture,'竞争.excalidraw'),JSON.stringify({type:'excalidraw',version:2,elements:[],files:{},appState:{viewBackgroundColor:'#ffffff'}}));
  const runtime=await startNativeRuntime({fixture,testModel:true}),browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1414,height:900}});page.setDefaultTimeout(10000);
  const path=join(runtime.vault,'竞争.excalidraw'),read=async()=>JSON.parse(await readFile(path,'utf8'));let release;
  try{
    await page.goto(runtime.authUrl);await page.getByRole('button',{name:/^(Continue|继续)$/}).click();await page.locator('[data-composer-input]:visible').waitFor();await page.waitForLoadState('networkidle');
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('notara:open-document',{detail:{path:'竞争.excalidraw'}})));const drawing=page.locator('.nv-drawing-editor:visible');await drawing.locator('canvas.interactive').waitFor();await page.getByRole('button',{name:'全屏',exact:true}).click();
    let captured;const arrived=new Promise(r=>captured=r),hold=new Promise(r=>release=r);let intercepted=false;
    await page.route('**/api/notaraVault/drawingCommit',async route=>{
      if(intercepted){await route.continue();return;}intercepted=true;
      const file=await read();file.elements.push(makeDrawingElements([{kind:'text',x:0,y:0,text:'老师在保存期间补的内容'}],()=> 'teacher-race')[0]);await writeFile(path,JSON.stringify(file));
      const response=await route.fetch();captured();await hold;await route.fulfill({response});
    });
    const box=await drawing.locator('canvas.interactive').boundingBox();
    await drawing.getByTitle(/矩形|Rectangle/).first().click();await page.mouse.move(box.x+box.width*.5,box.y+box.height*.35);await page.mouse.down();await page.mouse.move(box.x+box.width*.6,box.y+box.height*.48,{steps:6});await page.mouse.up();await page.keyboard.press('Escape');await arrived;
    await drawing.getByTitle(/椭圆|Ellipse/).first().click();await page.mouse.move(box.x+box.width*.72,box.y+box.height*.3);await page.mouse.down();await page.mouse.move(box.x+box.width*.76,box.y+box.height*.35,{steps:5});
    release();await expect(drawing.getByRole('button',{name:'保存',exact:true})).toBeEnabled();
    await page.mouse.move(box.x+box.width*.84,box.y+box.height*.46,{steps:8});await page.mouse.up();await page.keyboard.press('Escape');
    await expect.poll(async()=>(await read()).elements.filter(e=>!e.isDeleted).length).toBe(3);
    const result=await read();assert.ok(result.elements.some(e=>e.id==='teacher-race'&&!e.isDeleted));assert.ok(result.elements.find(e=>e.type==='ellipse').width>50);
    await expect(drawing.getByRole('alert')).toHaveCount(0);
  }finally{release?.();await browser.close();await runtime.stop();await rm(fixture,{recursive:true,force:true});}
});
