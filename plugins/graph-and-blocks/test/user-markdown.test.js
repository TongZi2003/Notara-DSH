import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

test('user Markdown honors native text display and renders reference nodes once in order',async()=>{
  const output=new URL('../.test-output/',import.meta.url);await mkdir(output,{recursive:true});
  const outfile=fileURLToPath(new URL('user-markdown.cjs',output));
  await build({entryPoints:[fileURLToPath(new URL('../src/user-markdown.jsx',import.meta.url))],outfile,bundle:true,platform:'node',format:'cjs',jsx:'automatic',external:['react'],logLevel:'warning'});
  const {UserMarkdownMessage,userMessageCopyText}=createRequire(import.meta.url)(outfile);
  const text='我的正文 INTERNAL_DIRECTIVE file-wire 后续话';
  const nodes=[{id:'text',start:0,end:5,data:{text:'我的正文 '}},{id:'text',start:5,end:23,data:{text:'INTERNAL_DIRECTIVE',display:'【大小姐】'}},{id:'file',start:23,end:33,data:{label:'讲义',path:'secret.md'}},{id:'text',start:33,end:text.length,data:{text:' 后续话'}}];
  const userText={subscribe:()=>()=>{},getSnapshot:()=>0,createEvaluator:()=>()=>nodes};
  const html=renderToStaticMarkup(React.createElement(UserMarkdownMessage,{node:{data:{content:[{type:'text',text}]}},Native:()=>null,userText,MarkdownText:({text})=>React.createElement('p',null,text),renderFactorySlot:()=>React.createElement('button',null,'讲义'),t:x=>x}));
  assert.doesNotMatch(html,/INTERNAL_DIRECTIVE|file-wire/);assert.match(html,/大小姐/);assert.match(html,/后续话/);
  assert.equal((html.match(/讲义/g)??[]).length,1);assert.ok(html.indexOf('大小姐')<html.indexOf('讲义'));assert.ok(html.indexOf('讲义')<html.indexOf('后续话'));
  assert.equal(userMessageCopyText(text,nodes),'我的正文 【大小姐】【讲义】 后续话');
});
