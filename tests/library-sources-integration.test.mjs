import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {startNativeRuntime,workspaceRoot} from '../scripts/native-runtime.mjs';
import {openLibrary,chooseBaseView,baseAction} from '../scripts/ui-navigation.mjs';
import {defaultLibraryBase,serializeBase} from '../plugins/vault-sqlite/bases.js';

test('native library starts with sources, drills into cards and offers simple contextual filtering', {timeout:120000}, async()=>{
  const fixture=await mkdtemp(join(workspaceRoot,'work/library-source-fixture-'));
  const config=defaultLibraryBase();config.views[0].groupBy={property:'notara.type',direction:'ASC'};
  const initial=serializeBase(config);
  const files={
    '资料库.base':initial,
    '不等式讲义.md':'---\ntype: source\ntags: [数学]\n---\n# 不等式讲义',
    '学校笔记.md':'---\ntype: source\n---\n# 学校笔记',
    '空讲义.md':'---\ntype: source\n---\n# 空讲义',
    '导读.md':'---\ntype: guide\n---\n# 导读\n[[不等式讲义.md]]',
    '均值不等式.md':'---\ntype: concept\ntags: [不等式]\nlearned: true\nmastery: 1\ninterval: 1\nlast_review: 1999-12-31\nnext_review: 2000-01-01\n---\n# 均值不等式\n## 来源\n[[不等式讲义.md]]\n[[学校笔记.md]]',
    '练习题.md':'---\ntype: exercise\ntags: [练习]\n---\n# 练习题\n## 来源\n[[不等式讲义.md]]',
    '无关概念.md':'---\ntype: concept\n---\n# 无关概念\n## 参考理解\n[[不等式讲义.md]]',
  };
  for(const [path,content] of Object.entries(files))await writeFile(join(fixture,path),content);
  const runtime=await startNativeRuntime({fixture,testModel:true}),browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1150,height:746}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
  const base=page.locator('.nv-base-workspace:visible'),dialog=page.getByRole('dialog'), output=join(workspaceRoot,'outputs/library-sources-20261105');await mkdir(output,{recursive:true});
  try{
    await page.goto(runtime.authUrl);await page.getByRole('button',{name:/^(Continue|继续)$/}).click();await page.locator('[data-composer-input]:visible').waitFor();await openLibrary(page);
    await expect(base.getByRole('button',{name:'切换保存的视图'})).toContainText('原始资料');
    await expect(base.locator('.nv-base-data-row')).toHaveCount(4);
    await expect(base.getByRole('button',{name:'批量带入当前对话'})).toHaveCount(0);
    await expect(base.getByRole('button',{name:'开始复习'})).toHaveCount(0);
    await expect(base.getByRole('columnheader',{name:'记录次数'})).toHaveCount(0);
    await base.getByRole('button',{name:'不等式讲义',exact:true}).click();
    await expect(base.locator('.nv-base-data-row')).toHaveCount(2);
    await expect(base.getByRole('button',{name:'无关概念',exact:true})).toHaveCount(0);
    await base.getByRole('button',{name:'筛选',exact:true}).click();
    await dialog.getByLabel('筛选资料类型',{exact:true}).selectOption('exercise');await expect(base.locator('.nv-base-data-row')).toHaveCount(1);
    await dialog.getByLabel('筛选资料类型',{exact:true}).selectOption('');
    await dialog.getByRole('button',{name:'筛选标签',exact:true}).click();await dialog.getByLabel('标签 练习',{exact:true}).check();await dialog.getByRole('button',{name:'应用',exact:true}).click();
    await expect(base.locator('.nv-base-data-row')).toHaveCount(1);
    await base.getByRole('button',{name:'练习题',exact:true}).click({modifiers:['ControlOrMeta']});await expect(base.getByRole('button',{name:'批量带入当前对话'})).toBeEnabled();
    await base.getByRole('button',{name:'取消选择'}).click();await expect(base.getByRole('button',{name:'批量带入当前对话'})).toHaveCount(0);
    await base.getByRole('button',{name:'返回原始资料'}).click();await expect(base.locator('.nv-base-data-row')).toHaveCount(4);
    await base.getByRole('button',{name:'筛选',exact:true}).click();await dialog.getByRole('button',{name:'筛选来源',exact:true}).click();await dialog.getByLabel('来源 学校笔记',{exact:true}).click();await expect(base.locator('.nv-base-data-row')).toHaveCount(1);
    await base.getByRole('button',{name:'返回原始资料'}).click();await base.getByRole('button',{name:'空讲义',exact:true}).click();await expect(base.locator('.nv-base-data-row')).toHaveCount(0);await expect(base.getByRole('button',{name:'打开原文 ↗'})).toBeVisible();
    await chooseBaseView(page,'全部资料');await expect(base.locator('.nv-base-data-row')).toHaveCount(8);
    await expect(base.getByRole('columnheader',{name:'类型',exact:true})).toHaveCount(0);
    await expect(base.getByRole('columnheader',{name:'记录次数'})).toHaveCount(0);
    await expect(base.getByRole('button',{name:'开始复习'})).toHaveCount(0);
    await baseAction(page,base,'高级筛选…');await expect(dialog.getByRole('tab',{name:'当前视图',exact:true})).toBeVisible();await page.keyboard.press('Escape');
    await chooseBaseView(page,'待复习');await expect(base.getByRole('button',{name:'开始复习'})).toHaveCount(0);await expect(base.getByRole('button',{name:'均值不等式',exact:true})).toBeVisible();
    await chooseBaseView(page,'原始资料');await page.getByRole('button',{name:'全屏',exact:true}).click();await page.getByRole('button',{name:'最小化会话',exact:true}).click();await page.getByRole('button',{name:/^(Collapse sidebar|收起侧边栏)$/}).click();
    for(const width of [1150,642,460]){await page.setViewportSize({width,height:746});await expect(base.locator('.nv-base-data-row')).toHaveCount(4);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:join(output,`sources-${width}.png`)});}
    await page.setViewportSize({width:1150,height:746});await base.getByRole('button',{name:'不等式讲义',exact:true}).click();await expect(base.locator('.nv-base-data-row')).toHaveCount(2);await page.screenshot({path:join(output,'source-cards.png')});
    await baseAction(page,base,'刷新资料');await expect(base.getByRole('button',{name:'返回原始资料'})).toBeVisible();await expect(base.locator('.nv-base-data-row')).toHaveCount(2);
    assert.equal(await readFile(join(runtime.vault,'资料库.base'),'utf8'),initial,'browsing must not rewrite saved views');
    assert.deepEqual(errors,[]);
  }catch(error){await page.screenshot({path:join(output,'failure.png')});throw error;}
  finally{await browser.close();await runtime.stop();await rm(fixture,{recursive:true,force:true});}
});
