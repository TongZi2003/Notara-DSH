import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {startNativeRuntime,workspaceRoot} from '../scripts/native-runtime.mjs';
import {openDocumentSource,refreshDocument} from '../scripts/ui-navigation.mjs';
import {parseReference} from '../plugins/vault-sqlite/file-reference.js';
import {samplePdf} from './sample-pdf.mjs';
import {createHash} from 'node:crypto';

test('source regions: PDF card round trip, reverse highlights, text selection and stale-source protection',{timeout:120000},async()=>{
  const fixture=await mkdtemp(join(workspaceRoot,'work/source-region-fixture-'));
  const source='# 选区来源\r\n\r\n前面的内容不应带入。\r\n\r\n只引用这一段。';await writeFile(join(fixture,'选区来源.md'),source);
  await mkdir(join(fixture,'卡片'));await writeFile(join(fixture,'卡片/整页引用.md'),`# 整页引用\n![[来源/集成测试讲义.pdf#page=1&rect=0,0,1,1&revision=${createHash('sha256').update(samplePdf()).digest('hex')}]]`);
  const runtime=await startNativeRuntime({fixture,testModel:true}),browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1414,height:900}}),errors=[];
  await writeFile(join(runtime.vault,'来源/两页保活.pdf'),samplePdf(2));
  const out=join(workspaceRoot,'outputs/source-regions-20261028');await mkdir(out,{recursive:true});
  page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
  const open=async path=>{await page.evaluate(path=>window.dispatchEvent(new CustomEvent('notara:open-document',{detail:{path}})),path);if(path.endsWith('.md'))await expect(page.locator('.nv-vault-doc-tab:visible .nv-vault-doc-path')).toHaveAttribute('title',path);};
  const tab=page.locator('.nv-vault-doc-tab:visible');
  try{
    await page.goto(runtime.authUrl);await page.getByRole('button',{name:/^(Continue|继续)$/}).click();await page.locator('[data-composer-input]:visible').waitFor();await page.waitForLoadState('networkidle');
    await open('来源/两页保活.pdf');
    await expect(tab.getByRole('button',{name:'下一页',exact:true})).toBeEnabled();
    await tab.getByRole('button',{name:'下一页',exact:true}).click();
    await tab.locator('.nv-vault-pdf-layer').waitFor();
    await tab.locator('canvas').evaluate(el=>el.dataset.keepalive='pdf-page-two');
    await page.locator('[data-sidebar-right-toggle]:visible').click();
    await page.locator('[data-sidebar-right-expand]').click();
    await expect(tab.getByRole('spinbutton',{name:'PDF 页码'})).toHaveValue('2');
    await expect(tab.locator('canvas')).toHaveAttribute('data-keepalive','pdf-page-two');
    await open('来源/集成测试讲义.pdf');const pdf=tab.locator('.nv-vault-pdf');await expect(pdf.getByRole('status')).toHaveCount(0);
    await expect(pdf.getByRole('button',{name:'关联卡片：整页引用 1',exact:true})).toBeVisible();await expect(page.getByText(/关联引用（/)).toHaveCount(0);
    const layer=pdf.locator('.nv-vault-pdf-layer');await layer.waitFor();const box=await layer.boundingBox();
    await page.mouse.move(box.x+box.width*.1,box.y+box.height*.1);await page.mouse.down();await page.mouse.move(box.x+box.width*.45,box.y+box.height*.25);await page.mouse.up();
    await pdf.getByRole('button',{name:'基于选区创建卡片',exact:true}).click();await pdf.getByLabel('卡片标题').fill('PDF区域卡');await pdf.getByRole('button',{name:'创建卡片',exact:true}).click();
    await expect(tab).toContainText('PDF区域卡');const card=await readFile(join(runtime.vault,'卡片/PDF区域卡.md'),'utf8');assert.match(card,/#page=1&rect=.*&revision=[a-f0-9]{64}/);
    await tab.locator('summary').filter({hasText:'查看原页'}).click();await expect(tab.getByRole('img',{name:'原页摘录 · 第 1 页'}).or(tab.locator('.nv-vault-pdf-crop canvas'))).toBeVisible();
    await tab.getByRole('button',{name:'查看原页 · 第 1 页',exact:true}).click();await expect(pdf.locator('.nv-vault-pdf-selection')).toBeVisible();
    const highlight=pdf.getByRole('button',{name:/关联卡片：PDF区域卡 \d+/});await expect(highlight).toBeVisible();await page.screenshot({path:join(out,'pdf-reverse-highlight.png')});
    // Both the full-page region and the smaller region must let another drag through.
    const again=await layer.boundingBox();await page.mouse.move(again.x+again.width*.2,again.y+again.height*.15);await page.mouse.down();await page.mouse.move(again.x+again.width*.3,again.y+again.height*.2,{steps:5});await page.mouse.up();
    await expect(pdf.locator('.nv-vault-pdf-selection')).toBeVisible();assert.ok(await pdf.locator('.nv-vault-pdf-selection').evaluate(el=>parseFloat(el.style.width))<12);
    await highlight.click();await expect(tab).toContainText('PDF区域卡');
    await open('选区来源.md');await openDocumentSource(page,tab);const editor=tab.getByRole('textbox',{name:'Markdown 正文编辑器',exact:true});await editor.click();await editor.press('ControlOrMeta+End');await editor.press('Shift+Home');
    const selection=tab.locator('.nv-source-selection');await expect(selection.getByRole('button',{name:'讨论选区',exact:true})).toBeEnabled();
    await selection.getByRole('button',{name:'创建来源卡片',exact:true}).click();await selection.getByLabel('选区卡片标题').fill('文字区域卡');await selection.getByRole('button',{name:'创建卡片',exact:true}).click();await expect(tab).toContainText('文字区域卡');
    const textCard=await readFile(join(runtime.vault,'卡片/文字区域卡.md'),'utf8');const ref=parseReference(textCard.match(/!\[\[[^\]]+\]\]/)[0]);assert.equal(source.replace(/\r\n/g,'\n').slice(...ref.range),'只引用这一段。');assert.ok(ref.revision);
    await tab.locator('summary').filter({hasText:'查看原页'}).click();await expect(tab.locator('.nv-source-text-preview blockquote')).toHaveText('只引用这一段。');
    await tab.getByRole('button',{name:/打开 选区来源/}).click();await expect(tab.locator('.nv-source-selection')).toBeVisible();await expect(tab.locator('.nv-source-selection').getByRole('button',{name:'讨论选区'})).toBeEnabled();
    await expect(page.getByText(/关联引用（/)).toHaveCount(0);
    await tab.getByRole('button',{name:'打开来源卡片：文字区域卡',exact:true}).click();await expect(tab.locator('.nv-vault-doc-path')).toHaveAttribute('title','卡片/文字区域卡.md');
    await tab.getByRole('button',{name:/打开 选区来源/}).click();await expect(tab.locator('.nv-source-selection')).toBeVisible();
    await tab.locator('.nv-source-selection').getByRole('button',{name:'请老师生成卡片'}).click();await expect(page.locator('[data-composer-input]').first()).toContainText('原样保留资料引用中的完整来源定位');await expect(page.locator('[data-composer-input]:visible')).toBeVisible();
    await tab.locator('.nv-source-selection').getByRole('button',{name:'讨论选区'}).click();await expect(page.locator('[data-composer-input]').first()).toContainText('选区来源');
    await writeFile(join(runtime.vault,'选区来源.md'),source.replace('只引用这一段。','新版本的内容。'));await refreshDocument(page,tab);
    await expect(tab.locator('.nv-live-markdown .cm-content:visible')).toContainText('新版本的内容。');await expect(tab.locator('.nv-source-selection')).toHaveCount(0);
    const currentEditor=tab.locator('.nv-live-markdown .cm-content:visible');await currentEditor.click();await currentEditor.press('ControlOrMeta+End');await currentEditor.press('End');await currentEditor.pressSequentially('未保存');await currentEditor.press('Shift+Home');await expect(tab.locator('.nv-source-selection').getByRole('button',{name:'讨论选区'})).toBeDisabled();
    await page.screenshot({path:join(out,'text-selection.png')});
    await expect(tab.getByRole('button',{name:'打开来源卡片：文字区域卡',exact:true})).toHaveCount(0);
    await open('卡片/文字区域卡.md');await page.reload();await tab.locator('summary').filter({hasText:'查看原页'}).click();await expect(tab.getByRole('alert').filter({hasText:'来源已更新'})).toBeVisible();await expect(tab.locator('.nv-source-text-preview blockquote')).toHaveCount(0);
    await writeFile(join(runtime.vault,'来源/集成测试讲义.pdf'),Buffer.concat([await readFile(join(runtime.vault,'来源/集成测试讲义.pdf')),Buffer.from('\n% changed source\n')]));
    await open('卡片/PDF区域卡.md');await page.reload();await tab.locator('summary').filter({hasText:'查看原页'}).click();await expect(tab.getByRole('alert').filter({hasText:'来源已更新'})).toBeVisible();await expect(tab.locator('.nv-vault-pdf-crop canvas:visible')).toHaveCount(0);
    await tab.getByRole('button',{name:'查看原页 · 第 1 页',exact:true}).click();await expect(pdf.getByRole('alert').filter({hasText:'来源已更新'})).toBeVisible();await expect(pdf.locator('.nv-source-region-highlight')).toHaveCount(0);
    await page.screenshot({path:join(out,'stale-source.png')});await page.setViewportSize({width:755,height:746});await page.screenshot({path:join(out,'source-narrow.png')});assert.deepEqual(errors,[]);
  }catch(error){await page.screenshot({path:join(out,'failure.png')});await writeFile(join(out,'failure-editors.json'),JSON.stringify(await page.locator('.cm-content').evaluateAll(nodes=>nodes.map(node=>({label:node.getAttribute('aria-label'),text:node.textContent,ancestors:[node,...function*(n){while(n.parentElement){n=n.parentElement;yield n;}}(node)].slice(0,14).map(n=>({class:n.className,box:n.getBoundingClientRect().toJSON(),display:getComputedStyle(n).display,visibility:getComputedStyle(n).visibility}))}))),null,2));throw error;}finally{await browser.close();await runtime.stop();await rm(fixture,{recursive:true,force:true});}
});

test('a late source-card save remains in its original classroom and cannot navigate the new conversation',{timeout:60000},async()=>{
  const runtime=await startNativeRuntime({testModel:true}),browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1414,height:900}});
  page.setDefaultTimeout(12000);let release;const held=new Promise(resolve=>{release=resolve;});let captured;const saved=new Promise(resolve=>{captured=resolve;});
  try{
    await page.goto(runtime.authUrl);await page.getByRole('button',{name:/^(Continue|继续)$/}).click();await page.locator('[data-composer-input]:visible').waitFor();await page.waitForLoadState('networkidle');
    const input=page.locator('[data-composer-input]');await input.fill('建立来源讨论会话A');await input.press('Enter');await page.locator('section.nv-block-flow:visible').waitFor();await expect(page.getByRole('button',{name:/^(Stop generating|停止生成)$/})).toHaveCount(0);
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('notara:open-document',{detail:{path:'来源/集成测试讲义.pdf'}})));
    const pdf=page.locator('.nv-vault-pdf:visible'),layer=pdf.locator('.nv-vault-pdf-layer');await layer.waitFor();const box=await layer.boundingBox();
    await page.mouse.move(box.x+box.width*.1,box.y+box.height*.1);await page.mouse.down();await page.mouse.move(box.x+box.width*.4,box.y+box.height*.2);await page.mouse.up();
    await pdf.getByRole('button',{name:'基于选区创建卡片',exact:true}).click();await pdf.getByLabel('卡片标题').fill('迟到来源卡');
    await page.route('**/api/notaraVault/save',async route=>{const response=await route.fetch();captured();await held;await route.fulfill({response});});
    await pdf.getByRole('button',{name:'创建卡片',exact:true}).click();await saved;
    await page.getByRole('button',{name:/^(New session|新会话|新建会话)$/}).click();await page.locator('[data-composer-input]:visible').waitFor();await input.fill('会话B的草稿');release();await page.waitForLoadState('networkidle');
    assert.match(await readFile(join(runtime.vault,'卡片/迟到来源卡.md'),'utf8'),/revision=/);
    await expect(input).toHaveText('会话B的草稿');await expect(page.locator('.nv-vault-doc-path[title="卡片/迟到来源卡.md"]')).toHaveCount(0);await expect(page.locator('[data-composer-input]:visible')).toBeVisible();
  }finally{release();await browser.close();await runtime.stop();}
});
