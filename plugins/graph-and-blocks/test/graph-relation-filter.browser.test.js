import {graphSettings,graphView,graphExamples} from './graph-ui.fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium,expect} from '@playwright/test';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

test('relation filters preserve source hierarchy, shared identity, camera, scope and state through refresh',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'notara-relation-filter-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';
    import {ForceGraphView} from './src/graph-view.jsx';import css from './src/styles.css';
    const style=document.createElement('style');style.textContent=css;document.head.append(style);
    const root=createRoot(document.getElementById('root'));window.state={organization:'all',positions:new Map()};
    window.renderGraph=(data,extra={})=>{window.data=data;root.render(<ForceGraphView data={data} viewState={window.state} {...extra}/>);};`,
    resolveDir:fileURLToPath(new URL('../',import.meta.url)),loader:'jsx'},bundle:true,outfile:join(dir,'fixture.js'),format:'iife',platform:'browser',jsx:'automatic',loader:{'.css':'text'},logLevel:'warning',
    alias:{'@deepseek-ai/dsh-client-ui-primitives':fileURLToPath(new URL('../../../tests/fixtures/modal.jsx',import.meta.url))}});
  await writeFile(join(dir,'fixture.html'),'<meta charset="utf-8"><body style="margin:16px;font:15px system-ui"><div id="root"></div><script src="fixture.js"></script>');
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1400,height:900}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));await page.route(/^https?:\/\//,route=>route.abort());await page.goto(pathToFileURL(join(dir,'fixture.html')).href);
  const data={nodes:[{path:'讲义.pdf',title:'不等式讲义（一）',type:'pdf',isSource:true},{path:'均值.md',title:'均值不等式',type:'concept'},
    {path:'柯西.md',title:'柯西不等式',type:'concept'},...Array.from({length:5},(_,i)=>({path:`题${i+1}.md`,title:`题 ${i+1}`,type:'exercise',sourcePaths:['讲义.pdf']})),
    {path:'日记.md',title:'今天的日记',type:'diary'}],edges:[]};
  for(let i=1;i<=5;i++)data.edges.push({source:`题${i}.md`,target:'讲义.pdf',style:'dashed',knowledge:false});
  for(const [topic,items] of [['均值.md',[1,2,3]],['柯西.md',[3,4,5]]])for(const i of items)data.edges.push({source:topic,target:`题${i}.md`,style:topic==='均值.md'&&i===3?'solid':'dashed',knowledge:true,support:'hint'});
  data.edges.push({source:'日记.md',target:'题3.md',style:'solid',knowledge:false});
  await page.evaluate(data=>window.renderGraph(data),data);
  const canvas=page.locator('.nv-block-graph-canvas'),filter=page.getByRole('combobox',{name:'知识联系筛选',exact:true});
  // Playwright :visible treats a horizontal SVG line as zero-height even when
  // its stroke is drawn. Count the actual visibility flag instead.
  const knowledge=page.locator('line[data-relation-kind="knowledge"]:not([aria-hidden="true"])'),source=page.locator('line[data-relation-kind="source"]:not([aria-hidden="true"])');
  await expect(canvas).toHaveAttribute('data-layout','source-clusters');await expect(knowledge).toHaveCount(6);await expect(source).toHaveCount(5);
  const cluster=page.locator('.nv-graph-cluster-backdrop[data-source-path="讲义.pdf"]');await cluster.focus();await page.keyboard.press('Enter');
  await expect(canvas).toHaveAttribute('data-layout','source-hierarchy');await expect(page.locator('[data-graph-node]')).toHaveCount(2);
  await expect(knowledge).toHaveCount(0);await expect(source).toHaveCount(0);
  await page.waitForTimeout(1200);
  // Manual pins must survive a visibility switch without being repositioned.
  for(const path of ['均值.md','柯西.md']){
    const node=page.locator(`[data-graph-node="${path}"]>circle:not(.nv-block-node-focus)`),box=await node.boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+24,box.y+box.height/2+10,{steps:4});await page.mouse.up();
  }
  const camera=await canvas.locator(':scope > g').getAttribute('transform'),pins=await page.evaluate(()=>[...window.state.positions].filter(([,p])=>p.fx!=null));
  await graphSettings(page);await filter.selectOption('established');await expect(knowledge).toHaveCount(0);
  await expect(source).toHaveCount(0);
  for(const line of await page.locator('[data-graph-edge][aria-hidden="true"]').all())await expect(line).toHaveCSS('display','none');
  await expect(page.locator('.nv-graph-source-branch:not([aria-hidden="true"])')).toHaveCount(0);await expect(page.locator('[data-graph-node="题3.md"]')).toHaveCount(0);
  await expect(canvas.locator(':scope > g')).toHaveAttribute('transform',camera);assert.deepEqual(await page.evaluate(()=>[...window.state.positions].filter(([,p])=>p.fx!=null)),pins);
  const output=(process.env.NOTARA_GRAPH_TEST_OUTPUT?new URL(`file://${process.env.NOTARA_GRAPH_TEST_OUTPUT}/graph-relation-filter/`):new URL('../.test-output/graph-relation-filter/',import.meta.url));await mkdir(output,{recursive:true});await page.mouse.move(0,0);await page.screenshot({path:fileURLToPath(new URL('established.png',output))});
  await page.waitForTimeout(550); // Existing drag-click suppression lasts 500 ms.
  await page.locator('[data-graph-node="均值.md"]>circle:not(.nv-block-node-focus)').click();
  await expect(page.getByRole('complementary',{name:'选中节点'})).toBeVisible();
  await graphExamples(page);await expect(page.getByRole('region',{name:'具体例子',exact:true}).getByRole('listitem')).toHaveCount(3);
  await graphSettings(page);await filter.selectOption('potential');await expect(knowledge).toHaveCount(0);await expect(page.locator('.nv-block-edge-solid:not([aria-hidden="true"])')).toHaveCount(0);
  await expect(source).toHaveCount(0);
  await page.getByRole('button',{name:'取消节点选择',exact:true}).click();await page.mouse.move(0,0);await page.screenshot({path:fileURLToPath(new URL('potential.png',output))});
  await expect(canvas.locator(':scope > g')).toHaveAttribute('transform',camera);
  await page.getByRole('button',{name:'返回资料概览',exact:true}).click();await expect(cluster).toBeFocused();await graphSettings(page);await expect(filter).toHaveValue('potential');await expect(knowledge).toHaveCount(5);await expect(source).toHaveCount(5);
  // The explicit full view still exposes every real case/provenance edge and
  // filters its evidence state without moving or duplicating the shared case.
  await page.locator('[data-graph-node="题3.md"]>circle:not(.nv-block-node-focus)').click();
  await expect(page.locator('[data-graph-node="均值.md"]')).toHaveClass(/nv-graph-node-muted/);await expect(page.locator('[data-graph-node="柯西.md"]')).not.toHaveClass(/nv-graph-node-muted/);
  await graphSettings(page);await filter.selectOption('established');await expect(knowledge).toHaveCount(1);await expect(knowledge).toHaveClass(/nv-block-edge-solid/);
  await expect(source).toHaveCount(5);await expect(page.locator('[data-graph-node="题3.md"]')).toHaveCount(1);
  await expect(page.locator('[data-graph-node="均值.md"]')).not.toHaveClass(/nv-graph-node-muted/);await expect(page.locator('[data-graph-node="柯西.md"]')).toHaveClass(/nv-graph-node-muted/);
  await graphSettings(page);await filter.selectOption('potential');
  // Remount with the same view state, then apply a live fact update.
  await page.evaluate(()=>window.renderGraph(window.data,{key:'reopened'}));
  await expect(page.getByRole('button',{name:'图谱选项',exact:true})).toHaveAttribute('aria-expanded','false');
  await graphSettings(page);await expect(filter).toHaveValue('potential');
  await page.evaluate(()=>window.renderGraph({...window.data,edges:window.data.edges.map(e=>e.knowledge?{...e,style:'solid'}:e)},{key:'reopened'}));
  await expect(knowledge).toHaveCount(0);await expect(filter.locator('option:checked')).toHaveText('潜在／待建立');
  await graphSettings(page);await filter.selectOption('established');await expect(knowledge).toHaveCount(6);
  await page.getByRole('button',{name:'图谱选项',exact:true}).click();await graphSettings(page,true);await page.getByRole('button',{name:'清空筛选',exact:true}).click();await page.keyboard.press('Escape');await graphSettings(page);await expect(filter).toHaveValue('all');
  // An auxiliary center's solid reference is never counted as established knowledge.
  await page.evaluate(data=>window.renderGraph(data,{key:'center',focusPath:'日记.md'}),data);
  await expect(canvas).toHaveAttribute('data-layout','center');await expect(page.locator('line[data-relation-kind="reference"]:not([aria-hidden="true"])')).toHaveCount(1);
  await graphSettings(page);await filter.selectOption('established');await expect(page.locator('line[data-relation-kind="reference"]:not([aria-hidden="true"])')).toHaveCount(0);
  await expect(filter.locator('option:checked')).toHaveText('已建立');await expect(page.locator('[data-graph-node]')).toHaveCount(2);
  // External scope still bounds the nodes and relation counts.
  await page.evaluate(data=>window.renderGraph(data,{key:'scoped',allowedPaths:['讲义.pdf','均值.md','题1.md','题3.md']}),data);
  await expect(page.locator('[data-graph-node]')).toHaveCount(4);await expect(knowledge).toHaveCount(1);await expect(source).toHaveCount(2);
  assert.deepEqual(errors,[]);
});
