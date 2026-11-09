import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,cp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {startNativeRuntime} from '../scripts/native-runtime.mjs';
import {openGraph,graphAction,graphSelect} from '../scripts/ui-navigation.mjs';

const fixture=await mkdtemp(join(tmpdir(),'notara-reference-refresh-'));
if(process.env.NOTARA_TEST_FIXTURE)await cp(resolve(process.env.NOTARA_TEST_FIXTURE),fixture,{recursive:true});
await mkdir(join(fixture,'回归'),{recursive:true});
await writeFile(join(fixture,'回归/数值1.1.md'),'---\ntype: concept\n---\n# 小数标题\n\n小数文件的正文保持可读。');
await writeFile(join(fixture,'回归/方法1.2.md'),'---\ntype: method\n---\n## 前序依赖\n- [[回归/数值1.1]]：理解数值。');
await writeFile(join(fixture,'回归/入口.md'),'# 引用入口\n\n[[回归/数值1.1|打开小数笔记]]\n\n![[回归/数值1.1]]');
const out=resolve(process.env.NOTARA_TEST_OUTPUT??'work/material-graph-refresh');await mkdir(out,{recursive:true});
let runtime,browser;const report={errors:[],stages:[]};
try{
 runtime=await startNativeRuntime({fixture,testModel:true});browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:960}});page.setDefaultTimeout(20000);page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(runtime.authUrl);await page.getByRole('button',{name:/^(Continue|继续)$/}).click();await page.locator('[data-composer-input]:visible').waitFor();await page.waitForLoadState('networkidle');
 const open=path=>page.evaluate(path=>window.dispatchEvent(new CustomEvent('notara:open-document',{detail:{path}})),path);
 await open('回归/入口.md');const reader=page.locator('.nv-vault-doc-tab:visible');
 await expect(reader.locator('.nv-document-file-embed')).toContainText('小数文件的正文保持可读');
 await reader.getByText('打开小数笔记',{exact:true}).click();
 await expect(reader).toContainText('小数文件的正文保持可读');
 await expect(reader).not.toContainText('引用入口');report.referenceClickAndEmbed=true;
 await page.screenshot({path:join(out,'01-decimal-note.png')});
 const graph=page.locator('.nv-independent-graph:visible'),canvas=graph.locator('svg.nv-block-graph-canvas');
 const centerPath=process.env.NOTARA_TEST_CENTER??'回归/数值1.1.md',centerTitle=centerPath.split('/').at(-1).replace(/\.md$/,'');
 async function snapshot(){return canvas.evaluate(async svg=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return {nodes:[...svg.querySelectorAll('[data-graph-node]')].map(n=>n.dataset.graphNode).sort(),centers:[...svg.querySelectorAll('.nv-block-center')].map(n=>n.dataset.graphNode).sort(),camera:svg.querySelector(':scope > g').getAttribute('transform'),labels:svg.dataset.labelMode,presentation:svg.dataset.presentation};});}
 async function reloadSame(name){
  await expect(canvas.locator('[data-graph-node]').first()).toBeVisible();
  const before=await snapshot();assert.ok(before.nodes.length);
  await page.reload();await expect(canvas.locator('[data-graph-node]').first()).toBeVisible();
  await expect.poll(snapshot).toEqual(before);report.stages.push({name,nodes:before.nodes.length,centers:before.centers,camera:before.camera});
  await page.screenshot({path:join(out,name+'.png')});
 }
 async function center(){
  await graphAction(page,graph,{name:'中心节点',exact:true});
  const dialog=page.getByRole('dialog',{name:'中心节点',exact:true});await dialog.getByLabel('查找中心资料').fill(centerTitle);
  // Title frontmatter may differ from the filename; use the exact authored
  // title for the actual derivative fixture, and the test title otherwise.
  await dialog.getByLabel('中心资料 '+(process.env.NOTARA_TEST_CENTER?centerTitle:'小数标题'),{exact:true}).check();
  await dialog.getByRole('button',{name:'应用',exact:true}).click();await expect(graph.locator('.nv-block-center')).toHaveCount(1);
 }
 await openGraph(page);await graphSelect(page,graph,'图谱视图','knowledge');await reloadSame('02-unsent-knowledge');
 await center();await graphSelect(page,graph,'图谱标题显示','all');await graphSelect(page,graph,'知识联系筛选','potential');
 await canvas.evaluate(svg=>svg.dispatchEvent(new WheelEvent('wheel',{deltaX:63,deltaY:29,bubbles:true,cancelable:true})));
 await expect.poll(()=>canvas.locator(':scope > g').getAttribute('transform')).not.toBe(null);
 await reloadSame('03-unsent-center');await expect(graph.getByLabel('知识联系筛选',{exact:true})).toHaveValue('potential');
 await graph.getByRole('button',{name:'返回上一级图谱',exact:true}).click();await expect(graph.getByLabel('图谱视图',{exact:true})).toHaveValue('knowledge');
 // An explicit document focus wins over the old saved view, then itself resumes.
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('notara:open-graph',{detail:{focusPath:'回归/方法1.2.md'}})));
 await expect(graph.locator('[data-graph-node="回归/方法1.2.md"]')).toHaveClass(/nv-block-center/);await reloadSame('04-explicit-focus');
 const composer=page.locator('[data-composer-input]:visible');await composer.fill('建立图谱刷新回归会话。');await composer.press('Enter');
 await page.locator('section.nv-block-flow:visible').waitFor();await expect(page.getByRole('button',{name:/^(Stop generating|停止生成)$/})).toHaveCount(0);
 await openGraph(page);await graphSelect(page,graph,'图谱视图','sources');
 const cluster=graph.locator('[data-cluster-key]').first();await cluster.focus();await page.keyboard.press('Enter');
 await expect(graph.getByRole('button',{name:'返回资料概览',exact:true})).toBeVisible();await reloadSame('05-active-source');
 await graph.getByRole('button',{name:'返回资料概览',exact:true}).click();await center();await reloadSame('06-active-center');
 assert.deepEqual(report.errors,[]);report.status='PASS';
}catch(error){report.status='FAIL';report.error=error.stack;const page=browser?.contexts()[0]?.pages()[0];if(page){await page.screenshot({path:join(out,'failure.png')});await writeFile(join(out,'failure.txt'),await page.locator('body').innerText());}process.exitCode=1;}
finally{await writeFile(join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));await browser?.close();await runtime?.stop();await rm(fixture,{recursive:true,force:true});}
