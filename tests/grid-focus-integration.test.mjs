import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {startNativeRuntime,workspaceRoot} from '../scripts/native-runtime.mjs';
import {openLibrary,chooseBaseView} from '../scripts/ui-navigation.mjs';
import {defaultLibraryBase,serializeBase} from '../plugins/vault-sqlite/bases.js';

test('grid pointer selection avoids duplicate rings while keyboard focus and editing remain visible',{timeout:60000},async()=>{
  const fixture=await mkdtemp(join(workspaceRoot,'work/grid-focus-fixture-'));
  const original='---\ntype: concept\nstatus: 待阅读\n---\n# 焦点甲\n正文不变。\n';
  await writeFile(join(fixture,'焦点甲.md'),original);await writeFile(join(fixture,'焦点乙.md'),original.replace('焦点甲','焦点乙'));
  const config=defaultLibraryBase();config.filters='file.ext == "md"';config.views[0].order=['file.name','note.status'];config.properties['note.status']={displayName:'状态'};
  await writeFile(join(fixture,'资料库.base'),serializeBase(config));
  const runtime=await startNativeRuntime({fixture,testModel:true}),browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1000,height:746}}),errors=[];
  page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));
  const base=page.locator('.nv-base-workspace:visible'),row=base.getByRole('row').filter({has:page.getByRole('button',{name:'焦点甲',exact:true})}),title=row.getByRole('button',{name:'焦点甲',exact:true}),titleCell=row.getByRole('gridcell',{name:'焦点甲',exact:true});
  const output=join(workspaceRoot,'work/grid-focus-20261106');await mkdir(output,{recursive:true});
  try{
    await page.goto(runtime.authUrl);await page.getByRole('button',{name:/^(Continue|继续)$/}).click();await page.locator('[data-composer-input]:visible').waitFor();await openLibrary(page);await chooseBaseView(page,'全部资料');
    await expect(row.getByRole('checkbox',{name:/^选择 /})).toHaveCount(0);
    await title.click({modifiers:['ControlOrMeta']});await expect(row).toHaveAttribute('aria-selected','true');
    await expect(titleCell).toHaveCSS('outline-style','none');
    await page.screenshot({path:join(output,'pointer-selection.png')});
    await title.click({modifiers:['ControlOrMeta']});await expect(row).toHaveAttribute('aria-selected','false');await expect(titleCell).toHaveCSS('outline-style','none');
    // Keyboard focus belongs to the real title cell, not a hidden selection column.
    await titleCell.click({position:{x:2,y:10}});await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowLeft');await expect(titleCell).toBeFocused();
    await expect(titleCell).toHaveCSS('outline-style','solid');
    await page.keyboard.press('Control+Space');await expect(row).toHaveAttribute('aria-selected','true');await page.keyboard.press('Control+Space');await expect(row).toHaveAttribute('aria-selected','false');
    const status=row.getByRole('gridcell',{name:'待阅读',exact:true});await status.click();await expect(status).toHaveCSS('outline-style','none');
    await page.keyboard.press('ArrowUp');
    const activeCell=base.locator('[role="gridcell"]:focus-visible');await expect(activeCell).toHaveCount(1);await expect(activeCell).toHaveCSS('outline-style','solid');
    await page.screenshot({path:join(output,'keyboard-focus.png')});
    await activeCell.press('Enter');await expect(base.getByRole('textbox',{name:'编辑 状态',exact:true})).toBeFocused();await page.keyboard.press('Escape');
    assert.equal(await readFile(join(runtime.vault,'焦点甲.md'),'utf8'),original);assert.deepEqual(errors,[]);
  }finally{await browser.close();await runtime.stop();await rm(fixture,{recursive:true,force:true});}
});
