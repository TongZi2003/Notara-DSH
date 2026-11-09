import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {startNativeRuntime,workspaceRoot} from '../scripts/native-runtime.mjs';
import {openLibrary,openGraph,graphAction} from '../scripts/ui-navigation.mjs';

test('filter pickers keep their frame through loading, empty results, selection and retry',{timeout:90000},async()=>{
  const fixture=await mkdtemp(join(workspaceRoot,'work/filter-picker-fixture-'));
  for(let i=0;i<44;i++)await writeFile(join(fixture,`资料${i}.md`),`---\ntype: source\ntags: [需要完整显示且不撑高弹层的长专题标签${i}]\n---\n# 资料${i}`);
  const runtime=await startNativeRuntime({fixture,testModel:true}),browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:642,height:746}}),errors=[],evidence=[];
  page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(8000);
  const base=page.locator('.nv-base-workspace:visible'),dialog=page.getByRole('dialog');
  let gate=null,release=null,seen=null,failNext=false;
  await page.route('**/api/notaraVault/query',async route=>{
    const input=route.request().postDataJSON()?.payload?.args?.input;
    if(input?.limit!==40)return route.continue();
    if(failNext){failNext=false;return route.fulfill({status:503,body:'temporarily unavailable'});}
    const response=await route.fetch();
    if(gate){const wait=gate;gate=null;seen();await wait;}
    await route.fulfill({response});
  });
  const arm=()=>{gate=new Promise(resolve=>{release=resolve;});return new Promise(resolve=>{seen=resolve;});};
  const rect=async()=>dialog.evaluate(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};});
  const stable=(before,after,label)=>{evidence.push({label,before,after});for(const key of ['x','y','width','height'])assert.ok(Math.abs(before[key]-after[key])<=1,`${label}: ${key} moved ${before[key]} -> ${after[key]}`);};
  const output=join(workspaceRoot,'work/filter-picker-stability-20261105');await mkdir(output,{recursive:true});
  try{
    await page.goto(runtime.authUrl);await page.getByRole('button',{name:/^(Continue|继续)$/}).click();await page.locator('[data-composer-input]:visible').waitFor();await openLibrary(page);
    for(const kind of ['来源','标签']){
      const trigger=base.getByRole('button',{name:`筛选${kind}`,exact:true});
      const held=arm();await trigger.click();await held;
      const before=await rect();release();release=null;
      await expect(dialog.locator('.nv-filter-options-list input')).toHaveCount(40);
      stable(before,await rect(),`${kind} loaded`);
      const search=dialog.getByRole('searchbox',{name:kind==='来源'?'查找来源':'查找资料标签',exact:true});
      await expect(search).toBeFocused();
      await search.fill('不存在的候选');await expect(dialog.getByText('没有匹配的候选项',{exact:true})).toBeVisible();
      stable(before,await rect(),`${kind} empty`);
      failNext=true;await search.fill('失败探针');await expect(dialog.getByRole('button',{name:'重试候选',exact:true})).toBeVisible();
      stable(before,await rect(),`${kind} error`);
      await dialog.getByRole('button',{name:'重试候选',exact:true}).click();await expect(dialog.getByText('没有匹配的候选项',{exact:true})).toBeVisible();
      stable(before,await rect(),`${kind} retry`);
      await search.fill('');await expect(dialog.locator('.nv-filter-options-list input')).toHaveCount(40);
      await dialog.getByRole('button',{name:`${kind}下一页`,exact:true}).click();await expect(dialog.locator('.nv-filter-options-list')).toHaveAttribute('aria-busy','false');await expect(dialog.locator('.nv-filter-options-list input')).not.toHaveCount(40);
      stable(before,await rect(),`${kind} last page`);
      if(kind==='标签'){
        await dialog.locator('.nv-filter-options-list input').nth(0).check();await dialog.locator('.nv-filter-options-list input').nth(1).check();await dialog.locator('.nv-filter-options-list input').nth(2).check();
        stable(before,await rect(),'tag selection');
      }
      await page.setViewportSize({width:390,height:440});
      const small=await rect();assert.ok(small.x>=0&&small.y>=0&&small.x+small.width<=390&&small.y+small.height<=440,JSON.stringify(small));
      if(kind==='标签')await expect(dialog.getByRole('button',{name:'应用',exact:true})).toBeInViewport();
      await page.screenshot({path:join(output,`${kind}-narrow.png`)});
      await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();
      await page.setViewportSize({width:642,height:746});
    }
    await page.emulateMedia({reducedMotion:'reduce'});await base.getByRole('button',{name:'筛选来源',exact:true}).click();await expect(dialog).toHaveCSS('animation-name','none');await page.keyboard.press('Escape');
    await openGraph(page);
    const graph=page.locator('.nv-independent-graph');
    for(const kind of ['标签筛选','中心节点']){
      await graphAction(page,graph,{name:kind,exact:true});
      const before=await rect(),search=dialog.getByRole('searchbox');
      await search.fill('不存在的候选');await expect(dialog.getByText('没有匹配的候选项',{exact:true})).toBeVisible();
      stable(before,await rect(),`graph ${kind} empty`);
      await search.fill('');await expect(dialog.locator('.nv-filter-options-list input')).toHaveCount(40);
      for(let i=0;i<4;i++)await dialog.locator('.nv-filter-options-list input').nth(i).check();
      stable(before,await rect(),`graph ${kind} selected`);
      await dialog.getByRole('button',{name:kind==='标签筛选'?'查看已选标签':'查看已选中心节点',exact:true}).click();
      await expect(dialog.locator('.nv-filter-options-list input')).toHaveCount(4);
      stable(before,await rect(),`graph ${kind} selected only`);
      await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
      await expect(graph.getByRole('button',{name:kind,exact:true})).toBeFocused();
    }
    assert.deepEqual(errors,[]);
  }finally{release?.();await writeFile(join(output,'geometry.json'),JSON.stringify(evidence,null,2));await browser.close();await runtime.stop();await rm(fixture,{recursive:true,force:true});}
});
