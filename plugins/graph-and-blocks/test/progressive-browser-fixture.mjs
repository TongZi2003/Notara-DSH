import {build} from 'esbuild';
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

export async function progressiveFixture(t,{viewport={width:1440,height:960},headless=true}={}){
  const base=fileURLToPath(new URL('../../../work/progressive-graph-20261103/ui/',import.meta.url));await mkdir(base,{recursive:true});
  const dir=await mkdtemp(join(base,'browser-'));
  const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ForceGraphView} from './src/graph-view.jsx';import css from './src/styles.css';
    const style=document.createElement('style');style.textContent=css;document.head.append(style);const root=createRoot(document.getElementById('root'));
    window.state={positions:new Map()};window.opened=[];window.brought=[];window.renderGraph=(data,{key,...extra}={})=>{window.data=data;root.render(<ForceGraphView key={key} data={data} viewState={window.state} onOpenDocument={item=>window.opened.push(item)} onBring={pins=>window.brought.push(pins)} {...extra}/>);};`,resolveDir:fileURLToPath(new URL('../',import.meta.url)),loader:'jsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',loader:{'.css':'text'},logLevel:'warning',alias:{'@deepseek-ai/dsh-client-ui-primitives':fileURLToPath(new URL('../../../tests/fixtures/modal.jsx',import.meta.url))}});
  const html='<meta charset="utf-8"><body style="margin:0;font:14px system-ui;height:100vh"><div id="root" style="height:100%"></div><script src="/fixture.js"></script>';
  const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/fixture.js'?'text/javascript':'text/html; charset=utf-8');res.end(req.url==='/fixture.js'?bundle.outputFiles[0].text:html);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const browser=await chromium.launch({headless});t.after(()=>browser.close());const page=await browser.newPage({viewport}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  t.after(()=>writeFile(join(dir,'browser.json'),JSON.stringify({port:server.address()?.port,errors},null,2)));
  return {page,errors,dir,port:server.address().port};
}
