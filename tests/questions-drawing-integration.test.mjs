import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { startNativeRuntime, workspaceRoot } from '../scripts/native-runtime.mjs';
import { board, boardPath } from './questions-drawing-model.mjs';

test('native brief questions resume after refresh and the saved teaching diagram renders and responds', {timeout:90_000}, async()=>{
  const runtime=await startNativeRuntime({testModel:true,modelFixture:'tests/questions-drawing-model.mjs'});
  const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1414,height:900}});
  page.setDefaultTimeout(10_000);
  const errors=[],output=join(workspaceRoot,'outputs/questions-drawing-20261027');
  await mkdir(output,{recursive:true});
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  try{
    await page.goto(runtime.authUrl);await page.getByRole('button',{name:/^(Continue|继续)$/}).click();await page.locator('[data-composer-input]:visible').waitFor();await page.waitForLoadState('networkidle');
    await page.getByRole('button',{name:'首页学习助手',exact:true}).click();await page.getByRole('menuitem',{name:/^专题课堂老师/}).click();
    await page.locator('[data-composer-input]').fill('协议验证：先确认学习安排，再展示当前示例。');await page.getByRole('button',{name:/^(Send message|发送消息)$/}).click();
    await expect(page.getByRole('heading',{name:'今天先学哪一部分？',exact:true})).toBeVisible();
    const card=page.locator('[data-question-key]');
    await card.getByRole('radio',{name:'导数',exact:true}).click();
    await expect(page.getByRole('heading',{name:'希望保留哪些材料？',exact:true})).toBeVisible();
    await card.getByRole('checkbox',{name:'笔记',exact:true}).click();await card.getByRole('checkbox',{name:'板书',exact:true}).click();
    await card.getByRole('button',{name:/^(Next|下一题)$/}).click();
    const answer=card.getByPlaceholder(/^(Type your answer|输入你的答案)$/);
    await answer.fill('二十分钟，想先看清割线怎么变化。');
    await page.screenshot({path:join(output,'native-question-before-refresh.png')});
    await page.reload();
    await expect(page.getByRole('heading',{name:'大概有多少时间？',exact:true})).toBeVisible();
    await expect(answer).toHaveValue('二十分钟，想先看清割线怎么变化。');
    await card.getByRole('button',{name:/^(Submit|提交)$/}).click();
    await expect(page.getByText('确认已收到。这是确定性协议测试，不代表教学效果。',{exact:true})).toBeVisible();
    const plot=page.locator('.nv-block-content .nv-block-figure[data-status="ready"]');
    await expect(plot).toBeVisible();
    const slider=page.getByRole('slider',{name:'参数 h',exact:true});await expect(slider).toHaveValue('1');
    const before=await plot.locator('svg').innerHTML();await slider.press('ArrowRight');
    await expect(slider).toHaveValue('1.1');await expect.poll(()=>plot.locator('svg').innerHTML()).not.toBe(before);
    const events=await readFile(join(runtime.home,'question-fixture.jsonl'),'utf8');
    assert.match(events,/导数/);assert.match(events,/笔记/);assert.match(events,/板书/);assert.match(events,/二十分钟/);
    assert.equal(await readFile(join(runtime.vault,boardPath),'utf8'),board);
    await page.screenshot({path:join(output,'inline-diagram.png')});
    await page.getByRole('button',{name:'本节板书',exact:true}).click();
    await expect(page.locator('.nv-canvas-editor:visible')).toBeVisible();
    await expect(page.locator('.nv-canvas-editor:visible .nv-block-figure[data-status="ready"]')).toBeVisible();
    await page.reload();
    await expect(page.locator('.nv-canvas-editor:visible .nv-block-figure[data-status="ready"]')).toBeVisible();
    await page.screenshot({path:join(output,'saved-board.png')});
    assert.deepEqual(errors,[]);
    await writeFile(join(output,'browser-result.json'),JSON.stringify({status:'PASS',nativeQuestionRefresh:true,structuredAnswers:true,inlinePlot:true,sliderChangesGeometry:true,savedBoardReload:true,errors},null,2));
  }catch(e){await page.screenshot({path:join(output,'browser-failure.png')});await writeFile(join(output,'browser-result.json'),JSON.stringify({status:'FAIL',error:e.message,errors},null,2));throw e;}
  finally{await browser.close();await runtime.stop();}
});
