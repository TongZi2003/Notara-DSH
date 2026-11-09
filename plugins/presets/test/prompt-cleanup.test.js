import test from 'node:test';
import assert from 'node:assert/strict';
import {resource} from '../resources.js';
import {apply} from '../prompt.js';
import {registerFollowUpTool} from '../followup-tool.js';
import {registerCanvasTool} from '../canvas-tool.js';
import {registerLessonTool} from '../lesson-tool.js';
import {registerSummaryTool} from '../summary-tool.js';
import {markdownFacts} from '../../vault-sqlite/markdown-projection.js';

function assembled(preset){let text;apply({systemPrompt:{section:section=>{text=section.text;},getSectionOrder:()=>0}},{preset});return text;}
test('recommendation content retains the existing document contract without promising a withdrawn home UI',()=>{
 const skill=resource('role-skills/coordinator/notara-recommend/SKILL.md'),home=resource('coordinator.md');
 assert.match(skill,/## 首页推荐/,'do not silently rename the stored recommendation section');
 for(const text of [skill,home])assert.doesNotMatch(text,/首页读取这个|首页只展示|首页沿已有文件变更通知刷新|没有时仅保留真实课堂的续接入口/);
 assert.match(skill,/当前对话/);assert.match(skill,/只推荐/);
});
test('teacher role and whiteboard instructions agree on lightweight teaching and actual activation',()=>{
 const home=assembled('notara-coordinator'),teacher=assembled('notara-teacher');
 assert.doesNotMatch(home,/不扩成单点教学|首页只做入口澄清/);
 assert.match(home,/轻量[^。\n]*当前会话/);
 assert.doesNotMatch(teacher,/较长推导[^。\n]*再整理成/);
 assert.doesNotMatch(teacher,/具备 `角色\/\*\.md` 档案与共同记忆/);
 assert.match(teacher,/notara-whiteboard/);
 const routing=resource('role-skills/coordinator/notara-quest-orchestrator/SKILL.md');
 assert.doesNotMatch(routing,/技能\/<id>\.md|保存自定义技能|不扩成单点教学/);
});
test('profile examples distinguish enduring preferences and retain exploratory student records',()=>{
 const home=resource('coordinator.md');
 assert.match(home,/以后[^。\n]*每步慢讲/);assert.doesNotMatch(home,/已表达的成熟理解/);assert.match(home,/疑问、尝试|尝试、疑问/);
});
test('shipped discipline templates teach qualified relationships accepted by the live parser',()=>{
 for(const file of ['math-concept','math-problem','chemistry-process','code-practice']){
  const text=resource(`role-skills/teacher/notara-pdf-learning-set/templates/${file}.md`);
  assert.doesNotMatch(text,/每个直接列表项写 - \[\[卡片\/目标\]\]：/);
  const examples=text.split('\n').filter(line=>/^- \[\[.*\]\][（(](前序依赖|知识标签|横向联系)/.test(line));assert.ok(examples.length>=2,file);
  const facts=markdownFacts('## 学生理解\n### 已建立的联系\n'+examples.join('\n'),0);
  assert.equal(facts.links.length,examples.length);assert.ok(facts.links.every(link=>link.relation?.evidence==='qualified'),file);
 }
});
test('conditional tool fields describe the accepted action rather than requiring invalid arguments',()=>{
 const tools=[],ctx={tools:{register:tool=>tools.push(tool)}};
 registerFollowUpTool(ctx,'notara-teacher');registerCanvasTool(ctx,'notara-teacher');registerLessonTool(ctx,'notara-teacher');
 const followup=tools.find(t=>t.name==='learning_followup'),canvas=tools.find(t=>t.name==='canvas'),lessonPlan=tools.find(t=>t.name==='lesson_plan');
 assert.match(followup.parameters.properties.heading.description,/plan\/clear/);assert.match(followup.parameters.properties.heading.description,/read.*不填/);
 assert.match(canvas.parameters.properties.title.description,/文本.*必填|必填.*文本/);assert.match(canvas.parameters.properties.body.description,/完整替换/);
 assert.doesNotMatch(lessonPlan.description,/所有更新均校验 expectedRevision、line 与 expectedText/);
 assert.match(lessonPlan.description,/clear_current 必填 expectedRevision/);
 assert.match(lessonPlan.parameters.properties.line.description,/set_current、complete、reopen 必填/);
});
test('assembled teacher prompt keeps core teaching judgments resident while moving operational formats to skills and tools',()=>{
 const teacher=assembled('notara-teacher'),home=assembled('notara-coordinator');
 // Resident teaching judgments remain available before any skill is loaded
 for(const pattern of [/## 共享教学判断/,/接续与引入/,/求导后为了判号而整理表达式、考虑因式分解/,/受阻时降阶/,/触发信号、核心思想、适用条件/,/不同于参考方法不算错/,/First Mention/]){
  assert.match(teacher,pattern);
 }
 // Obsolete patch instructions and role-blind profile creation are gone
 for(const text of [teacher,home]){
  assert.doesNotMatch(text,/正文中的 read\(\{path:"skill:名称"\}\)|正文中的 worker 改用 subagent/);
  assert.doesNotMatch(text,/首次得到明确学情、目标或稳定偏好时主动建档/);
 }
 // Operational fence/component/metadata specs live in skills rather than resident base prompt
 assert.doesNotMatch(teacher,/```notara-review/);
 assert.doesNotMatch(teacher,/predict 独占一行/);
 assert.match(resource('role-skills/teacher/notara-review-brainstorm/SKILL.md'),/```notara-review/);
 assert.match(resource('role-skills/teacher/notara-quest-tutor/SKILL.md'),/predict.*独占一行/);
 assert.match(resource('role-skills/teacher/notara-pdf-learning-set/SKILL.md'),/YAML Frontmatter `summary`/);
 // Ordinary teacher delivery no longer requires loading the full orchestrator skill
 assert.doesNotMatch(teacher,/按 `notara-quest-orchestrator` 的 `lesson_summary` 合同交付/);
});
test('lesson_summary tool separates sender delivery guidance from home coordinator decision fields',()=>{
 const senderTools=[],homeTools=[];
 registerSummaryTool({tools:{register:tool=>senderTools.push(tool)}},'notara-teacher');
 registerSummaryTool({tools:{register:tool=>homeTools.push(tool)}},'notara-coordinator');
 const sender=senderTools[0],home=homeTools[0];
 assert.deepEqual(sender.parameters.properties.action.enum,['deliver','read','retry']);
 assert.equal(sender.parameters.properties.targets,undefined);
 assert.equal(sender.parameters.properties.outcome,undefined);
 assert.deepEqual(home.parameters.properties.action.enum,['read','decide','acknowledge','retry']);
 assert.equal(home.parameters.properties.heading,undefined);
 assert.equal(home.parameters.properties.kind,undefined);
});
