import test from 'node:test';
import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {progressiveFixture} from './progressive-browser-fixture.mjs';
import {graphSettings,graphView,graphExamples} from './graph-ui.fixture.mjs';

test('canvas-first graph keeps sources, knowledge and arbitrary centers in one canvas', {timeout:20000},async t=>{
  const {page,errors}=await progressiveFixture(t);
  const data={relationsVersion:2,nodes:[
    {path:'book',title:'原始讲义',type:'source',isSource:true},
    {path:'A',title:'知识甲',type:'concept',sourcePaths:['book']},
    {path:'B',title:'方法乙',type:'method',sourcePaths:['book']},
    {path:'case',title:'具体例子',type:'exercise',sourcePaths:['book'],tags:['数学'],revision:'r1'},
    {path:'diary',title:'今日日记',type:'diary'},
  ],edges:[{source:'A',target:'B',kind:'prerequisite',style:'dashed'},{source:'A',target:'case',kind:'example',style:'solid'},{source:'B',target:'case',kind:'example',style:'dashed'},{source:'case',target:'book',kind:'source',style:'dashed'},{source:'diary',target:'case',kind:'reference',style:'dashed'}]};
  await page.evaluate(data=>window.renderGraph(data),data);
  const canvas=page.locator('svg.nv-block-graph-canvas');
  await expect(canvas).toBeVisible();await expect(canvas).toHaveAttribute('data-layout','source-clusters');
  await expect(page.locator('[data-graph-node]')).toHaveCount(3);
  await expect(page.getByRole('searchbox',{name:'搜索图谱'})).toBeHidden();
  await expect(page.locator('.nv-graph-source-overview,.nv-graph-topbar,.nv-graph-organization,.nv-graph-bring-bar')).toHaveCount(0);
  await graphSettings(page);await page.getByRole('searchbox',{name:'搜索图谱'}).fill('具体例子');
  const results=page.getByRole('region',{name:'图谱搜索结果'});await expect(results.getByRole('listitem')).toHaveCount(1);
  await results.getByRole('button',{name:'加入候选 具体例子',exact:true}).click();
  await expect(page.getByRole('button',{name:/已选 1/})).toBeVisible();
  await page.getByRole('searchbox',{name:'搜索图谱'}).fill('');
  await graphView(page,'knowledge');await expect(page.locator('[data-graph-node]')).toHaveCount(2);
  await expect(page.locator('[data-relation-kind="prerequisite"][marker-end]')).toHaveCount(1);
  await page.locator('[data-graph-node="A"]').click();await graphExamples(page);
  await expect(page.getByRole('region',{name:'具体例子'}).getByRole('listitem')).toHaveCount(1);
  await page.getByRole('button',{name:'取消节点选择'}).click();
  await graphSettings(page);await page.getByRole('combobox',{name:'图谱视图'}).selectOption('center');
  const dialog=page.getByRole('dialog',{name:'中心节点',exact:true});
  await dialog.getByRole('checkbox',{name:'中心资料 具体例子',exact:true}).check();
  await dialog.getByRole('button',{name:'应用',exact:true}).click();
  await expect(canvas).toHaveAttribute('data-layout','center');await expect(page.locator('[data-graph-node="case"]')).toHaveCount(1);
  await page.evaluate(()=>window.renderGraph({...window.data},{key:'refresh'}));
  await graphSettings(page);await expect(page.getByRole('combobox',{name:'图谱视图'})).toHaveValue('center');
  await page.getByRole('button',{name:'关闭图谱选项'}).click();
  await page.getByRole('button',{name:'带入当前对话',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>window.brought.at(-1)),[{path:'case',title:'具体例子',revision:'r1'}]);
  await graphView(page,'sources');await expect(canvas).toHaveAttribute('data-layout','source-clusters');
  await page.getByRole('button',{name:'展开原始讲义，3张卡片',exact:true}).press('Enter');
  await expect(canvas).toHaveAttribute('data-layout','source-hierarchy');
  await page.getByRole('button',{name:'返回资料概览',exact:true}).click();await expect(canvas).toHaveAttribute('data-layout','source-clusters');
  await graphSettings(page);await page.getByRole('combobox',{name:'图谱资料类型'}).selectOption('exercise');
  await expect(page.locator('[data-graph-node]')).toHaveCount(1);
  await expect(page.locator('[data-graph-node="case"]')).toBeVisible();
  await page.evaluate(()=>{window.state={positions:new Map()};window.renderGraph({nodes:[{path:'s1',title:'材料来源',type:'source',isSource:true},{path:'s2',title:'原创素材',type:'source',isSource:true}],edges:[]},{key:'empty-source'});});
  await expect(page.locator('[data-graph-node]')).toHaveCount(2);await expect(canvas).toBeVisible();
  assert.deepEqual(errors,[]);
});
