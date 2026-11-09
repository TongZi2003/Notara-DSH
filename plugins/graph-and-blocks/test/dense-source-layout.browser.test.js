import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium,expect} from '@playwright/test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

test('715-node source: compact examples remain hit-testable and visible long titles do not overlap after zoom or selection',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'notara-dense-source-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';
    import {CompleteSourceFixture} from './test/complete-source.fixture.jsx';import css from './src/styles.css';
    const style=document.createElement('style');style.textContent=css;document.head.append(style);
    const root=createRoot(document.getElementById('root'));window.state={positions:new Map()};
    window.renderGraph=data=>root.render(<CompleteSourceFixture data={data}/>);`,
    resolveDir:fileURLToPath(new URL('../',import.meta.url)),loader:'jsx'},bundle:true,outfile:join(dir,'fixture.js'),format:'iife',platform:'browser',jsx:'automatic',loader:{'.css':'text'},logLevel:'warning',
    alias:{'@deepseek-ai/dsh-client-ui-primitives':fileURLToPath(new URL('../../../tests/fixtures/modal.jsx',import.meta.url))}});
  await writeFile(join(dir,'fixture.html'),'<meta charset="utf-8"><body style="margin:16px;font:15px system-ui;height:calc(100vh - 32px)"><div id="root" style="height:100%"></div><script src="fixture.js"></script>');
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1400,height:980}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));await page.route(/^https?:\/\//,route=>route.abort());await page.goto(pathToFileURL(join(dir,'fixture.html')).href);
  const source={path:'原书.pdf',title:'导数原书',type:'pdf',isSource:true};
  const topics=Array.from({length:34},(_,i)=>({path:`知识${i}`,title:`知识单元${i}的完整条件和使用方法`,type:i%2?'concept':'method',sourcePaths:[source.path]}));
  const examples=Array.from({length:680},(_,i)=>({path:`题${i}`,title:`第${i}题：两个函数在给定区间的切线与参数条件`,type:'exercise',sourcePaths:[source.path]}));
  const data={relationsVersion:2,nodes:[source,...topics,...examples],edges:[...topics.slice(1).map((n,i)=>({source:topics[Math.max(0,i-3)].path,target:n.path,kind:'prerequisite'})),...examples.flatMap((n,i)=>[{source:topics[i%34].path,target:n.path,kind:'example'},{source:topics[(i+1)%34].path,target:n.path,kind:'example'}])]};
  await page.evaluate(data=>window.renderGraph(data),data);
  await page.getByRole('button',{name:'展开导数原书，714张卡片',exact:true}).click();
  const canvas=page.locator('.nv-block-graph-canvas'),item=page.locator('[data-graph-node="题0"]'),circle=item.locator('circle:not(.nv-block-node-focus)');
  await expect(canvas).toHaveAttribute('data-layout','source-hierarchy');await expect(page.locator('[data-graph-node]')).toHaveCount(715);
  await expect(page.locator('[data-relation-kind="prerequisite"][marker-end]')).toHaveCount(33);
  await expect(page.locator('[data-relation-kind="example"][marker-end]')).toHaveCount(0);
  await expect.poll(async()=>{const before=await circle.boundingBox();await page.waitForTimeout(200);return JSON.stringify(before)===JSON.stringify(await circle.boundingBox());}).toBe(true);
  await circle.hover();await expect(item).toHaveAttribute('data-label-hidden','false');
  await page.keyboard.down('Control');await page.mouse.wheel(0,-180);await page.keyboard.up('Control');
  await expect.poll(()=>item.locator('text').evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThan(32);
  await expect(item).toHaveAttribute('data-label-hidden','false');
  const assertNoVisibleOverlap=async()=>{
    const overlaps=await canvas.evaluate(svg=>{const labels=[...svg.querySelectorAll('[data-label-hidden="false"]>text')].map(el=>({title:el.textContent,box:el.getBoundingClientRect()})),overlaps=[];
      for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++){const a=labels[i].box,b=labels[j].box;if(a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom)overlaps.push([labels[i].title,labels[j].title]);}return overlaps;});
    assert.deepEqual(overlaps,[]);
  };
  await assertNoVisibleOverlap();await circle.click();await page.mouse.move(0,0);
  await expect(item).toHaveAttribute('data-label-hidden','false');await expect(page.getByRole('complementary',{name:'选中节点',exact:true})).toContainText(examples[0].title);await assertNoVisibleOverlap();
  assert.deepEqual(errors,[]);
});
