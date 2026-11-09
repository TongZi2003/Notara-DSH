import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resource,resourceProvenance} from '../resources.js';
import {ROLES} from '../catalog.js';

test('classroom summaries and long-term profiles share one leading record-purpose paragraph',async()=>{
  const shared=resource('learning-records.md');
  assert.equal(shared,await readFile(new URL('../../../prompts/learning-records.md',import.meta.url),'utf8'));
  assert.equal(resourceProvenance.origins['learning-records.md'],'prompts/learning-records.md');
  for(const role of ROLES){
    const receives=['teacher','coordinator'].includes(role.kind);
    assert.equal(role.prompt.split(shared.trim()).length-1,receives?1:0,role.id);
    if(receives)assert.ok(role.prompt.startsWith(shared+'\n\n'),role.id);
  }
});

test('record purpose preserves causal attribution, supported progress and evidence without a mandatory form',()=>{
  const shared=resource('learning-records.md');
  for(const part of ['真实学习经历','不是教学成果汇报','谁提出了想法','什么帮助','疑惑因何产生','学生指出教师的错误','不能反记成学生弱点','搭梯后自行完成是真实进步','原话与概括分开','合理推断与已经确认的事实分开'])assert.ok(shared.includes(part),part);
  const judgments=resource('conversation-judgments.md');
  assert.ok(!judgments.includes('AI或老师的计算、推演与学生的选法、解释、质疑和修正分别归属'),'attribution lives in the leading paragraph');
  assert.match(judgments,/将影响理解的必要帮助融入叙述/);
  assert.match(judgments,/不以另做独立测试为承认学习价值的前提/);
});

test('first substantive contribution separates student, scaffold and teacher without counting quoted or host messages as student discovery',()=>{
  const shared=resource('learning-records.md');
  for(const part of ['First Mention','归学生（无提示独立）','归搭梯（提示下完成）','归老师（讲解后验证）','后台交接不算学生提出','不缩写为“独立完成”','不改变该规律的来源','新的解释或方法'])assert.ok(shared.includes(part),part);
});

test('teacher and coordinator retain step attribution and independent application before loading a recording skill',()=>{
  for(const id of ['notara-teacher','notara-coordinator']){
    const prompt=ROLES.find(role=>role.id===id).prompt;
    assert.match(prompt,/老师给出哪一步、学生完成哪一步，分别记录/);
    assert.match(prompt,/不用“搭梯后完成”统括动作归属/);
    assert.match(prompt,/本次无提示运用可以记为独立应用，不等于首次发现/);
  }
});
