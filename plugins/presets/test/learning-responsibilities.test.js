import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Source-only omission guards. They neither require resource sync nor establish
// runtime delivery, context injection, or real-model teaching quality.
const load = path => readFile(new URL(`../../../prompts/${path}`, import.meta.url), 'utf8');
const check = (body, pattern, message) => assert.ok(pattern.test(body), message);

test('long-term teacher can answer light questions while existing classrooms and full learner context are preserved', async () => {
  const [home, base, tutor, orchestrator] = await Promise.all([
    'coordinator.md', 'base.md', 'skills/quest-tutor.md', 'skills/quest-orchestrator.md',
  ].map(load));
  for (const [name, body] of [['home', home], ['base', base], ['tutor', tutor], ['orchestrator', orchestrator]]) {
    check(body, /轻量[\s\S]*?已有[\s\S]*?会话/, `${name}: reuse teacher conversations for lightweight discussion`);
    check(body, /无需[^。\n]*完整备课本|不[^。\n]*完整备课本[^。\n]*前提/, `${name}: a lesson document is not a prerequisite for a small question`);
  }
  check(home, /轻量问题在当前会话直接讨论/, 'lightweight teaching need not create another classroom');
  check(home, /系统备课与较重的课堂任务交相关老师/, 'systematic lessons retain the existing teacher workflow');
  assert.doesNotMatch(home,/不扩成单点教学/);
  for (const [name, body] of [['home', home], ['base', base], ['tutor', tutor]]) {
    check(body, /默认[^。\n]*(?:带入|注入)[^。\n]*当前学情[^。\n]*偏好[^。\n]*进度/, `${name}: learner context is available by default, not only after a gap appears`);
    check(body, /完整语义段落/, `${name}: select complete semantic passages`);
    check(body, /必要[^。\n]*长[^。\n]*完整保留/, `${name}: retain necessary long sections`);
    check(body, /不[^。\n]*硬截断/, `${name}: no hard clipping`);
  }
  check(base, /有首页绑定[^。\n]*事实[^。\n]*卡片[^。\n]*报告/, 'bound teacher owns local evidence');
  check(base, /无首页[^。\n]*自维护/, 'standalone teaching retains long-term maintenance');
});

test('reports are saved lesson or diary sections, with honest preparation and deferred home delivery', async () => {
  const [base, tutor, contract] = await Promise.all(['base.md', 'skills/quest-tutor.md', 'skills/quest-orchestrator.md'].map(load));
  for (const [name, body] of [['base', base], ['tutor', tutor], ['contract', contract]]) {
    check(body, /保存[\s\S]*?read[\s\S]*?lesson_summary/, `${name}: save and read back before delivery`);
    assert.ok(!/初版仅支持|coordinator 经原生 handoff 发起的普通专题/.test(body), `${name}: remove obsolete handoff-only scope`);
  }
  check(contract, /kind[^。\n]*lesson[^。\n]*preparation[^。\n]*question[^。\n]*materials/, 'all four report purposes are supported');
  check(contract, /schema/, 'tool schema owns callable fields');
  check(contract, /已保存[^。\n]*lesson[^。\n]*diary/, 'delivery refers to a saved lesson or diary section');
  check(base, /纯备课[^。\n]*日记[^。\n]*备课交付[^。\n]*课稿/, 'preparation uses a diary delivery section linking the lesson draft');
  check(base, /不[^。\n]*虚构[^。\n]*本节总结与下次续接/, 'preparation never manufactures post-lesson evidence');
  check(contract, /宿主[^。\n]*绑定[^。\n]*日期[^。\n]*当日日记索引[^。\n]*通知/, 'host binds diary indexing and notification');
  check(contract, /独立会话[^。\n]*持久保存[\s\S]*?同学习集[^。\n]*首页[^。\n]*有效[^。\n]*续接/, 'standalone delivery can persist before a home exists');
  check(contract, /暂无首页[^。\n]*deliver[^。\n]*日记索引[^。\n]*待回传回执/, 'first standalone delivery persists both diary indexing and a pending return receipt');
  check(contract, /真实用户请求[^。\n]*宿主[^。\n]*绑定[^。\n]*通知/, 'only actual user entry into home allows deferred binding and notification');
  check(contract, /纯备课[^。\n]*整理[^。\n]*日记[^。\n]*单独小节[^。\n]*产物/, 'non-teaching work links artifacts from separate diary sections');
  check(base, /未授课[^。\n]*学情总结[^。\n]*保持空[^。\n]*授课/, 'a preparation draft leaves learning evidence empty until teaching occurs');
  check(contract, /不[^。\n]*伪造送达/, 'persisted and delivered remain distinct');
});

test('home decides only necessary targets before revision-checked acknowledgments and preserves completed work', async () => {
  const [home, contract] = await Promise.all(['coordinator.md', 'skills/quest-orchestrator.md'].map(load));
  for (const [name, body] of [['home', home], ['contract', contract]]) {
    check(body, /read[\s\S]*?decide[\s\S]*?targets/, `${name}: read evidence before choosing maintenance targets`);
    check(body, /targets\s*:\s*\[\]/, `${name}: no long-term change may complete with no targets`);
    assert.ok(!/二者均[^。\n]*updated[^。\n]*unchanged[^。\n]*交付处理完成/.test(body), `${name}: do not force both documents`);
  }
  for (const field of ['deliveryId', 'version', 'note', 'profile', 'route', 'revision', 'acknowledge', 'sourceLocator']) {
    assert.ok(contract.includes(field), `contract retains ${field}`);
  }
  for (const outcome of ['updated', 'unchanged', 'retryable', 'blocked']) assert.ok(contract.includes(outcome), outcome);
  check(contract, /decide[^。\n]*补选[^。\n]*不能[^。\n]*取消[^。\n]*未完成项/, 'later decisions may add targets but cannot abandon pending selected work');
  check(contract, /已完成项[^。\n]*保留/, 'completed targets survive later decisions');
  check(contract, /同稿[^。\n]*去重/, 'same report deduplicates');
  check(contract, /修订[^。\n]*deliver/, 'revised reports are delivered again');
  check(contract, /失败[^。\n]*保留[^。\n]*已[^。\n]*项/, 'partial failure retains completed targets');
  check(contract, /idle[^。\n]*不[^。\n]*(?:新轮|新[^。\n]*回合)/, 'idle never starts another model turn');
});

test('organizing and review save truthful diary reports while long-term decisions stay with the responsible teacher', async () => {
  const [organizer, pdf, review] = await Promise.all(['material-organizer.md', 'skills/pdf-learning-set.md', 'skills/review-brainstorm.md'].map(load));
  for (const [name, body] of [['organizer', organizer], ['pdf', pdf], ['review', review]]) {
    check(body, /日记[\s\S]*?read[\s\S]*?lesson_summary/, `${name}: save and verify a report before durable delivery`);
    check(body, /(?:纯整理|纯导入、备课)[^。\n]*不[^。\n]*(?:新学情|学习事实|作答|学生表现)/, `${name}: organizing does not create learning evidence`);
    check(body, /首页[^。\n]*画像[^。\n]*路线|长期教师[^。\n]*路线[\s\S]*不重写没有变化的画像/, `${name}: home owns long-term maintenance when bound`);
  }
  check(organizer, /直接父老师[^。\n]*send_message/, 'teacher-owned organizing returns to its direct parent');
  check(pdf, /不[^。\n]*默认[^。\n]*专题备课/, 'receiving material alone does not start a lesson workflow');
});

test('workers receive local task context and shared skills cannot grant writing or delegation', async () => {
  const worker = await load('workers/base.md');
  check(worker, /局部任务片段/, 'internal task context remains bounded');
  check(worker, /共享\s*Skill[^。\n]*不[^。\n]*权限/, 'shared skill loading does not grant permissions');
  check(worker, /写入[^。\n]*委派[^。\n]*建议[^。\n]*父/, 'writing and delegation instructions become suggestions for the parent');
  check(worker, /不[^。\n]*自写日记/, 'workers do not create separate delivery records');
});
