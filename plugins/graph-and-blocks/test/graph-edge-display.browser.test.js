import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium,expect} from '@playwright/test';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {graphSettings} from './graph-ui.fixture.mjs';

test('relation styles, hover targets and compact legend preserve graph identity and evidence filters',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'notara-edge-display-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';
    import {ForceGraphView} from './src/graph-view.jsx';import css from './src/styles.css';
    import {appearanceCss} from '../vault-views/src/appearance-tokens.js';
    const style=document.createElement('style');style.textContent=css;document.head.append(style);
    const theme=document.createElement('style');document.head.append(theme);
    window.theme=(name,dark)=>{theme.textContent=appearanceCss(name);document.body.dataset.notaraTheme=name;document.body.toggleAttribute('data-ds-dark-theme',dark);};window.theme('claude',false);
    const root=createRoot(document.getElementById('root'));window.state={organization:'all',labelMode:'all',positions:new Map()};
    window.renderGraph=data=>{window.data=data;root.render(<ForceGraphView data={data} viewState={window.state}/>);};`,
    resolveDir:fileURLToPath(new URL('../',import.meta.url)),loader:'jsx'},bundle:true,outfile:join(dir,'fixture.js'),format:'iife',platform:'browser',jsx:'automatic',loader:{'.css':'text'},logLevel:'warning',
    alias:{'@deepseek-ai/dsh-client-ui-primitives':fileURLToPath(new URL('../../../tests/fixtures/modal.jsx',import.meta.url))}});
  await writeFile(join(dir,'fixture.html'),'<meta charset="utf-8"><body style="margin:0;font:14px system-ui;background:var(--dsw-alias-bg-base)"><div id="root" style="height:100vh"></div><script src="fixture.js"></script>');
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1200,height:850}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route(/^https?:\/\//,route=>route.abort());await page.goto(pathToFileURL(join(dir,'fixture.html')).href);
  const data={relationsVersion:2,nodes:[['a','极限','concept'],['b','导数定义','concept'],['c','求导方法','method'],['d','例题一','exercise'],['e','微积分讲义','source'],['f','瞬时变化率','concept']].map(([path,title,type])=>({path,title,type,...(type==='source'?{isSource:true}:{sourcePaths:['e']}),...(path==='d'?{independentReviewCount:1}:{})})),edges:[]};
  for(const [kind,source,target,style] of [['prerequisite','a','b','solid'],['prerequisite','b','c','dashed'],['example','c','d','solid'],['example','b','d','dashed'],['association','b','f','solid'],['association','f','c','dashed'],['reference','a','c','dashed'],...['a','b','c','d','f'].map(p=>['source',p,'e','dashed'])])data.edges.push({id:String(data.edges.length),kind,source,target,style});
  await page.evaluate(data=>{const positions=[[160,170],[400,270],[720,170],[860,510],[480,650],[200,500]];data.nodes.forEach((node,i)=>window.state.positions.set(node.path,{x:positions[i][0],y:positions[i][1],fx:positions[i][0],fy:positions[i][1]}));window.renderGraph(data);},data);
  const edges=page.locator('[data-graph-edge]'),canvas=page.locator('.nv-block-graph-canvas'),legend=page.getByRole('region',{name:'连线图例'});
  await expect(edges).toHaveCount(data.edges.length);await expect(legend).toBeHidden();
  await expect(page.locator('.nv-graph-edge-hit:not([aria-hidden=true])')).toHaveCount(0,'wider pointer targets must not duplicate screen-reader relations');
  const association=page.locator('[data-relation-kind=association]').first();await expect(association).toHaveAttribute('d',/^M .* Q /);
  await expect(page.locator('[data-relation-kind=prerequisite][marker-end]')).toHaveCount(2);await expect(page.locator('[data-relation-kind=example][marker-end]')).toHaveCount(0);
  await expect(page.locator('[data-relation-id="0"] title')).toHaveText('前序依赖 · 先学 极限 → 再学 导数定义 · 已建立');
  const geometry=await edges.evaluateAll(items=>items.map(el=>[el.dataset.relationId,...['d','x1','y1','x2','y2'].map(key=>el.getAttribute(key))]));
  assert.equal(await edges.evaluateAll(items=>items.every(el=>{const hit=el.parentElement.querySelector('.nv-graph-edge-hit');return ['d','x1','y1','x2','y2'].every(key=>el.getAttribute(key)===hit.getAttribute(key));})),true);
  const camera=await canvas.locator(':scope>g').getAttribute('transform');
  const output=fileURLToPath(new URL('../../../outputs/graph-edge-display-20261108/',import.meta.url));await mkdir(output,{recursive:true});
  for(const name of ['claude','obsidian'])for(const dark of [false,true]){
    await page.evaluate(({name,dark})=>window.theme(name,dark),{name,dark});await graphSettings(page);await expect(legend).toBeVisible();
    const colours=[];
    for(const kind of ['prerequisite','example','association','source','reference']){
      const edge=page.locator(`[data-relation-kind=${kind}]`).first(),sample=legend.locator('.nv-legend-'+kind);
      const stroke=await edge.evaluate(el=>getComputedStyle(el).stroke);assert.equal(await sample.evaluate(el=>getComputedStyle(el).stroke),stroke);colours.push(stroke);
    }
    assert.equal(new Set(colours).size,5);
    for(const kind of ['prerequisite','example','association']){
      await expect(page.locator(`[data-relation-kind=${kind}].nv-block-edge-solid`)).toHaveCSS('stroke-dasharray','none');
      await expect(page.locator(`[data-relation-kind=${kind}].nv-block-edge-dashed`)).toHaveCSS('stroke-dasharray','5px, 4px');
    }
    await expect(page.locator('.nv-block-independent>circle:not(.nv-block-node-focus)')).toHaveCSS('stroke',dark?'rgb(127, 184, 138)':'rgb(76, 138, 79)');
    await page.screenshot({path:join(output,`${name}-${dark?'dark':'light'}-legend.png`)});
    await page.getByRole('button',{name:'关闭图谱选项',exact:true}).click();await expect(legend).toBeHidden();
    assert.equal(await canvas.locator(':scope>g').getAttribute('transform'),camera);
  }
  assert.deepEqual(await edges.evaluateAll(items=>items.map(el=>[el.dataset.relationId,...['d','x1','y1','x2','y2'].map(key=>el.getAttribute(key))])),geometry);
  const reference=page.locator('[data-relation-kind=reference]'),hit=reference.locator('..').locator('.nv-graph-edge-hit');
  const midpoint=await hit.evaluate(el=>{const x=(+el.getAttribute('x1')+ +el.getAttribute('x2'))/2,y=(+el.getAttribute('y1')+ +el.getAttribute('y2'))/2,p=new DOMPoint(x,y).matrixTransform(el.getScreenCTM());return {x:p.x,y:p.y};});
  await page.mouse.move(midpoint.x,midpoint.y);await expect(reference).toHaveCSS('stroke-opacity','1');await page.mouse.move(0,0);await expect(reference).toHaveCSS('stroke-opacity','0.65');
  await graphSettings(page);const filter=page.getByRole('combobox',{name:'知识联系筛选',exact:true});await filter.selectOption('established');
  await expect(page.locator('[data-graph-edge]:not([aria-hidden=true])')).toHaveCount(8);await expect(page.locator('[data-relation-kind=source]:not([aria-hidden=true])')).toHaveCount(5);
  await filter.selectOption('potential');await expect(page.locator('[data-graph-edge]:not([aria-hidden=true])')).toHaveCount(8);
  await expect(page.locator('[data-graph-edge].nv-block-edge-solid:not([aria-hidden=true])')).toHaveCount(0);
  await filter.selectOption('all');await page.getByRole('button',{name:'关闭图谱选项',exact:true}).click();
  await page.evaluate(()=>window.renderGraph({...window.data}));await expect(edges).toHaveCount(data.edges.length);assert.equal(await canvas.locator(':scope>g').getAttribute('transform'),camera);
  await page.setViewportSize({width:390,height:844});await graphSettings(page);await expect(legend).toBeVisible();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:join(output,'narrow.png')});
  assert.deepEqual(errors,[]);
});
