import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {chromium,expect} from '@playwright/test';

test('success feedback expires, repeated success renews, errors and durable state remain',{timeout:30000},async()=>{
 const script=await build({stdin:{contents:`
 import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
 import {useSuccessFeedback} from './src/success-feedback.jsx';
 import {InteractiveBlocks} from './src/blocks.jsx';
 const frames=['\x60\x60\x60frames','title: 推演','frame 当前','当前条件','predict: 下一步？','frame 后续','NEXT_FRAME','\x60\x60\x60'].join('\\n');
 function Surface(){const [toast,success,clear]=useSuccessFeedback(),[error,setError]=useState('');
 return <section>{toast}<button onClick={()=>success('操作已完成')}>成功</button><button onClick={()=>{clear();setError('保存失败，草稿已保留');}}>失败</button><div role="status">白板教学已启用</div>{error&&<p role="status">{error}</p>}<textarea aria-label="草稿" defaultValue="保留这段想法"/></section>;}
 function App(){const [open,setOpen]=useState(true);return <><button onClick={()=>setOpen(!open)}>切换页面</button>{open&&<Surface/>}<InteractiveBlocks scope="feedback-regression" source={frames} onSubmit={async()=>{}}/></>;}
 createRoot(document.getElementById('root')).render(<App/>);`,loader:'jsx',resolveDir:fileURLToPath(new URL('../',import.meta.url))},bundle:true,write:false,format:'iife',platform:'browser',conditions:['production'],define:{'process.env.NODE_ENV':'"production"'},loader:{'.css':'text'},alias:{'@deepseek-ai/dsh-client-ui-primitives':fileURLToPath(new URL('../../../tests/fixtures/modal.jsx',import.meta.url))},logLevel:'silent'});
 const browser=await chromium.launch({headless:true});
 try{const page=await browser.newPage();page.setDefaultTimeout(5000);const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.route('https://feedback.test/**',route=>route.fulfill(route.request().url().endsWith('/fixture.js')?{contentType:'text/javascript; charset=utf-8',body:script.outputFiles[0].text}:{contentType:'text/html; charset=utf-8',body:'<!doctype html><meta charset="utf-8"><div id="root"></div><script src="/fixture.js"></script>'}));await page.goto('https://feedback.test/');await page.clock.install();
  const receipt=page.getByRole('alert');await page.getByRole('button',{name:'成功',exact:true}).click();await expect(receipt).toHaveText('操作已完成');const position=await page.getByLabel('草稿').boundingBox();
  await page.clock.runFor(2000);await page.getByRole('button',{name:'成功',exact:true}).click();await page.clock.runFor(2100);await expect(receipt).toBeVisible();
  await page.clock.runFor(2000);await expect(receipt).toHaveCount(0);assert.deepEqual(await page.getByLabel('草稿').boundingBox(),position);await expect(page.getByLabel('草稿')).toHaveValue('保留这段想法');
  await page.getByRole('button',{name:'成功',exact:true}).click();await page.getByRole('button',{name:'失败',exact:true}).click();await page.clock.runFor(6000);await expect(receipt).toHaveCount(0);await expect(page.getByText('保存失败，草稿已保留',{exact:true})).toBeVisible();await expect(page.getByText('白板教学已启用',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'成功',exact:true}).click();await page.getByRole('button',{name:'切换页面'}).click();await page.clock.runFor(6000);await expect(receipt).toHaveCount(0);await page.getByRole('button',{name:'切换页面'}).click();await expect(receipt).toHaveCount(0);
  await page.getByRole('button',{name:'下一帧',exact:true}).click();
  await page.getByRole('button',{name:'交给老师',exact:true}).click();await page.clock.runFor(6000);await expect(page.getByText('请先写下预测，或勾选“不确定”。',{exact:true})).toBeVisible();
  await page.getByRole('textbox',{name:'我的预测',exact:true}).fill('状态会改变');await page.getByRole('button',{name:'交给老师',exact:true}).click();await expect(receipt).toHaveText('已放入对话草稿，请确认后发送。');await expect(page.getByRole('status').filter({hasText:'已放入对话草稿'})).toHaveCount(0);await page.clock.runFor(4100);await expect(receipt).toHaveCount(0);await expect(page.getByText('NEXT_FRAME',{exact:true})).toBeVisible();
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
