import {graphAction,graphSelect} from '../scripts/ui-navigation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {startNativeRuntime,workspaceRoot} from '../scripts/native-runtime.mjs';
async function openGraph(page){
  const tab=page.locator('.nv-doc-tab-chip:visible').filter({hasText:/^知识图谱$/});
  if(await tab.count()){await tab.click();return;}
  await page.getByRole('tablist',{name:'工作区栏目'}).getByRole('tab',{name:'资料',exact:true}).click();
  await page.locator('.nv-left-files-body').getByRole('button',{name:'知识图谱',exact:true}).click();
  await page.locator('.nv-independent-graph:visible').getByRole('button',{name:'全部联系',exact:true}).click();
}

test('graph hop expansion, modifier selection, marquee and context menu bring native references without sending', {timeout:120000},async()=>{
  const fixture=await mkdtemp(join(workspaceRoot,'work/graph-select-'));
  for(const [title,type,next] of [['甲概念','concept','乙来源'],['乙来源','source','丙方法'],['丙方法','method','丁习题'],['丁习题','exercise','']])await writeFile(join(fixture,title+'.md'),`---\ntitle: ${title}\ntype: ${type}\ntags: [数学]\n---\n# ${title}\n\n正文\n${next?`[[${next}]]`:''}\n`);
  for(let i=0;i<13;i++)await writeFile(join(fixture,`额外${i}.md`),`---\ntype: source\n---\n# 额外${i}\n`);
  await writeFile(join(fixture,'今日日记.md'),'---\ntype: diary\n---\n# 今日日记\n[[甲概念]]\n[[学习导读]]\n');
  await writeFile(join(fixture,'学习导读.md'),'---\ntype: source\n---\n# 学习导读\n[[丙方法]]\n');
  const out=join(workspaceRoot,'outputs/graph-selection-20261027');await mkdir(out,{recursive:true});
  const runtime=await startNativeRuntime({fixture,testModel:true}),browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1414,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
  const graph=page.locator('.nv-independent-graph:visible'),input=page.locator('[data-composer-input]');
  const node=title=>graph.locator(`[data-graph-node="${title}.md"]`);
  const dismissDetail=async()=>{const close=graph.getByRole('button',{name:'取消节点选择',exact:true});if(await close.isVisible())await close.click();};
  const retain=async text=>{await input.fill(text);await input.press('Enter');await page.locator('section.nv-block-flow:visible').waitFor();await expect(page.getByRole('button',{name:/^(Stop generating|停止生成)$/})).toHaveCount(0);};
  try{
    await page.goto(runtime.authUrl);await page.getByRole('button',{name:/^(Continue|继续)$/}).click();await page.locator('[data-composer-input]:visible').waitFor();await page.waitForLoadState('networkidle');
    await retain('测试会话A');await input.fill('A的原草稿');await openGraph(page);
    await expect(node('今日日记')).toHaveCount(0);await expect(node('学习导读')).toHaveCount(0);
    await graphAction(page,graph,{name:'中心节点',exact:true});
    const centers=page.getByRole('dialog',{name:'中心节点',exact:true});
    await centers.getByLabel('查找中心资料').fill('今日日记');
    await centers.getByLabel('中心资料 今日日记',{exact:true}).check();
    await centers.getByRole('button',{name:'应用',exact:true}).click();
    await expect(node('今日日记')).toBeVisible();await expect(graph.locator('[data-graph-node]')).toHaveCount(2);
    await expect(node('学习导读')).toHaveCount(0);
    await graphAction(page,graph,{name:'退出中心',exact:true});
    await expect(node('今日日记')).toHaveCount(0);
    await graphAction(page,graph,{name:'选中当前结果',exact:true});await expect(graph.getByRole('status')).toContainText('最多选择 12');await expect(graph.getByRole('button',{name:'已选 0 / 12',exact:true})).toBeVisible();
    await graphSelect(page,graph,'图谱资料类型','cards');await expect(graph.locator('[data-graph-node]')).toHaveCount(3);
    await node('甲概念').click({modifiers:['Meta']});await dismissDetail();await expect(graph.getByRole('button',{name:'已选 1 / 12',exact:true})).toBeVisible();
    await graphAction(page,graph,{name:'展开关联',exact:true});await expect(graph.locator('[data-graph-node]')).toHaveCount(2);
    await graphSelect(page,graph,'中心联系范围','2');await expect(graph.locator('[data-graph-node]')).toHaveCount(3);
    await graphSelect(page,graph,'中心联系范围','3');await expect(graph.locator('[data-graph-node]')).toHaveCount(4);
    await node('丙方法').click({modifiers:['Meta']});await dismissDetail();await expect(graph.getByRole('button',{name:'已选 2 / 12',exact:true})).toBeVisible();
    await graphSelect(page,graph,'图谱资料类型','source');await expect(graph.getByRole('button',{name:'已选 2 / 12 · 1 项在筛选外',exact:true})).toBeVisible();
    await graphSelect(page,graph,'图谱资料类型','all');
    await node('甲概念').click({button:'right'});await expect(page.getByRole('menuitem',{name:'带入当前对话（2）',exact:true})).toBeVisible();await page.keyboard.press('Escape');
    // Keep the selection through an actual native conversation change.
    await page.getByRole('button',{name:/^(New session|新会话|新建会话)$/}).click();await page.locator('[data-composer-input]:visible').waitFor();await retain('测试会话B');await input.fill('B的原草稿');await openGraph(page);
    await expect(graph.getByRole('button',{name:'已选 2 / 12',exact:true})).toBeVisible();
    await node('甲概念').click({button:'right'});await page.getByRole('menuitem',{name:'带入当前对话（2）',exact:true}).click();
    await expect(input).toContainText('B的原草稿');await expect(input).toContainText('甲概念');await expect(input).toContainText('丙方法');
    await expect(page.locator('section.nv-block-flow:visible')).toHaveCount(1);
    await page.screenshot({path:join(out,'references-in-draft.png')});
    await page.getByRole('tablist',{name:'工作区栏目'}).getByRole('tab',{name:'会话',exact:true}).click();await page.locator('.nv-session-row[data-selected="false"] button.nv-session-open').click();
    await expect(input).toHaveText('A的原草稿');await openGraph(page);
    await expect(graph.getByRole('button',{name:'已选 0 / 12',exact:true})).toBeVisible();
    await graphAction(page,graph,{name:'适应当前范围',exact:true});await graphAction(page,graph,{name:'框选资料',exact:true});
    const canvas=graph.locator('.nv-block-graph-canvas');await canvas.scrollIntoViewIfNeeded();
    const box=await canvas.boundingBox();
    await page.mouse.move(box.x+5,box.y+5);await page.mouse.down();await page.mouse.move(box.x+box.width-5,box.y+box.height-5,{steps:10});await page.keyboard.press('Escape');await page.mouse.up();
    await expect(graph.getByRole('button',{name:'已选 0 / 12',exact:true})).toBeVisible();await expect(graph.locator('.nv-graph-marquee')).toHaveCount(0);
    await graphAction(page,graph,{name:'框选资料',exact:true});
    const target=await node('甲概念').locator('circle').last().boundingBox();await page.mouse.move(target.x+target.width/2,target.y+target.height/2);await page.mouse.down();await page.mouse.move(target.x+target.width/2+20,target.y+target.height/2+10,{steps:4});await page.waitForTimeout(650);await page.mouse.up();
    await expect(graph.getByRole('button',{name:'已选 0 / 12',exact:true})).toBeVisible();
    await page.mouse.move(box.x+5,box.y+5);await page.mouse.down();await page.mouse.move(box.x+box.width-5,box.y+box.height-5,{steps:10});await page.mouse.up();
    await expect(graph.getByRole('button',{name:'已选 4 / 12',exact:true})).toBeVisible();
    await graphAction(page,graph,{name:'退出框选',exact:true});
    await graphAction(page,graph,{name:'已选 4 / 12',exact:true});await page.getByRole('checkbox',{name:'带入资料 乙来源',exact:true}).uncheck();await page.getByRole('button',{name:'完成选择',exact:true}).click();
    await expect(graph.getByRole('button',{name:'已选 3 / 12',exact:true})).toBeVisible();
    await page.screenshot({path:join(out,'selected-graph.png')});
    await page.setViewportSize({width:755,height:746});await expect(graph.getByRole('button',{name:'带入当前对话',exact:true})).toBeVisible();
    await page.screenshot({path:join(out,'selected-graph-narrow.png')});
    assert.deepEqual(errors,[]);await writeFile(join(out,'browser-result.json'),JSON.stringify({status:'PASS',hopCounts:[2,3,4],modifierMultiSelect:true,contextMenu:true,marquee:true,selectionSurvivesSessionSwitch:true,draftIsolation:true,noAutoSend:true,limit:true,errors},null,2));
  }catch(error){await page.screenshot({path:join(out,'browser-failure.png')});await writeFile(join(out,'browser-failure.txt'),error.stack+'\n'+await page.locator('body').innerText());throw error;}
  finally{await browser.close();await runtime.stop();await rm(fixture,{recursive:true,force:true});}
});
