import test from 'node:test';
import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {progressiveFixture} from './progressive-browser-fixture.mjs';
import {graphSettings,graphView} from './graph-ui.fixture.mjs';

const data={relationsVersion:2,nodes:[{path:'book',title:'讲义',type:'source',isSource:true},
  ...['A','B','C'].map(path=>({path,title:path,type:'concept',tags:['数学'],sourcePaths:['book']}))],
  edges:[{source:'A',target:'B',kind:'prerequisite',style:'dashed'},{source:'B',target:'C',kind:'prerequisite',style:'solid'}]};
const node=(page,path)=>page.locator(`[data-graph-node="${path}"]`);
const back=page=>page.getByRole('button',{name:'返回上一级图谱',exact:true});

test('center navigation returns one level at a time with camera, filters and selection after remount',async t=>{
  const {page,errors}=await progressiveFixture(t);
  await page.evaluate(data=>{window.state={organization:'knowledge',positions:new Map(),filters:{centers:[],tags:['数学'],hops:1,tagMatch:'all',type:'concept'},relationFilter:'potential'};window.renderGraph(data);},data);
  await expect(node(page,'A')).toBeVisible();
  await page.locator('.nv-block-graph-canvas').evaluate(svg=>svg.dispatchEvent(new WheelEvent('wheel',{deltaX:80,deltaY:25,bubbles:true,cancelable:true})));
  const camera=await page.evaluate(()=>({...window.state.view}));
  await node(page,'A').locator('circle:not(.nv-block-node-focus)').click();
  await page.getByRole('button',{name:'加入候选',exact:true}).click();
  await expect(page.getByRole('button',{name:'移出候选',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'移出候选',exact:true}).click();
  await expect(page.getByRole('button',{name:'加入候选',exact:true})).toHaveAttribute('aria-pressed','false');
  await page.getByRole('button',{name:'加入候选',exact:true}).click();
  await page.getByRole('button',{name:'以此为中心',exact:true}).click();
  await expect(back(page)).toBeVisible();await expect(node(page,'A')).toHaveClass(/nv-block-center/);
  const firstCamera=await page.evaluate(()=>({...window.state.view}));
  await node(page,'B').press('Space');await expect(node(page,'B')).toHaveClass(/nv-block-center/);
  await page.evaluate(()=>window.renderGraph(window.data,{key:'reopen'}));
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  await back(page).click();await expect(node(page,'A')).toHaveClass(/nv-block-center/);
  assert.deepEqual(await page.evaluate(()=>window.state.view),firstCamera);
  await back(page).click();await expect(back(page)).toHaveCount(0);
  assert.equal(await page.evaluate(()=>window.state.organization),'knowledge');
  assert.deepEqual(await page.evaluate(()=>window.state.filters),{centers:[],tags:['数学'],hops:1,tagMatch:'all',type:'concept'});
  assert.deepEqual(await page.evaluate(()=>window.state.view),camera);
  assert.equal(await page.evaluate(()=>window.state.relationFilter),'potential');
  await expect(page.getByRole('button',{name:/已选 1/})).toBeVisible();
  assert.deepEqual(errors,[]);
});

test('source detail and arbitrary centers share a usable return path',async t=>{
  const {page,errors}=await progressiveFixture(t);await page.evaluate(data=>window.renderGraph(data),data);
  await page.getByRole('button',{name:'展开讲义，3张卡片',exact:true}).click();
  await expect(page.locator('.nv-block-graph-canvas')).toHaveAttribute('data-layout','source-hierarchy');
  const sourceCamera=await page.evaluate(()=>({...window.state.view}));
  await node(page,'A').locator('circle:not(.nv-block-node-focus)').click();
  await page.getByRole('button',{name:'查看全部关联',exact:true}).click();await expect(back(page)).toBeVisible();
  await back(page).click();await expect(page.locator('.nv-block-graph-canvas')).toHaveAttribute('data-layout','source-hierarchy');
  assert.deepEqual(await page.evaluate(()=>window.state.view),sourceCamera);
  await page.getByRole('button',{name:'返回资料概览'}).click();
  await graphSettings(page);await page.getByRole('combobox',{name:'图谱视图'}).selectOption('center');
  const dialog=page.getByRole('dialog',{name:'中心节点',exact:true});await dialog.getByRole('checkbox',{name:'中心资料 B',exact:true}).check();await dialog.getByRole('button',{name:'应用',exact:true}).click();
  await expect(back(page)).toBeVisible();await back(page).click();
  await expect(page.locator('.nv-block-graph-canvas')).toHaveAttribute('data-layout','source-clusters');
  assert.deepEqual(errors,[]);
});

test('a direct center has an exit and a changed outer scope invalidates only the return camera',async t=>{
  const {page,errors}=await progressiveFixture(t);
  await page.evaluate(data=>window.renderGraph(data,{focusPath:'A'}),data);
  await expect(back(page)).toBeVisible();await back(page).click();
  await expect(page.locator('.nv-block-graph-canvas')).toHaveAttribute('data-layout','source-clusters');
  await graphView(page,'knowledge');
  await page.locator('.nv-block-graph-canvas').evaluate(svg=>svg.dispatchEvent(new WheelEvent('wheel',{deltaX:1600,deltaY:900,bubbles:true,cancelable:true})));
  const oldCamera=await page.evaluate(()=>({...window.state.view}));await node(page,'A').press('Space');
  await page.evaluate(data=>window.renderGraph(data,{allowedPaths:['B'],focusPath:'A'}),data);
  await back(page).click();await expect(node(page,'A')).toHaveCount(0);await expect(node(page,'B')).toHaveCount(1);
  assert.notDeepEqual(await page.evaluate(()=>window.state.view),oldCamera);
  await page.evaluate(data=>window.renderGraph(data,{key:'stateless',viewState:undefined,focusPath:'A'}),data);
  await expect(back(page)).toBeVisible();await back(page).click();
  await expect(page.locator('.nv-block-graph-canvas')).toHaveAttribute('data-layout','source-clusters');
  assert.deepEqual(errors,[]);
});
