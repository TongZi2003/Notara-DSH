import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {startNativeRuntime,workspaceRoot} from '../scripts/native-runtime.mjs';
import {openLibrary,chooseBaseView} from '../scripts/ui-navigation.mjs';
import {parseBase} from '../plugins/vault-sqlite/bases.js';

test('source overview and source cards can create persistent views; management stays reachable',{timeout:90000},async()=>{
  const fixture=await mkdtemp(join(workspaceRoot,'work/library-view-create-'));
  await writeFile(join(fixture,'讲义.md'),'---\ntype: source\n---\n# 讲义');
  await writeFile(join(fixture,'例题.md'),'---\ntype: exercise\n---\n# 例题\n## 来源\n[[讲义.md]]');
  const runtime=await startNativeRuntime({fixture,testModel:true}),browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1150,height:746}});page.setDefaultTimeout(6000);
  const base=page.locator('.nv-base-workspace:visible'),dialog=page.getByRole('dialog'),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const config=async()=>parseBase(await readFile(join(runtime.vault,'资料库.base'),'utf8'));
  const create=async name=>{await base.getByRole('button',{name:'切换保存的视图'}).click();await page.getByRole('menuitem',{name:'＋ 添加视图',exact:true}).click();await dialog.getByLabel('视图名称',{exact:true}).fill(name);await dialog.getByRole('button',{name:'保存视图',exact:true}).click();await expect(base.getByRole('button',{name:'切换保存的视图'})).toContainText(name);};
  try{
    await page.goto(runtime.authUrl);await page.getByRole('button',{name:/^(Continue|继续)$/}).click();await page.locator('[data-composer-input]:visible').waitFor();await openLibrary(page);
    await expect(base.locator('.nv-base-data-row')).toHaveCount(2);
    for(const name of ['切换保存的视图','资料库操作']){
      const trigger=base.getByRole('button',{name,exact:true});
      for(let i=0;i<2;i++){
        await trigger.click();await expect(trigger).toHaveAttribute('aria-expanded','true');await expect(page.getByRole('menu')).toHaveCount(1);
        await trigger.click();await expect(trigger).toHaveAttribute('aria-expanded','false');await expect(page.getByRole('menu')).toHaveCount(0);
      }
      await trigger.press('Enter');await expect(trigger).toHaveAttribute('aria-expanded','true');
      await page.keyboard.press('Escape');await expect(trigger).toHaveAttribute('aria-expanded','false');await expect(trigger).toBeFocused();
      await trigger.click();await base.getByRole('searchbox',{name:'搜索资料',exact:true}).click();await expect(trigger).toHaveAttribute('aria-expanded','false');
    }
    await base.getByRole('button',{name:'切换保存的视图',exact:true}).click();await base.getByRole('button',{name:'资料库操作',exact:true}).click();
    await expect(base.getByRole('button',{name:'切换保存的视图',exact:true})).toHaveAttribute('aria-expanded','false');await expect(page.getByRole('menu')).toHaveCount(1);await page.keyboard.press('Escape');
    const before=(await config()).views;
    await create('原文清单');await expect(base.locator('.nv-base-data-row')).toHaveCount(2);
    assert.equal((await config()).views[3].notara.scope,'sources');
    assert.deepEqual((await config()).views.slice(0,3),before);
    await page.reload();await openLibrary(page);await chooseBaseView(page,'原文清单');await expect(base.locator('.nv-base-data-row')).toHaveCount(2);
    await writeFile(join(runtime.vault,'新笔记.md'),'---\ntype: source\n---\n# 新笔记');await expect(base.locator('.nv-base-data-row')).toHaveCount(3);
    await chooseBaseView(page,'原始资料');await base.getByRole('button',{name:'讲义',exact:true}).click();await expect(base.locator('.nv-base-data-row')).toHaveCount(1);
    await create('讲义相关卡片');await expect(base.getByRole('button',{name:'例题',exact:true})).toBeVisible();
    const saved=(await config()).views[4];assert.equal(saved.notara.sourcePath,'讲义.md');assert.equal(saved.notara.scope,undefined);assert.equal(saved.notara.preset,undefined);
    await page.reload();await openLibrary(page);await chooseBaseView(page,'讲义相关卡片');await expect(base.locator('.nv-base-data-row')).toHaveCount(1);
    await chooseBaseView(page,'原始资料');await base.getByRole('button',{name:'切换保存的视图'}).click();await page.getByRole('menuitem',{name:'管理视图…',exact:true}).click();await expect(dialog.getByLabel('重命名视图 原文清单',{exact:true})).toBeVisible();
    await dialog.getByRole('button',{name:'打开视图 原文清单',exact:true}).click();await expect(base.getByRole('button',{name:'切换保存的视图'})).toContainText('原文清单');await expect(base.locator('.nv-base-data-row')).toHaveCount(3);
    await base.getByRole('button',{name:'卡片布局',exact:true}).click();await expect(base.locator('.nv-vault-card')).toHaveCount(3);
    await base.getByRole('button',{name:'讲义',exact:true}).click();await expect(base.locator('.nv-vault-card')).toHaveCount(1);await expect(base.getByRole('button',{name:'例题',exact:true})).toBeVisible();
    assert.deepEqual(errors,[]);
  }finally{await browser.close();await runtime.stop();await rm(fixture,{recursive:true,force:true});}
});
