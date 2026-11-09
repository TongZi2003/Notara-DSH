import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {startNativeRuntime,workspaceRoot} from '../scripts/native-runtime.mjs';
import {openGraph} from '../scripts/ui-navigation.mjs';

test('independent teacher keeps its source workspace for graph and native document links',{timeout:90_000},async()=>{
  const fixture=await mkdtemp(join(workspaceRoot,'work/file-child-fixture-'));
  await writeFile(join(fixture,'train.py'),'# CHILD_WORKSPACE_CODE\nprint(1)\n');
  await writeFile(join(fixture,'课堂笔记.md'),'# 课堂笔记\n[[train.py]]\n');
  const runtime=await startNativeRuntime({fixture,testModel:true,modelFixture:'tests/file-child-model.mjs'});
  const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1414,height:850}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.goto(runtime.authUrl);await page.getByRole('button',{name:/^(Continue|继续)$/}).click();await page.locator('[data-composer-input]:visible').waitFor();await page.waitForLoadState('networkidle');
    const picker=page.getByRole('button',{name:'切换工作区',exact:true}),workspaceId=await picker.getAttribute('data-workspace-id');
    await page.locator('[data-composer-input]').pressSequentially('请创建文件引用课堂。');await page.getByRole('button',{name:/^(Send message|发送消息)$/}).click();
    await expect(page.getByText('文件引用课堂已打开。',{exact:true})).toBeVisible();
    await page.getByRole('tablist',{name:'工作区栏目'}).getByRole('tab',{name:'会话',exact:true}).click();
    await page.getByRole('list',{name:'当前工作区会话'}).locator('.nv-session-row').filter({hasText:'文件引用课堂'}).locator('button').first().click();
    await expect(page.locator('.nv-chat-markdown').getByRole('button',{name:'课堂代码',exact:true})).toBeVisible();
    await expect(picker).toHaveAttribute('data-workspace-id',workspaceId);
    await page.locator('[data-composer-input]').pressSequentially('保留子课堂草稿');
    await page.locator('.nv-chat-markdown').getByRole('button',{name:'课堂代码',exact:true}).click();
    await expect(page.getByText('# CHILD_WORKSPACE_CODE',{exact:true})).toBeVisible();
    const codeTab=await page.locator('[data-dockkit-tab][aria-selected="true"]').getAttribute('data-dockkit-tab');
    await page.locator('.nv-chat-markdown').getByRole('button',{name:'课堂笔记',exact:true}).click();
    await expect(page.locator('.nv-vault-doc-tab:visible .cm-editor')).toBeVisible();
    await openGraph(page);const graph=page.locator('.nv-independent-graph:visible');
    await expect(graph.getByRole('button',{name:'按原始资料',exact:true})).toHaveAttribute('aria-pressed','true');
    await graph.getByRole('button',{name:'全部联系',exact:true}).click();await expect(graph.getByRole('button',{name:'集成测试讲义，按回车打开',exact:true})).toBeVisible();
    await expect(graph.getByRole('button',{name:'train.py，按回车打开',exact:true})).toHaveCount(0);
    // Explicit focus includes ordinary files while retaining their source workspace.
    await page.evaluate(workspaceId=>window.dispatchEvent(new CustomEvent('notara:open-graph',{detail:{focusPath:'train.py',workspaceId}})),workspaceId);
    await expect(graph.getByRole('button',{name:'train.py，按回车打开',exact:true})).toBeVisible();
    await graph.getByRole('button',{name:'train.py，按回车打开',exact:true}).press('Enter');
    await expect(page.getByText('# CHILD_WORKSPACE_CODE',{exact:true})).toBeVisible();
    assert.equal(await page.locator('[data-dockkit-tab][aria-selected="true"]').getAttribute('data-dockkit-tab'),codeTab,'Chat and graph reuse the same source-bound code tab');
    await expect(page.locator('[data-composer-input]')).toHaveText('保留子课堂草稿');
    assert.deepEqual(errors,[]);
  }catch(error){await page.screenshot({path:join(workspaceRoot,'outputs/file-references-20261026/child-failure.png')});throw error;}
  finally{await browser.close();await runtime.stop();await rm(fixture,{recursive:true,force:true});}
});
