import {graphSettings,graphView,graphExamples} from './graph-ui.fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';
  import {ForceGraphView} from './src/graph-view.jsx';import css from './src/styles.css';
  const style=document.createElement('style');style.textContent=css;document.head.append(style);
  const data={relationsVersion:2,nodes:[['甲卡片','card'],['乙来源','source'],['丙卡片','card'],['丁卡片','card']].map(([title,type])=>({path:title+'.md',title,type,tags:[],isSource:type==='source'})),edges:[['甲卡片','乙来源'],['乙来源','丙卡片'],['丙卡片','丁卡片']].map(([source,target])=>({id:source+'-'+target,source:source+'.md',target:target+'.md',kind:'reference',style:'dashed',context:''}))};
  createRoot(document.getElementById('root')).render(<ForceGraphView data={data}/>);`,resolveDir:fileURLToPath(new URL('../',import.meta.url)),loader:'jsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',loader:{'.css':'text'},logLevel:'silent',alias:{'@deepseek-ai/dsh-client-ui-primitives':fileURLToPath(new URL('../../../tests/fixtures/modal.jsx',import.meta.url))}});

for(const entry of ['all','sources'])test(`v2 advanced-search count equals applied nodes from ${entry}`,{timeout:15000},async t=>{
  const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/fixture.js'?'text/javascript':'text/html; charset=utf-8');res.end(req.url==='/fixture.js'?bundle.outputFiles[0].text:'<meta charset="utf-8"><body style="margin:16px;font:14px system-ui"><div id="root"></div><script src="/fixture.js"></script>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1100,height:800}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));await page.goto(`http://127.0.0.1:${server.address().port}/`);
  if(entry==='all')await graphView(page,'all');
  const openSearch=async()=>{const options=page.getByRole('button',{name:'图谱选项',exact:true});if(await options.getAttribute('aria-expanded')!=='true')await options.click();await graphSettings(page,true);await page.getByRole('button',{name:/高级搜索/}).click();};
  await openSearch();const dialog=page.getByRole('dialog',{name:'图谱高级搜索'});
  await dialog.getByRole('checkbox',{name:'中心资料 甲卡片',exact:true}).check();await dialog.getByRole('checkbox',{name:'中心资料 丁卡片',exact:true}).check();
  if(entry==='all'){
    await dialog.getByLabel('中心联系范围').selectOption('0');await expect(dialog.getByRole('status')).toHaveText('2 份符合条件');
    await dialog.getByRole('button',{name:'应用',exact:true}).click();await expect(page.locator('[data-graph-node]')).toHaveCount(2);
    await openSearch();
  }
  await dialog.getByLabel('中心联系范围').selectOption('1');
  const preview=await dialog.getByRole('status').innerText();
  const output=(process.env.NOTARA_GRAPH_TEST_OUTPUT?new URL(`file://${process.env.NOTARA_GRAPH_TEST_OUTPUT}/graph-search-count/${entry}/`):new URL(`../output/playwright/graph-search-count/${entry}/`,import.meta.url));await mkdir(output,{recursive:true});
  await page.screenshot({path:fileURLToPath(new URL('preview.png',output)),animations:'disabled'});
  await dialog.getByRole('button',{name:'应用',exact:true}).click();await expect(page.locator('[data-graph-node]')).toHaveCount(4);
  const paths=await page.locator('[data-graph-node]').evaluateAll(items=>items.map(item=>item.dataset.graphNode).sort());
  await page.screenshot({path:fileURLToPath(new URL('applied.png',output)),animations:'disabled'});
  await writeFile(new URL('result.json',output),JSON.stringify({entry,preview,actual:paths.length,paths,errors,port:server.address().port},null,2));
  assert.deepEqual(errors,[]);assert.equal(preview,`${paths.length} 份符合条件`);
  await openSearch();await expect(dialog.getByRole('status')).toHaveText('4 份符合条件');
  await dialog.getByRole('button',{name:'取消',exact:true}).click();await expect(page.locator('[data-graph-node]')).toHaveCount(4);
});
