import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {startNativeRuntime,workspaceRoot} from '../scripts/native-runtime.mjs';

test('peer turn is retained in native Trajectory but absent from student text, tools, copy and navigation after reload',{timeout:120000},async()=>{
  const runtime=await startNativeRuntime({testModel:true,modelFixture:'tests/communication-model.mjs'});
  const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1414,height:850}}),errors=[];let passed=false;
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  const output=join(workspaceRoot,'outputs/upgrade-rc4');await mkdir(output,{recursive:true});
  await writeFile(join(runtime.vault,'PRIVATE_TOOL_FILE.md'),'PRIVATE_TOOL_BODY');
  try {
    await page.goto(runtime.authUrl);await page.getByRole('button',{name:/^(Continue|继续)$/}).click();await page.locator('[data-composer-input]:visible').waitFor();await page.waitForLoadState('networkidle');
    const send=async text=>{await page.locator('[data-composer-input]').fill(text);await page.getByRole('button',{name:/^(Send message|发送消息)$/}).click();};
    await send('我想开始一节课');await expect(page.getByText('专题已准备好。',{exact:true})).toBeVisible({timeout:25000});
    await page.getByRole('tablist',{name:'工作区栏目'}).getByRole('tab',{name:'会话',exact:true}).click();
    await page.getByRole('list',{name:'当前工作区会话'}).locator('.nv-session-row').filter({hasText:'通信专题'}).locator('button').first().click();
    await expect(page.getByText('STUDENT_VISIBLE_LESSON',{exact:true})).toBeVisible({timeout:15000});
    await send('把发现告诉首页');
    await expect.poll(async()=>readFile(join(runtime.home,'communication-finished.json'),'utf8').then(()=>true,()=>false),{timeout:25000}).toBe(true);
    // Wait for the final native event to reach the loaded view, then test both surfaces.
    await expect(page.getByRole('button',{name:/^(Stop generating|停止生成)$/})).toHaveCount(0,{timeout:15000});
    const assertPrivateAbsent=async()=>{
      assert.doesNotMatch(await page.locator('body').innerText(),/TEACHER_PRIVATE|HOME_PRIVATE|PRIVATE_TOOL|内部备课问题/);
      assert.doesNotMatch(await page.locator('body').innerHTML(),/TEACHER_PRIVATE_ANSWER_42|HOME_PRIVATE_PREPARATION|PRIVATE_TOOL_BODY/);
    };
    await assertPrivateAbsent();
    await page.getByRole('tab',{name:/^(Trajectory|轨迹)$/}).click();
    await expect(page.getByText('TEACHER_PRIVATE_ANSWER_42',{exact:true})).toBeVisible({timeout:15000});
    await page.getByRole('tab',{name:/^(Chat|对话)$/}).click();await assertPrivateAbsent();
    await page.locator('[data-composer-input]').fill('未发送草稿');await page.reload();
    await expect(page.locator('[data-composer-input]')).toHaveText('未发送草稿');await assertPrivateAbsent();
    await send('学生继续');await expect(page.getByText('STUDENT_VISIBLE_FOLLOWUP',{exact:true})).toBeVisible({timeout:15000});await assertPrivateAbsent();
    await page.screenshot({path:join(output,'communication-wide.png')});await page.setViewportSize({width:755,height:746});await page.screenshot({path:join(output,'communication-narrow.png')});
    assert.deepEqual(errors,[]);passed=true;
  }catch(error){await page.screenshot({path:join(output,'communication-failure.png')});console.error('Browser errors:',errors);throw error;}
  finally{await browser.close();await runtime.stop({preserve:!passed});if(!passed)console.error('Fixture home:',runtime.home);}
});

test('post-lesson summary delivery updates learner profile and route milestones without mid-lesson noise or unverified locators',{timeout:120000},async()=>{
  const runtime=await startNativeRuntime({testModel:true,modelFixture:'tests/communication-model.mjs'});
  const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1414,height:850}}),errors=[];let passed=false;
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  const output=join(workspaceRoot,'outputs/upgrade-rc4');await mkdir(output,{recursive:true});
  await mkdir(join(runtime.vault,'备课'),{recursive:true});
  await mkdir(join(runtime.vault,'路线'),{recursive:true});
  await writeFile(join(runtime.vault,'备课/极值点偏移第一课.md'),[
    '---',
    'type: lesson',
    'title: 极值点偏移第一课',
    'status: active',
    '---',
    '# 极值点偏移第一课',
    '- [ ] 独立完成对称差构造函数设元',
    '- [ ] 独立完成商法则求导与符号判别',
    '<details data-notara="teacher">',
    '- [ ] 隐藏教师备课参考答案',
    '</details>',
  ].join('\n'));
  await writeFile(join(runtime.vault,'路线/导数突破路线.md'),[
    '---',
    'type: route',
    'title: 导数突破路线',
    'status: active',
    'lessons:',
    '  - 备课/极值点偏移第一课.md',
    '---',
    '# 导数突破路线',
    '',
    '## 里程碑',
    '- [ ] 里程碑 1：极值点偏移对称构造与求导校验 ^ms1',
    '  - 关联课堂：[[备课/极值点偏移第一课]]',
    '  - 校验依据：无提示独立完成对称差函数求导与符号判别',
    '',
    '## 下一步行动',
    '- [ ] 当前下一步：进入 [[备课/极值点偏移第一课]] 完成首轮训练',
  ].join('\n'));

  try{
    await page.goto(runtime.authUrl);await page.getByRole('button',{name:/^(Continue|继续)$/}).click();await page.locator('[data-composer-input]:visible').waitFor();await page.waitForLoadState('networkidle');
    const send=async text=>{await page.locator('.pI_x6G_centerCol [data-composer-input]').fill(text);await page.getByRole('button',{name:/^(Send message|发送消息)$/}).click();};

    await send('CLOSURE_CASE：开始极值点偏移第一课');
    await expect(page.getByText('极值点偏移课堂已建立，可从左侧进入课堂。',{exact:true})).toBeVisible({timeout:25000});

    await page.getByRole('tablist',{name:'工作区栏目'}).getByRole('tab',{name:'会话',exact:true}).click();
    await page.getByRole('list',{name:'当前工作区会话'}).locator('.nv-session-row').filter({hasText:'极值点偏移课堂'}).locator('button').first().click();
    await expect(page.getByText('欢迎进入极值点偏移第一课，我们先从对称差构造函数设元开始。',{exact:true})).toBeVisible({timeout:15000});

    // Stage 4: Bind lesson plan in ActivityPanel, verify hidden teacher task stays absent, and mark task 1 done
    const actTrigger=page.locator('.pI_x6G_centerCol').getByRole('button',{name:'本次活动',exact:true});
    await actTrigger.click();
    const actPanel=page.getByRole('complementary',{name:'本次活动',exact:true});
    await expect(actPanel).toBeVisible();
    await actPanel.getByRole('button',{name:/关联备课本/}).click();
    await page.getByRole('listbox',{name:'可关联的备课本'}).getByRole('button',{name:/极值点偏移第一课/}).click();
    const checklist=actPanel.getByTestId('lesson-checklist');
    await expect(checklist).toBeVisible();
    assert.doesNotMatch(await checklist.innerText(),/隐藏教师备课参考答案/);
    await checklist.locator('.nv-lesson-header').click();
    await checklist.getByRole('checkbox',{name:'标记完成：独立完成对称差构造函数设元'}).click();
    await expect(checklist).toContainText('1/2');
    await actTrigger.click();

    // Mid-lesson pause waiting on student must NOT trigger send_message to coordinator
    await send('我先想一下商法则分子符号，等会儿回答');
    await expect(page.getByText('好的，你先独立推导商法则分子符号，想好随时发我。',{exact:true})).toBeVisible({timeout:15000});
    const midCalls=(await readFile(join(runtime.home,'communication-requests.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(midCalls.some(r=>!r.sessionId.startsWith('notara-topic-')&&r.messages.some(m=>m.source?.kind==='agent-message')),false,'mid-lesson pause must not notify coordinator');

    // Explicit post-lesson closure: saves summary, delivers to coordinator, coordinator verifies disk & updates profile + route
    await send('今天先下课，商法则我是看提示才写对的，含参还没测，请保存本节总结并同步给学习助手');
    await expect.poll(async()=>readFile(join(runtime.home,'closure-finished.json'),'utf8').then(()=>true,()=>false),{timeout:30000}).toBe(true);
    await expect(page.getByText(/本节总结已保存至/)).toBeVisible({timeout:15000});
    assert.doesNotMatch(await page.locator('body').innerText(),/CLOSURE_COORDINATOR_INTERNAL_DONE|CLOSURE_DELIVERY/);

    const profileDisk=await readFile(join(runtime.vault,'00-学习画像与偏好.md'),'utf8');
    assert.match(profileDisk,/商法则分子求导仍依赖提示/);
    assert.doesNotMatch(profileDisk,/不存在的伪造总结/);

    const routeDisk=await readFile(join(runtime.vault,'路线/导数突破路线.md'),'utf8');
    assert.match(routeDisk,/待补内容：商法则分子符号尚未无提示独立通过/);
    assert.doesNotMatch(routeDisk,/不存在的伪造总结/);

    // Open route document in Vault reader and verify RouteAndLessonBar remediation gating, next-action filtering, and classroom navigation
    await page.locator('.pI_x6G_centerCol').getByRole('button',{name:'导数突破路线',exact:true}).click();
    const routeBar=page.locator('.nv-vault-doc-tab:visible').getByRole('region',{name:'路线里程碑概览'});
    await expect(routeBar).toBeVisible({timeout:15000});
    await expect(routeBar).toContainText('已完成 0 / 1 项阶段活动');
    await expect(routeBar).toContainText('有待补内容，可在继续学习时提供支撑');
    await expect(routeBar).toContainText('无提示复测商法则分子符号');
    assert.doesNotMatch(await routeBar.innerText(),/完成首轮训练/);

    // Switch main view back to Home session, open the route from 资料 sidebar, and click 打开关联课堂 to jump straight into the bound classroom
    await page.getByRole('tablist',{name:'工作区栏目'}).getByRole('tab',{name:'会话',exact:true}).click();
    await page.getByRole('list',{name:'当前工作区会话'}).locator('.nv-session-row').filter({hasNotText:'极值点偏移课堂'}).first().locator('button').first().click();
    await expect(page.getByText('极值点偏移课堂已建立，可从左侧进入课堂。',{exact:true})).toBeVisible();
    await page.getByRole('tablist',{name:'工作区栏目'}).getByRole('tab',{name:'资料',exact:true}).click();
    await page.getByRole('navigation',{name:'学习资料'}).getByRole('button',{name:'导数突破路线',exact:true}).click();
    await expect(routeBar).toBeVisible({timeout:15000});
    await routeBar.getByRole('button',{name:'打开关联课堂'}).first().click();
    await expect(page.getByText(/本节总结已保存至/)).toBeVisible({timeout:15000});

    // Spawn a continuable child notara-teacher sub-classroom bound to its own lesson file, switch back to Home,
    // cold-reload the browser (so parent subagentCatalog is unhydrated and subagentAddress.mode === 'unknown'),
    // and verify clicking 打开关联课堂 in RouteAndLessonBar still opens the child classroom cleanly.
    await writeFile(join(runtime.vault,'备课/商法则补救小课.md'),[
      '---',
      'type: lesson',
      'title: 商法则补救小课',
      '---',
      '# 商法则补救小课',
      '- [ ] 无提示写出商法则分子符号',
    ].join('\n'));
    await send('开启商法则补救子课堂');
    await expect.poll(async()=>readFile(join(runtime.home,'subclass-ready.json'),'utf8').then(()=>true,()=>false),{timeout:25000}).toBe(true);
    await expect(page.getByText('补救子课堂已准备就绪，你可以进入作答。',{exact:true})).toBeVisible({timeout:15000});

    await page.getByRole('tablist',{name:'工作区栏目'}).getByRole('tab',{name:'会话',exact:true}).click();
    await page.locator('button.hHd-Xa_newSession').click();
    await page.locator('[data-composer-input]:visible').waitFor({timeout:15000});

    // Completed parent remains distinct from the child classroom opened by its lesson document.
    const parentLessonText=await readFile(join(runtime.vault,'备课/极值点偏移第一课.md'),'utf8');
    await writeFile(join(runtime.vault,'备课/极值点偏移第一课.md'),parentLessonText.replace('type: lesson','type: lesson\nstatus: completed'));

    await page.reload();
    await page.locator('[data-composer-input]:visible').waitFor({timeout:20000});
    await expect(page.locator('.nr-home')).toHaveCount(0);

    // 1) Cold-reload navigation via RouteAndLessonBar (before parent session projections ever hydrate)
    await page.getByRole('tablist',{name:'工作区栏目'}).getByRole('tab',{name:'资料',exact:true}).click();
    await page.getByRole('navigation',{name:'学习资料'}).getByRole('button',{name:'商法则补救小课',exact:true}).click();
    const lessonBar=page.locator('.nv-vault-doc-tab:visible').getByRole('region',{name:'关联课堂'});
    await expect(lessonBar).toBeVisible({timeout:15000});
    await lessonBar.getByRole('button',{name:'打开关联课堂'}).click();
    await expect(page.getByText('SUBCLASS_TEACHER_READY：请无提示写出 (u/v) 求导的分子符号。',{exact:true})).toBeVisible({timeout:15000});
    await expect(page.locator('.pI_x6G_centerCol [data-composer-input]')).toBeVisible();

    assert.deepEqual(errors,[]);passed=true;
  }catch(error){await page.screenshot({path:join(output,'closure-failure.png')});console.error('Browser errors:',errors);throw error;}
  finally{await browser.close();await runtime.stop({preserve:!passed});if(!passed)console.error('Fixture home:',runtime.home);}
});
