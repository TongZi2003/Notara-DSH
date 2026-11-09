import {graphSettings,graphView,graphExamples} from './graph-ui.fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {progressiveFixture} from './progressive-browser-fixture.mjs';

test('backbone columns balance both viewport dimensions rather than shrinking a tall field', async t => {
  // Approximate the graph area left by the native sidebar in a 1440×900 window.
  const {page, errors} = await progressiveFixture(t, {viewport: {width: 1160, height: 800}});
  const source = {path: 'book', title: '原始资料', type: 'source', isSource: true};
  const topics = Array.from({length: 45}, (_, i) => ({path: `k${i}`, title: `知识${i}的完整适用条件与多种方法之间的比较`, type: 'concept', sourcePaths: ['book']}));
  const data = {relationsVersion: 2, nodes: [source, ...topics], edges: topics.slice(1).map((node, i) => ({source: topics[i].path, target: node.path, kind: 'prerequisite', style: 'dashed'}))};
  await page.evaluate(data => window.renderGraph(data), data);
  await page.getByRole('button', {name: '展开原始资料，45张卡片', exact: true}).click();
  await expect(page.locator('[data-label-hidden="false"]')).toHaveCount(45);
  const geometry = () => page.locator('svg.nv-block-graph-canvas').evaluate(svg => {
    const bounds = svg.getBoundingClientRect();
    return [...svg.querySelectorAll('[data-graph-node] text')].map(text => {
      const box = text.getBoundingClientRect(), matrix = text.getScreenCTM();
      return {font: parseFloat(getComputedStyle(text).fontSize) * Math.hypot(matrix.a, matrix.b), inside: box.left >= bounds.left && box.right <= bounds.right && box.top >= bounds.top && box.bottom <= bounds.bottom};
    });
  });
  await expect.poll(async () => Math.min(...(await geometry()).map(label => label.font))).toBeGreaterThanOrEqual(12);
  assert.ok((await geometry()).every(label => label.inside), JSON.stringify(await geometry()));
  assert.deepEqual(errors, []);
});

for (const [name, filters] of [
  ['标签', {centers: [], tags: ['数学'], hops: 1, tagMatch: 'all', type: 'all'}],
  ['中心邻域', {centers: ['A'], tags: [], hops: 0, tagMatch: 'all', type: 'all'}],
]) test(`hidden-case search and bulk selection retain the current ${name} scope`, async t => {
  const {page, errors} = await progressiveFixture(t);
  const data = {relationsVersion: 2, nodes: [
    {path: 'A', title: '数学例子', type: 'exercise', tags: ['数学'], revision: 'ra'},
    {path: 'B', title: '化学例子', type: 'exercise', tags: ['化学'], revision: 'rb'},
  ], edges: []};
  await page.evaluate(({data, filters}) => {
    window.state = {positions: new Map(), filters, organization: 'all'};
    window.renderGraph(data, {key: 'scoped-search'});
  }, {data, filters});
  await expect(page.locator('[data-graph-node="A"]')).toHaveCount(1);
  await expect(page.locator('[data-graph-node="B"]')).toHaveCount(0);
  await graphSettings(page);await page.getByRole('searchbox', {name: '搜索图谱'}).fill('例子');
  const results = page.getByRole('region', {name: '图谱搜索结果', exact: true});
  await expect(results.getByRole('listitem')).toHaveCount(1);
  await expect(results).toContainText('数学例子');
  await expect(results).not.toContainText('化学例子');
  await page.getByRole('button', {name: '图谱选项', exact: true}).click();
  await graphSettings(page,true);await page.getByRole('button', {name: '选中匹配项', exact: true}).click();
  await page.getByRole('button', {name: '带入当前对话', exact: true}).click();
  assert.deepEqual(await page.evaluate(() => window.brought.at(-1)), [{path: 'A', title: '数学例子', revision: 'ra'}]);
  assert.deepEqual(errors, []);
});

test('progressive source UI: skeleton, paginated shared cases, full catalog search, selection, refresh and legacy entry',async t=>{
  const {page,errors}=await progressiveFixture(t);
  const source={path:'原书.pdf',title:'原书',type:'pdf',isSource:true};
  const topics=Array.from({length:34},(_,i)=>({path:`知识${i}`,title:`知识单元${i}的完整条件与使用方法`,type:i%2?'concept':'method',sourcePaths:[source.path]}));
  const examples=Array.from({length:680},(_,i)=>({path:`例子${i}`,title:`具体例子${i}的原始材料与条件`,type:'exercise',sourcePaths:[source.path],revision:`r${i}`}));
  const data={relationsVersion:2,nodes:[source,...topics,...examples],edges:[...topics.slice(1).map((n,i)=>({source:topics[i].path,target:n.path,kind:'prerequisite',style:i%2?'solid':'dashed'})),...examples.flatMap((n,i)=>[{source:topics[i%34].path,target:n.path,kind:'example',style:'dashed'},{source:topics[(i+1)%34].path,target:n.path,kind:'example',style:'dashed'},{source:n.path,target:source.path,kind:'source',style:'dashed'}]) ]};
  await page.evaluate(data=>window.renderGraph(data),data);
  await page.getByRole('button',{name:'展开原书，714张卡片',exact:true}).click();
  await expect(page.locator('[data-graph-node]')).toHaveCount(34);
  await expect.poll(()=>page.locator('svg.nv-block-graph-canvas').evaluate(svg=>Math.abs(svg.viewBox.baseVal.height-svg.getBoundingClientRect().height))).toBeLessThanOrEqual(2);
  await expect(page.locator('[data-relation-kind="prerequisite"]')).toHaveCount(33);
  await expect(page.locator('[data-relation-kind="source"],[data-relation-kind="example"],.nv-graph-source-branch')).toHaveCount(0);
  await expect(page.getByText(/680 个具体例子未展开/)).toHaveCount(0);
  const topic=page.locator('[data-graph-node="知识0"]');await topic.focus();await page.keyboard.press('Space');
  const list=page.getByRole('region',{name:'具体例子',exact:true});await graphExamples(page);await expect(list).toBeVisible();
  await expect(list.getByRole('listitem')).toHaveCount(8);
  await expect(page.locator('[data-graph-node]')).toHaveCount(34);
  await list.getByRole('button',{name:'下一页',exact:true}).click();await expect(list.getByText(/9–16/)).toBeVisible();
  const search=page.getByRole('searchbox',{name:'搜索图谱'});await graphSettings(page);await search.fill(examples[679].title);
  const results=page.getByRole('region',{name:'图谱搜索结果',exact:true});await expect(results).toContainText('1 项资料');
  await results.getByRole('button',{name:'打开 '+examples[679].title,exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>window.opened.at(-1)),{path:'例子679'});
  await results.getByRole('button',{name:'加入候选 '+examples[679].title,exact:true}).click();
  await expect(page.getByRole('button',{name:/已选 1 \/ 12/})).toContainText('1 项未展开');
  await page.getByRole('button',{name:'图谱选项',exact:true}).click();
  await graphSettings(page,true);await expect(page.getByRole('button',{name:'选中匹配项',exact:true})).toBeEnabled();
  await graphSettings(page,true);await page.getByRole('button',{name:'选中匹配项',exact:true}).click();
  await page.getByRole('combobox',{name:'图谱资料类型',exact:true}).selectOption('concept');
  await expect(page.getByRole('button',{name:/已选 1 \/ 12/})).toContainText('1 项在筛选外');
  await page.getByRole('combobox',{name:'图谱资料类型',exact:true}).selectOption('all');
  await page.keyboard.press('Escape');
  await graphSettings(page);await search.fill('');
  const filter=page.getByRole('combobox',{name:'知识联系筛选',exact:true});
  const camera=await page.locator('svg > g').getAttribute('transform');await graphSettings(page);await filter.selectOption('established');
  await expect(page.locator('svg > g')).toHaveAttribute('transform',camera);
  await page.getByRole('button',{name:'返回资料概览',exact:true}).click();
  await expect(page.locator('.nv-graph-cluster-backdrop[data-source-path="原书.pdf"]')).toBeFocused();
  await expect(page.getByRole('button',{name:/已选 1 \/ 12/})).toBeVisible();
  await page.getByRole('button',{name:'展开原书，714张卡片',exact:true}).click();
  await page.evaluate(()=>window.renderGraph({...window.data},{key:'refresh'}));
  await expect(page.locator('[data-graph-node]')).toHaveCount(34);await graphSettings(page);await expect(filter).toHaveValue('established');
  await page.getByRole('button',{name:'带入当前对话',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>window.brought.at(-1)),[{path:'例子679',title:examples[679].title,revision:'r679'}]);
  await graphView(page,'all');await expect(page.locator('[data-graph-node]')).toHaveCount(715);
  await expect(page.locator('[data-relation-kind="example"]')).toHaveCount(1360);
  const legacy={nodes:[source,{path:'旧卡',type:'card',title:'旧卡',sourcePaths:[source.path]}],edges:[{source:'旧卡',target:source.path,style:'dashed'}]};
  await page.evaluate(data=>{window.state={positions:new Map()};window.renderGraph(data,{key:'legacy'});},legacy);
  await page.getByRole('button',{name:'展开原书，1张卡片',exact:true}).click();await expect(page.locator('[data-graph-node]')).toHaveCount(2);
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);
});

test('graph loading/failure retry and search escape preserve the progressive source entry',async t=>{
  const {page,errors}=await progressiveFixture(t);
  await page.evaluate(()=>{
    window.remote={graph:()=>new Promise((resolve,reject)=>{window.resolveGraph=resolve;window.rejectGraph=reject;})};
    window.renderGraph(undefined,{remote:window.remote});
  });
  await expect(page.getByRole('status')).toHaveText('正在读取…');
  await page.evaluate(()=>window.rejectGraph(new Error('fixture')));await expect(page.getByRole('alert')).toContainText('暂时无法读取图谱');
  await page.getByRole('button',{name:'重试',exact:true}).click();await expect(page.getByRole('status')).toHaveText('正在读取…');
  await page.evaluate(()=>window.resolveGraph({ok:true,value:{nodes:[{path:'book',type:'source',title:'来源',isSource:true},{path:'case',type:'exercise',title:'隐藏例子',sourcePaths:['book']}],edges:[]}}));
  await expect(page.getByRole('button',{name:'展开来源，1张卡片',exact:true})).toBeVisible();
  await graphSettings(page);await page.getByRole('searchbox',{name:'搜索图谱'}).fill('隐藏例子');await expect(page.getByRole('region',{name:'图谱搜索结果',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.getByRole('region',{name:'图谱搜索结果',exact:true})).toHaveCount(0);
  await graphSettings(page);await page.getByRole('searchbox',{name:'搜索图谱'}).fill('隐藏例子');
  await page.getByRole('region',{name:'图谱搜索结果',exact:true}).getByRole('button',{name:'查看联系 隐藏例子',exact:true}).click();
  await expect(page.getByRole('complementary',{name:'选中节点',exact:true})).toBeVisible();
  await expect(page.getByRole('complementary',{name:'选中节点',exact:true})).toContainText('隐藏例子');
  assert.deepEqual(errors,[]);
});
