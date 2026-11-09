import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createVaultStore} from '@oh-my-student/plugin-vault-sqlite/store';
import {parseMarkdown} from '@oh-my-student/plugin-vault-sqlite/frontmatter';
import {reviewProjection} from '@oh-my-student/plugin-vault-sqlite/review';
import {rescheduleCalendarItem} from '../reschedule.js';
import {projectCalendar,agendaForDay} from '../model.js';
const now=new Date(2026,10,8,12),range={from:'2026-11-01',to:'2026-11-30',today:'2026-11-08'};
function fixture(t){const root=mkdtempSync(join(tmpdir(),'notara-plan-')),store=createVaultStore({root,now:()=>now});t.after(async()=>{await store.close();rmSync(root,{recursive:true,force:true});});return {store,root};}
test('legacy guide with numeric title still uses the same classification on read and reschedule',t=>{
 const {store}=fixture(t);store.save({path:'材料.md',content:'---\ntype: source\ntitle: 2026\ntags: [导读]\n---\n# 阅读安排\n- [ ] 继续阅读 📅 2026-11-08',expectedRevision:null});
 const row=projectCalendar(store.calendarSources(),range).events[0];assert.equal(row.kind,'plan');
 rescheduleCalendarItem(store,{kind:'plan',path:row.path,line:row.line,expectedText:row.text,expectedRevision:row.revision,date:'2026-11-12'},now);
 assert.equal(projectCalendar(store.calendarSources(),range).events[0].date,'2026-11-12');
});
test('rescheduling a plan changes only the real date, retaining CRLF, links, math and task anchor',t=>{
  const {store,root}=fixture(t);
  const text='---\r\ntype: plan\r\n---\r\n# 导数学习\r\n- [ ] 讨论 [[导数]] 与 $f(x)$，示例 `📅 2026-01-01` 📅 2026-10-01 <!-- notara-task:one -->\r\n- [ ] 还没约时间\r\n';
  store.save({path:'计划.md',content:text,expectedRevision:null});
  const item=projectCalendar(store.calendarSources(),range).overdue[0];
  const input={kind:'plan',path:item.path,line:item.line,expectedText:item.text,expectedRevision:item.revision,date:'2026-11-10'};
  rescheduleCalendarItem(store,input,now);
  assert.equal(readFileSync(join(root,'计划.md'),'utf8'),text.replace('📅 2026-10-01','📅 2026-11-10'));
  assert.throws(()=>rescheduleCalendarItem(store,input,now),/revision_conflict/);
  assert.equal(projectCalendar(store.calendarSources(),range).overdue.length,0);
  const updated=projectCalendar(store.calendarSources(),range).events[0];
  store.toggleTask({path:updated.path,line:updated.line,checked:true,expectedText:updated.text,expectedRevision:updated.revision});
  assert.equal(agendaForDay(projectCalendar(store.calendarSources(),{...range,today:'2026-11-20'}),'2026-11-20').length,0);
});
test('question reschedule appends a continuation, keeps evidence and can be cleared or undone',t=>{
  const {store}=fixture(t);
  store.save({path:'卡.md',content:'---\ntype: concept\n---\n# 导数\n',expectedRevision:null});
  let record=store.read({path:'卡.md'});
  store.recordReview({path:record.path,expectedRevision:record.revision,result:'done',support:'hint',keyStep:'定号',note:'老师提示因式分解；学生完成定号。',followUp:{afterDays:0,question:'求导以后，为什么先因式分解？',reason:'衔接定号'}});
  let data=projectCalendar(store.calendarSources(),range),item=data.events.find(row=>row.kind==='question');
  const before=parseMarkdown(store.read({path:'卡.md'}).content).fields.review_history;
  rescheduleCalendarItem(store,{kind:'question',path:item.path,recordId:item.recordId,expectedRevision:item.revision,date:'2026-11-12'},now);
  record=store.read({path:'卡.md'});const fields=parseMarkdown(record.content).fields,projection=reviewProjection(fields,'卡.md');
  assert.deepEqual(fields.review_history.slice(0,-1),before);assert.equal(projection.reviewCount,1);assert.equal(projection.lastSupport,'hint');
  assert.equal(projection.reviewPlans[0].nextReview,'2026-11-12');assert.equal(fields.review_history.at(-1).kind,'continuation');
  assert.equal(fields.review_history.at(-1).result,undefined);
  assert.throws(()=>rescheduleCalendarItem(store,{kind:'question',path:item.path,recordId:item.recordId,expectedRevision:record.revision,date:'2026-11-13'},now),/record_conflict/);
  store.scheduleReview({path:record.path,expectedRevision:record.revision,followUp:null});
  assert.equal(projectCalendar(store.calendarSources(),range).events.length,0);
  record=store.read({path:'卡.md'});store.undoReview({path:record.path,expectedRevision:record.revision});
  assert.equal(projectCalendar(store.calendarSources(),range).events[0].date,'2026-11-12');
});
test('ordinary, hidden, undated, completed and invalid requests cannot be rescheduled',t=>{
  const {store}=fixture(t);
  for(const [path,content] of Object.entries({'笔记.md':'# 笔记\n- [ ] 普通 📅 2026-11-08','计划.md':'---\ntype: plan\n---\n# 计划\n- [ ] 未约时间\n- [x] 已执行 📅 2026-11-08\n## 教师参考\n- [ ] 隐藏 📅 2026-11-08'}))store.save({path,content,expectedRevision:null});
  for(const [path,line,text] of [['笔记.md',2,'普通 📅 2026-11-08'],['计划.md',5,'未约时间'],['计划.md',6,'已执行 📅 2026-11-08'],['计划.md',8,'隐藏 📅 2026-11-08']]){
    const record=store.read({path});assert.throws(()=>rescheduleCalendarItem(store,{kind:'plan',path,line,expectedText:text,expectedRevision:record.revision,date:'2026-11-10'},now),/plan_required|task_conflict/);assert.equal(store.read({path}).content,record.content);
  }
  for(const date of ['2026-02-30','2026-11-07'])assert.throws(()=>rescheduleCalendarItem(store,{date},now),/calendar_date/);
});
