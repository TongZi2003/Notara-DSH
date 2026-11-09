import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {startNativeRuntime,workspaceRoot} from '../scripts/native-runtime.mjs';
import {openLibrary,chooseBaseView,openGraph,focusLibrary, baseAction } from '../scripts/ui-navigation.mjs';
import {defaultLibraryBase,serializeBase,parseBase} from '../plugins/vault-sqlite/bases.js';
import {parseMarkdown} from '../plugins/vault-sqlite/frontmatter.js';
import {graphView} from '../plugins/graph-and-blocks/test/graph-ui.fixture.mjs';

test('native editable grid preserves CAS and undo, wraps tags, persists views, and opens an independent graph', {timeout:120000},async()=>{
  const fixture=await mkdtemp(join(workspaceRoot,'work/base-grid-fixture-'));
  const card='---\ntype: card\ntitle: 样例甲\ntags: [线性代数, SVD, 低秩近似, 手算推导, 矩阵理论]\nstatus: 待阅读\nscore: 3\nflag: false\n---\n# 样例甲\n\n正文不能被属性编辑改写。\n';
  await writeFile(join(fixture,'甲.md'),card);await writeFile(join(fixture,'乙.md'),'---\ntype: source\ntitle: 样例乙\ntags: [线性代数]\nstatus: 进行中\nscore: 1\n---\n# 样例乙\n');
  const config=defaultLibraryBase();config.filters='file.ext == "md"';config.views[0].order=['file.name','note.tags','note.status',"note['score']",'note.flag'];config.properties['note.status']={displayName:'状态'};config.properties["note['score']"]={displayName:'评分'};config.properties['note.flag']={displayName:'标记'};
  await writeFile(join(fixture,'资料库.base'),serializeBase(config));
  const runtime=await startNativeRuntime({fixture,testModel:true}),browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1200,height:850}}), errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000);
  const output=join(workspaceRoot,'outputs/base-library-20261025');await mkdir(output,{recursive:true});
  const base=page.locator('.nv-base-workspace:visible'),dialog=page.getByRole('dialog'),row=()=>base.locator('.nv-base-data-row').filter({has:page.getByRole('button',{name:'样例甲',exact:true})});
  const fields=async()=>parseMarkdown(await readFile(join(runtime.vault,'甲.md'),'utf8')).fields;
  try{
    await page.goto(runtime.authUrl);await page.getByRole('button',{name:/^(Continue|继续)$/}).click();await page.locator('[data-composer-input]:visible').waitFor();await openLibrary(page);await chooseBaseView(page,'全部资料');await page.getByRole('button',{name:'全屏',exact:true}).click();await page.getByRole('button',{name:'最小化会话',exact:true}).click();
    await expect(base.locator('.nv-base-data-row')).toHaveCount(2);
    await expect(base.getByRole('checkbox',{name:/^选择 /})).toHaveCount(0);
    await row().getByRole('checkbox',{name:'编辑 标记 样例甲',exact:true}).check();await expect.poll(async()=>(await fields()).flag).toBe(true);
    await row().getByRole('checkbox',{name:'编辑 标记 样例甲',exact:true}).uncheck();await expect.poll(async()=>(await fields()).flag).toBe(false);
    await row().getByRole('gridcell',{name:'待阅读',exact:true}).dblclick();await base.getByRole('textbox',{name:'编辑 状态',exact:true}).fill('已阅读');await base.getByRole('textbox',{name:'编辑 状态',exact:true}).press('Tab');await expect.poll(async()=>(await fields()).status).toBe('已阅读');
    await base.getByRole('button',{name:'撤销属性修改',exact:true}).click();await expect.poll(async()=>(await fields()).status).toBe('待阅读');await base.getByRole('button',{name:'重做',exact:true}).click();await expect.poll(async()=>(await fields()).status).toBe('已阅读');
    assert.equal(parseMarkdown(await readFile(join(runtime.vault,'甲.md'),'utf8')).body,parseMarkdown(card).body);
    // An external update must not be overwritten by an old undo entry.
    await writeFile(join(runtime.vault,'甲.md'),(await readFile(join(runtime.vault,'甲.md'),'utf8')).replace('status: "已阅读"','status: 外部修改'));
    await base.getByRole('button',{name:'撤销属性修改',exact:true}).click();await expect(base.getByRole('alert')).toContainText('其他地方修改');assert.equal((await fields()).status,'外部修改');
    await base.getByRole('button',{name:'卡片布局',exact:true}).click();await base.getByRole('button',{name:'表格布局',exact:true}).click();await expect(base.getByRole('alert')).toContainText('其他地方修改');
    await base.getByRole('button',{name:'放弃本次修改',exact:true}).click();await baseAction(page,base,'刷新资料');await expect(row().getByRole('gridcell',{name:'外部修改',exact:true})).toBeVisible();
    // Every tag stays within its actual cell; there is no selection column.
    await page.setViewportSize({width:755,height:746});
    await expect(base.getByRole('grid',{name:'资料表格'})).toHaveAttribute('aria-colcount','5');
    const tags=await row().locator('[role="gridcell"]').filter({has:page.locator('.nv-vault-tags')}).evaluate(el=>{const box=el.getBoundingClientRect();return [...el.querySelectorAll('.nv-vault-tag')].map(tag=>{const r=tag.getBoundingClientRect();return r.right<=box.right+1&&r.bottom<=box.bottom+1;});});assert.equal(tags.length,5);assert.ok(tags.every(Boolean));
    await page.screenshot({path:join(output,'grid-complete-tags-755.png')});await page.setViewportSize({width:1200,height:850});
    await baseAction(page,base,'高级筛选…');await expect(dialog.getByRole('tab',{name:'当前视图',exact:true})).toHaveAttribute('aria-selected','true');await dialog.getByRole('button',{name:'＋ 添加条件',exact:true}).click();await dialog.getByRole('button',{name:'应用',exact:true}).click();await expect(base.locator('.nv-base-data-row')).toHaveCount(1);
    const mode=await page.evaluate(()=>document.documentElement.dataset.notaraConversationMode);
    await openGraph(page);const graph=page.locator('.nv-independent-graph:visible');await expect(graph).toHaveCount(1);await expect(graph.locator('.nv-block-graph-canvas')).toHaveAttribute('data-layout','source-clusters');await expect(graph.locator('.nv-block-node')).toHaveCount(3);
    await graphView(page,'all');await expect(graph.locator('.nv-block-node')).toHaveCount(3);assert.equal(await page.evaluate(()=>document.documentElement.dataset.notaraConversationMode),mode);
    await focusLibrary(page);await expect(base.locator('.nv-base-data-row')).toHaveCount(1);await expect(base.getByRole('button',{name:'图谱布局'})).toHaveCount(0);
    await base.getByRole('button',{name:'切换保存的视图',exact:true}).click();await page.getByRole('menuitem',{name:'管理视图…',exact:true}).click();await dialog.getByRole('button',{name:'复制视图 全部资料',exact:true}).click();await expect(dialog.getByLabel('重命名视图 全部资料 副本',{exact:true})).toBeVisible();
    await dialog.getByLabel('重命名视图 全部资料 副本',{exact:true}).fill('卡片集合');await dialog.getByLabel('重命名视图 全部资料 副本',{exact:true}).press('Tab');await expect(dialog.getByLabel('重命名视图 卡片集合',{exact:true})).toBeVisible();await dialog.getByRole('button',{name:'上移视图 卡片集合',exact:true}).click();await expect.poll(async()=>parseBase(await readFile(join(runtime.vault,'资料库.base'),'utf8')).views[0].name).toBe('卡片集合');
    await dialog.getByRole('button',{name:'移除视图 卡片集合',exact:true}).click();await expect(dialog.getByLabel('重命名视图 卡片集合',{exact:true})).toHaveCount(0);await dialog.getByRole('button',{name:'完成',exact:true}).click();assert.equal((await fields()).status,'外部修改');assert.deepEqual(errors,[]);
  }catch(error){await page.screenshot({path:join(output,'grid-editing-failure.png')});throw error;}finally{await browser.close();await runtime.stop();await rm(fixture,{recursive:true,force:true});}
});
