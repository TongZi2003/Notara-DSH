import {graphSettings,graphView,graphExamples} from './graph-ui.fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

test('graph UI keeps auxiliary centers discoverable and selections intact while default and scoped views stay clean', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'notara-graph-scope-'));
  t.after(() => rm(directory, { recursive:true, force:true }));
  await build({ stdin:{contents:`
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {ForceGraphView} from './src/graph-view.jsx';
    import css from './src/styles.css';
    const style=document.createElement('style');style.textContent=css;document.head.append(style);
    const root=createRoot(document.getElementById('root'));
    window.brought=[];window.opened=[];
    window.renderGraph=props=>root.render(<ForceGraphView {...props}
      onBring={pins=>window.brought.push(pins)} onOpenDocument={value=>window.opened.push(value)}/>);
  `,resolveDir:fileURLToPath(new URL('../',import.meta.url)),loader:'jsx'},
    bundle:true,outfile:join(directory,'fixture.js'),format:'iife',platform:'browser',jsx:'automatic',loader:{'.css':'text'},logLevel:'warning',
    alias:{'@deepseek-ai/dsh-client-ui-primitives':fileURLToPath(new URL('../../../tests/fixtures/modal.jsx',import.meta.url))} });
  await writeFile(join(directory,'fixture.html'),'<meta charset="utf-8"><body style="margin:16px;font:15px system-ui"><div id="root"></div><script src="fixture.js"></script>');
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1100,height:900}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route(/^https?:\/\//,route=>route.abort());
  await page.goto(pathToFileURL(join(directory,'fixture.html')).href);
  const data={nodes:[
    {path:'讲义.pdf',title:'原始讲义',type:'source',isSource:true},
    {path:'题目.md',title:'练习题',type:'exercise',tags:['数学'],sourcePaths:['讲义.pdf']},
    {path:'概念.md',title:'概念',type:'concept',tags:['数学']},
    {path:'今日.md',title:'今日日记',type:'diary'},
    {path:'导读.md',title:'学习导读',type:'source',isSource:false},
    {path:'工具.py',title:'辅助脚本',type:'file',isSource:false},
  ].map(node=>({tags:[],revision:'fixture-v1',...node})),edges:[
    ['题目.md','讲义.pdf'],['今日.md','题目.md'],['今日.md','导读.md'],['导读.md','概念.md'],['题目.md','概念.md'],
  ].map(([source,target])=>({source,target,style:'dashed'}))};
  const render=props=>page.evaluate(props=>window.renderGraph(props),{data,...props});
  const nodes=page.locator('[data-graph-node]');
  const paths=async()=>nodes.evaluateAll(nodes=>nodes.map(node=>node.dataset.graphNode).sort());
  const options=async()=>{const button=page.getByRole('button',{name:'图谱选项',exact:true});if(await button.getAttribute('aria-expanded')!=='true')await button.click();};
  await render({});
  await expect(page.getByRole('button',{name:'展开原始讲义，1张卡片'})).toBeVisible();
  await expect(page.getByRole('button',{name:/展开.*(?:日记|导读|辅助脚本)/})).toHaveCount(0);
  await page.getByRole('button',{name:'展开原始讲义，1张卡片'}).click();
  await expect(nodes).toHaveCount(1);
  assert.deepEqual(await paths(),['概念.md']);
  await expect(page.locator('.nv-block-graph-canvas')).toHaveAttribute('data-layout','source-hierarchy');
  await expect(page.locator('.nv-graph-source-branch')).toHaveCount(0);
  await expect(page.locator('.nv-block-edge')).toHaveCount(0);
  await page.locator('[data-graph-node="概念.md"]>circle:not(.nv-block-node-focus)').click();
  await graphExamples(page);await expect(page.getByRole('region',{name:'具体例子',exact:true})).toContainText('练习题');
  await graphView(page,'all');
  await expect(nodes).toHaveCount(3);
  await options();await page.getByRole('combobox',{name:'图谱资料类型'}).selectOption('source');
  await graphSettings(page,true);await page.getByRole('button',{name:/高级搜索/}).click();
  const advanced=page.getByRole('dialog',{name:'图谱高级搜索'});
  await advanced.getByRole('button',{name:'清空条件',exact:true}).click();
  await expect(advanced.getByRole('status')).toHaveText('1 份符合条件');
  await advanced.getByRole('button',{name:'应用',exact:true}).click();
  await expect(nodes).toHaveCount(1);
  await options();await page.getByRole('combobox',{name:'图谱资料类型'}).selectOption('all');
  await options();await page.getByRole('button',{name:'中心节点',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'中心节点',exact:true});
  await dialog.getByRole('searchbox',{name:'查找中心资料'}).fill('日记');
  await dialog.getByRole('checkbox',{name:'中心资料 今日日记',exact:true}).check();
  await dialog.getByRole('button',{name:'应用',exact:true}).click();
  await expect(nodes).toHaveCount(2);
  assert.deepEqual(await paths(),['今日.md','题目.md'].sort());
  await options();await page.getByRole('combobox',{name:'中心联系范围'}).selectOption('3');
  await expect(nodes).toHaveCount(4);
  await expect(page.locator('[data-graph-node="导读.md"]')).toHaveCount(0);
  await page.getByRole('combobox',{name:'图谱资料类型'}).selectOption('cards');
  await expect(nodes).toHaveCount(3);
  await page.getByRole('button',{name:'标签筛选',exact:true}).click();
  const tags=page.getByRole('dialog',{name:'筛选标签'});
  await tags.getByRole('checkbox',{name:'图谱标签 数学',exact:true}).check();
  await tags.getByRole('button',{name:'应用',exact:true}).click();
  await expect(nodes).toHaveCount(3);
  // Closing the dialog returns focus on the next animation frame; wait before
  // focusing a node so the keyboard action cannot be redirected to the trigger.
  await expect(page.getByRole('button',{name:'图谱选项',exact:true})).toBeFocused();
  await page.locator('[data-graph-node="今日.md"]').press('Control+Space');
  await expect(page.getByRole('button',{name:'已选 1 / 12',exact:true})).toBeEnabled();
  const output=(process.env.NOTARA_GRAPH_TEST_OUTPUT?new URL(`file://${process.env.NOTARA_GRAPH_TEST_OUTPUT}/graph-scope/`):new URL('../.test-output/graph-scope/',import.meta.url));await mkdir(output,{recursive:true});
  await page.screenshot({path:fileURLToPath(new URL('auxiliary-center.png',output))});
  await options();await page.getByRole('button',{name:'退出中心',exact:true}).click();await graphView(page,'all');
  await expect(nodes).toHaveCount(2);
  await expect(page.getByRole('button',{name:'已选 1 / 12 · 1 项在筛选外',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'带入当前对话',exact:true}).click();
  await expect(page.getByText('已放入当前对话草稿，尚未发送。',{exact:true})).toBeVisible();
  await expect(page.getByRole('status').filter({hasText:'已放入当前对话草稿，尚未发送。'})).toHaveCount(0);
  await expect(page.getByRole('alert').filter({hasText:'已放入当前对话草稿，尚未发送。'})).toHaveCount(0,{timeout:6000});
  assert.deepEqual(await page.evaluate(()=>window.brought),[[{path:'今日.md',title:'今日日记',revision:'fixture-v1'}]]);
  // Document entry focuses an auxiliary even when the overview currently hides it.
  await render({focusPath:'导读.md'});await expect(page.locator('[data-graph-node="导读.md"]')).toBeVisible();await expect(nodes).toHaveCount(3);
  assert.deepEqual(await paths(),['导读.md','概念.md','题目.md'].sort());
  await page.locator('[data-graph-node="导读.md"]').press('Control+Space');
  await expect(page.getByRole('button',{name:'已选 1 / 12',exact:true})).toBeEnabled();
  // A Base/workspace restriction is authoritative for the center and selection catalog.
  await render({focusPath:'导读.md',allowedPaths:['题目.md','概念.md']});
  await expect(nodes).toHaveCount(0);
  await expect(page.locator('.nv-graph-bring-bar')).toHaveCount(0);
  await render({focusPath:'导读.md'});await expect(nodes).toHaveCount(3);
  await page.locator('[data-graph-node="导读.md"]').press('Control+Space');
  await render({focusPath:'导读.md',data:{...data,nodes:data.nodes.filter(node=>node.path!=='导读.md')}});
  await expect(nodes).toHaveCount(0);
  await expect(page.locator('.nv-graph-bring-bar')).toHaveCount(0);
  // A fresh document-center request overrides an overview saved for another scope.
  await render({key:'remounted-center',focusPath:'今日.md',viewState:{organization:'sources',focusPath:undefined,filters:{centers:[],tags:[],type:'all',hops:1}}});
  await expect(page.locator('[data-graph-node="今日.md"]')).toBeVisible();
  await expect(nodes).toHaveCount(2);
  assert.deepEqual(errors,[]);
});
