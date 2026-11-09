import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { startNativeRuntime, workspaceRoot } from '../scripts/native-runtime.mjs';
import { openLibrary, chooseBaseView , baseAction } from '../scripts/ui-navigation.mjs';
import { parseBase, serializeBase } from '../plugins/vault-sqlite/bases.js';

test('native Base saves filters, layout, columns and sort; review, conflict and theme remain intact', {timeout:120000}, async () => {
  const fixture = await mkdtemp(join(workspaceRoot,'work/base-fixture-'));
  const card='---\ntype: card\ntitle: 甲矩阵\ntags: [数学, 共同, 非常长的专题标签用来验证胶囊始终保持合理的尺寸]\nlearned: true\nmastery: 1\ninterval: 1\nlast_review: 1999-12-31\nnext_review: 2000-01-01\n---\n# 甲矩阵\n## 内容\n矩阵特征计算\n';
  await writeFile(join(fixture,'甲.md'),card.replace('title: 甲矩阵','title: 甲矩阵\nsummary: "概括矩阵特征值问题的对象与用途。"'));
  await writeFile(join(fixture,'乙.md'),'---\ntype: source\ntitle: 乙矩阵\ntags: [数学, 共同]\n---\n# 乙矩阵\n矩阵特征来源\n');
  await writeFile(join(fixture,'丙.md'),'---\ntype: card\ntitle: 丙几何\ntags: [几何]\n---\n# 丙几何\n几何图形\n');
  await writeFile(join(fixture,'专题库.base'),'filters: \'notara.type == "card"\'\nviews:\n  - type: table\n    name: 专题卡片\n    order: [file.name, note.tags]\n');
  await writeFile(join(fixture,'专题导读.md'),'---\ntype: source\ntags: [导读]\n---\n# 专题导读\n- [ ] 阅读甲\n');
  const output=join(workspaceRoot,'outputs/base-library-20261025'); await mkdir(output,{recursive:true});
  const runtime=await startNativeRuntime({fixture,testModel:true}), browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1414,height:850}}), errors=[]; page.on('pageerror',error=>errors.push(error.message)); page.setDefaultTimeout(10000);
  const workspace=page.locator('.nv-base-workspace:visible'), dialog=page.getByRole('dialog');
  const openActions=async name=>{await workspace.getByRole('button',{name:'资料库操作',exact:true}).click();await page.getByRole('menuitem',{name,exact:true}).click();};
  try {
    await page.goto(runtime.authUrl); await page.getByRole('button',{name:/^(Continue|继续)$/}).click(); await page.locator('[data-composer-input]:visible').waitFor();
    await openLibrary(page); await chooseBaseView(page,'全部资料'); await expect(workspace.getByRole('button',{name:'甲矩阵',exact:true})).toBeVisible();
    const originalMode=await page.evaluate(()=>document.documentElement.dataset.notaraConversationMode || 'parallel');
    const basePath=join(runtime.vault,'资料库.base'); assert.equal(parseBase(await readFile(basePath,'utf8')).views.length,3);
    await workspace.getByRole('button',{name:'卡片布局',exact:true}).click(); await expect(workspace.locator('.nv-vault-card')).toHaveCount(5);
    await expect(workspace.locator('.nv-vault-card-summary')).toHaveCount(1);
    await expect(workspace.locator('.nv-vault-card-summary')).toHaveText('概括矩阵特征值问题的对象与用途。');
    await expect(workspace).not.toContainText('矩阵特征计算');
    const sourceCard=workspace.locator('.nv-vault-card').filter({has:page.getByRole('button',{name:'乙矩阵',exact:true})});
    await expect(sourceCard).not.toContainText('记录次数'); await expect(sourceCard).not.toContainText('下次复习');
    await openActions('视图设置…'); await expect(dialog.getByLabel('显示正文预览',{exact:true})).toHaveCount(0);
    await dialog.getByRole('button',{name:'取消',exact:true}).click();
    const legacyConfig=parseBase(await readFile(basePath,'utf8'));legacyConfig.views[0].notara.cardPreview=true;
    await writeFile(basePath,serializeBase(legacyConfig));
    await baseAction(page,workspace,'刷新资料');
    await expect(workspace.locator('.nv-vault-card-summary')).toHaveCount(1);
    await expect(workspace).not.toContainText('矩阵特征计算');
    await chooseBaseView(page,'导读资料'); await expect(workspace.locator('.nv-vault-card')).toHaveCount(1);
    await chooseBaseView(page,'待复习'); await expect(workspace.locator('.nv-vault-card')).toHaveCount(1);
    await workspace.getByRole('button',{name:'开始复习',exact:true}).click();
    await dialog.getByLabel('抽考关键步').fill('矩阵的特征值'); await dialog.getByLabel('本次结果').selectOption('done'); await dialog.getByLabel('本次帮助条件').selectOption('independent'); await dialog.getByLabel('实况备注').fill('独立完成推导');
    await dialog.getByRole('button',{name:'记录这次复习',exact:true}).click(); await expect(dialog.getByRole('status')).toContainText('已记录'); await expect(workspace.locator('.nv-vault-card')).toHaveCount(0);
    await dialog.getByRole('button',{name:'撤销最近一次',exact:true}).click(); await expect(workspace.locator('.nv-vault-card')).toHaveCount(1); await dialog.getByRole('button',{name:'关闭复习',exact:true}).click();
    const secondCard=await readFile(join(runtime.vault,'丙.md'),'utf8');
    await writeFile(join(runtime.vault,'丙.md'),secondCard.replace('---\n#','learned: true\nmastery: 1\ninterval: 1\nlast_review: 1999-12-31\nnext_review: 2000-01-01\n---\n#'));
    await expect(workspace.locator('.nv-vault-card')).toHaveCount(2); await workspace.getByRole('button',{name:'开始复习',exact:true}).click();
    await dialog.getByLabel('抽考关键步').fill('这段填写应在切卡后保留'); await dialog.getByRole('button',{name:'下一张',exact:true}).click(); await dialog.getByRole('button',{name:'上一张',exact:true}).click(); await expect(dialog.getByLabel('抽考关键步')).toHaveValue('这段填写应在切卡后保留'); await dialog.getByRole('button',{name:'关闭复习',exact:true}).click();
    await writeFile(join(runtime.vault,'丙.md'),secondCard); await chooseBaseView(page,'全部资料');
    for(const [control,title] of [['排序','资料排序'],['分组','资料分组'],['属性','显示属性']]) {await baseAction(page,workspace,control); await expect(dialog).toHaveAttribute('aria-label',title); await dialog.getByRole('button',{name:'取消',exact:true}).click();}
    await workspace.getByRole('button',{name:'高级搜索',exact:true}).click();
    await dialog.getByLabel('资料搜索关键词').fill('矩阵'); await dialog.getByLabel('标签 数学',{exact:true}).check(); await dialog.getByLabel('标签 共同',{exact:true}).check(); await dialog.getByLabel('资料排序').selectOption('updated');
    await expect(dialog.getByRole('status')).toHaveText('2 份符合条件'); await dialog.getByRole('button',{name:'应用',exact:true}).click();
    await workspace.getByRole('button',{name:'卡片布局',exact:true}).click(); await expect(workspace.locator('.nv-vault-card')).toHaveCount(2);
    await openActions('保存为视图…'); await dialog.getByLabel('视图名称',{exact:true}).fill('数学共同资料'); await dialog.getByLabel('显示记录次数',{exact:true}).uncheck(); await dialog.getByLabel('资料分组').selectOption('notara.type'); await dialog.getByRole('button',{name:'保存视图',exact:true}).click();
    await expect(workspace.getByRole('button',{name:'切换保存的视图'})).toHaveText('数学共同资料⌄');
    const saved=parseBase(await readFile(basePath,'utf8')).views[3]; assert.equal(saved.type,'cards'); assert.equal(saved.notara.search,'矩阵'); assert.ok(!saved.order.includes('notara.reviewCount')); assert.equal(saved.groupBy.property,'notara.type'); assert.equal(saved.sort[0].property,'file.mtime');
    await page.getByRole('button',{name:'全屏',exact:true}).click(); await expect(page.locator('.nv-conversation-chip')).toHaveCount(1);
    await page.screenshot({path:join(output,'base-cards-wide.png')});
    await workspace.getByRole('button',{name:'表格布局',exact:true}).click(); await expect(workspace.locator('.nv-base-data-row')).toHaveCount(2);
    await page.screenshot({path:join(output,'base-table-wide.png')});
    for(const width of [761,460]) {
      await page.setViewportSize({width,height:746}); await workspace.getByRole('button',{name:'卡片布局',exact:true}).click();
      const sizes=await workspace.locator('.nv-vault-tag').evaluateAll(elements=>elements.map(element=>({width:element.getBoundingClientRect().width,height:element.getBoundingClientRect().height,font:getComputedStyle(element).fontSize,bg:getComputedStyle(element).backgroundColor})));
      assert.ok(sizes.length); assert.ok(sizes.every(x=>x.width <=160.5 && x.height>=22 && x.height<=25 && x.font==='11.5px'),JSON.stringify(sizes));
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await page.screenshot({path:join(output,`base-cards-${width}.png`)});
      await openActions('视图设置…'); await expect(dialog).toHaveCSS('opacity','1'); const box=await dialog.boundingBox(); assert.ok(box.x>=0 && box.x+box.width<=width && box.y+box.height<=746); await page.screenshot({path:join(output,`base-settings-${width}.png`)}); await dialog.getByRole('button',{name:'取消',exact:true}).click();
    }
    await page.setViewportSize({width:1414,height:850}); await page.reload(); await openLibrary(page); await chooseBaseView(page,'数学共同资料'); await expect(workspace.locator('.nv-vault-card')).toHaveCount(2);
    await openActions('视图设置…'); await dialog.getByLabel('视图名称',{exact:true}).fill('本地尚未保存');
    const external=await readFile(basePath,'utf8'); await writeFile(basePath,external+'\n# 外部修改\n');
    await dialog.getByRole('button',{name:'保存视图',exact:true}).click(); await expect(dialog.getByRole('alert')).toContainText('其他窗口'); await expect(dialog.getByLabel('视图名称',{exact:true})).toHaveValue('本地尚未保存'); assert.ok((await readFile(basePath,'utf8')).endsWith('# 外部修改\n'));
    await dialog.getByRole('button',{name:'取消',exact:true}).click();
    const reordered=parseBase(await readFile(basePath,'utf8')); [reordered.views[1],reordered.views[3]]=[reordered.views[3],reordered.views[1]]; const reorderedContent=serializeBase(reordered); await writeFile(basePath,reorderedContent);
    // Query conflicts synchronize automatically; assert the recovered view and file instead of a transient notice.
    await workspace.getByRole('searchbox',{name:'搜索资料',exact:true}).fill('不存在的资料标题'); await expect(workspace.locator('.nv-vault-card')).toHaveCount(0);
    await workspace.getByRole('searchbox',{name:'搜索资料',exact:true}).fill('特征'); await expect(workspace.locator('.nv-vault-card')).toHaveCount(2);
    await expect(workspace.getByRole('button',{name:'切换保存的视图'})).toContainText('数学共同资料'); await expect(workspace.getByRole('alert')).toHaveCount(0); assert.equal(await readFile(basePath,'utf8'),reorderedContent);
    await baseAction(page,workspace,'刷新资料'); await expect(workspace.getByRole('button',{name:'切换保存的视图'})).toContainText('数学共同资料'); await expect(workspace.locator('.nv-vault-card')).toHaveCount(2);
    await page.locator('.nv-left-files-body').getByRole('button',{name:'专题库',exact:true}).click(); await expect(page.locator('.nv-vault-doc-tab:visible .nv-base-workspace')).toHaveAttribute('data-base-path','专题库.base'); await expect(workspace.locator('.nv-base-data-row')).toHaveCount(2);
    assert.equal(await readFile(join(runtime.vault,'乙.md'),'utf8'),await readFile(join(fixture,'乙.md'),'utf8'));
    assert.equal(originalMode,'parallel'); assert.deepEqual(errors,[]);
  } catch(error) {await page.screenshot({path:join(output,'base-failure.png')}); throw error;}
  finally {await browser.close();await runtime.stop();await rm(fixture,{recursive:true,force:true});}
});
