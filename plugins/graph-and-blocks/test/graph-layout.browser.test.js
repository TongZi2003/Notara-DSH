import {graphSettings,graphView,graphExamples} from './graph-ui.fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium,expect} from '@playwright/test';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

test('dense center labels remain readable, fit includes text, and zoom, pins and full-graph positions survive',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'notara-graph-layout-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';
    import {ForceGraphView} from './src/graph-view.jsx';import css from './src/styles.css';
    const style=document.createElement('style');style.textContent=css;document.head.append(style);
    const root=createRoot(document.getElementById('root'));window.viewState={organization:'all',labelMode:'all',positions:new Map()};
    window.renderGraph=props=>root.render(<ForceGraphView {...props} viewState={window.viewState}/>);`,
    resolveDir:fileURLToPath(new URL('../',import.meta.url)),loader:'jsx'},bundle:true,outfile:join(dir,'fixture.js'),format:'iife',platform:'browser',jsx:'automatic',loader:{'.css':'text'},logLevel:'warning',
    alias:{'@deepseek-ai/dsh-client-ui-primitives':fileURLToPath(new URL('../../../tests/fixtures/modal.jsx',import.meta.url))}});
  await writeFile(join(dir,'fixture.html'),'<meta charset="utf-8"><body style="margin:16px;font:15px system-ui;height:calc(100vh - 32px)"><div id="root" style="height:100%"></div><script src="fixture.js"></script>');
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1400,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route(/^https?:\/\//,route=>route.abort());await page.goto(pathToFileURL(join(dir,'fixture.html')).href);
  const data={nodes:[{path:'导读.md',title:'均值不等式讲义导读',type:'guide'},...Array.from({length:27},(_,i)=>({path:`题目${i+1}.md`,title:`讲义第${i+1}题：正数约束与不等式恒成立`,type:'exercise'}))],edges:[...Array.from({length:27},(_,i)=>({source:'导读.md',target:`题目${i+1}.md`,style:'dashed'})),...Array.from({length:26},(_,i)=>({source:`题目${i+1}.md`,target:`题目${i+2}.md`,style:i%2?'solid':'dashed'}))]};
  const render=props=>page.evaluate(props=>window.renderGraph(props),{data,...props});
  const nodes=page.locator('[data-graph-node]'),canvas=page.locator('.nv-block-graph-canvas');
  const options=async()=>{const b=page.getByRole('button',{name:'图谱选项',exact:true});if(await b.getAttribute('aria-expanded')!=='true')await b.click();};
  const fit=async()=>{await options();await graphSettings(page,true);await page.getByRole('button',{name:'适应当前范围'}).click();await page.getByRole('button',{name:'图谱选项',exact:true}).click();await page.mouse.move(0,0);};
  await render({});await expect(nodes).toHaveCount(27);await page.waitForTimeout(1500);
  const oldPositions=await page.evaluate(()=>[...window.viewState.positions]);
  await render({focusPath:'导读.md'});await expect(nodes).toHaveCount(28);await page.waitForTimeout(1200);await fit();
  const bounds=await canvas.boundingBox(),center=await page.locator('[data-graph-node="导读.md"]>circle').last().boundingBox();
  assert.ok(Math.abs(center.x+center.width/2-bounds.x-bounds.width/2)<2);
  assert.ok(Math.abs(center.y+center.height/2-bounds.y-bounds.height/2)<2);
  assert.deepEqual(await page.evaluate(()=>[...window.viewState.positions]),oldPositions,'center arrangement must not contaminate automatic full-graph coordinates');
  await expect(page.locator('[data-label-hidden="false"]')).toHaveCount(28);
  const titles=await nodes.locator('text').evaluateAll(items=>items.map(item=>{const r=item.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};}));
  for(let i=0;i<titles.length;i++){
    const a=titles[i];assert.ok(a.left>=bounds.x&&a.right<=bounds.x+bounds.width&&a.top>=bounds.y&&a.bottom<=bounds.y+bounds.height,'fit must include the full wrapped title');
    for(let j=i+1;j<titles.length;j++){const b=titles[j];assert.ok(a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top,'visible titles must not overlap');}
  }
  await expect(page.locator('.nv-block-edge')).toHaveCount(data.edges.length);
  const panMeasurements=await canvas.evaluate(async svg=>{
    const original=SVGGraphicsElement.prototype.getBBox;let count=0;
    SVGGraphicsElement.prototype.getBBox=function(...args){count++;return original.apply(this,args);};
    try{const r=svg.getBoundingClientRect();for(let i=0;i<100;i++)svg.dispatchEvent(new WheelEvent('wheel',{clientX:r.x+30,clientY:r.y+30,deltaX:1,deltaY:1,bubbles:true,cancelable:true}));await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));return count;}
    finally{SVGGraphicsElement.prototype.getBBox=original;}
  });assert.equal(panMeasurements,0,'pure panning must not remeasure or repack labels');
  const coordinates=()=>nodes.evaluateAll(items=>items.map(item=>[item.dataset.graphNode,item.getAttribute('transform')]));
  const stable=await coordinates();await page.setViewportSize({width:750,height:950});await page.waitForTimeout(100);assert.deepEqual(await coordinates(),stable,'resize must not rearrange world coordinates');
  await fit();const camera=await canvas.locator(':scope > g').getAttribute('transform');
  await render({focusPath:'导读.md'});await page.waitForTimeout(100);
  assert.deepEqual(await coordinates(),stable,'a later data refresh must preserve the center origin after resize');
  assert.equal(await canvas.locator(':scope > g').getAttribute('transform'),camera);
  await page.setViewportSize({width:1400,height:950});await fit();
  await options();for(let i=0;i<6;i++){await graphSettings(page,true);await page.getByRole('button',{name:'缩小图谱'}).click();}await page.getByRole('button',{name:'图谱选项',exact:true}).click();
  await expect(page.locator('[data-graph-node="导读.md"]')).toHaveAttribute('data-label-hidden','false');
  await expect(page.locator('[data-graph-node="题目1.md"]')).toHaveAttribute('data-label-hidden','true');
  await page.locator('[data-graph-node="题目1.md"]').focus();await expect(page.locator('[data-graph-node="题目1.md"]')).toHaveAttribute('data-label-hidden','false');
  await graphSettings(page);await page.getByRole('searchbox',{name:'搜索图谱'}).fill('第4题');await expect(page.locator('[data-graph-node="题目4.md"]')).toHaveAttribute('data-label-hidden','false');
  await graphSettings(page);await page.getByRole('searchbox',{name:'搜索图谱'}).fill('');await fit();
  const node=page.locator('[data-graph-node="题目1.md"]'),box=await node.locator('circle').last().boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+55,box.y+box.height/2+20,{steps:5});await page.mouse.up();
  const pinned=await page.evaluate(()=>window.viewState.positions.get('题目1.md'));assert.equal(typeof pinned.fx,'number');
  await render({});await expect(nodes).toHaveCount(27);await page.waitForTimeout(1200);
  const matrix=await node.evaluate(el=>{const m=el.transform.baseVal.consolidate().matrix;return {x:m.e,y:m.f};});assert.ok(Math.abs(matrix.x-pinned.fx)<.01&&Math.abs(matrix.y-pinned.fy)<.01);
  await render({focusPath:'导读.md'});await expect(nodes).toHaveCount(28);await fit();
  await options();await graphSettings(page,true);await page.getByRole('button',{name:'释放固定',exact:true}).click();await page.getByRole('button',{name:'图谱选项',exact:true}).click();await page.waitForTimeout(1200);await fit();
  assert.equal(await page.evaluate(()=>window.viewState.positions.get('题目1.md').fx),null);
  const output=(process.env.NOTARA_GRAPH_TEST_OUTPUT?new URL(`file://${process.env.NOTARA_GRAPH_TEST_OUTPUT}/graph-layout/`):new URL('../.test-output/graph-layout/',import.meta.url));await mkdir(output,{recursive:true});await page.screenshot({path:fileURLToPath(new URL('dense-center.png',output))});
  const larger={nodes:[data.nodes[0],...Array.from({length:40},(_,i)=>({path:`fresh${i}.md`,title:`新题目${i}：需要完整阅读的题目标题`,type:'card'}))],edges:Array.from({length:40},(_,i)=>({source:'导读.md',target:`fresh${i}.md`,style:'dashed'}))};
  await page.evaluate(()=>{window.viewState={positions:new Map()};});
  await render({key:'fresh-center',focusPath:'导读.md',data:larger});await expect(nodes).toHaveCount(41);await page.waitForTimeout(1200);
  const fitted=await canvas.evaluate(svg=>{const r=svg.getBoundingClientRect();return [...svg.querySelectorAll('[data-graph-node]>circle:last-of-type')].every(circle=>{const b=circle.getBoundingClientRect();return b.left>=r.left&&b.right<=r.right&&b.top>=r.top&&b.bottom<=r.bottom;});});
  assert.ok(fitted,'first direct center mount must fit automatically without an extra click');
  assert.deepEqual(errors,[]);
});
