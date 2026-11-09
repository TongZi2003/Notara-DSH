import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {startNativeRuntime,workspaceRoot} from '../scripts/native-runtime.mjs';
import {openLibrary,openDocumentSource} from '../scripts/ui-navigation.mjs';

test('only the chosen formula edits in a stable popover while text and other formulas stay rendered', {timeout:90000},async()=>{
  const fixture=await mkdtemp(join(workspaceRoot,'work/inline-formula-fixture-'));
  const original=('---\ntitle: 公式交互\ntags: [数学]\ncustom: "keep" # 注释\n---\n# 公式交互\n\n普通文字😀，第一式 $x^2$，第二式 $x^2$，结尾。\n\n另一种公式 \\(a+b\\)。\n\n- 列表里的公式 $z^2$。\n\n$$\nA = U\\Sigma V^T\n\nB = 2\n$$\n\n公式后面的正文。\n\n```math\nc^2\n```\n').replace(/\n/g,'\r\n');
  await writeFile(join(fixture,'公式交互.md'),original);
  const runtime=await startNativeRuntime({fixture,testModel:true}),browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1200,height:850}}),errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000);
  const output=join(workspaceRoot,'outputs/inline-formula-20261026');await mkdir(output,{recursive:true});
  const doc=page.locator('.nv-vault-doc-tab:visible'),dialog=page.getByRole('dialog',{name:'编辑公式',exact:true}),read=()=>readFile(join(runtime.vault,'公式交互.md'),'utf8');
  try{
    await page.goto(runtime.authUrl);await page.getByRole('button',{name:/^(Continue|继续)$/}).click();await page.locator('[data-composer-input]:visible').waitFor();await page.waitForLoadState('networkidle');await openLibrary(page);
    await page.locator('.nv-vault-workspace:visible').getByRole('button',{name:'公式交互',exact:true}).click();await page.getByRole('button',{name:'全屏',exact:true}).click();
    await page.getByRole('button',{name:'最小化会话',exact:true}).click();
    const editor=doc.getByRole('textbox',{name:'Markdown 实时预览编辑器'}),formulas=doc.locator('.nv-live-inline-math');
    await expect(editor).toBeVisible();await expect(doc.getByRole('group',{name:'Markdown 编辑模式'})).toHaveCount(0);await expect(doc.getByRole('button',{name:/^(富文本|实时预览|源码)$/})).toHaveCount(0);
    await expect(formulas).toHaveCount(4);await doc.getByRole('button',{name:/文档属性/}).click();
    const line=doc.locator('.nv-live-text').filter({hasText:'普通文字'});await line.click({position:{x:18,y:12}});
    await expect(formulas).toHaveCount(4);await expect(line).not.toContainText('$x^2$');await expect(doc.locator('.nv-live-source')).toHaveCount(0);
    const before=await line.boundingBox();await formulas.nth(1).click();await expect(dialog.getByRole('textbox',{name:'公式源码'})).toHaveValue('x^2');
    const after=await line.boundingBox();assert.ok(Math.abs(before.height-after.height)<1);await expect(formulas).toHaveCount(4);
    const input=dialog.getByRole('textbox',{name:'公式源码'});await input.evaluate(element=>element.dataset.formulaIdentity='stable');
    await input.fill('x^3');await input.pressSequentially('+1');await expect(input).toHaveValue('x^3+1');await expect(input).toHaveAttribute('data-formula-identity','stable');await expect(input).toBeFocused();
    await expect(dialog.locator('.katex')).toHaveCount(1);await input.press('ControlOrMeta+s');
    await expect.poll(read).toBe(original.replace('第二式 $x^2$','第二式 $x^3+1$'));
    await page.screenshot({path:join(output,'formula-wide.png')});
    await dialog.getByRole('button',{name:'完成公式编辑'}).click();await expect(dialog).toHaveCount(0);
    await doc.getByRole('button',{name:'撤销',exact:true}).click();await formulas.nth(1).click();await expect(input).toHaveValue('x^2');await input.press('Escape');
    await doc.getByRole('button',{name:'保存',exact:true}).click();await expect.poll(read).toBe(original);
    // Reuse widgets after their source ranges shift, then edit the second repeated formula.
    await openDocumentSource(page,doc);const source=doc.getByRole('textbox',{name:'Markdown 正文编辑器'}),moved=original.replace('普通文字😀','前文增加一段。\r\n\r\n普通文字😀');
    await source.fill(moved);await doc.getByRole('button',{name:'返回正文',exact:true}).click();await formulas.nth(1).click();await input.fill('y^2');await input.press('ControlOrMeta+s');
    await expect.poll(read).toBe(moved.replace('第二式 $x^2$','第二式 $y^2$'));await input.press('Escape');
    const block=doc.locator('.nv-live-preview-block[data-kind="math"]').first();await block.getByRole('button',{name:'编辑这一段'}).click();await expect(input).toHaveValue('A = U\\Sigma V^T\n\nB = 2');
    await input.fill('A = U\\Sigma V^T\n\nB = 3');await input.press('ControlOrMeta+s');
    await expect.poll(read).toBe(moved.replace('第二式 $x^2$','第二式 $y^2$').replace('B = 2','B = 3'));const saved=await read();assert.equal(saved.replaceAll('\r\n','').includes('\n'),false);await input.press('Escape');
    await formulas.nth(0).press('Enter');await expect(input).toHaveValue('x^2');await line.click({position:{x:10,y:12}});await expect(dialog).toHaveCount(0);
    await page.reload();await expect(editor).toBeVisible();await expect(formulas).toHaveCount(4);
    const collapse=page.getByRole('button',{name:/^(Collapse sidebar|收起侧边栏)$/});if(await collapse.isVisible())await collapse.click();
    await page.setViewportSize({width:460,height:746});await formulas.nth(1).click();await expect(input).toHaveValue('y^2');
    const box=await dialog.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=460&&box.y>=0&&box.y+box.height<=746,JSON.stringify(box));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:join(output,'formula-narrow.png')});assert.deepEqual(errors,[]);
  }catch(error){await page.screenshot({path:join(output,'failure.png')});throw error;}finally{await browser.close();await runtime.stop();await rm(fixture,{recursive:true,force:true});}
});
