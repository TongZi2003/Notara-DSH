import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Source contract guards, not a claim about model behavior or graph rendering.
const source = path => readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
const prompt = path => source(`prompts/${path}`);

test('shared conversation judgment recognizes supported exploration without requiring a separate test', async () => {
  const body = await prompt('conversation-judgments.md');
  assert.match(body, /本次想理解或做什么/);
  assert.match(body, /认识变化/);
  assert.match(await prompt('learning-records.md'), /学生[^。\n]*教师[^。\n]*错误/);
  assert.match(body, /不[^。\n]*独立[^。\n]*(?:测试|检验)[^。\n]*前提/);
  assert.match(body, /考试[^。\n]*(?:独立|限时|迁移)[^。\n]*检验/);
});

test('ordinary records do not inherit the formal review hint-list ceremony', async () => {
  for (const path of ['base.md', 'skills/quest-tutor.md', 'skills/quest-orchestrator.md', 'skills/review-brainstorm.md']) {
    const body = await prompt(path);
    const ordinary = body.split('4. **复习事实、帮助经历与排期')[0];
    assert.doesNotMatch(ordinary, /必须先写出 `提示清单|先列本次提示和示范，再判断完成性质|学情须先盘点提示|记录演进时先写 `提示清单/, path);
  }
  const review = await prompt('skills/review-brainstorm.md');
  assert.match(review, /note[^。\n]*必要提问与经过/);
  assert.match(review, /学生[^。\n]*确认/);
});

test('preparation closes according to the learning purpose and retains the complete teaching path', async () => {
  const [prep, template, shared] = await Promise.all([
    prompt('skills/lesson-preparation.md'), source('templates/base-files/lesson.md'), prompt('lesson-judgments.md'),
  ]);
  assert.doesNotMatch(prep, /保留一次[^。\n]*独立短检验/);
  assert.doesNotMatch(template, /^## 独立短检验$/m);
  assert.match(template, /^## 收束与下一步$/m);
  assert.match(prep, /考试[^。\n]*独立短检验/);
  assert.match(prep, /解释[^。\n]*作品/);
  assert.match(shared, /应用、解释、拓展或检验/);
  for (const term of ['worker-general', 'worker-review', '关键的小判断', '完整解答', 'lesson_plan']) assert.ok(prep.includes(term), term);
});

test('scenario entries preserve diagnosis and exam needs while notes explicitly support requested expansion', async () => {
  const [diagnosis, cram, notes] = await Promise.all(['exam-diagnosis', 'exam-cram', 'school-notes'].map(id => prompt(`skills/${id}.md`)));
  assert.match(diagnosis, /少数[^。\n]*关键缺口/);
  assert.match(diagnosis, /notara-practice-design/);
  assert.match(diagnosis, /不[^。\n]*重做整卷/);
  assert.match(cram, /近期状态/);
  assert.match(cram, /时间分配/);
  assert.match(cram, /不[^。\n]*永久[^。\n]*标签/);
  assert.match(notes, /已经要求拓展[^。\n]*直接承接/);
  assert.match(notes, /教师补充[^。\n]*学生[^。\n]*分别/);
});

test('practice design is available only to coordinator and teacher, with reusable material selection', async () => {
  const manifest = JSON.parse(await prompt('manifest.json'));
  const practice = manifest.skills.find(skill => skill.id === 'practice-design');
  assert.ok(practice, 'practice design is a real loadable skill');
  assert.deepEqual(practice.roles, ['coordinator', 'teacher']);
  assert.equal(practice.title, '练习与探究');
  assert.ok(manifest.skills.some(skill => skill.id === 'summer-preview'));
  const body = await prompt(practice.file);
  for (const term of ['具体例子', '知识实体', '题干与解答', '实验', '历史事件', '医学病案', 'type: lesson', 'preparation', 'lesson_plan']) assert.ok(body.includes(term), term);
  assert.match(body, /相同标签不等于/);
  assert.match(body, /组卷[^。\n]*结束/);
  assert.match(body, /他人[^。\n]*当前学生/);
});

test('knowledge grammar is authoritative only in organizing skill and card template', async () => {
  const pdf = await prompt('skills/pdf-learning-set.md');
  const card = await source('templates/base-files/card.md');
  for (const body of [pdf, card]) {
    for (const term of ['## 前序依赖', '### 路线：', '## 横向联系', '### 主题：', '（前序依赖／', '（知识标签）', '（横向联系／']) assert.ok(body.includes(term), term);
    assert.match(body, /联合[^。\n]*替代/);
    assert.match(body, /普通[^。\n]*引用/);
  }
  assert.match(pdf, /缺失[^。\n]*歧义/);
  assert.match(pdf, /不[^。\n]*空卡/);
  assert.match(pdf, /循环[^。\n]*不[^。\n]*删/);
  for (const path of ['base.md', 'coordinator.md', 'workers/base.md', 'skills/examiner-analysis.md', 'skills/quest-tutor.md', 'skills/quest-orchestrator.md', 'skills/review-brainstorm.md']) {
    const body = await prompt(path);
    assert.doesNotMatch(body, /当前知识联系格式|每项以 `- \[\[卡片\/另一知识卡\]\]：`/, path);
    assert.match(body, /notara-pdf-learning-set/, `${path}: refer to the authoritative grammar`);
  }
});

test('route and profile templates keep cognitive progress, current questions and time-bound state', async () => {
  const [route, profile] = await Promise.all(['route', 'learner-profile'].map(id => source(`templates/base-files/${id}.md`)));
  assert.match(route, /^## 里程碑与进展$/m);
  assert.match(route, /阶段依据（/);
  assert.doesNotMatch(route, /校验依据（/);
  assert.match(route, /开放探索[^。\n]*不[^。\n]*里程碑/);
  assert.match(profile, /可用支点/);
  assert.match(profile, /正在追问的问题/);
  assert.match(profile, /近期目标与约束/);
  assert.match(profile, /时间[^。\n]*场景[^。\n]*来源/);
});
