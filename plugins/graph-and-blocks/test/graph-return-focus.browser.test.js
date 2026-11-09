import {graphSettings,graphView,graphExamples} from './graph-ui.fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium,expect} from '@playwright/test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

async function fixture(t){
  const dir=await mkdtemp(join(tmpdir(),'notara-graph-return-focus-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';
    import {ForceGraphView} from './src/graph-view.jsx';import css from './src/styles.css';
    const style=document.createElement('style');style.textContent=css;document.head.append(style);
    const root=createRoot(document.getElementById('root'));window.state={organization:'all',positions:new Map()};
    window.renderGraph=props=>root.render(<ForceGraphView {...props} viewState={window.state}/>);`,
    resolveDir:fileURLToPath(new URL('../',import.meta.url)),loader:'jsx'},bundle:true,outfile:join(dir,'fixture.js'),format:'iife',platform:'browser',jsx:'automatic',loader:{'.css':'text'},logLevel:'warning',
    alias:{'@deepseek-ai/dsh-client-ui-primitives':fileURLToPath(new URL('../../../tests/fixtures/modal.jsx',import.meta.url))}});
  await writeFile(join(dir,'fixture.html'),'<meta charset="utf-8"><body style="margin:16px;font:15px system-ui"><div id="root"></div><script src="fixture.js"></script>');
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));t.after(()=>assert.deepEqual(errors,[]));
  await page.route(/^https?:\/\//,route=>route.abort());await page.goto(pathToFileURL(join(dir,'fixture.html')).href);
  const data={nodes:[
    {path:'A.pdf',title:'资料 A',type:'source',isSource:true},
    {path:'B.pdf',title:'资料 B',type:'source',isSource:true},
    ...['A','B'].flatMap(letter=>Array.from({length:3},(_,i)=>({path:`${letter}${i}.md`,title:`${letter} 题目 ${i}`,type:'exercise',sourcePaths:[`${letter}.pdf`]}))),
  ],edges:[]};
  data.edges=data.nodes.filter(node=>node.sourcePaths).map(node=>({source:node.path,target:node.sourcePaths[0],style:'dashed'}));
  const render=props=>page.evaluate(props=>window.renderGraph(props),{data,...props});
  await render({});const canvas=page.locator('.nv-block-graph-canvas');await expect(canvas).toHaveAttribute('data-layout','source-clusters');
  await expect(page.locator('[data-graph-node]')).toHaveCount(8);
  return {page,canvas,data,render};
}

test('hidden graph defers invalidations and a warm reveal preserves the canvas',async t=>{
  const {page,data,canvas}=await fixture(t);
  await page.evaluate(data=>{
    window.calls=0;window.props={active:true,remote:{graph:async()=>{window.calls++;return {ok:true,value:data};}}};
    window.renderGraph(window.props);
  },data);
  await expect.poll(()=>page.evaluate(()=>window.calls)).toBe(1);
  await canvas.evaluate(el=>el.dataset.keepalive='original');
  await page.evaluate(()=>{window.props.active=false;window.renderGraph(window.props);});
  await expect(canvas).toHaveAttribute('data-keepalive','original');
  await page.evaluate(()=>{for(let i=0;i<5;i++)window.dispatchEvent(new CustomEvent('notara:vault-updated',{detail:{path:'A0.md',workspaceId:undefined}}));});
  await page.waitForTimeout(60);
  assert.equal(await page.evaluate(()=>window.calls),1);
  await page.evaluate(()=>{window.props.active=true;window.renderGraph(window.props);});
  await expect.poll(()=>page.evaluate(()=>window.calls)).toBe(2);
  await page.evaluate(()=>{window.props.active=false;window.renderGraph(window.props);});
  await page.waitForTimeout(30);
  await page.evaluate(()=>{window.props.active=true;window.renderGraph(window.props);});
  await page.waitForTimeout(60);
  assert.equal(await page.evaluate(()=>window.calls),2,'unchanged reveal uses the loaded graph');
  await expect(canvas).toHaveAttribute('data-keepalive','original');
});

for(const change of ['filter','allowed paths','source membership'])test(`return from a source detail fits the current graph after changing ${change}`,async t=>{
  const {page,canvas,data,render}=await fixture(t);
  await canvas.evaluate(svg=>svg.dispatchEvent(new WheelEvent('wheel',{deltaX:1600,deltaY:900,bubbles:true,cancelable:true})));
  const camera=await page.evaluate(()=>({...window.state.view}));
  const cluster=page.locator('.nv-graph-cluster-backdrop[data-source-path="A.pdf"]');
  await cluster.evaluate(el=>el.focus({preventScroll:true}));await page.keyboard.press('Enter');
  await expect(page.getByRole('button',{name:'返回资料概览',exact:true})).toBeVisible();
  await expect(page.locator('[data-graph-node]')).toHaveCount(4);
  if(change==='filter'){
    await page.getByRole('button',{name:'图谱选项',exact:true}).click();
    await page.getByRole('combobox',{name:'图谱资料类型'}).selectOption('source');
    await page.getByRole('button',{name:'图谱选项',exact:true}).click();
    await expect(page.locator('[data-graph-node]')).toHaveCount(1);
  }else if(change==='allowed paths'){
    await render({allowedPaths:['B.pdf','B0.md','B1.md','B2.md']});
    await expect(page.locator('[data-graph-node]')).toHaveCount(0);
  }else{
    await render({data:{...data,nodes:data.nodes.map(node=>node.path==='A0.md'?{...node,sourcePaths:['B.pdf']}:node)}});
    await expect(page.locator('[data-graph-node]')).toHaveCount(3);
  }
  await page.getByRole('button',{name:'返回资料概览',exact:true}).click();
  await expect(canvas).toHaveAttribute('data-layout','source-clusters');
  await expect(page.locator('[data-graph-node]')).toHaveCount(change==='filter'?2:change==='allowed paths'?4:8);
  await expect.poll(()=>page.evaluate(()=>window.state.view)).not.toEqual(camera);
  await expect.poll(()=>canvas.evaluate(svg=>{
    const r=svg.getBoundingClientRect();return [...svg.querySelectorAll('[data-graph-node]>.nv-block-node-shape')].every(el=>{const b=el.getBoundingClientRect();return b.left>=r.left&&b.right<=r.right&&b.top>=r.top&&b.bottom<=r.bottom;});
  })).toBe(true);
});

test('equivalent refresh order preserves the original preview camera',async t=>{
  const {page,canvas,data,render}=await fixture(t);
  const shared={...data,nodes:data.nodes.map(node=>node.path==='A0.md'?{...node,sourcePaths:['A.pdf','B.pdf']}:node)};
  const allowedPaths=data.nodes.map(node=>node.path);
  await render({data:shared,allowedPaths});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await canvas.evaluate(svg=>svg.dispatchEvent(new WheelEvent('wheel',{deltaX:500,deltaY:200,bubbles:true,cancelable:true})));
  const camera=await page.evaluate(()=>({...window.state.view}));
  await page.locator('.nv-graph-cluster-backdrop[data-source-path="A.pdf"]').evaluate(el=>el.focus({preventScroll:true}));await page.keyboard.press('Enter');
  await expect(page.getByRole('button',{name:'返回资料概览',exact:true})).toBeVisible();
  await render({allowedPaths:[...allowedPaths].reverse(),data:{
    nodes:[...shared.nodes].reverse().map(node=>({...node,sourcePaths:node.sourcePaths?[...node.sourcePaths].reverse():undefined})),
    edges:[...data.edges].reverse().map(edge=>({...edge,source:edge.target,target:edge.source})),
  }});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.getByRole('button',{name:'返回资料概览',exact:true}).click();
  await expect(canvas).toHaveAttribute('data-layout','source-clusters');
  assert.deepEqual(await page.evaluate(()=>window.state.view),camera,'only presentation inputs that change the graph should invalidate the return camera');
});

test('refresh keeps the focused source cluster mounted without taking focus from another control',async t=>{
  const {page,data,render}=await fixture(t);
  const cluster=page.locator('.nv-graph-cluster-backdrop[data-source-path="A.pdf"]');
  await cluster.focus();const element=await cluster.elementHandle();
  const renamed={...data,nodes:data.nodes.map(node=>node.path==='A.pdf'?{...node,title:'更新后的资料 A'}:node)};
  await render({data:renamed});await expect(cluster).toHaveAttribute('aria-label','展开更新后的资料 A，3 张卡片');
  await expect(cluster).toBeFocused();
  assert.equal(await element.evaluate(el=>el.isConnected),true,'refresh must retain the keyed SVG group');
  await page.keyboard.press('Enter');await expect(page.getByRole('button',{name:'返回资料概览',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'返回资料概览',exact:true}).click();await expect(cluster).toBeFocused();
  const search=page.getByRole('searchbox',{name:'搜索图谱'});await graphSettings(page);await search.focus();
  await render({data});await expect(cluster).toHaveAttribute('aria-label','展开资料 A，3 张卡片');await expect(search).toBeFocused();
  await cluster.focus();await render({allowedPaths:['B.pdf','B0.md','B1.md','B2.md']});
  await expect(cluster).toHaveCount(0);
  await expect(page.locator('.nv-graph-cluster-backdrop[data-source-path="B.pdf"]')).not.toBeFocused();
});
