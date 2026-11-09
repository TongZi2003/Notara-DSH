import test from 'node:test';
import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {progressiveFixture} from './progressive-browser-fixture.mjs';
import {graphView} from './graph-ui.fixture.mjs';

test('node details separate sources from examples and omit empty groups', {timeout:20000}, async t => {
  const {page, errors} = await progressiveFixture(t);
  await page.evaluate(() => window.renderGraph({relationsVersion:2,nodes:[
    {path:'book',title:'原始讲义',type:'source',isSource:true},
    {path:'empty',title:'还没有案例的知识点',type:'concept',sourcePaths:['book']},
    {path:'concept',title:'有案例的知识点',type:'concept',sourcePaths:['book']},
    {path:'case',title:'案例甲',type:'exercise',sourcePaths:['book']},
  ],edges:[{source:'concept',target:'case',kind:'example',style:'dashed'}]}));
  await graphView(page, 'knowledge');
  await page.locator('[data-graph-node="concept"]').click({modifiers:['Control']});
  await expect(page.locator('[data-graph-node="concept"]')).toHaveAttribute('aria-pressed','true');
  await page.locator('[data-graph-node="concept"]').click({modifiers:['Meta']});
  await expect(page.locator('[data-graph-node="concept"]')).toHaveAttribute('aria-pressed','false');
  const detail = page.getByRole('complementary', {name:'选中节点',exact:true});
  await page.locator('[data-graph-node="empty"]').click();
  await expect(detail.locator('summary')).toHaveCount(0);
  const sources = detail.getByRole('region', {name:'原始来源',exact:true});
  await expect(sources.getByText('来源', {exact:true})).toBeVisible();
  await sources.getByRole('button', {name:'原始讲义 ↗',exact:true}).click();
  assert.equal(await page.evaluate(() => window.opened.at(-1).path), 'book');
  await page.locator('[data-graph-node="concept"]').click();
  await expect(detail.locator('summary')).toHaveText('具体例子 · 1');
  await detail.locator('summary').click();
  await expect(detail.getByRole('region', {name:'具体例子',exact:true}).locator('header')).toHaveCount(0);
  await detail.getByRole('button', {name:'加入候选 案例甲',exact:true}).click();
  await expect(detail.getByRole('button', {name:'移出候选 案例甲',exact:true})).toHaveAttribute('aria-pressed','true');
  assert.deepEqual(errors, []);
});
