import test from 'node:test';
import assert from 'node:assert/strict';
import {projectCalendar,monthDays,dayInZone,validDay,shiftMonth,agendaForDay} from '../model.js';
const range={from:'2026-10-01',to:'2026-10-31',today:'2026-10-27'};
const task=(text,line=1,checked=false)=>({line,text,checked});
test('explicit card types retain questions even when their names resemble old guides',()=>{
 for(const type of ['card','concept','method','exercise']){
  const doc={path:'导读方法.md',title:'导读方法',tags:['导读'],type,tasks:[task('普通勾选 📅 2026-10-27')],reviewPlans:[{recordId:'r',question:'如何想到这个方法？',nextReview:'2026-10-27'}]};
  assert.deepEqual(projectCalendar({documents:[doc]},range).events.map(row=>row.kind),['question']);
 }
});
test('only explicit plan items and card questions become calendar to-dos',()=>{
  const documents=[
    {path:'计划.md',type:'plan',title:'学习计划',tasks:[task('开始单调性 📅 2026-10-28'),task('尚未约定时间',2)],frontmatter:{scheduledOn:'2026-10-29'}},
    {path:'旧导读.md',type:'guide',title:'旧导读',tasks:[task('开始极值 📅 2026-10-29')]},
    ...['source','note','lesson','route','daily'].map(type=>({path:type+'.md',type,frontmatter:{lessons:[{scheduledOn:'2026-10-28'}]},tasks:[task('不是计划 📅 2026-10-28')]})),
    {path:'模板/计划.md',type:'plan',tasks:[task('模板 📅 2026-10-28')]},
    {path:'卡片/导数.md',type:'concept',title:'导数',reviewPlans:[{recordId:'r1',nextReview:'2026-10-27',question:'求导后为什么先因式分解？',reason:'衔接定号',heading:''}]},
    {path:'卡片/旧卡.md',type:'card',reviewPlans:[{nextReview:'2026-10-27'}]},
  ];
  const data=projectCalendar({documents},range);
  assert.deepEqual(data.events.map(row=>[row.kind,row.title]),[['question','求导后为什么先因式分解？'],['plan','开始单调性'],['plan','开始极值']]);
  assert.equal('undated' in data,false);
});
test('unhandled dates survive month boundaries without moving their original dates',()=>{
  const data=projectCalendar({documents:[
    {path:'计划.md',type:'plan',tasks:[task('上月计划 📅 2026-09-01'),task('已完成 📅 2026-09-02',2,true),task('今天 📅 2026-10-27',3)]},
    {path:'卡.md',type:'card',reviewPlans:[{recordId:'r',nextReview:'2026-09-03',question:'为什么？'}]},
  ]},range);
  assert.deepEqual(data.overdue.map(row=>row.date),['2026-09-01','2026-09-03']);
  assert.deepEqual(data.events.map(row=>row.title),['今天']);
  assert.deepEqual(agendaForDay(data,range.today).map(row=>row.title),['上月计划','为什么？','今天']);
  assert.equal(agendaForDay(data,'2026-10-28').length,0);
});
test('diary content remains separate and malformed legacy schedules are ignored',()=>{
  const data=projectCalendar({documents:[{path:'日记/2026-10-27.md',type:'daily',title:'日记',frontmatter:{date:'2026-10-27'},tasks:[task('日记勾选 📅 2026-10-27')]},{path:'路线.md',type:'route',frontmatter:{lessons:'invalid'}}]},range);
  assert.deepEqual(data.events.map(row=>row.kind),['daily']);assert.deepEqual(data.invalid,[]);
});
test('invalid dates and literal date examples never become appointments',()=>{
  const texts=['学习 `📅 2026-10-28` 的写法','公式 $📅 2026-10-28$','坏日期 📅 2026-10-280','坏日期 📅 2026-02-30'];
  const data=projectCalendar({documents:[{path:'计划.md',type:'plan',tasks:texts.map((text,i)=>task(text,i+1))}]},range);
  assert.equal(data.events.length,0);assert.equal(data.invalid.length,1);assert.equal(validDay('2026-02-30'),false);
});
test('date arithmetic and time zones retain civil dates',()=>{
  assert.equal(shiftMonth('2026-12',1),'2027-01');assert.equal(monthDays('2026-11')[0],'2026-10-26');assert.equal(monthDays('2026-11').length,42);
  assert.equal(dayInZone(new Date('2026-10-26T17:00:00Z'),'Asia/Shanghai'),'2026-10-27');assert.equal(dayInZone(new Date('2026-10-26T17:00:00Z'),'America/Los_Angeles'),'2026-10-26');
});
