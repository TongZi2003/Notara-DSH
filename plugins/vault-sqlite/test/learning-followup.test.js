import test from 'node:test';
import assert from 'node:assert/strict';
import {recordReviewContent,scheduleReviewContent,undoReviewContent,reviewSchedule,reviewProjection,reviewPlans} from '../review.js';
import {parseMarkdown} from '../frontmatter.js';
const base='---\ntype: card\n---\n## 学生理解\n老师问谁的和固定，学生选出两项。\n';
const observation={keyStep:'选出比较对象',result:'done',support:'hint',note:'老师问“谁的和固定”后，学生选出两项；随后自行检查取等。'};
const date=day=>new Date(`${day}T12:00:00`),fields=doc=>parseMarkdown(doc).fields;
const plan={question:'换一个条件，自己找比较的两项并解释理由。',afterDays:4,reason:'运算已走通，选路仍借助提示。'};
test('new observations do not assign a ladder; explicit AI intervals are independent of assistance and outcome',()=>{
 const only=recordReviewContent(base,observation,date('2026-11-07'));
 assert.equal(reviewSchedule(fields(only)),null);assert.equal(fields(only).review_history[0].scheduleVersion,3);
 const saved=recordReviewContent(base,{...observation,followUp:plan},date('2026-11-07'));
 assert.equal(reviewProjection(fields(saved)).reviewDue,'2026-11-11');assert.equal(reviewProjection(fields(saved)).reviewStage,null);
 const later=recordReviewContent(saved,{...observation,result:'missed',followUp:{...plan,afterDays:2}},date('2026-11-08'));
 assert.equal(reviewProjection(fields(later)).reviewDue,'2026-11-10');
 assert.equal(reviewProjection(fields(recordReviewContent(later,observation,date('2026-11-09')))).reviewDue,'2026-11-10');
});
test('planning changes and cancellation are not learning evidence; undo restores earlier arrangements',()=>{
 const first=scheduleReviewContent(base,{followUp:plan},date('2026-11-07'));
 const deferred=scheduleReviewContent(first,{followUp:{...plan,afterDays:10}},date('2026-11-08'));
 assert.equal(reviewProjection(fields(deferred)).reviewDue,'2026-11-18');assert.equal(reviewProjection(fields(deferred)).reviewCount,0);
 assert.equal(reviewProjection(fields(deferred)).independentReviewCount,0);
 const cleared=scheduleReviewContent(deferred,{followUp:null},date('2026-11-09'));assert.equal(reviewSchedule(fields(cleared)),null);
 assert.equal(reviewProjection(fields(undoReviewContent(cleared,date('2026-11-09')))).reviewDue,'2026-11-18');
});
test('diary headings have independent followups without manufacturing cards',()=>{
 const diary='---\ntype: diary\n---\n# 今日\n## 编程讨论\n修正了循环边界。\n## 阅读想法\n学生提出不同解释。\n';
 let saved=scheduleReviewContent(diary,{heading:'编程讨论',followUp:plan},date('2026-11-07'));
 saved=scheduleReviewContent(saved,{heading:'阅读想法',followUp:{...plan,afterDays:8}},date('2026-11-07'));
 assert.equal(reviewPlans(fields(saved)).length,2);assert.equal(reviewProjection(fields(saved)).reviewDue,'2026-11-11');
 saved=scheduleReviewContent(saved,{heading:'编程讨论',followUp:null},date('2026-11-08'));
 assert.equal(reviewProjection(fields(saved)).reviewDue,'2026-11-15');
 assert.throws(()=>scheduleReviewContent(diary,{followUp:plan}),/heading_required/);
 assert.throws(()=>scheduleReviewContent(diary,{heading:'不存在',followUp:plan}),/heading_not_found/);
});
test('legacy history and its date remain readable and unchanged when an AI schedule replaces it',()=>{
 const history=[{id:'old',day:'2026-10-01',result:'done',support:'independent',scheduleVersion:2,before:null}];
 const doc=`---\ntype: card\nreview_history: ${JSON.stringify(history)}\n---\n旧记录\n`;
 assert.equal(reviewProjection(fields(doc)).reviewDue,'2026-10-02');
 const saved=scheduleReviewContent(doc,{followUp:plan},date('2026-11-07'));
 assert.deepEqual(fields(saved).review_history[0],history[0]);assert.equal(reviewProjection(fields(saved)).reviewDue,'2026-11-11');
 assert.equal(reviewProjection(fields(undoReviewContent(saved,date('2026-11-08')))).reviewDue,'2026-10-02');
});
test('invalid or ambiguous plans fail rather than falling back to fixed intervals',()=>{
 for(const followUp of [{...plan,afterDays:-1},{...plan,afterDays:1.5},{...plan,question:''},{...plan,reason:''},{...plan,date:'2026-11-08'}])assert.throws(()=>scheduleReviewContent(base,{followUp}),/followup_invalid/);
 assert.throws(()=>scheduleReviewContent(base,{}),/followup_required/);
});
test('renamed or deleted diary headings can clear historical plans but cannot receive new plans',()=>{
 const diary='---\ntype: diary\n---\n## 原讨论\n原话\n';
 const planned=scheduleReviewContent(diary,{heading:'原讨论',followUp:plan},date('2026-11-07'));
 for(const edited of [planned.replace('## 原讨论','## 更名讨论'),planned.replace('## 原讨论','原讨论')]){
  assert.throws(()=>scheduleReviewContent(edited,{heading:'原讨论',followUp:plan},date('2026-11-08')),/heading_not_found/);
  const cleared=scheduleReviewContent(edited,{heading:'原讨论',followUp:null},date('2026-11-08'));
  assert.deepEqual(reviewPlans(fields(cleared)),[]);
 }
});
