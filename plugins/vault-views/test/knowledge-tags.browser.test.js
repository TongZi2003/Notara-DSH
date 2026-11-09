import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';

test('preview entity tags show labels, open their real targets and keep ordinary tags distinct',async()=>{
  const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {DocumentProperties} from './src/document-properties.jsx';import {PropertyControl} from './src/property-control.jsx';
    window.opened=[];window.filtered=[];window.edited=[];createRoot(document.getElementById('root')).render(<><DocumentProperties content={'---\\ntype: exercise\\ntags: ["[[卡片/实体.md|别名]]", "别名"]\\n---\\n正文'} knowledgeTags={[{raw:'[[卡片/实体.md|别名]]',target:'卡片/实体.md',label:'别名'}]} onOpen={item=>window.opened.push(item)} onTag={value=>window.filtered.push(value)}/><div id="edit"><PropertyControl name="标签" type="tags" value={['[[卡片/实体.md|别名]]','别名']} knowledgeTags={[{raw:'[[卡片/实体.md|别名]]',target:'卡片/实体.md',label:'别名'}]} onOpen={item=>window.opened.push(item)} onCommit={value=>window.edited.push(value)}/></div></>);`,resolveDir:fileURLToPath(new URL('../',import.meta.url)),loader:'jsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',logLevel:'silent',alias:{'@deepseek-ai/dsh-client-ui-primitives':fileURLToPath(new URL('../../../tests/fixtures/modal.jsx',import.meta.url))}});
  const browser=await chromium.launch({headless:true});try{
    const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setContent('<meta charset="utf-8"><div id="root"></div>');await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.getByRole('region',{name:'文档属性'}).getByRole('button',{name:'打开知识实体 别名',exact:true}).click({timeout:3000});
    await page.getByRole('button',{name:'筛选知识标签 别名',exact:true}).click();
    await page.getByRole('button',{name:'筛选标签 别名',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>window.opened),[{path:'卡片/实体.md'}]);
    assert.deepEqual(await page.evaluate(()=>window.filtered),['[[卡片/实体.md]]','别名']);
    await expect(page.getByText('具体例子',{exact:true})).toBeVisible();
    assert.equal((await page.locator('body').innerText()).includes('[['),false);
    await page.locator('#edit').getByRole('button',{name:'打开知识实体 别名',exact:true}).click({timeout:3000});
    await page.locator('#edit').getByRole('button',{name:'移除标签 别名',exact:true}).first().click();
    assert.deepEqual(await page.evaluate(()=>window.edited),[['别名']]);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

test('preview resolves entity metadata from the exact query document when read returns only file bytes',async()=>{
  const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {useFilePreview} from './src/file-preview.jsx';import {DocumentProperties} from './src/document-properties.jsx';
    window.opened=[];window.queries=[];const content='---\\ntype: exercise\\ntags: ["[[卡片/实体.md|别名]]"]\\n---\\n正文';
    const remote={read:async()=>({ok:true,value:{path:'例子.md',revision:'r1',content}}),query:async input=>{window.queries.push(input);return {ok:true,value:{documents:[{path:'例子.md',revision:'r1',knowledgeTags:[{raw:'[[卡片/实体.md|别名]]',target:'卡片/实体.md',label:'别名'}]}]}};}};
    function Preview(){const state=useFilePreview(remote,'例子.md');return state.record?<DocumentProperties content={state.record.content} knowledgeTags={state.record.knowledgeTags} onOpen={item=>window.opened.push(item)}/>:null;}createRoot(document.getElementById('root')).render(<Preview/>);`,resolveDir:fileURLToPath(new URL('../',import.meta.url)),loader:'jsx'},bundle:true,write:false,format:'iife',platform:'browser',conditions:['production'],jsx:'automatic',loader:{'.css':'text'},logLevel:'silent',alias:{'@deepseek-ai/dsh-client-ui-primitives':fileURLToPath(new URL('../../../tests/fixtures/modal.jsx',import.meta.url))}});
  const browser=await chromium.launch({headless:true});try{const page=await browser.newPage();await page.setContent('<div id="root"></div>');await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.getByRole('button',{name:'打开知识实体 别名',exact:true}).click({timeout:3000});
    assert.deepEqual(await page.evaluate(()=>window.opened),[{path:'卡片/实体.md'}]);
    assert.deepEqual((await page.evaluate(()=>window.queries))[0].paths,['例子.md']);
  }finally{await browser.close();}
});
