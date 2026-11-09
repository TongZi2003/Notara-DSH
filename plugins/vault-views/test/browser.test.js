import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { createPdfAssetHandler, PDF_ASSET_ROOT } from '../index.js';

function pdfFixture() {
  const stream = '0.2 0.3 0.7 rg 40 40 120 80 re f';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << >> >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let value = '%PDF-1.4\n', offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(value)); value += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(value);
  value += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(value).toString('base64');
}

const browserFixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {VaultWorkspace} from './src/workspace.jsx';
import {MarkdownReader} from './src/markdown.jsx';
import {parseBase,evaluateBase,basePropertyValue} from '@oh-my-student/plugin-vault-sqlite/bases';
import {createViewState,verifyDisplayedSource} from './src/logic.js';
import styles from './src/styles.css';
import editorStyles from './src/editor-styles.css';
import surfaceStyles from './src/student-surfaces.css';
import {appearanceCss} from './src/appearance-tokens.js';
const guide = '# 化学导读\\n## 背景\\n先看真实材料。\\n## 学习任务\\n- [ ] 阅读 [[卡片/溶液]]\\n## 目标\\n能解释边界。\\n';
const records = {
 '卡片/溶液.md': {path:'卡片/溶液.md',content:'---\\ntype: card\\n---\\n# 溶液\\n## 内容\\n判断沉淀条件。\\n<details>\\n<summary>查看原页</summary>\\n\\n![[来源/讲义.pdf#page=1&rect=0.1,0.1,0.5,0.5]]\\n\\n</details>\\n## 参考理解\\n参考答案不应默认展开\\n## 学生理解\\n本次表达\\n',revision:'r1'},
 '卡片/速率.md': {path:'卡片/速率.md',content:'# 速率\\n## 内容\\n判断反应速率',revision:'r1'},
 '00-化学导读.md': {path:'00-化学导读.md',content:guide,revision:'g1'},
 '来源/讲义.pdf': {path:'来源/讲义.pdf',encoding:'base64',content:${JSON.stringify(pdfFixture())},revision:'p1'}
};
const docs = [
 {path:'卡片/溶液.md',title:'溶液',type:'card',tags:['化学','平衡'],revision:'r1',reviewDue:'2020-01-01',reviewCount:1,lastSupport:'hint',cardSummary:'判断沉淀条件。',summary:'# 溶液 ## 内容 判断沉淀条件。 <details><summary>查看原解</summary>ORIGINAL_SOLUTION_42</details> ## 参考理解 不能泄露的答案'},
 {path:'卡片/速率.md',title:'速率',type:'card',tags:['化学','动力学'],revision:'r1',reviewDue:null,reviewCount:0,lastSupport:null},
 {path:'00-化学导读.md',title:'化学导读',type:'source',tags:['化学','导读'],revision:'g1',reviewDue:null,reviewCount:0},
 {path:'来源/讲义.pdf',title:'讲义',type:'source',tags:['化学'],revision:'p1',reviewDue:null,reviewCount:0}
];
const calls = [], brought = [], store = createViewState({visible:true});
const api = {
 async query(input){ calls.push({method:'query',input}); await new Promise(r=>setTimeout(r,25)); if(window.fixture.failQuery){throw Error('offline');} if(input.facet==='tags'){const values=[...new Set(docs.flatMap(doc=>doc.tags))].filter(tag=>tag.includes(input.search||'')).sort().map(value=>({value,count:1}));return {facet:'tags',values:values.slice(input.offset||0,(input.offset||0)+(input.limit||40)),total:values.length};} let documents = docs.filter(d=>(!input.tags?.length||input.tags.every(t=>d.tags.includes(t)))&&(!input.q||d.title.includes(input.q))&&(!input.type||d.type===input.type)&&(input.view!=='guides'||d.title.includes('导读'))&&(input.view!=='review'||d.type==='card')&&(!input.reviewStatus||input.reviewStatus!=='due'||d.reviewDue)&&(!input.minReviews||d.reviewCount>=input.minReviews)); if(input.base){const result=evaluateBase(parseBase(records[input.base.path].content),documents.map(d=>({...d,frontmatter:{type:d.type,tags:d.tags,summary:d.cardSummary},isGuide:d.title.includes('导读')})),input.base.view);documents=result.rows.map(d=>({...d,properties:Object.fromEntries(result.properties.map(key=>[key,basePropertyValue(d,key)]))}));} return {documents,total:documents.length}; },
 async read(input){calls.push({method:'read',input}); await new Promise(r=>setTimeout(r,15)); if(!records[input.path]) throw Error('not found');return {...records[input.path]};},
 async toggleTask(input){calls.push({method:'toggleTask',input}); const record=records[input.path]; if(input.expectedRevision!==record.revision) throw Error('conflict'); record.content=record.content.replace(input.checked?'- [ ]':'- [x]',input.checked?'- [x]':'- [ ]');record.revision+='1';return {path:input.path,revision:record.revision};},
 async recordReview(input){calls.push({method:'recordReview',input});if(window.fixture.failReview){window.fixture.failReview=false;throw Error('failed');}docs.find(d=>d.path===input.path).reviewCount++;records[input.path].content=records[input.path].content.replace('type: card','type: card\\nreview_history: '+JSON.stringify([{...input,id:'confirmed',day:'2026-11-07',scheduleVersion:3,kind:'observation',baseline:null}]));records[input.path].revision='r2';return {path:input.path,revision:'r2'};},
 async undoReview(input){calls.push({method:'undoReview',input});return {path:input.path,revision:'r3'};},
 async save(input){calls.push({method:'save',input});if(records[input.path]&&input.expectedRevision!==records[input.path].revision)throw Error('vault_revision_conflict'); const revision=(records[input.path]?.revision||'new')+'1'; records[input.path]={...input,revision};return {path:input.path,revision};}
};
window.fixture={calls,brought,records,store,failQuery:false,failReview:false,pending:0};
const style=document.createElement('style');style.textContent=styles + editorStyles + surfaceStyles + appearanceCss('claude');document.head.append(style);document.body.dataset.notaraTheme='claude';
document.documentElement.style.cssText='--dsw-alias-bg-base:#fff;--dsw-alias-bg-layer-1:#f7f7f7;--dsw-alias-border-l1:#ddd;--dsw-alias-label-primary:#262626;--dsw-alias-label-secondary:#777;--dsw-alias-label-link:#536dd7';
const remote = Object.fromEntries(Object.entries(api).map(([method, fn]) => [method, async input => { window.fixture.pending++; try { return {ok:true,value:await fn(input)}; } catch(error) { return {ok:false,error:{message:error.message}}; } finally {window.fixture.pending--;} }]));
createRoot(document.getElementById('root')).render(<VaultWorkspace remote={remote} store={store} onBring={async(pins,intent)=>{await Promise.all(pins.filter(pin=>pin.revision).map(pin=>verifyDisplayedSource(remote,pin)));brought.push({pins,intent});}}/>);
window.fixture.foldProbe=()=>{const host=document.createElement('div');host.id='fold-probe';document.body.append(host);const root=createRoot(host);root.render(<MarkdownReader remote={remote} renderMarkdown={text=>{window.fixture.foldChunks??=[];window.fixture.foldChunks.push(text);return <pre>{text}</pre>;}} content={'<details>\\n<summary>延迟来源探针</summary>\\n\\n![[来源/讲义.pdf#page=1&rect=0.1,0.1,0.5,0.5]]\\n\\n$$\\n1/2\\n\\n+x\\n$$\\n\\n</details>'}/>);return()=>{root.unmount();host.remove();};};
`;

test('headless workspace: filters, CAS, honest review, failure recovery, tabs, real PDF, narrow layout', { timeout: 60000 }, async () => {
  const bundled = await build({ stdin: { contents: browserFixture, resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'jsx' }, bundle: true, write: false, format: 'iife', platform: 'browser', conditions: ['production'], target: 'es2022', loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent', alias: { '@deepseek-ai/dsh-client-ui-primitives': fileURLToPath(new URL('../../../tests/fixtures/modal.jsx', import.meta.url)) } });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1000, height: 760 } });
    const assetHandler = createPdfAssetHandler();
    await context.route('https://vault-views.test/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/fixture.js') return route.fulfill({ contentType: 'text/javascript', body: bundled.outputFiles[0].text });
      if (url.pathname.startsWith(PDF_ASSET_ROOT)) {
        let status, headers, body;
        await assetHandler({ url: route.request().url(), method: route.request().method() }, { writeHead(code, values) { status = code; headers = values; }, end(bytes) { body = bytes; } });
        return route.fulfill({ status, headers, body });
      }
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}</style><div id="root"></div><script src="/fixture.js"></script>' });
    });
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(6000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('https://vault-views.test/');
    await page.getByRole('button',{name:'切换保存的视图'}).click();await page.getByRole('menuitem',{name:'全部资料',exact:true}).click();
    await page.getByRole('button', { name: '溶液', exact: true }).waitFor();
    await page.evaluate(()=>{window.fixture.dropFoldProbe=window.fixture.foldProbe();});
    await page.locator('#fold-probe summary').waitFor();
    await page.waitForFunction(()=>window.fixture.pending===0);
    assert.equal(await page.evaluate(()=>window.fixture.calls.filter(c=>c.method==='read'&&c.input.path==='来源/讲义.pdf').length),0,'unopened source does not read a PDF');
    await page.locator('#fold-probe summary').click();
    await expect.poll(()=>page.evaluate(()=>window.fixture.calls.filter(c=>c.method==='read'&&c.input.path==='来源/讲义.pdf').length)).toBe(1);
    assert.ok(await page.evaluate(()=>window.fixture.foldChunks.some(text=>text.trim()==='$$\n1/2\n\n+x\n$$')),'expanded fold passes complete multiline math to the native renderer');
    await page.evaluate(()=>window.fixture.dropFoldProbe());
    const output = fileURLToPath(new URL('../output/playwright/', import.meta.url)); await mkdir(output, { recursive: true });
    await page.screenshot({ path: `${output}/workspace-desktop.png` });
    await page.getByRole('button', { name: '卡片布局', exact: true }).click();
    await expect(page.locator('.nv-vault-card-summary')).toHaveCount(1);
    await page.getByRole('button',{name:'资料库操作',exact:true}).click();await page.getByRole('menuitem',{name:'视图设置…',exact:true}).click();await expect(page.getByLabel('显示正文预览',{exact:true})).toHaveCount(0);await page.getByRole('button',{name:'保存视图',exact:true}).click();
    await page.getByRole('button', { name: '表格布局', exact: true }).click();
    await page.getByRole('button',{name:'搜索',exact:true}).click();
    await page.getByRole('button',{name:'高级搜索',exact:true}).click();await page.getByLabel('标签 化学',{exact:true}).check();await page.getByLabel('标签 平衡',{exact:true}).check();await page.getByRole('button',{name:'应用',exact:true}).click();
    await page.waitForFunction(() => window.fixture.calls.some(call => call.method === 'query' && call.input.tags?.length === 2));
    await expect(page.getByRole('button', { name: '速率', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '卡片布局', exact: true }).click();
    await page.getByText('判断沉淀条件。', { exact: true }).filter({visible:true}).waitFor();
    assert.equal(await page.getByText('不能泄露的答案', { exact: false }).count(), 0);
    assert.equal(await page.getByText('ORIGINAL_SOLUTION_42', { exact: false }).count(), 0);
    await expect(page.getByRole('checkbox', { name: '选择 溶液' })).toHaveCount(0);
    await page.getByRole('button',{name:'溶液',exact:true}).click({modifiers:['ControlOrMeta']});
    await expect(page.locator('.nv-vault-card.is-picked')).toHaveCount(1);
    await page.getByRole('button', { name: '批量带入当前对话', exact: true }).click();
    await page.waitForFunction(() => window.fixture.brought.length === 1);
    assert.equal(await page.evaluate(() => window.fixture.brought[0].pins[0].path), '卡片/溶液.md');
    await page.getByRole('button',{name:'筛选',exact:true}).click();await page.getByRole('button',{name:'筛选标签',exact:true}).click();await page.getByLabel('标签 平衡',{exact:true}).uncheck();await page.getByRole('button',{name:'应用',exact:true}).click();
    await page.getByRole('button',{name:'切换保存的视图'}).click(); await page.getByRole('menuitem',{name:'学习计划',exact:true}).click();
    await page.getByRole('button',{name:'化学导读',exact:true}).waitFor();
    await expect(page.locator('.nv-vault-card')).toHaveCount(1);
    await page.getByRole('button',{name:'切换保存的视图'}).click(); await page.getByRole('menuitem',{name:'待复习',exact:true}).click();
    await expect(page.getByRole('button',{name:'开始复习',exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'资料库操作',exact:true}).click();await page.getByRole('menuitem',{name:'记录学习实况…',exact:true}).click();
    await page.getByLabel('本次关键步').waitFor();
    await page.getByLabel('本次关键步').fill('判断边界');
    await page.getByLabel('本次结果').selectOption('done');
    assert.ok(await page.getByRole('button', { name: '记录这次复习', exact: true }).isDisabled());
    await page.getByLabel('本次帮助条件').selectOption('hint');
    await page.evaluate(() => { window.fixture.failReview = true; });
    await page.getByRole('button', { name: '记录这次复习', exact: true }).click();
    await page.getByText('未能保存，请刷新后重试；本次填写仍保留').waitFor();
    await page.waitForTimeout(4200);
    await expect(page.getByText('未能保存，请刷新后重试；本次填写仍保留')).toBeVisible();
    assert.equal(await page.getByLabel('本次关键步').inputValue(), '判断边界');
    await page.getByRole('button', { name: '记录这次复习', exact: true }).click();
    await page.getByRole('button', { name: '已记录', exact: true }).waitFor();
    await expect(page.getByRole('alert',{name:''}).filter({hasText:'已记录本次实况'})).toBeVisible();
    await expect(page.getByRole('status').filter({hasText:'已记录本次实况'})).toHaveCount(0);
    await expect(page.getByRole('alert').filter({hasText:'已记录本次实况'})).toHaveCount(0,{timeout:6000});
    await expect(page.getByRole('button',{name:'已记录',exact:true})).toBeVisible();
    await page.getByRole('button', { name: '撤销最近一次', exact: true }).click();
    await page.waitForFunction(() => window.fixture.calls.some(call => call.method === 'undoReview'));
    await page.getByRole('button',{name:'关闭复习'}).click();
    await page.evaluate(() => window.fixture.store.open({ path: '卡片/溶液.md' }));
    await page.getByRole('textbox', { name: 'Markdown 实时预览编辑器', exact: true }).waitFor();
    await page.getByText('判断沉淀条件。', { exact: true }).filter({visible:true}).waitFor();
    assert.ok(!(await page.locator('details').filter({ has: page.locator('summary', { hasText: '参考理解' }) }).getAttribute('open')));
    await page.getByText('查看原页', { exact: true }).click();
    await page.getByRole('button', { name: '查看原页 · 第 1 页' }).click();
    await page.locator('.nv-vault-pdf-layer').waitFor({ timeout: 20000 });
    await page.screenshot({ path: `${output}/pdf-rendered.png` });
    const canvas = page.locator('canvas');
    assert.ok(await canvas.evaluate(element => { const pixel = element.getContext('2d').getImageData(100, 160, 1, 1).data; return pixel[0] < 100 && pixel[2] > 100 && pixel[3] === 255; }));
    const bounds = await canvas.boundingBox();
    await page.mouse.move(bounds.x + bounds.width * .15, bounds.y + bounds.height * .15);
    await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width * .65, bounds.y + bounds.height * .65); await page.mouse.up();
    const previousBrought = await page.evaluate(() => window.fixture.brought.length);
    await page.evaluate(() => { window.fixture.records['来源/讲义.pdf'].revision = 'p2'; });
    await page.getByRole('button', { name: '带入选区', exact: true }).click();
    await page.getByText('来源已更新，请刷新页面并重新框选').waitFor();
    assert.equal(await page.evaluate(() => window.fixture.brought.length), previousBrought);
    assert.equal(await page.locator('.nv-vault-pdf-selection').count(), 1);
    await page.getByRole('button', { name: '基于选区创建卡片' }).click();
    await page.getByLabel('卡片标题').fill('过期选区禁止建卡');
    await page.getByRole('button', { name: '创建卡片', exact: true }).click();
    await page.getByText('来源已更新，请刷新页面并重新框选').waitFor();
    assert.equal(await page.evaluate(() => window.fixture.calls.filter(call => call.method === 'save' && !call.input.path.endsWith('.base')).length), 0);
    assert.equal(await page.getByLabel('卡片标题').inputValue(), '过期选区禁止建卡');
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.evaluate(() => { window.fixture.records['来源/讲义.pdf'].revision = 'p1'; });
    await page.getByRole('button', { name: '带入选区', exact: true }).click();
    await page.waitForFunction(count => window.fixture.brought.length > count, previousBrought);
    assert.equal(await page.evaluate(() => window.fixture.brought.at(-1).pins[0].page), 1);
    assert.equal(await page.evaluate(() => window.fixture.brought.at(-1).pins[0].revision), 'p1');
    await page.getByRole('button', { name: '基于选区创建卡片' }).click();
    await page.getByLabel('卡片标题').fill('新区域卡片');
    await page.getByRole('button', { name: '创建卡片', exact: true }).click();
    await page.waitForFunction(() => window.fixture.calls.some(call => call.method === 'save' && !call.input.path.endsWith('.base')));
    assert.equal(await page.evaluate(() => window.fixture.calls.find(call => call.method === 'save' && !call.input.path.endsWith('.base')).input.expectedRevision), null);
    await page.getByRole('tab', { name: '资料库.base', exact: true }).click();
    await page.setViewportSize({ width: 375, height: 740 });
    await page.getByRole('button', { name: '表格布局', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.nv-vault-results')?.getAttribute('aria-busy') === 'false');
    await page.evaluate(() => { window.fixture.failQuery = true; });
    await page.getByRole('button',{name:'资料库操作',exact:true}).click();await page.getByRole('menuitem',{name:'刷新资料',exact:true}).click();
    await page.getByRole('alert').waitFor();
    await page.waitForFunction(() => window.fixture.pending === 0);
    await page.evaluate(() => { window.fixture.failQuery = false; });
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await page.getByRole('button', { name: '溶液', exact: true }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `${output}/workspace-narrow.png` });
    await page.evaluate(() => { window.fixture.records['白板/练习.canvas'] = { path: '白板/练习.canvas', content: '{"nodes":[],"edges":[]}', revision: 'c1' }; window.fixture.store.open({ path: '白板/练习.canvas' }); });
    await page.getByRole('button', { name: '添加文本', exact: true }).waitFor();
    await page.getByRole('button', { name: '添加文本', exact: true }).click();
    await page.locator('.react-flow__node').waitFor();
    assert.deepEqual(errors, []);
    await context.close();
  } finally { await browser.close(); }
});
