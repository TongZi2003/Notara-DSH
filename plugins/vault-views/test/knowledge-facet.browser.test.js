import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createVaultStore} from '../../vault-sqlite/vault-indexer.js';

test('actual indexed facets display label and submit canonical identity separately from a same-name ordinary tag',async t=>{
  const root=await mkdtemp(join(tmpdir(),'notara-entity-facet-ui-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'卡片'));
  const doc=(type,tags)=>`---\ntype: ${type}\ntags: ${JSON.stringify(tags)}\n---\n原始内容`;
  await writeFile(join(root,'卡片/实体.md'),doc('concept',[]));
  await writeFile(join(root,'例一.md'),doc('exercise',['[[卡片/实体|别名]]','[[卡片/实体.md|别名]]']));
  await writeFile(join(root,'例二.md'),doc('exercise',['[[实体|别名]]']));
  await writeFile(join(root,'普通.md'),doc('exercise',['实体']));
  const store=createVaultStore({root,cachePath:':memory:'});t.after(()=>store.close());
  const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {VaultSearchDialog} from './src/search-dialog.jsx';import css from './src/styles.css';
    const style=document.createElement('style');style.textContent=css;document.head.append(style);
    const root=createRoot(document.getElementById('root'));window.applied=[];
    const remote={query:async input=>(await fetch('/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)})).json()};
    const filters={tags:[],tagMatch:'all',q:'',type:'',reviewStatus:'',minReviews:'',sort:'title'};
    window.renderDialog=key=>root.render(<VaultSearchDialog key={key} remote={remote} search="" filters={filters} view="table" onApply={(text,value)=>window.applied.push(value)} onClose={()=>{}}/>);window.renderDialog('initial');`,resolveDir:fileURLToPath(new URL('../',import.meta.url)),loader:'jsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',loader:{'.css':'text'},logLevel:'silent',alias:{'@deepseek-ai/dsh-client-ui-primitives':fileURLToPath(new URL('../../../tests/fixtures/modal.jsx',import.meta.url))}});
  const queries=[],server=createServer(async(req,res)=>{
    if(req.url==='/query'){let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);queries.push(input);res.setHeader('Content-Type','application/json');try{res.end(JSON.stringify({ok:true,value:store.query(input)}));}catch(error){res.end(JSON.stringify({ok:false,error:{message:error.code||error.message}}));}return;}
    res.setHeader('Content-Type',req.url==='/fixture.js'?'text/javascript':'text/html; charset=utf-8');res.end(req.url==='/fixture.js'?bundle.outputFiles[0].text:'<meta charset="utf-8"><body style="font:14px system-ui"><div id="root"></div><script src="/fixture.js"></script>');
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1000,height:800}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const entity=page.getByRole('checkbox',{name:'标签 实体 · 知识实体',exact:true}),ordinary=page.getByRole('checkbox',{name:'标签 实体',exact:true});
  await expect(entity).toHaveCount(1);await expect(ordinary).toHaveCount(1);await entity.check();
  await expect(page.getByRole('status')).toHaveText('2 份符合条件');
  await page.getByRole('button',{name:'应用',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>window.applied[0].tags),['[[卡片/实体.md]]']);
  assert.equal((await page.locator('body').innerText()).includes('[['),false);
  const output=new URL('../output/playwright/exploration-upgrade/',import.meta.url);await mkdir(output,{recursive:true});await page.screenshot({path:fileURLToPath(new URL('canonical-facet.png',output)),fullPage:true});
  await page.evaluate(()=>window.renderDialog('ordinary'));await ordinary.check();await expect(page.getByRole('status')).toHaveText('1 份符合条件');await page.getByRole('button',{name:'应用',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>window.applied[1].tags),['实体']);
  assert.ok(queries.some(input=>input.tags?.[0]==='[[卡片/实体.md]]'));
  assert.deepEqual(errors,[]);
});
