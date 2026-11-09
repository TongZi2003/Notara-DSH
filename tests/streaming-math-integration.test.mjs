import test from 'node:test';
import assert from 'node:assert/strict';
import {access,mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {startNativeRuntime,workspaceRoot} from '../scripts/native-runtime.mjs';

// Run only after the parent has built UI sources and patched the isolated
// dependency directory. This test performs neither build nor package patching.
test('native browser renders closed streaming formulas, preserves pending/code boundaries and settles identically',{timeout:120000},async()=>{
  const runtime=await startNativeRuntime({testModel:true,modelFixture:'tests/streaming-math-model.mjs'});
  let browser,page;
  const errors=[],out=join(workspaceRoot,'outputs/streaming-math-20261030');
  try{
    browser=await chromium.launch({headless:true});
    page=await browser.newPage({viewport:{width:1414,height:950}});page.setDefaultTimeout(12000);
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(runtime.authUrl);await page.getByRole('button',{name:/^(Continue|继续)$/}).click();
    await page.locator('[data-composer-input]:visible').waitFor();await page.waitForLoadState('networkidle');
    await page.getByRole('button',{name:'首页学习助手',exact:true}).click();
    await page.getByRole('menuitem',{name:/^专题课堂老师/}).click();
    const input=page.locator('[data-composer-input]:visible').first();
    await input.fill('请分段展示公式，保留代码。');await input.press('Enter');
    const annotations=page.locator('.katex annotation[encoding="application/x-tex"]');
    const tex=()=>annotations.allTextContents();
    const running=page.getByRole('button',{name:/^(Stop generating|停止生成)$/});
    const ready=async stage=>{
      await expect.poll(()=>access(join(runtime.home,`streaming-math-ready-${stage}`)).then(()=>true,()=>false)).toBe(true);
      await expect(running).toBeVisible();
    };
    const next=stage=>writeFile(join(runtime.home,`streaming-math-next-${stage}`),'next');
    await ready(0);await expect(annotations).toHaveCount(2);await expect(page.locator('.katex').first()).toBeVisible();
    assert.deepEqual(await tex(),['x^2','y+1']);await next(0);
    await ready(1);await expect(page.locator('body')).toContainText('c&=3');await expect(annotations).toHaveCount(2);
    await expect(page.locator('.katex-error')).toHaveCount(0);await next(1);
    await ready(2);await expect(page.locator('body')).toContainText('end{aligned}');await expect(annotations).toHaveCount(2);await next(2);
    await ready(3);await expect(annotations).toHaveCount(3);await expect(page.locator('body')).toContainText('未完成命令');
    await expect(page.locator('.katex-error')).toHaveCount(0);await next(3);
    await ready(4);await expect(annotations).toHaveCount(4);
    await expect(page.locator('pre code').filter({hasText:'$also_code$'})).toBeVisible();
    await expect(page.locator('code').filter({hasText:'$literal$'})).toBeVisible();
    await expect(page.locator('.katex-error')).toHaveCount(0);await next(4);
    await ready(5);await expect(page.getByText('最后正文仍在生成。',{exact:true})).toBeVisible();
    const before=await tex();assert.ok(before.includes('\\frac{1}{2}'));assert.equal(before.length,4);
    await mkdir(out,{recursive:true});await page.screenshot({path:join(out,'still-streaming.png')});
    await next(5);await expect(running).toHaveCount(0);
    assert.deepEqual(await tex(),before,'final swap preserves already-rendered formula values');
    await page.reload();await expect(annotations).toHaveCount(4);assert.deepEqual(await tex(),before);
    await expect(page.locator('pre code').filter({hasText:'$also_code$'})).toBeVisible();
    await input.fill('核对保存的流式原文');await input.press('Enter');
    await expect(page.getByText('原文已核对。',{exact:true})).toBeVisible();
    assert.deepEqual(JSON.parse(await readFile(join(runtime.home,'streaming-math-history.json'),'utf8')),{exact:true},'reload preserves the exact source for the next model request');
    await expect(page.locator('.katex-error')).toHaveCount(0);assert.deepEqual(errors,[]);
  }catch(error){
    if(page){await mkdir(out,{recursive:true});await page.screenshot({path:join(out,'failure.png')});}
    throw error;
  }finally{await browser?.close();await runtime.stop();}
});
