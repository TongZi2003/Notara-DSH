import test from 'node:test';
import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {progressiveFixture} from './progressive-browser-fixture.mjs';

test('camera changes reuse text geometry, while changed titles and fonts are remeasured',async t=>{
 const {page,errors}=await progressiveFixture(t);
 const data={nodes:[{path:'A',title:'中心',type:'concept'},{path:'B',title:'右侧标题',type:'method'},{path:'C',title:'另一标题',type:'concept'}],edges:[{source:'A',target:'B'},{source:'A',target:'C'}]};
 await page.evaluate(data=>{window.state={positions:new Map()};window.renderGraph(data,{focusPath:'A'});},data);
 await expect(page.locator('[data-graph-node]')).toHaveCount(3);await page.waitForTimeout(1100);
 await page.evaluate(()=>{window.measurements={box:0,screen:0};const box=SVGGraphicsElement.prototype.getBBox,screen=SVGGraphicsElement.prototype.getScreenCTM;
  SVGGraphicsElement.prototype.getBBox=function(...args){window.measurements.box++;return box.apply(this,args);};SVGGraphicsElement.prototype.getScreenCTM=function(...args){window.measurements.screen++;return screen.apply(this,args);};});
 const canvas=page.locator('.nv-block-graph-canvas');
 await canvas.evaluate(async svg=>{for(let i=0;i<5;i++){svg.dispatchEvent(new WheelEvent('wheel',{deltaY:-10,ctrlKey:true,bubbles:true,cancelable:true}));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));}});
 const counts=await page.evaluate(()=>window.measurements);assert.equal(counts.box,0,'unchanged labels are not measured on every zoom');assert.equal(counts.screen,5,'the native gesture still updates coordinates each frame; painting adds no screen reads');
 await page.evaluate(()=>{window.data={...window.data,nodes:window.data.nodes.map(n=>n.path==='B'?{...n,title:'改变后的很长标题'}:n)};window.renderGraph(window.data,{focusPath:'A'});});
 await expect(page.locator('[data-graph-node="B"] text')).toContainText('改变后的');await expect.poll(()=>page.evaluate(()=>window.measurements.box)).toBeGreaterThan(0);
 await page.evaluate(()=>{window.measurements.box=0;document.body.style.setProperty('--claude-font-sans','monospace');});
 await expect.poll(()=>page.evaluate(()=>window.measurements.box)).toBeGreaterThan(0);
 assert.deepEqual(errors,[]);
});

test('cached gesture coordinates invalidate after resize and scrolling',async t=>{
 const {page,errors}=await progressiveFixture(t);
 await page.evaluate(()=>window.renderGraph({nodes:[{path:'A',title:'中心',type:'concept'}],edges:[]},{focusPath:'A'}));
 const canvas=page.locator('.nv-block-graph-canvas');await expect(canvas.locator('[data-graph-node]')).toHaveCount(1);
 const zoom=()=>canvas.evaluate(async svg=>{
  const rect=svg.getBoundingClientRect(),x=rect.x+rect.width*.6,y=rect.y+Math.min(rect.height*.4,150),p=new DOMPoint(x,y).matrixTransform(svg.getScreenCTM().inverse());
  const previous={...window.state.view};svg.dispatchEvent(new WheelEvent('wheel',{clientX:x,clientY:y,deltaY:10,ctrlKey:true,bubbles:true,cancelable:true}));
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const next=window.state.view;
  return Math.max(Math.abs((p.x-previous.x)/previous.scale-(p.x-next.x)/next.scale),Math.abs((p.y-previous.y)/previous.scale-(p.y-next.y)/next.scale));
 });
 assert.ok(await zoom()<1e-7);await page.setViewportSize({width:900,height:700});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));assert.ok(await zoom()<1e-7);
 await page.evaluate(()=>{document.body.style.height='1600px';window.scrollTo(0,120);});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));assert.ok(await zoom()<1e-7);assert.deepEqual(errors,[]);
});
