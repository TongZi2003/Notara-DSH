import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {startNativeRuntime,workspaceRoot} from '../scripts/native-runtime.mjs';
import {openLibrary} from '../scripts/ui-navigation.mjs';
import {parseMarkdown} from '../plugins/vault-sqlite/frontmatter.js';

test('native document properties edit typed values, tags, add/remove and undo without replacing body', {timeout:90000},async()=>{
  const fixture=await mkdtemp(join(workspaceRoot,'work/property-fixture-'));
  const original='---\ntype: card\ntitle: 属性样例\ntags: [数学, SVD]\nstatus: 待阅读\nscore: 3\nlearned: false\nnext_review: 2026-10-25\ncustom: keep # 保留注释\n---\n# 属性样例\n\n正文保持完整。\n';
  await writeFile(join(fixture,'属性样例.md'),original);
  const runtime=await startNativeRuntime({fixture,testModel:true}), browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1100,height:850}}), errors=[];page.on('pageerror',error=>errors.push(error.message));
  const output=join(workspaceRoot,'outputs/base-library-20261025');await mkdir(output,{recursive:true});
  try{
    await page.goto(runtime.authUrl);await page.getByRole('button',{name:/^(Continue|继续)$/}).click();await page.locator('[data-composer-input]:visible').waitFor();await openLibrary(page);
    await page.locator('.nv-left-files-body').getByRole('button',{name:'属性样例',exact:true}).click();
    const document=page.locator('.nv-vault-doc-tab:visible'), properties=document.getByRole('region',{name:'文档属性',exact:true});
    await properties.getByRole('textbox',{name:'状态',exact:true}).fill('进行中');await properties.getByRole('textbox',{name:'状态',exact:true}).press('Tab');
    await properties.getByRole('spinbutton',{name:'score',exact:true}).fill('5');await properties.getByRole('spinbutton',{name:'score',exact:true}).press('Tab');
    await properties.getByLabel('添加标签',{exact:true}).fill('新标签');await properties.getByLabel('添加标签',{exact:true}).press('Enter');await expect(properties.getByRole('button',{name:'移除标签 新标签',exact:true})).toBeVisible();
    await properties.getByRole('button',{name:'＋ 添加属性',exact:true}).click();await properties.getByLabel('新属性名称').fill('测试备注');await properties.getByRole('button',{name:'添加',exact:true}).click();
    await properties.getByLabel('测试备注',{exact:true}).fill('真实属性编辑');await properties.getByLabel('测试备注',{exact:true}).press('Tab');
    await document.getByRole('button',{name:'保存',exact:true}).click();await expect.poll(async()=>parseMarkdown(await readFile(join(runtime.vault,'属性样例.md'),'utf8')).fields['测试备注']).toBe('真实属性编辑');
    const saved=await readFile(join(runtime.vault,'属性样例.md'),'utf8');const fields=parseMarkdown(saved).fields;assert.equal(fields.status,'进行中');assert.equal(fields.score,5);assert.deepEqual(fields.tags,['数学','SVD','新标签']);assert.ok(saved.includes('custom: keep # 保留注释'));assert.equal(parseMarkdown(saved).body,parseMarkdown(original).body);
    await properties.getByRole('button',{name:'属性 测试备注 的类型与操作',exact:true}).click();await page.getByRole('menuitem',{name:'移除属性',exact:true}).click();await expect(properties.getByLabel('测试备注',{exact:true})).toHaveCount(0);
    await document.getByRole('button',{name:'撤销',exact:true}).click();await expect(properties.getByLabel('测试备注',{exact:true})).toHaveValue('真实属性编辑');
    await page.getByRole('button',{name:'全屏',exact:true}).click();await page.getByRole('button',{name:'最小化会话',exact:true}).click();
    await page.screenshot({path:join(output,'properties-wide.png')});await page.setViewportSize({width:460,height:746});
    await page.evaluate(async()=>{await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));await Promise.allSettled(document.getAnimations().filter(animation=>animation.effect?.getComputedTiming().iterations!==Infinity).map(animation=>animation.finished));});
    await expect(properties).toBeInViewport({ratio:.1});
    await page.screenshot({path:join(output,'properties-narrow.png')});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.deepEqual(errors,[]);
  }catch(error){await page.screenshot({path:join(output,'properties-failure.png')});throw error;}finally{await browser.close();await runtime.stop();await rm(fixture,{recursive:true,force:true});}
});
