import test from 'node:test';
import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {progressiveFixture} from './progressive-browser-fixture.mjs';
import {graphSettings,graphView} from './graph-ui.fixture.mjs';

test('expanded unassigned group retains reference lines in both themes; search owns one rounded focus ring',async t=>{
  const {page,errors}=await progressiveFixture(t,{viewport:{width:642,height:746}});
  page.setDefaultTimeout(5000);
  const nodes=Array.from({length:17},(_,i)=>({path:`卡片${i}`,title:`知识与例子${i}`,type:i%2?'exercise':'concept',sourcePaths:[]}));
  const edges=nodes.slice(1,16).map((node,i)=>({source:nodes[i].path,target:node.path,kind:'reference',style:'dashed',knowledge:false}));
  await page.evaluate(data=>window.renderGraph(data),{relationsVersion:2,nodes:[{path:'原书',title:'原书',type:'source',isSource:true},...nodes],edges});
  // The overview remains restrained. Expanding is the request to inspect the
  // group's existing relations, not to reinterpret references as prerequisites.
  await expect(page.locator('.nv-block-edge')).toHaveCount(0);
  await page.locator('[data-cluster-kind="unassigned"]').press('Enter');
  await expect(page.locator('[data-graph-node]')).toHaveCount(17);
  await expect(page.locator('[data-relation-kind="reference"]')).toHaveCount(15);
  for(const dark of [false,true]){
    await page.evaluate(dark=>{document.body.toggleAttribute('data-ds-dark-theme',dark);document.documentElement.style.cssText=dark?'--dsw-alias-bg-base:#1e1e20;--dsw-alias-label-primary:#e5e5e5;--claude-clay:#baa2e8;--claude-clay-soft:#baa2e826;':'--dsw-alias-bg-base:#fafafa;--dsw-alias-label-primary:#202024;--claude-clay:#7752b8;--claude-clay-soft:#7752b826;';},dark);
    const lines=await page.locator('[data-relation-kind="reference"]').evaluateAll(items=>items.map(e=>({stroke:getComputedStyle(e).stroke,opacity:getComputedStyle(e).opacity,display:getComputedStyle(e).display,style:e.classList.contains('nv-block-edge-dashed')})));
    assert.ok(lines.every(e=>e.stroke!=='none'&&Number(e.opacity)>0&&e.display!=='none'&&e.style));
    await graphSettings(page);const input=page.getByRole('searchbox',{name:'搜索图谱',exact:true});await input.focus();
    const focus=await input.evaluate(e=>({inner:getComputedStyle(e).outlineStyle,outer:getComputedStyle(e.parentElement).boxShadow,radius:getComputedStyle(e.parentElement).borderRadius}));
    assert.equal(focus.inner,'none');assert.notEqual(focus.outer,'none');assert.notEqual(focus.radius,'0px');
    await page.getByRole('button',{name:'关闭图谱选项'}).click();
  }
  await graphSettings(page);await page.getByRole('combobox',{name:'知识联系筛选'}).selectOption('established');
  await expect(page.locator('[data-relation-kind="reference"]:visible')).toHaveCount(0);
  await graphView(page,'knowledge');await expect(page.locator('[data-relation-kind="reference"]')).toHaveCount(0);
  assert.deepEqual(errors,[]);
});
