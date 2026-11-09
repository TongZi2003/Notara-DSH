import {graphSettings,graphView,graphExamples} from './graph-ui.fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium,expect} from '@playwright/test';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {projectGraph} from '../src/graph.js';
import {sourceGroups,sourceStudyGraph} from '../src/source-graph.js';

test('source detail renders two knowledge branches sharing one question and preserves selection and the full map',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'notara-source-hierarchy-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';
    import {ForceGraphView} from './src/graph-view.jsx';import css from './src/styles.css';
    const style=document.createElement('style');style.textContent=css;document.head.append(style);
    const root=createRoot(document.getElementById('root'));window.state={organization:'all',positions:new Map()};window.brought=[];
    window.renderGraph=data=>root.render(<ForceGraphView data={data} viewState={window.state} onBring={pins=>window.brought.push(pins)}/>);`,
    resolveDir:fileURLToPath(new URL('../',import.meta.url)),loader:'jsx'},bundle:true,outfile:join(dir,'fixture.js'),format:'iife',platform:'browser',jsx:'automatic',loader:{'.css':'text'},logLevel:'warning',
    alias:{'@deepseek-ai/dsh-client-ui-primitives':fileURLToPath(new URL('../../../tests/fixtures/modal.jsx',import.meta.url))}});
  await writeFile(join(dir,'fixture.html'),'<meta charset="utf-8"><body style="margin:16px;font:15px system-ui"><div id="root"></div><script src="fixture.js"></script>');
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1400,height:900}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));await page.route(/^https?:\/\//,route=>route.abort());await page.goto(pathToFileURL(join(dir,'fixture.html')).href);
  const source={path:'讲义.pdf',title:'不等式讲义（一）',type:'pdf',isSource:true};
  const data={nodes:[source,{path:'均值.md',title:'均值不等式',type:'concept'},{path:'柯西.md',title:'柯西不等式',type:'concept'},...Array.from({length:5},(_,i)=>({path:`题${i+1}.md`,title:`题 ${i+1}`,type:'exercise',sourcePaths:[source.path]}))],edges:[]};
  for(let i=1;i<=5;i++)data.edges.push({source:`题${i}.md`,target:source.path,style:'dashed',knowledge:false});
  for(const [topic,items] of [['均值.md',[1,2,3]],['柯西.md',[3,4,5]]])for(const i of items)data.edges.push({source:topic,target:`题${i}.md`,style:topic==='均值.md'&&i===3?'solid':'dashed',knowledge:true});
  await page.evaluate(data=>window.renderGraph(data),data);const canvas=page.locator('.nv-block-graph-canvas');
  await expect(canvas).toHaveAttribute('data-layout','source-clusters');await page.waitForTimeout(1000);
  const initial=await page.evaluate(()=>[...window.state.positions]);
  const cluster=page.locator('.nv-graph-cluster-backdrop[data-source-path="讲义.pdf"]');await cluster.focus();await page.keyboard.press('Enter');
  await expect(canvas).toHaveAttribute('data-layout','source-hierarchy');await expect(page.locator('[data-graph-node]')).toHaveCount(2);
  await expect(page.locator('[data-source-layer="knowledge"]')).toHaveCount(2);await expect(page.locator('[data-graph-node="题3.md"]')).toHaveCount(0);
  await expect(page.locator('.nv-graph-source-branch,.nv-block-edge')).toHaveCount(0);
  const projected=projectGraph(data),complete=sourceStudyGraph(projected,sourceGroups(projected).find(group=>group.path===source.path));
  assert.equal(complete.nodes.length,8);assert.equal(complete.edges.length,11);assert.equal(complete.branches.length,2);
  assert.equal(complete.edges.filter(edge=>edge.style==='solid').length,1);
  await page.waitForTimeout(900);
  await page.locator('[data-graph-node="均值.md"]>circle:not(.nv-block-node-focus)').click();
  const list=page.getByRole('region',{name:'具体例子',exact:true});await graphExamples(page);await expect(list.getByRole('listitem')).toHaveCount(3);
  assert.deepEqual(await page.evaluate(()=>[...window.state.positions]),initial,'automatic source hierarchy cannot overwrite the full map');
  const output=(process.env.NOTARA_GRAPH_TEST_OUTPUT?new URL(`file://${process.env.NOTARA_GRAPH_TEST_OUTPUT}/source-hierarchy/`):new URL('../.test-output/source-hierarchy/',import.meta.url));await mkdir(output,{recursive:true});await page.mouse.move(0,0);await page.screenshot({path:fileURLToPath(new URL('example.png',output))});
  await list.getByRole('button',{name:'加入候选 题 3',exact:true}).click();
  await expect(page.getByRole('button',{name:'已选 1 / 12 · 1 项未展开',exact:true})).toBeVisible();await page.getByRole('button',{name:'带入当前对话',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>window.brought.map(pins=>pins.map(pin=>pin.path))),[['题3.md']]);
  await page.getByRole('button',{name:'返回资料概览',exact:true}).click();await expect(canvas).toHaveAttribute('data-layout','source-clusters');await expect(cluster).toBeFocused();
  await expect(page.locator('.nv-block-edge')).toHaveCount(data.edges.length);assert.deepEqual(errors,[]);
});
