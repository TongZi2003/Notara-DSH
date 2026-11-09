import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';

test('large filter pickers bound rendered options, retain cross-page selections and reject stale remote results', {timeout:30000},async()=>{
  const source=`import React,{useState} from 'react';import{createRoot}from'react-dom/client';
    import{FilterOptions,FilterSelect}from'./src/filter-options.jsx';
    import{FilterOptions as GraphOptions}from'../graph-and-blocks/src/filter-options.jsx';
    import styles from './src/styles.css';
    const style=document.createElement('style');style.textContent=styles;document.head.append(style);
    const options=Array.from({length:1200},(_,i)=>'标签'+String(i).padStart(4,'0'));
    window.loads=[];const load=async({q})=>{window.loads.push(q);await new Promise(resolve=>setTimeout(resolve,q==='slow'?400:20));if(q==='error')throw Error('offline');return{options:[{value:q||'initial',label:q||'initial'}],total:1};};
    function Local({Component,id}){const[selected,set]=useState([]);return <section data-picker={id}><Component options={options} selected={selected} onChange={set} maxSelected={32}/><button onClick={()=>set(options.slice(0,32))}>选择32项</button></section>;}
    function App(){const[selected,set]=useState([]),[property,setProperty]=useState(options[0]);return <><Local Component={FilterOptions} id="library"/><Local Component={GraphOptions} id="graph"/><section data-picker="remote"><FilterOptions selected={selected} onChange={set} loadOptions={load}/></section><section data-picker="property"><FilterSelect label="筛选属性" value={property} onChange={setProperty} options={options}/></section></>;}
    createRoot(document.getElementById('root')).render(<App/>);`;
  const bundle=await build({stdin:{contents:source,resolveDir:fileURLToPath(new URL('../',import.meta.url)),loader:'jsx'},bundle:true,write:false,platform:'browser',format:'iife',loader:{'.css':'text'},define:{'process.env.NODE_ENV':'"production"'},alias:{'@deepseek-ai/dsh-client-ui-primitives':fileURLToPath(new URL('../../../tests/fixtures/modal.jsx',import.meta.url))},logLevel:'silent'});
  const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:460,height:746}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  page.setDefaultTimeout(5000);
  try{
    await page.setContent('<!doctype html><meta charset="utf-8"><style>body{margin:12px}section{margin-bottom:25px}</style><div id="root"></div>');await page.addScriptTag({content:bundle.outputFiles[0].text});
    for(const id of ['library','graph']){
      const picker=page.locator(`[data-picker="${id}"]`),candidates=picker.getByRole('group',{name:'标签候选'});
      await expect(candidates.getByRole('checkbox')).toHaveCount(40);
      await picker.getByRole('button',{name:'标签下一页',exact:true}).click();await picker.getByLabel('标签 标签0041',{exact:true}).check();
      await picker.getByRole('searchbox',{name:'查找标签',exact:true}).fill('标签1199');await expect(candidates.getByRole('checkbox')).toHaveCount(1);await picker.getByLabel('标签 标签1199',{exact:true}).check();
      await picker.getByRole('button',{name:'查看已选标签',exact:true}).click();await expect(candidates.getByRole('checkbox')).toHaveCount(2);await expect(picker.getByLabel('标签 标签0041',{exact:true})).toBeChecked();
      await picker.getByLabel('标签 标签0041',{exact:true}).click();await expect(candidates.getByRole('checkbox')).toHaveCount(1);
      await picker.getByRole('button',{name:'查看已选标签',exact:true}).click();await picker.getByRole('button',{name:'选择32项',exact:true}).click();
      await expect(picker.getByLabel('标签 标签0032',{exact:true})).toBeDisabled();await picker.getByLabel('标签 标签0000',{exact:true}).uncheck();await expect(picker.getByLabel('标签 标签0032',{exact:true})).toBeEnabled();
      const box=await candidates.boundingBox();assert.ok(box.height<=204);
    }
    const remote=page.locator('[data-picker="remote"]'),input=remote.getByRole('searchbox',{name:'查找标签',exact:true});
    await input.fill('slow');await expect.poll(()=>page.evaluate(()=>window.loads.includes('slow'))).toBe(true);await input.fill('fast');await expect(remote.getByLabel('标签 fast',{exact:true})).toBeVisible();
    await page.waitForTimeout(450);await expect(remote.getByLabel('标签 slow',{exact:true})).toHaveCount(0);
    await remote.getByLabel('标签 fast',{exact:true}).check();await input.fill('error');await expect(remote.getByRole('button',{name:'重试候选',exact:true})).toBeVisible();await expect(remote.getByRole('group',{name:'标签候选'}).getByRole('checkbox')).toHaveCount(0);
    await remote.getByRole('button',{name:'查看已选标签',exact:true}).click();await expect(remote.getByLabel('标签 fast',{exact:true})).toBeChecked();
    await page.locator('[data-picker="property"]').getByRole('button',{name:'筛选属性',exact:true}).click();const dialog=page.getByRole('dialog');await expect(dialog.getByRole('radio')).toHaveCount(40);await dialog.getByRole('searchbox',{name:'查找筛选属性',exact:true}).fill('标签1199');await dialog.getByLabel('属性 标签1199',{exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.locator('[data-picker="property"]').getByRole('button')).toHaveText('标签1199⌄');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
