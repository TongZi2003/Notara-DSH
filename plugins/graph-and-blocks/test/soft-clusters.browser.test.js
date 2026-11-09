import test from 'node:test';
import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {progressiveFixture} from './progressive-browser-fixture.mjs';
import {graphSettings,graphView} from './graph-ui.fixture.mjs';

const data={relationsVersion:2,nodes:[
  {path:'book',title:'有内容的来源',type:'source',isSource:true},
  {path:'empty',title:'尚未整理的来源',type:'source',isSource:true},
  {path:'folded',title:'只有例子的来源',type:'source',isSource:true},
  {path:'A',title:'概念甲',type:'concept',sourcePaths:['book']},
  {path:'B',title:'方法乙',type:'method',sourcePaths:['book']},
  {path:'C',title:'具体例子',type:'exercise',sourcePaths:['book']},
  {path:'D',title:'折叠的例子',type:'exercise',sourcePaths:['folded']},
],edges:[{source:'A',target:'B',kind:'prerequisite',style:'solid'},
  {source:'A',target:'C',kind:'example',style:'dashed'},
  ...[['A','book'],['B','book'],['C','book'],['D','folded']].map(([source,target])=>({source,target,kind:'source',style:'dashed'}))]};

test('pointer focus does not frame the whole canvas; keyboard controls retain their indicator',async t=>{
  const {page}=await progressiveFixture(t);
  await page.evaluate(data=>window.renderGraph(data),data);
  const canvas=page.locator('.nv-block-graph-canvas');await expect(canvas).toBeVisible();
  // Reproduce the native webview outline observed on 60323; Chromium does not
  // give pointer-focused SVG roots the same default outline on every platform.
  await page.addStyleTag({content:'.nv-block-graph-canvas:focus {outline:5px auto rgb(153,200,255)}'});
  await canvas.evaluate(el=>el.setAttribute('tabindex','0'));
  await canvas.click({position:{x:8,y:8}});await expect(canvas).toBeFocused();
  assert.equal(await canvas.evaluate(el=>el.matches(':focus-visible')),false);
  await expect(canvas).toHaveCSS('outline-style','none');
  await page.keyboard.press('Shift+Tab');
  const gear=page.getByRole('button',{name:'图谱选项',exact:true});await expect(gear).toBeFocused();
  assert.equal(await gear.evaluate(el=>el.matches(':focus-visible')),true);
  assert.notEqual(await gear.evaluate(el=>getComputedStyle(el).outlineStyle),'none');
});

for(const dark of [false,true])test(`soft clusters keep geometry and interactions in ${dark?'dark':'light'} mode`,async t=>{
  const {page,errors}=await progressiveFixture(t,{viewport:{width:1100,height:760}});
  if(dark)await page.evaluate(()=>{document.body.setAttribute('data-ds-dark-theme','');document.body.style.setProperty('--dsw-alias-bg-base','#202022');document.body.style.setProperty('--dsw-alias-label-primary','#e4e4e7');});
  await page.evaluate(data=>window.renderGraph(data),data);
  const canvas=page.locator('.nv-block-graph-canvas'),header=page.locator('.nv-graph-header');
  await expect(header.getByRole('heading',{name:'知识图谱',exact:true})).toBeVisible();
  await expect(header.getByRole('button',{name:'图谱选项',exact:true})).toHaveCount(1);
  const group=page.locator('[data-cluster-key][data-source-path="book"]'),empty=page.locator('[data-cluster-key][data-source-path="empty"]');
  await expect(group).toHaveAttribute('aria-label','展开有内容的来源，3 张卡片');
  await expect(empty.locator('ellipse')).toHaveCount(0);
  await expect(page.locator('[data-cluster-key][data-source-path="folded"] ellipse')).toHaveCount(1);
  await expect(page.locator('[data-graph-node="book"]>rect:not(.nv-block-node-focus)')).toBeVisible();
  await expect(page.locator('[data-graph-node="A"]>circle:not(.nv-block-node-focus)')).toBeVisible();
  const ellipse=group.locator('ellipse'),heading=group.locator('text');
  await expect(ellipse).toHaveCSS('stroke-opacity','0');
  await expect(heading).toHaveCSS('font-weight','400');
  const fill=await ellipse.evaluate(el=>getComputedStyle(el).fill);
  const geometry=()=>page.locator('[data-graph-node]').evaluateAll(nodes=>nodes.map(el=>[el.dataset.graphNode,el.getAttribute('transform')]));
  const before=await geometry(),camera=await canvas.locator(':scope > g').getAttribute('transform');
  await heading.hover();await expect(ellipse).toHaveCSS('stroke-opacity','1');await expect(ellipse).toHaveCSS('fill',fill);
  await page.locator('[data-graph-node="A"]>circle:not(.nv-block-node-focus)').click();
  await expect(page.getByRole('complementary',{name:'选中节点'})).toContainText('概念甲');
  await expect(group).not.toHaveClass(/is-highlighted/);await expect(ellipse).toHaveCSS('fill',fill);
  await expect(page.locator('[data-graph-node="B"]')).not.toHaveClass(/nv-graph-node-muted/);
  await expect(page.locator('[data-graph-node="empty"]')).toHaveClass(/nv-graph-node-muted/);
  assert.deepEqual(await geometry(),before);await expect(canvas.locator(':scope > g')).toHaveAttribute('transform',camera);
  await page.getByRole('button',{name:'取消节点选择'}).click();
  await graphSettings(page,true);await page.getByRole('button',{name:'放大图谱',exact:true}).click();
  await page.getByRole('button',{name:'关闭图谱选项'}).click();
  const size=()=>heading.evaluate(el=>{const m=el.getScreenCTM();return parseFloat(getComputedStyle(el).fontSize)*Math.hypot(m.a,m.b);});
  await expect.poll(size).toBeLessThanOrEqual(13.1);
  await empty.focus();await page.keyboard.press('Enter');await expect(canvas).toHaveAttribute('data-layout','center');
  await page.getByRole('button',{name:'返回资料概览'}).click();await expect(empty).toBeFocused();
  await graphView(page,'all');
  await expect(page.locator('[data-graph-node="C"]>circle:not(.nv-block-node-focus)')).toBeVisible();
  const source=page.locator('[data-graph-node="book"]>rect:not(.nv-block-node-focus)');
  await source.click({modifiers:['Control']});await expect(page.getByRole('button',{name:/已选 1/})).toBeVisible();
  await source.dblclick();assert.deepEqual(await page.evaluate(()=>window.opened.at(-1)),{path:'book'});
  assert.deepEqual(errors,[]);
});
