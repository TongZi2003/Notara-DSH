import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resource, resourceProvenance, skillManifest, skillsForRole } from '../resources.js';
import { BLIND_SYSTEM_PROMPT, blindTask } from '../isolation.js';
import { PRESET_IDS, ROLES } from '../catalog.js';

test('all packaged prompts, per-role skill bundles, and provenance match their authoritative sources', async () => {
  const entries = Object.entries(resourceProvenance.sha256);
  assert.ok(entries.length >= 30);
  for (const [path, hash] of entries) {
    const origin = resourceProvenance.origins[path];
    assert.ok(origin, `missing origin for ${path}`);
    const source = await readFile(new URL(`../../../${origin}`, import.meta.url));
    assert.equal(createHash('sha256').update(source).digest('hex'), hash, path);
    assert.equal(resource(path), source.toString('utf8'), path);
  }
  for (const skill of skillManifest.skills) {
    const body = (await readFile(new URL(`../../../prompts/${skill.file}`, import.meta.url), 'utf8')).trimEnd();
    const built = await readFile(new URL(`../../../prompts/pi-skills-built/notara-${skill.id}/SKILL.md`, import.meta.url), 'utf8');
    assert.ok(built.endsWith(`\n---\n\n${body}\n`), `built skill must come from ${skill.file}`);
  }
  assert.throws(() => resource('../missing.md'), /Unknown bundled/);
});

test('shared lesson judgments match the single source and occur once in exactly the three teaching roles', async () => {
  const shared = resource('lesson-judgments.md');
  assert.ok(shared.trim().length > 0);
  assert.equal(shared, await readFile(new URL('../../../prompts/lesson-judgments.md', import.meta.url), 'utf8'));
  assert.equal(resourceProvenance.origins['lesson-judgments.md'], 'prompts/lesson-judgments.md');
  const recipients = new Set(['notara-teacher', 'worker-general', 'worker-review']);
  for (const role of ROLES) assert.equal(role.prompt.split(shared.trim()).length - 1, recipients.has(role.id) ? 1 : 0, role.id);
});

test('shared lesson judgments distinguish an observable phenomenon from a prerequisite check and explain auxiliary references', () => {
  const shared = resource('lesson-judgments.md');
  assert.ok(/现象/.test(shared) && /小测|前置/.test(shared) && /区分|区别|不等于|不能[^。\n]{0,12}替代/.test(shared), 'a prerequisite check does not itself make the target phenomenon observable');
  const auxiliary = shared.split(/\n\s*\n|\n(?=- )/).find(paragraph => /辅助对象|辅助函数|辅助点|比较点|变量|模型/.test(paragraph) && /参照|比较/.test(paragraph));
  assert.ok(auxiliary && /表示|用途|作用|目的|理由|为什么|为何|用来|用于|回答原目标/.test(auxiliary), 'auxiliary objects need a reference or comparison purpose');
});

// Source/package omission guards only: these do not exercise the tool runtime or
// model behavior. Check generated resources separately from their source.
for (const [surface, load] of [
  ['source', path => readFile(new URL(`../../../prompts/${path}`, import.meta.url), 'utf8')],
  ['packaged', path => resource({
    'skills/quest-tutor.md': 'role-skills/teacher/notara-quest-tutor/SKILL.md',
    'skills/quest-orchestrator.md': 'role-skills/coordinator/notara-quest-orchestrator/SKILL.md',
  }[path] ?? path)],
]) {
  test(`learning reports ${surface}: saved evidence and host diary routing cover all work kinds`, async () => {
    const [base, tutor, home, contract] = await Promise.all(['base.md', 'skills/quest-tutor.md', 'coordinator.md', 'skills/quest-orchestrator.md'].map(load));
    for (const body of [base, tutor, home]) assert.ok(body.includes('lesson_summary'));
    assert.ok(/保存[\s\S]*read[\s\S]*lesson_summary/.test(base));
    assert.ok(/kind[^。\n]*lesson[^。\n]*preparation[^。\n]*question[^。\n]*materials/.test(contract));
    assert.ok(/当日日记索引/.test(contract) && /宿主/.test(contract));
    assert.ok(/暂无首页/.test(contract) && /待回传/.test(contract));
    assert.ok(/内部工作员与子课堂/.test(contract) && /父老师汇总/.test(contract));
    assert.ok(!/初版仅支持|二者均[^。\n]*updated[^。\n]*unchanged[^。\n]*交付处理完成/.test(contract));
  });

  test(`learning reports ${surface}: next-step judgement chooses document work without duplicating tool schema`, async () => {
    const contract = await load('skills/quest-orchestrator.md');
    for (const term of ['schema', 'decide', 'targets', 'profile', 'route', 'sourceLocator', 'revision', 'acknowledge', 'retryable', 'blocked']) assert.ok(contract.includes(term), term);
    assert.ok(/targets:\[\]/.test(contract));
    assert.ok(/不能取消已选未完成项/.test(contract));
    assert.ok(/同稿交付去重/.test(contract) && /修订后重新 deliver/.test(contract));
    assert.ok(/失败保留已成项/.test(contract) && /不重复追加/.test(contract));
    assert.ok(/普通 idle 不启动新轮/.test(contract));
    assert.ok(/交付完成不等于掌握/.test(contract));
  });
}

// Omission guards for the shared contract, not evidence of model judgement,
// autonomous scheduling, answer grading or teaching quality.
test('lesson core exposes whole-lesson preparation only to the teacher', () => {
  const prep = skillManifest.skills.find(skill => skill.id === 'lesson-preparation');
  assert.deepEqual(prep.roles, ['teacher']);
  assert.ok(skillsForRole('teacher').includes('notara-lesson-preparation'));
  assert.ok(!skillsForRole('worker').includes('notara-lesson-preparation'));
  for (const role of ROLES.filter(role => role.kind === 'worker')) {
    assert.ok(!role.skills.includes('notara-lesson-preparation'), role.id);
  }
  for (const file of ['SKILL.md', 'templates/lesson.md']) {
    assert.throws(() => resource(`role-skills/worker/notara-lesson-preparation/${file}`), /Unknown bundled/);
  }
});

test('error analysis ships matching references only to its diagnostic roles', () => {
  const skill = skillManifest.skills.find(item => item.id === 'error-analysis');
  assert.ok(skill, 'the diagnostic skill must be registered');
  assert.deepEqual(skill.roles, ['coordinator', 'teacher', 'worker']);
  const name = `notara-${skill.id}`;
  for (const role of ROLES) {
    const allowed = skill.roles.includes(role.kind);
    assert.equal(role.skills.includes(name), allowed, role.id);
    for (const file of ['SKILL.md', 'templates/card.md', 'templates/learner-profile.md']) {
      const path = `role-skills/${role.kind}/${name}/${file}`;
      if (allowed) assert.equal(resource(path), resource(`pi-skills-built/${name}/${file}`));
      else assert.throws(() => resource(path), /Unknown bundled/, path);
    }
  }
});

test('material organization packages backbone and curation guidance for its existing roles', () => {
  const name = 'notara-pdf-learning-set';
  const skill = skillManifest.skills.find(item => item.id === 'pdf-learning-set');
  assert.deepEqual(skill.roles, ['organizer', 'teacher', 'worker']);
  for (const file of ['references/book-backbone.md', 'references/curation-spec.md']) {
    assert.ok(skill.resources.some(item => item.path === file), file);
    assert.ok(resource(`pi-skills-built/${name}/SKILL.md`).includes(file));
    for (const role of ['organizer', 'teacher', 'worker']) {
      assert.equal(resource(`role-skills/${role}/${name}/${file}`), resource(`pi-skills-built/${name}/${file}`));
    }
    for (const role of ['coordinator', 'companion', 'blind']) assert.throws(() => resource(`role-skills/${role}/${name}/${file}`), /Unknown bundled/);
  }
  const workflow = resource(`pi-skills-built/${name}/references/book-backbone.md`);
  const writing = resource(`pi-skills-built/${name}/references/curation-spec.md`);
  assert.match(workflow, /骨架[\s\S]*标杆[\s\S]*并行/);
  assert.match(workflow, /原子/); assert.match(workflow, /物理页/);
  assert.match(workflow, /worker-review/); assert.match(workflow, /当前.*schema/);
  assert.match(workflow, /主会话.*保存/); assert.match(workflow, /通用路线.*建议/);
  assert.match(writing, /零剧透/); assert.match(writing, /题面记忆锚点/);
  assert.match(writing, /为什么会想到/); assert.match(writing, /最贴切/);
  assert.match(writing, /原书.*勘误/); assert.match(writing, /学科/);
  assert.doesNotMatch([workflow, writing].join('\n'), /invoke_subagent|Model\s*[:=]|~\/\.gemini|\/Users\/|audit_vault\.py/);
  assert.doesNotMatch(resource('workers/base.md'), /开头给 1～2 句加粗的|采用严谨客观的教材说明文体/);
  assert.match(resource('workers/base.md'), /notara-pdf-learning-set.*卡片/);
});

test('recommend skill is available only to long-term teaching roles', () => {
  const skill = skillManifest.skills.find(item => item.id === 'recommend');
  assert.deepEqual(skill.roles, ['coordinator', 'teacher']);
  for (const role of ROLES) {
    const allowed = skill.roles.includes(role.kind);
    assert.equal(role.skills.includes('notara-recommend'), allowed, role.id);
    const path = `role-skills/${role.kind}/notara-recommend/SKILL.md`;
    if (allowed) assert.equal(resource(path), resource('pi-skills-built/notara-recommend/SKILL.md'));
    else assert.throws(() => resource(path), /Unknown bundled/);
  }
});

test('recommendation guidance agrees on automatic actionable saves and explicit no-save', () => {
  for (const path of ['coordinator.md', 'pi-skills-built/notara-quest-orchestrator/SKILL.md', 'pi-skills-built/notara-recommend/SKILL.md']) {
    const text = resource(path);
    assert.match(text, /本轮已经给出了可执行的后续安排/);
    assert.match(text, /只是讨论可能性/);
    assert.match(text, /明确不保存/);
    assert.match(text, /回读/);
    assert.doesNotMatch(text, /值得持续保留|需持续保留时|固定规则只在没有有效建议时兜底|复习候选兜底/);
  }
});

test('practice design ships usable materials to the two teaching entry roles without granting worker access', () => {
  const skill = skillManifest.skills.find(item => item.id === 'practice-design');
  assert.ok(skill);
  const name = `notara-${skill.id}`;
  const files = ['SKILL.md', ...skill.resources.map(item => item.path)];
  for (const role of ROLES) {
    const allowed = ['coordinator', 'teacher'].includes(role.kind);
    assert.equal(role.skills.includes(name), allowed, role.id);
    for (const file of files) {
      const path = `role-skills/${role.kind}/${name}/${file}`;
      if (allowed) assert.equal(resource(path), resource(`pi-skills-built/${name}/${file}`));
      else assert.throws(() => resource(path), /Unknown bundled/, path);
    }
  }
  assert.match(resource(`role-skills/teacher/${name}/SKILL.md`), /实际进入课堂时才按需要 `lesson_plan`/);
});

test('lesson core keeps ABC and the next learning step with the teacher and delegates research and audit by dependency', () => {
  const prep = resource('role-skills/teacher/notara-lesson-preparation/SKILL.md');
  assert.ok(/资料|材料/.test(prep) && /学情|已有认识/.test(prep) && /目标/.test(prep), 'the teacher connects materials, learner evidence and the goal');
  assert.match(prep, /认知.{0,8}进展|下一.{0,8}(?:认识|判断|理解)|新增.{0,8}判断/);
  assert.ok(prep.includes('worker-general') && prep.includes('worker-review'), 'preparation uses research and audit helpers');
  assert.doesNotMatch(resource('role-skills/teacher/notara-examiner-analysis/SKILL.md'), /worker-(?:problem|exercise|lesson)/, 'shared problem analysis must not override the preparation roles');
  assert.ok(/并行/.test(prep) && /依赖|前置/.test(prep) && /等待|串行|先[^。\n]{0,20}再/.test(prep), 'independent research and dependent work use different scheduling');
  assert.ok(/保存|落盘/.test(prep) && /read/.test(prep) && /完整/.test(prep) && /审核|审查|核验/.test(prep) && /lesson_plan/.test(prep), 'the teacher saves, reads, audits and binds the complete lesson');
});

test('lesson core keeps unit connections, four answer states and valid alternative methods distinct from skill evidence', () => {
  const prep = resource('role-skills/teacher/notara-lesson-preparation/SKILL.md');
  const teaching = [prep, resource('lesson-judgments.md'), resource('base.md'), resource('role-skills/teacher/notara-quest-tutor/SKILL.md')].join('\n');
  assert.ok(/单元|知识点|要点/.test(teaching) && /触发|信号/.test(teaching) && /条件/.test(teaching) && /跨题|联系/.test(teaching), 'units include when to use them and how they connect');
  assert.ok(/正确|答对/.test(teaching) && /部分|不完整/.test(teaching) && /明确[^。\n]{0,8}错|错误/.test(teaching) && /(?:无法|不能)[^。\n]{0,6}判断|信息不足/.test(teaching), 'correct, partial, wrong and indeterminate answers are separate cases');
  const alternatives = teaching.split(/\n\s*\n/).filter(paragraph => /他法|其他方法|不同方法|参考方法/.test(paragraph)).join('\n');
  assert.ok(/认可|接受|肯定|承认/.test(alternatives) && /兴趣|愿意/.test(alternatives) && /简提|简要|简短|一句/.test(alternatives) && /探索/.test(alternatives), 'valid alternatives are accepted and further exploration respects interest');
  assert.ok(/技能|目标方法/.test(alternatives) && /证据|展示/.test(alternatives) && /分开|分别|区分/.test(alternatives), 'a correct alternative and demonstrated skill evidence are distinct');
  assert.ok(/学科/.test(teaching) && /资料|材料/.test(teaching) && /风格|体裁|表达方式|长处|思考方式/.test(teaching), 'presentation follows the discipline and materials');
});

test('lesson core template retains teacher references and pending tasks without imposing fixed stage fields', async () => {
  const template = await readFile(new URL('../../../templates/base-files/lesson.md', import.meta.url), 'utf8');
  assert.match(template, /type:\s*lesson/);
  assert.match(template, /<details data-notara="teacher">[\s\S]*?<\/details>/);
  assert.match(template, /完整解答|推导/);
  assert.doesNotMatch(template, /^- \[[xX]\]/m);
});

test('teacher preparation skill, all declared lesson templates and five worker prompts ship exact source bytes to allowed roles', async () => {
  const manifest = JSON.parse(await readFile(new URL('../../../prompts/manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(skillManifest, manifest, 'packaged role/resource declarations must be current');
  const prep = manifest.skills.find(skill => skill.id === 'lesson-preparation');
  assert.deepEqual(prep.roles, ['teacher']);
  assert.deepEqual(prep.resources.map(item => item.path), ['templates/lesson.md']);
  for (const directory of [
    '../../../prompts/pi-skills-built/notara-lesson-preparation/templates/',
    '../resources/pi-skills-built/notara-lesson-preparation/templates/',
    '../resources/role-skills/teacher/notara-lesson-preparation/templates/',
  ]) assert.deepEqual((await readdir(new URL(directory, import.meta.url))).sort(), ['lesson.md'], directory);
  const sourceBody = (await readFile(new URL(`../../../prompts/${prep.file}`, import.meta.url), 'utf8')).trimEnd();
  const built = await readFile(new URL('../../../prompts/pi-skills-built/notara-lesson-preparation/SKILL.md', import.meta.url), 'utf8');
  assert.ok(built.endsWith(`\n---\n\n${sourceBody}\n`));
  assert.equal(resource('pi-skills-built/notara-lesson-preparation/SKILL.md'), built);
  for (const role of prep.roles) assert.equal(resource(`role-skills/${role}/notara-lesson-preparation/SKILL.md`), built);

  const lessonSource = await readFile(new URL('../../../templates/base-files/lesson.md', import.meta.url), 'utf8');
  for (const skill of manifest.skills) {
    if (!skill.resources?.some(item => item.path === 'templates/lesson.md')) continue;
    const rel = `notara-${skill.id}/templates/lesson.md`;
    assert.equal(await readFile(new URL(`../../../prompts/pi-skills-built/${rel}`, import.meta.url), 'utf8'), lessonSource, `built ${rel}`);
    assert.equal(resource(`pi-skills-built/${rel}`), lessonSource, `packaged ${rel}`);
    for (const role of skill.roles) assert.equal(resource(`role-skills/${role}/${rel}`), lessonSource, `${role}/${rel}`);
  }
  for (const id of ['lesson', 'problem', 'exercise', 'review', 'general']) {
    const source = await readFile(new URL(`../../../prompts/workers/${id}.md`, import.meta.url), 'utf8');
    assert.equal(resource(`workers/${id}.md`), source, `${id} source/package drift`);
    const ownPrompt = `${resource('workers/base.md')}\n\n${source}`;
    const prompt = ROLES.find(role => role.id === `worker-${id}`).prompt;
    assert.ok(prompt.startsWith(ownPrompt), `${id} retains its own exact prompt`);
    assert.equal(prompt.slice(ownPrompt.length).trim(), ['general', 'review'].includes(id) ? resource('lesson-judgments.md').trim() : '', `${id} shared prompt suffix`);
  }
});

test('the catalog has three learning roles (coordinator, teacher, organizer), four companions plus blind, and five workers', () => {
  assert.equal(PRESET_IDS.length, 13);
  assert.equal(new Set(PRESET_IDS).size, 13);
  assert.equal(ROLES.filter(role => role.kind === 'worker').length, 5);
  for (const id of ['notara-teacher', 'notara-coordinator', 'notara-material-organizer', 'companion-deepseek-blind']) {
    assert.ok(PRESET_IDS.includes(id), id);
  }
  const teacherPrompt = ROLES.find(role => role.kind === 'teacher').prompt;
  const teacherPrefix = `${resource('learning-records.md')}\n\n${resource('base.md')}`;
  assert.ok(teacherPrompt.startsWith(teacherPrefix));
  assert.equal(teacherPrompt.slice(teacherPrefix.length).trim(), `${resource('lesson-judgments.md')}\n\n${resource('conversation-judgments.md')}`.trim());
  assert.equal(ROLES.find(role => role.kind === 'coordinator').prompt, `${resource('learning-records.md')}\n\n${resource('coordinator.md')}\n\n${resource('conversation-judgments.md')}`);
  assert.equal(ROLES.find(role => role.kind === 'organizer').prompt, resource('material-organizer.md'));
  assert.equal(ROLES.find(role => role.kind === 'blind').prompt, BLIND_SYSTEM_PROMPT);
  assert.deepEqual(skillsForRole('coordinator'), [
    'notara-whiteboard',
    'notara-review-brainstorm',
    'notara-quest-orchestrator',
    'notara-recommend',
    'notara-exam-diagnosis',
    'notara-error-analysis',
    'notara-exam-cram',
    'notara-school-notes',
    'notara-practice-design',
    'notara-summer-preview',
  ]);
  assert.deepEqual(skillsForRole('organizer'), [
    'notara-pdf-learning-set',
    'notara-examiner-analysis',
    'notara-review-brainstorm',
    'notara-school-notes',
  ]);
  assert.deepEqual(skillsForRole('teacher'), [
    'notara-whiteboard',
    'notara-pdf-learning-set',
    'notara-quest-tutor',
    'notara-examiner-analysis',
    'notara-review-brainstorm',
    'notara-lesson-preparation',
    'notara-quest-orchestrator',
    'notara-recommend',
    'notara-exam-diagnosis',
    'notara-error-analysis',
    'notara-exam-cram',
    'notara-school-notes',
    'notara-practice-design',
    'notara-summer-preview',
  ]);
  assert.deepEqual(skillsForRole('worker'), ['notara-pdf-learning-set', 'notara-examiner-analysis', 'notara-review-brainstorm', 'notara-error-analysis']);
  assert.deepEqual(skillsForRole('companion'), []);
  assert.deepEqual(skillsForRole('blind'), []);
});

test('a corrupted packaged core fails at load time with no fallback prompt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notara-presets-resources-'));
  try {
    await cp(new URL('../resources/', import.meta.url), join(root, 'resources'), { recursive: true });
    await cp(new URL('../resources.js', import.meta.url), join(root, 'resources.mjs'));
    await writeFile(join(root, 'resources', 'base.md'), 'corrupted');
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', `try { await import(${JSON.stringify(pathToFileURL(join(root, 'resources.mjs')).href)}); process.exit(1); } catch (error) { console.log(error.message); }`], { encoding: 'utf8' });
    assert.match(output, /checksum mismatch: base.md/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('blind tasks accept only the original problem and current student explanation', () => {
  const result = blindTask({ problem: '证明 x > 0', studentExplanation: '我从定义开始……' });
  assert.match(result, /证明 x > 0/);
  assert.match(result, /我从定义开始/);
  assert.doesNotMatch(BLIND_SYSTEM_PROMPT, /参考理解|共同记忆|skill:/);
  for (const key of ['history', 'reference', 'context', 'materials', 'skill', 'memory', 'prompt', 'tools']) {
    assert.throws(() => blindTask({ problem: '题面', studentExplanation: '讲解', [key]: 'secret' }), /does not accept/);
  }
  assert.throws(() => blindTask({ problem: '', studentExplanation: '讲解' }), /non-empty/);
  assert.throws(() => blindTask({ problem: '题面', studentExplanation: 'x'.repeat(48_001) }), /at most/);
});

test('bundled skill relative templates omit legacy review fields and preserve exemplar problem-solving rationale', async () => {
  const defaultCard = resource('role-skills/organizer/notara-pdf-learning-set/templates/card.md');
  assert.doesNotMatch(defaultCard, /\blearned:|\bmastery:|\bnext_review:|\blast_review:/);
  assert.match(defaultCard, /如何想到、什么情况下能用与失效/);
  const routeTemplate = resource('role-skills/coordinator/notara-quest-orchestrator/templates/route.md');
  assert.match(routeTemplate, /type:\s*route/);
  assert.match(routeTemplate, /## 里程碑与进展/);
  const lessonTemplate = resource('role-skills/teacher/notara-quest-tutor/templates/lesson.md');
  assert.match(lessonTemplate, /type:\s*lesson/);
  assert.match(lessonTemplate, /data-notara="teacher"/);

  const prepSkill = resource('role-skills/teacher/notara-lesson-preparation/SKILL.md');
  const prepLessonTemplate = resource('role-skills/teacher/notara-lesson-preparation/templates/lesson.md');
  assert.equal(prepLessonTemplate, lessonTemplate);

  const examinerSkill = resource('role-skills/worker/notara-examiner-analysis/SKILL.md');
  assert.match(examinerSkill, /后台分析与备课不以学生先发问为前提/);
  assert.match(examinerSkill, /不尝试再次委派子任务或调用 `write`\/`edit`/);

  const exemplar = await readFile(new URL('../../../showcase-examples/case-a-svd/卡片/例题-二阶非方阵的SVD手算与秩1近似误差.md', import.meta.url), 'utf8');
  assert.doesNotMatch(exemplar, /^learned:/m);
  assert.match(exemplar, /为什么这样想/);
  assert.match(exemplar, /方法适用条件与失效边界/);
  assert.match(exemplar, /零奇异值处耦合公式/);
  assert.match(exemplar, /查看原页/);

  const basePrompt = resource('base.md');
  const tutorSkill = resource('role-skills/teacher/notara-quest-tutor/SKILL.md');
  assert.doesNotMatch(basePrompt, /没有教学进度工具/);
  assert.doesNotMatch(tutorSkill, /没有教学进度工具/);
  assert.match(basePrompt, /lesson_plan/);
  assert.match(tutorSkill, /lesson_plan/);
  assert.match(prepSkill, /lesson_plan/);

  // Phase 5 contracts: post-lesson summary handoff, milestone verification, deduplication, and review schedule decoupling.
  assert.match(lessonTemplate, /## 本节总结与下次续接/);
  assert.match(routeTemplate, /\[\[session:会话ID\|课堂标题\]\]/);
  assert.match(routeTemplate, /待补内容/);
  assert.match(basePrompt, /等待学生回答.*都不是下课/);
  assert.match(tutorSkill, /出题后等待学生回答.*均不属于下课/);
  const coordPrompt = resource('coordinator.md');
  const orchSkill = resource('role-skills/coordinator/notara-quest-orchestrator/SKILL.md');
  const reviewSkill = resource('role-skills/teacher/notara-review-brainstorm/SKILL.md');
  assert.match(coordPrompt, /sourceLocator.*同稿不重复累计/);
  assert.match(orchSkill, /同稿交付去重/);
  assert.match(reviewSkill, /里程碑检验也不自动变成正式复习确认/);

  // Scenario skills and relative templates stay inside their declared roles.
  const examDiag = resource('role-skills/coordinator/notara-exam-diagnosis/SKILL.md');
  const examCram = resource('role-skills/coordinator/notara-exam-cram/SKILL.md');
  const schoolNotes = resource('role-skills/organizer/notara-school-notes/SKILL.md');
  const summerPreview = resource('role-skills/coordinator/notara-summer-preview/SKILL.md');
  assert.match(examDiag, /无作答不编造错因/);
  assert.match(examCram, /时间不足.*缩减目标/);
  assert.match(schoolNotes, /可以在这里干净结束/);
  assert.match(summerPreview, /按实际进展动态调整后续路线/);
  assert.equal(resource('role-skills/teacher/notara-exam-diagnosis/templates/lesson.md'), lessonTemplate);
  assert.equal(resource('role-skills/coordinator/notara-summer-preview/templates/route.md'), routeTemplate);
  const sourceTemplate=resource('role-skills/organizer/notara-school-notes/templates/source-guide.md');
  assert.match(sourceTemplate,/type: source/);assert.match(sourceTemplate,/普通链接列表/);assert.doesNotMatch(sourceTemplate,/^- \[[ x]\]/m);
  assert.throws(() => resource('role-skills/worker/notara-exam-diagnosis/SKILL.md'), /Unknown bundled/);
  assert.throws(() => resource('role-skills/worker/notara-summer-preview/SKILL.md'), /Unknown bundled/);
});

test('learning plans ship a dated-item template without turning directories or milestones into appointments',()=>{
  const plan=resource('role-skills/coordinator/notara-quest-orchestrator/templates/plan.md');
  assert.equal(plan,resource('role-skills/teacher/notara-quest-orchestrator/templates/plan.md'));
  assert.match(plan,/type: plan/);assert.match(plan,/📅 YYYY-MM-DD/);assert.doesNotMatch(plan,/📅 \d{4}-\d{2}-\d{2}/);
  const skill=resource('role-skills/coordinator/notara-quest-orchestrator/SKILL.md');
  assert.match(skill,/只有显式日期条目进入日历/);assert.match(skill,/到期卡片问题沿原复访记录/);assert.match(skill,/未处理项保留/);
  assert.match(resource('base.md'),/普通勾选框不进入待办/);
  assert.match(resource('material-organizer.md'),/收到资料不自动生成个人排期/);
});
