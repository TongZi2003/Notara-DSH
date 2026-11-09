import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {startNativeRuntime,workspaceRoot} from '../scripts/native-runtime.mjs';

test('ordinary topic and native teaching subagents preserve isolated histories and original navigation',{timeout:120000},async()=>{
  const runtime=await startNativeRuntime({testModel:true,modelFixture:'tests/teaching-threads-model.mjs'});
  let browser,page;const errors=[],output=join(workspaceRoot,'outputs/teaching-blocks-20261026');await mkdir(output,{recursive:true});
  try{
    browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1414,height:850}});page.on('pageerror',e=>errors.push(e.stack));page.on('console',m=>{if(m.type()==='error')console.error(m.text().replace(/([?&]token=)[^\s&"<>]+/g,'$1[redacted]'));});page.setDefaultTimeout(15000);
    const send=async text=>{const input=page.locator('.pI_x6G_centerCol [data-composer-input]');await input.fill(text);await input.press('Enter');};
    const childPane=page.locator('[data-sidebar-chat]:visible');
    const sendChild=async text=>{const input=childPane.locator('[data-composer-input]');await input.fill(text);await input.press('Enter');};
    const openTopic=async()=>{
      await page.getByRole('tablist',{name:'工作区栏目'}).getByRole('tab',{name:'会话',exact:true}).click();
      await page.getByRole('list',{name:'当前工作区会话'}).locator('.nv-session-row').filter({hasText:'训练循环专题'}).locator('button').first().click();
    };
    const openChild=async title=>{
      const trigger=page.locator('.pI_x6G_centerCol').getByRole('button',{name:'本次活动',exact:true});
      if((await trigger.getAttribute('aria-expanded'))!=='true')await trigger.click();
      const panel=page.getByRole('complementary',{name:'本次活动',exact:true});
      await expect(panel).toBeVisible();
      await panel.getByRole('region',{name:'子智能体'}).getByRole('button',{name:title,exact:true}).click();
      await expect(childPane.locator('.nv-activity-child-header')).toContainText(title);
      await expect(childPane.locator('section.nv-block-flow')).toBeVisible();
    };
    await page.goto(runtime.authUrl);await page.getByRole('button',{name:/^(Continue|继续)$/}).click();await page.locator('[data-composer-input]:visible').waitFor();await page.waitForLoadState('networkidle');
    await send('我想学习训练循环。HOME_PRIVATE_HISTORY');await expect(page.getByText('专题对话已创建，可从会话列表继续。',{exact:true})).toBeVisible({timeout:20000});
    await openTopic();await expect(page.getByText('这间课堂可以独立继续。',{exact:true})).toBeVisible();
    assert.equal(await page.locator('.nv-teaching-nav').count(),0,'No dedicated teaching navigation');
    await send('TOPIC_PRIVATE_DISCUSSION，请拆开讨论梯度与学习率。');await expect(page.getByText('两个讨论已创建，可以分别继续。',{exact:true})).toBeVisible();
    await openChild('梯度累积');await sendChild('A_STUDENT_ANSWER：因为上一次的梯度还在。');await expect(childPane.getByText('这条回答留在梯度讨论中。',{exact:true})).toBeVisible();
    await childPane.locator('[data-composer-input]').fill('A_DRAFT');await openTopic();await openChild('学习率');
    await childPane.locator('[data-composer-input]').fill('B_DRAFT');await openTopic();await openChild('梯度累积');
    await expect(childPane.locator('[data-composer-input]')).toHaveText('A_DRAFT');
    await page.reload();await openTopic();await openChild('梯度累积');await expect(childPane.getByText('A_STUDENT_ANSWER：因为上一次的梯度还在。',{exact:true})).toBeVisible();
    await page.screenshot({path:join(output,'native-subagent-wide.png')});await page.setViewportSize({width:755,height:746});await page.screenshot({path:join(output,'native-subagent-narrow.png')});
    const calls=(await readFile(join(runtime.home,'teaching-requests.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
    const b=calls.find(row=>!row.id.startsWith('notara-topic-')&&JSON.stringify(row.messages).includes('B_OVERVIEW'));
    assert.ok(b);assert.doesNotMatch(JSON.stringify(b.messages),/A_STUDENT_ANSWER|HOME_PRIVATE_HISTORY|A_OVERVIEW|TOPIC_PRIVATE_DISCUSSION/);
    const topic=calls.find(row=>row.id.startsWith('notara-topic-'));assert.doesNotMatch(JSON.stringify(topic.messages),/HOME_PRIVATE_HISTORY/);
    assert.deepEqual(errors,[]);
  }catch(error){if(page)await page.screenshot({path:join(output,'failure.png')});console.error('Browser errors:',errors);throw error;}
  finally{await browser?.close();await runtime.stop();}
});

test('coordinator writes learner profile and delegates standalone notara-material-organizer session with visible checklist and clickable Vault links',{timeout:120000},async()=>{
  const runtime=await startNativeRuntime({testModel:true,modelFixture:'tests/teaching-threads-model.mjs'});
  let browser,page;const errors=[],output=join(workspaceRoot,'outputs/teaching-blocks-20261026');await mkdir(output,{recursive:true});
  try{
    browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1414,height:850}});
    page.on('pageerror',e=>errors.push(e.stack));
    page.on('console',m=>{if(m.type()==='error')console.error(m.text().replace(/([?&]token=)[^\s&"<>]+/g,'$1[redacted]'));});
    page.setDefaultTimeout(20000);
    await page.goto(runtime.authUrl);await page.getByRole('button',{name:/^(Continue|继续)$/}).click();await page.locator('[data-composer-input]:visible').waitFor();await page.waitForLoadState('networkidle');

    const input=page.locator('.pI_x6G_centerCol [data-composer-input]');
    await input.fill('帮我整理课堂笔记，不急着做题：函数单调性与导数符号。ORGANIZER_CASE');
    await input.press('Enter');
    await expect(page.getByText('资料整理会话已创建，可从会话列表查看整理清单。',{exact:true})).toBeVisible({timeout:25000});

    const profileDisk=await readFile(join(runtime.vault,'00-学习画像与偏好.md'),'utf8');
    assert.match(profileDisk,/暂不出题测验/);

    // Verify会话列表 shows standalone organizer session with 资料整理 badge
    await page.getByRole('tablist',{name:'工作区栏目'}).getByRole('tab',{name:'会话',exact:true}).click();
    const organizerRow=page.getByRole('list',{name:'当前工作区会话'}).locator('.nv-session-row').filter({hasText:'导数笔记整理'});
    await expect(organizerRow).toBeVisible();
    await expect(organizerRow.getByText('资料整理',{exact:true})).toBeVisible();
    await organizerRow.locator('button').first().click();

    // Wait for background worker-problem settlement turn to render checklist while keeping raw trigger hidden
    await expect(page.getByRole('heading',{name:'整理清单'})).toBeVisible({timeout:25000});
    await expect(page.getByText('本次仅完成资料整理，暂不出题。',{exact:true})).toBeVisible();
    const bodyText=await page.locator('body').innerText();
    assert.doesNotMatch(bodyText,/WORKER_PROBLEM_RAW_TRIGGER|ORGANIZER_HOME_INTERNAL_ACK|system-reminder/i);

    // Organizer is not a classroom: 本课清单 must not appear in its ActivityPanel
    await page.locator('.pI_x6G_centerCol').getByRole('button',{name:'本次活动',exact:true}).click();
    const panel=page.getByRole('complementary',{name:'本次活动',exact:true});
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId('lesson-checklist')).toHaveCount(0);
    await expect(panel.getByText('关联备课本')).toHaveCount(0);
    await page.locator('.pI_x6G_centerCol').getByRole('button',{name:'本次活动',exact:true}).click();

    // Clicking Vault link in organizer checklist opens the created card in the right material pane
    const cardLink=page.locator('.pI_x6G_centerCol').getByRole('button',{name:'导数符号与单调性',exact:true});
    await expect(cardLink).toBeVisible();
    await cardLink.click();
    await expect(page.locator('.nv-vault-doc-tab:visible .cm-editor')).toBeVisible();
    const cardDisk=await readFile(join(runtime.vault,'卡片/导数符号与单调性.md'),'utf8');
    assert.match(cardDisk,/type: concept/);
    assert.deepEqual(errors,[]);
  }catch(error){if(page)await page.screenshot({path:join(output,'organizer-failure.png')});console.error('Browser errors:',errors);throw error;}
  finally{await browser?.close();await runtime.stop();}
});
