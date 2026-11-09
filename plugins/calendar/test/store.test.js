import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createVaultStore} from '@oh-my-student/plugin-vault-sqlite/store';import {projectCalendar} from '../model.js';
import {DatabaseSync} from 'node:sqlite';
test('indexed learning-plan items keep individual dates and ignore obsolete route lessons',async t=>{
  const root=await mkdtemp(join(tmpdir(),'calendar-plan-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const source='---\ntype: plan\nlessons:\n  - id: old\n    title: 旧排期课堂\n    scheduledOn: 2026-10-27\n---\n# 学习计划\n- [ ] 开始单调性：[[导数定号]] 📅 2026-10-28\n- [ ] 开始极值：[[极值判断]] 📅 2026-10-30\n';
  await writeFile(join(root,'学习计划.md'),source);
  const store=createVaultStore({root,cachePath:':memory:'});t.after(()=>store.close());
  const data=projectCalendar(store.calendarSources(),{from:'2026-10-01',to:'2026-10-31',today:'2026-10-27'});
  assert.deepEqual(data.events.map(row=>[row.kind,row.date,row.title]),[['plan','2026-10-28','开始单调性：[[导数定号]]'],['plan','2026-10-30','开始极值：[[极值判断]]']]);
  const task=data.events[0];await store.toggleTask({path:task.path,line:task.line,checked:true,expectedRevision:task.revision,expectedText:task.text});
  assert.equal(await readFile(join(root,'学习计划.md'),'utf8'),source.replace('- [ ] 开始单调性','- [x] 开始单调性'));
});
test('calendar uses the index, excludes code examples and preserves revision-safe task writes',async t=>{
  const root=await mkdtemp(join(tmpdir(),'calendar-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'日记'));await writeFile(join(root,'计划.md'),'---\ntype: plan\n---\n# 日记\n- [ ] 学导数 📅 2026-10-27\n\n```md\n- [ ] 不是任务 📅 2026-10-27\n```\n');
  const store=createVaultStore({root,cachePath:':memory:'});t.after(()=>store.close());const before={...store.metrics},snapshot=store.calendarSources(),data=projectCalendar(snapshot,{from:'2026-10-01',to:'2026-10-31',today:'2026-10-27'});assert.equal(data.events.length,1);assert.equal(store.metrics.fileReads,before.fileReads);assert.equal(store.metrics.scans,before.scans);const task=data.events.find(row=>row.kind==='plan');await store.toggleTask({path:task.path,line:task.line,checked:true,expectedRevision:task.revision,expectedText:task.text});assert.equal(store.calendarSources().documents[0].tasks[0].checked,true);assert.throws(()=>store.toggleTask({path:task.path,line:task.line,checked:false,expectedRevision:task.revision,expectedText:task.text}),/revision_conflict/);
});
test('reference/detail tasks stay out of calendar after upgrading a v6 cache',async t=>{const root=await mkdtemp(join(tmpdir(),'calendar-cache-'));t.after(()=>rm(root,{recursive:true,force:true}));const source='# Note\n- [ ] visible 📅 2026-10-27\n\n## 参考理解\n- [ ] secret 📅 2026-10-27\n\n## 内容\n<details>\n<summary>answer</summary>\n\n- [ ] hidden 📅 2026-10-27\n\n</details>\n';await writeFile(join(root,'note.md'),source);const cachePath=join(root,'cache.sqlite');let store=createVaultStore({root,cachePath});await store.close();const db=new DatabaseSync(cachePath);db.exec('ALTER TABLE tasks DROP COLUMN hidden;UPDATE cache_meta SET projection_version=6;');db.close();store=createVaultStore({root,cachePath});t.after(()=>store.close());assert.deepEqual(store.calendarSources().documents[0].tasks.map(row=>row.text),['visible 📅 2026-10-27']);assert.equal(await import('node:fs/promises').then(fs=>fs.readFile(join(root,'note.md'),'utf8')),source);});
