import {graphSettings,graphView,graphExamples} from './graph-ui.fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium,expect} from '@playwright/test';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

test('full source clusters fit, retain shared and cross-source identities, and yield to filtering and explicit centers',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'notara-source-clusters-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';
    import {ForceGraphView} from './src/graph-view.jsx';import css from './src/styles.css';
    const style=document.createElement('style');style.textContent=css;document.head.append(style);
    const root=createRoot(document.getElementById('root'));window.state={organization:'all',positions:new Map()};
    window.renderGraph=props=>root.render(<ForceGraphView {...props} viewState={window.state} onBring={()=>{}}/>);`,
    resolveDir:fileURLToPath(new URL('../',import.meta.url)),loader:'jsx'},bundle:true,outfile:join(dir,'fixture.js'),format:'iife',platform:'browser',jsx:'automatic',loader:{'.css':'text'},logLevel:'warning',alias:{'@deepseek-ai/dsh-client-ui-primitives':fileURLToPath(new URL('../../../tests/fixtures/modal.jsx',import.meta.url))}});
  await writeFile(join(dir,'fixture.html'),'<meta charset="utf-8"><body style="margin:16px;font:15px system-ui"><div id="root"></div><script src="fixture.js"></script>');
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1400,height:950}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route(/^https?:\/\//,route=>route.abort());await page.goto(pathToFileURL(join(dir,'fixture.html')).href);
  const nodes=[{path:'A.pdf',title:'均值不等式讲义',type:'pdf',isSource:true},{path:'B.pdf',title:'函数专题资料',type:'pdf',isSource:true},{path:'C.md',title:'数列原始笔记',type:'source',isSource:true}];
  const edges=[];
  for(const [letter,count] of [['A',16],['B',12],['C',4]])for(let i=0;i<count;i++){
    const source=letter==='C'?'C.md':letter+'.pdf',path=letter+i+'.md';
    nodes.push({path,title:`${letter}第${i+1}题：条件与解题方法`,type:'exercise',sourcePaths:[source]});edges.push({source:path,target:source,style:'dashed'});
  }
  nodes.push({path:'shared.md',title:'跨资料的共同方法',type:'method',sourcePaths:['A.pdf','B.pdf']});
  edges.push({source:'shared.md',target:'A.pdf',style:'dashed'},{source:'shared.md',target:'B.pdf',style:'dashed'},{source:'A0.md',target:'B0.md',style:'solid'});
  for(let i=0;i<4;i++)nodes.push({path:`u${i}.md`,title:`尚未记录来源${i}`,type:'card',sourcePaths:[]});
  nodes.push({path:'日记.md',title:'今日日记',type:'diary'});edges.push({source:'日记.md',target:'A0.md',style:'dashed'},{source:'日记.md',target:'B0.md',style:'dashed'});
  const data={nodes,edges},render=props=>page.evaluate(props=>window.renderGraph(props),{data,...props});
  const canvas=page.locator('.nv-block-graph-canvas'),items=page.locator('[data-graph-node]');
  const options=async()=>{const button=page.getByRole('button',{name:'图谱选项',exact:true});if(await button.getAttribute('aria-expanded')!=='true')await button.click();};
  await render({});await expect(canvas).toHaveAttribute('data-layout','source-clusters');await expect(items).toHaveCount(40);await page.waitForTimeout(1200);
  await expect(page.locator('.nv-graph-cluster-backdrop[data-source-path]')).toHaveCount(3);
  await expect(page.locator('[data-graph-node="shared.md"]')).toHaveCount(1);
  await expect(page.locator('.nv-block-edge')).toHaveCount(edges.length-2);await expect(page.locator('.nv-block-edge-solid')).toHaveCount(1);
  for(const source of ['A.pdf','B.pdf','C.md'])await expect(page.locator(`.nv-graph-cluster-backdrop[data-source-path="${source}"] .nv-graph-cluster-heading`)).toBeVisible();
  const aCluster=page.locator('.nv-graph-cluster-backdrop[data-source-path="A.pdf"]'),bCluster=page.locator('.nv-graph-cluster-backdrop[data-source-path="B.pdf"]');
  await expect(aCluster).toHaveAttribute('aria-label','展开均值不等式讲义，17 张卡片 · 共享 1');
  await expect(bCluster).toHaveAttribute('aria-label','展开函数专题资料，13 张卡片 · 共享 1');
  await expect(page.locator('[data-relation-kind="source"]')).toHaveCount(34);await expect(page.locator('[data-relation-kind="knowledge"]')).toHaveCount(1);
  assert.notEqual(await page.locator('[data-relation-kind="source"]').first().evaluate(el=>getComputedStyle(el).stroke),await page.locator('[data-relation-kind="knowledge"]').first().evaluate(el=>getComputedStyle(el).stroke));
  await aCluster.locator('.nv-graph-cluster-heading').hover();await expect(page.locator('[data-graph-node="shared.md"]')).toHaveClass(/nv-graph-shared-highlight/);
  await expect(page.locator('[data-graph-node="B0.md"]')).toHaveClass(/nv-graph-node-muted/);
  await page.mouse.move(0,0);
  const clearHeadings=await canvas.evaluate(svg=>{const headings=[...svg.querySelectorAll('.nv-graph-cluster-heading')].map(el=>el.getBoundingClientRect()),labels=[...svg.querySelectorAll('[data-label-hidden="false"]>text')].map(el=>el.getBoundingClientRect());return labels.every(a=>headings.every(b=>a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top));});assert.ok(clearHeadings,'ordinary labels must leave cluster headings readable');
  const clearPoint=()=>aCluster.locator('ellipse').evaluate(el=>{const r=el.getBoundingClientRect(),group=el.closest('[data-cluster-key]');for(const x of [.25,.4,.6,.75])for(const y of [.25,.4,.6,.75]){const p={x:r.x+r.width*x,y:r.y+r.height*y};if(document.elementFromPoint(p.x,p.y)?.closest('[data-cluster-key]')===group)return p;}throw new Error('No background hit point');});
  const modifierPoint=await clearPoint();await page.keyboard.down('Control');await page.mouse.click(modifierPoint.x,modifierPoint.y);await page.keyboard.up('Control');await expect(canvas).toHaveAttribute('data-layout','source-clusters');
  await options();await graphSettings(page,true);await page.getByRole('button',{name:'框选资料',exact:true}).click();const selectingPoint=await clearPoint();await page.mouse.click(selectingPoint.x,selectingPoint.y);await expect(page.getByRole('button',{name:'返回资料概览',exact:true})).toHaveCount(0);
  await options();await page.getByRole('button',{name:'退出框选',exact:true}).click();
  const point=await clearPoint();await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x+40,point.y+25,{steps:5});await page.mouse.up();
  await expect(canvas).toHaveAttribute('data-layout','source-clusters');await expect(page.getByRole('button',{name:'返回资料概览',exact:true})).toHaveCount(0);await page.waitForTimeout(550);
  const cameraBefore=await canvas.locator(':scope > g').getAttribute('transform');
  const clickPoint=await clearPoint();await page.mouse.click(clickPoint.x,clickPoint.y);
  await expect(page.getByRole('button',{name:'返回资料概览',exact:true})).toBeVisible();await expect(items).toHaveCount(1);await expect(page.locator('[data-graph-node="shared.md"]')).toHaveCount(1);
  await page.getByRole('button',{name:'返回资料概览',exact:true}).click();await expect(items).toHaveCount(40);await expect(canvas.locator(':scope > g')).toHaveAttribute('transform',cameraBefore);
  await bCluster.focus();await page.keyboard.press('Enter');await expect(items).toHaveCount(1);await expect(page.locator('[data-graph-node="shared.md"]')).toHaveCount(1);
  await page.getByRole('button',{name:'返回资料概览',exact:true}).click();await expect(items).toHaveCount(40);
  await options();await graphSettings(page,true);await page.getByRole('button',{name:'适应当前范围'}).click();await page.getByRole('button',{name:'图谱选项',exact:true}).click();await page.mouse.move(0,0);
  const bounds=await canvas.boundingBox(),circles=await page.locator('.nv-graph-cluster-backdrop ellipse').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,x:r.x+r.width/2,y:r.y+r.height/2,r:r.width/2};}));
  for(let i=0;i<circles.length;i++){
    const a=circles[i];assert.ok(a.left>=bounds.x&&a.right<=bounds.x+bounds.width&&a.top>=bounds.y&&a.bottom<=bounds.y+bounds.height,'cluster backdrops fit without an extra click');
    for(let j=i+1;j<circles.length;j++)assert.ok(Math.hypot(a.x-circles[j].x,a.y-circles[j].y)>=a.r+circles[j].r,'source groups stay separated');
  }
  const coordinates=()=>items.evaluateAll(els=>els.map(el=>[el.dataset.graphNode,el.getAttribute('transform')]));
  const stable=await coordinates();await page.setViewportSize({width:750,height:950});await render({});await page.waitForTimeout(150);assert.deepEqual(await coordinates(),stable,'resize and refresh retain the global origin');
  await page.setViewportSize({width:1400,height:950});await options();await graphSettings(page,true);await page.getByRole('button',{name:'适应当前范围'}).click();await page.getByRole('button',{name:'图谱选项',exact:true}).click();await page.mouse.move(0,0);
  const out=(process.env.NOTARA_GRAPH_TEST_OUTPUT?new URL(`file://${process.env.NOTARA_GRAPH_TEST_OUTPUT}/source-clusters/`):new URL('../.test-output/source-clusters/',import.meta.url));await mkdir(out,{recursive:true});await page.screenshot({path:fileURLToPath(new URL('full.png',out))});
  const anchors=()=>page.locator('.nv-graph-cluster-backdrop ellipse').evaluateAll(els=>els.map(el=>[el.getAttribute('cx'),el.getAttribute('cy')]));
  const beforeDrag=await anchors(),source=page.locator('[data-graph-node="A.pdf"]'),sourceBox=await source.locator('.nv-block-node-shape').boundingBox();
  await page.mouse.move(sourceBox.x+sourceBox.width/2,sourceBox.y+sourceBox.height/2);await page.mouse.down();await page.mouse.move(sourceBox.x+90,sourceBox.y+70,{steps:5});await page.mouse.up();
  const pin=await page.evaluate(()=>window.state.positions.get('A.pdf'));assert.equal(typeof pin.fx,'number');
  await render({});await page.waitForTimeout(150);assert.deepEqual(await anchors(),beforeDrag,'refresh must not move an entire source cluster after one node was dragged');
  const moved=await source.evaluate(el=>{const m=el.transform.baseVal.consolidate().matrix;return [m.e,m.f];});assert.ok(Math.abs(moved[0]-pin.fx)<.01&&Math.abs(moved[1]-pin.fy)<.01);
  await options();await page.getByRole('combobox',{name:'图谱资料类型'}).selectOption('cards');await expect(page.locator('.nv-graph-cluster-backdrop')).toHaveCount(0);await expect(items).toHaveCount(37);
  await page.getByRole('combobox',{name:'图谱资料类型'}).selectOption('all');await expect(canvas).toHaveAttribute('data-layout','source-clusters');
  await page.getByRole('button',{name:'中心节点',exact:true}).click();const dialog=page.getByRole('dialog',{name:'中心节点',exact:true});
  await dialog.getByRole('searchbox',{name:'查找中心资料'}).fill('日记');await dialog.getByRole('checkbox',{name:'中心资料 今日日记',exact:true}).check();await dialog.getByRole('button',{name:'应用',exact:true}).click();
  await expect(canvas).toHaveAttribute('data-layout','center');await expect(items).toHaveCount(3);await expect(page.locator('.nv-graph-cluster-backdrop')).toHaveCount(0);
  await options();await page.getByRole('button',{name:'退出中心',exact:true}).click();await graphView(page,'all');await expect(canvas).toHaveAttribute('data-layout','source-clusters');await expect(items).toHaveCount(40);
  await render({allowedPaths:['A0.md','B0.md','shared.md']});await expect(items).toHaveCount(3);await expect(page.locator('.nv-graph-cluster-backdrop')).toHaveCount(0);await expect(page.locator('.nv-graph-node-source')).toHaveCount(0); // No out-of-scope source node.
  assert.deepEqual(errors,[]);
});
