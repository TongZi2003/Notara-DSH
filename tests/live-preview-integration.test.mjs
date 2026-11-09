import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,readFile,mkdir,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium,expect } from '@playwright/test';
import { startNativeRuntime,workspaceRoot } from '../scripts/native-runtime.mjs';
import { openLibrary, openDocumentSource, blurDocumentEditor } from '../scripts/ui-navigation.mjs';

test('CodeMirror live preview edits exact Markdown, reuses source history and preserves custom previews', {timeout:120000},async()=>{
  const fixture=await mkdtemp(join(workspaceRoot,'work/live-preview-fixture-'));
  const component='```choice\nprompt: 选择方向\n- [ ] 向左\n- [ ] 向右\n```';
  const original=('---\ntitle: 实时预览验证\ntags: [线性代数, SVD]\ncustom: "keep" # 注释\n---\n# 实时预览验证\n\n初始正文 **重点**，见 [[引用|双链]]，公式 $x^2$。\n\n$$\nA = U\\Sigma V^T\n\nB = 2\n$$\n\n| 名称 | 值 |\n| --- | --- |\n| 矩阵 | 2 |\n\n'+component+'\n\n<details>\n<summary>来源摘录</summary>\n\n![[引用]]\n\n</details>\n\n## 参考理解\n\n应保持折叠的参考。\n\n## 学生理解\n\n结尾。\n').replace(/\n/g,'\r\n');
  await writeFile(join(fixture,'实时预览验证.md'),original);
  await writeFile(join(fixture,'引用.md'),'---\ntitle: 引用\ntags: [来源]\n---\n# 引用正文\n\n嵌入来源文本。\n');
  const output=join(workspaceRoot,'outputs/codemirror-live-20261025');await mkdir(output,{recursive:true});
  const runtime=await startNativeRuntime({fixture,testModel:true}),browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1414,height:850}}),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
  const doc=page.locator('.nv-vault-doc-tab:visible'), read=()=>readFile(join(runtime.vault,'实时预览验证.md'),'utf8');
  try{
    await page.goto(runtime.authUrl);await page.getByRole('button',{name:/^(Continue|继续)$/}).click();await page.locator('[data-composer-input]:visible').waitFor();await page.waitForLoadState('networkidle');
    await openLibrary(page);await page.locator('.nv-vault-workspace:visible').getByRole('button',{name:'实时预览验证',exact:true}).click();await page.getByRole('button',{name:'全屏',exact:true}).click();
    await blurDocumentEditor(page,doc);
    let editor=doc.getByRole('textbox',{name:'Markdown 实时预览编辑器'});
    await expect(doc.locator('.nv-live-preview-block[data-kind="math"] .katex-display')).toBeVisible();
    await expect(doc.locator('.nv-live-preview-block table')).toBeVisible();
    await expect(doc.locator('.nv-retired-component')).toBeVisible();
    await expect(doc.locator('.milkdown-block-handle')).toHaveCount(0);
    await expect(doc.getByRole('button',{name:'保存',exact:true})).toBeDisabled();assert.equal(await read(),original);
    await editor.press('ControlOrMeta+Home');await expect(editor.locator('.cm-line').filter({hasText:'custom: "keep" # 注释'})).toBeVisible();
    await blurDocumentEditor(page,doc);await expect(doc.getByRole('button',{name:'保存',exact:true})).toBeDisabled();
    await doc.getByRole('button',{name:'双链',exact:true}).click();await expect(doc.getByRole('heading',{name:'引用正文',exact:true})).toBeVisible();
    await page.getByRole('tab',{name:/^实时预览验证(?: Close| 关闭)?$/}).click();await expect(editor).toBeVisible();
    await doc.getByText('来源摘录',{exact:true}).click();await expect(doc.getByText('嵌入来源文本。',{exact:true})).toBeVisible();
    await expect(doc.getByText('应保持折叠的参考。',{exact:true})).not.toBeVisible();
    await doc.getByText('来源摘录',{exact:true}).click();
    await doc.locator('.nv-live-text').filter({hasText:'初始正文'}).click();
    await expect(doc.locator('.nv-live-inline-math')).toHaveCount(1);
    await expect(doc.locator('.nv-live-source').filter({hasText:'初始正文'})).toHaveCount(0);
    await editor.press('ControlOrMeta+End');await editor.pressSequentially('实时预览追加');
    await openDocumentSource(page,doc);
    const source=doc.getByRole('textbox',{name:'Markdown 正文编辑器'});await expect(source).toContainText('实时预览追加');
    await source.evaluate(element=>element.dataset.liveIdentity='same-editor');
    await doc.getByRole('button',{name:'返回正文',exact:true}).click();await expect(editor).toHaveAttribute('data-live-identity','same-editor');
    // Hiding the native panel must preserve the editor, draft and undo history.
    await page.locator('[data-sidebar-right-toggle]:visible').click();
    await expect(page.locator('[data-sidebar-right-expand]')).toBeVisible();
    await page.locator('[data-sidebar-right-expand]').click();
    await expect(editor).toHaveAttribute('data-live-identity','same-editor');
    await expect(editor).toContainText('实时预览追加');
    await doc.getByRole('button',{name:'撤销',exact:true}).click();
    await doc.getByRole('button',{name:'保存',exact:true}).waitFor();await expect(doc.getByRole('button',{name:'保存',exact:true})).toBeDisabled();
    await editor.press('ControlOrMeta+End');await editor.pressSequentially('实时预览追加');await editor.press('ControlOrMeta+s');
    await expect.poll(read).toBe(original+'实时预览追加');
    await blurDocumentEditor(page,doc);await page.screenshot({path:join(output,'live-wide.png')});
    await expect(doc.locator('.nv-retired-component')).toBeVisible();
    await expect(doc.locator('.nv-retired-component').getByRole('radio')).toHaveCount(0);
    // Activating a moved widget after a preceding edit must resolve its current position.
    await openDocumentSource(page,doc);await source.fill(original.replace('# 实时预览验证','# 新增标题\r\n\r\n# 实时预览验证')+'实时预览追加');
    await doc.getByRole('button',{name:'返回正文',exact:true}).click();await doc.locator('.nv-live-text').filter({hasText:'初始正文'}).click();await expect(doc.locator('.nv-live-inline-math')).toHaveCount(1);await editor.press('ControlOrMeta+End');await editor.pressSequentially('未保存草稿');
    await page.reload();await page.getByRole('tab',{name:/^实时预览验证(?: Close| 关闭)?$/}).click();await expect(editor).toBeVisible();
    await openDocumentSource(page,doc);await source.press('ControlOrMeta+End');await expect(source).toContainText('未保存草稿');await doc.getByRole('button',{name:'返回正文',exact:true}).click();
    await editor.press('ControlOrMeta+a');await expect(doc.locator('.nv-live-preview-block')).toHaveCount(0);await editor.press('ArrowRight');
    await blurDocumentEditor(page,doc);
    const collapse=page.getByRole('button',{name:/^(Collapse sidebar|收起侧边栏)$/});if(await collapse.isVisible())await collapse.click();
    for(const width of [755,460]){await page.setViewportSize({width,height:746});await expect(editor).toBeVisible();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await doc.getByRole('button',{name:'文档选项',exact:true}).scrollIntoViewIfNeeded();const bar=doc.locator('.nv-document-toolbar');assert.ok((await bar.boundingBox()).height<55);assert.equal(await bar.evaluate(el=>el.scrollWidth>el.clientWidth),false);await expect(bar.getByRole('button',{name:'查看源码',exact:true})).toBeVisible();await page.screenshot({path:join(output,`live-${width}.png`)});}
    assert.deepEqual(errors,[]);
  }catch(error){await page.screenshot({path:join(output,'failure.png')});throw error;}
  finally{await browser.close();await runtime.stop();await rm(fixture,{recursive:true,force:true});}
});
