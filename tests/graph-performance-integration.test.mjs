import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {startNativeRuntime} from '../scripts/native-runtime.mjs';
import {openGraph,graphSelect} from '../scripts/ui-navigation.mjs';

const output=resolve(process.env.NOTARA_TEST_OUTPUT??'work/graph-performance'),runs=Number(process.env.NOTARA_PERF_RUNS??3);
await mkdir(output,{recursive:true});let runtime,browser;const report={runs:[],errors:[]};
try{
 runtime=await startNativeRuntime({fixture:process.env.NOTARA_TEST_FIXTURE??'work/functional-acceptance-20261108/derivative-vault',testModel:true});browser=await chromium.launch({headless:true});
 for(let run=0;run<runs;run++){
  const context=await browser.newContext({viewport:{width:1440,height:960}}),page=await context.newPage();page.setDefaultTimeout(30000);
  page.on('pageerror',e=>report.errors.push(e.message));await page.goto(runtime.authUrl);await page.locator('[data-composer-input]:visible').waitFor();await page.waitForLoadState('networkidle');const welcome=page.getByRole('button',{name:/^(Continue|继续)$/});if(await welcome.isVisible())await welcome.click();await page.evaluate(()=>document.fonts.ready);
  await page.evaluate(()=>{
   window.__perf={start:performance.now()};
   for(const method of ['getBBox','getScreenCTM','setAttribute']){const prototype=method==='setAttribute'?SVGElement.prototype:SVGGraphicsElement.prototype,original=prototype[method];prototype[method]=function(...args){const p=window.__perf;p[method]=(p[method]??0)+1;return original.apply(this,args);};}
   const put=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith('notara.graph')){const p=window.__perf;p.storageCalls=(p.storageCalls??0)+1;p.storageCharacters=(p.storageCharacters??0)+value.length;}return put.call(this,key,value);};
   new PerformanceObserver(list=>{for(const e of list.getEntries())if(e.startTime>=window.__perf.start)(window.__perf.longTasks??=[]).push(e.duration);}).observe({type:'longtask'});
   let previous=performance.now();const frame=now=>{if(previous>=window.__perf.start)(window.__perf.frames??=[]).push(now-previous);previous=now;requestAnimationFrame(frame);};requestAnimationFrame(frame);
  });
  const graph=page.locator('.nv-independent-graph:visible'),canvas=graph.locator('svg.nv-block-graph-canvas');
  const rows=[];
  async function measure(name,action){
   const profile=process.env.NOTARA_PERF_PROFILE?await context.newCDPSession(page):null;
   if(profile){await profile.send('Profiler.enable');await profile.send('Profiler.start');}
   await page.evaluate(()=>window.__perf={start:performance.now()});const start=performance.now();await action();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const actionMs=performance.now()-start;
   await page.waitForTimeout(600);
   const metrics=await page.evaluate(()=>{const {frames=[],start,...p}=window.__perf;frames.sort((a,b)=>a-b);return {...p,frameP95:frames[Math.floor(frames.length*.95)]??0,frameMax:frames.at(-1)??0};});
   const shape=await canvas.evaluate(svg=>({nodes:svg.querySelectorAll('[data-graph-node]').length,edges:svg.querySelectorAll('[data-graph-edge]').length,elements:svg.querySelectorAll('*').length,layout:svg.dataset.layout}));
   rows.push({name,actionMs,...metrics,...shape});
   if(profile){const {profile:trace}=await profile.send('Profiler.stop');await writeFile(join(output,name+'.cpuprofile'),JSON.stringify(trace));await profile.detach();}
  }
  await measure('overview',async()=>{await openGraph(page);await expect(canvas.locator('[data-graph-node]').first()).toBeVisible();});
  await measure('expand-book',async()=>{await graph.locator('[data-source-path="来源/新思路-mst26版导数.pdf"]').focus();await page.keyboard.press('Enter');await expect(graph.getByRole('button',{name:'返回资料概览',exact:true})).toBeVisible();});
  const zoom=()=>canvas.evaluate(async svg=>{const b=svg.getBoundingClientRect();for(let i=0;i<12;i++){svg.dispatchEvent(new WheelEvent('wheel',{deltaY:-20,ctrlKey:true,clientX:b.x+b.width/2,clientY:b.y+b.height/2,bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,40));}});
  await measure('zoom-book',zoom);
  await measure('all-links',()=>graphSelect(page,graph,'图谱视图','all'));
  await page.waitForTimeout(1000);
  if(run===0){await page.screenshot({path:join(output,'all-links.png')});await writeFile(join(output,'geometry.json'),JSON.stringify(await canvas.evaluate(svg=>[...svg.querySelectorAll('[data-graph-node]')].map(n=>({path:n.dataset.graphNode,transform:n.getAttribute('transform'),label:n.querySelector('text')?.textContent}))),null,2));}
  await measure('zoom-all',zoom);
  const node=await canvas.evaluate(svg=>{const clip=svg.getBoundingClientRect();for(const e of svg.querySelectorAll('[data-graph-node]')){const r=e.querySelector('.nv-block-node-shape')?.getBoundingClientRect();if(r&&r.x>clip.x+60&&r.right<clip.right-100&&r.y>clip.y+60&&r.bottom<clip.bottom-100)return {path:e.dataset.graphNode,x:r.x+r.width/2,y:r.y+r.height/2,before:e.getAttribute('transform')};}});
  assert.ok(node,'visible node for real dragging');
  await measure('drag-all',async()=>{await page.mouse.move(node.x,node.y);await page.mouse.down();await page.mouse.move(node.x+70,node.y+40,{steps:20});await page.mouse.up();});
  assert.notEqual(await canvas.locator(`[data-graph-node="${node.path}"]`).getAttribute('transform'),node.before);
  await measure('return-book',()=>graphSelect(page,graph,'图谱视图','sources'));
  report.runs.push(rows);await context.close();
 }
 assert.deepEqual(report.errors,[]);report.status='PASS';
}catch(error){report.status='FAIL';report.error=error.stack;process.exitCode=1;}
finally{await writeFile(join(output,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,runs:report.runs.length,errors:report.errors,error:report.error}));await browser?.close();await runtime?.stop();}
