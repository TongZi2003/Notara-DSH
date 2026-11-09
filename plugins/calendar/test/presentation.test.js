import test from 'node:test';
import assert from 'node:assert/strict';
import {dateStatus,selectedDateLabel,planPresentation} from '../src/presentation.js';

test('calendar dates use civil days, including leap days and DST transitions',()=>{
  assert.deepEqual(dateStatus('2026-11-06','2026-11-08'),{text:'逾期 2 天',overdue:true});
  assert.deepEqual(dateStatus('2026-11-08','2026-11-08'),{text:'今天',overdue:false});
  assert.deepEqual(dateStatus('2026-11-10','2026-11-08'),{text:'11月10日',overdue:false});
  assert.deepEqual(dateStatus('2026-11-06','2026-11-08',true),{text:'11月6日',overdue:false});
  assert.equal(dateStatus('2024-02-28','2024-03-01').text,'逾期 2 天');
  assert.equal(dateStatus('2026-03-07','2026-03-09').text,'逾期 2 天');
  assert.equal(dateStatus('2027-01-02','2026-11-08').text,'2027年1月2日');
  assert.equal(selectedDateLabel('2026-11-08'),'11月8日 周日');
});

test('only explicit trailing plan references move to metadata; title and source are not rewritten',()=>{
  const text='检查 $f\'(x)$ 的符号 · [[卡片/导函数#单调性|导函数]] · [[来源/讲义.pdf#page=2|讲义]]';
  const view=planPresentation(text);
  assert.equal(view.title,"检查 $f'(x)$ 的符号");
  assert.deepEqual(view.sources.map(ref=>[ref.path,ref.label]),[['卡片/导函数.md','导函数'],['来源/讲义.pdf','讲义']]);
  assert.equal(view.sources[1].page,2);
  for(const text of ['开始学习 [[卡片/导函数|导函数的符号]]','比较 [[甲]] 与 [[乙]]','`示例 · [[甲]]`','$x · [[甲]]$','检查 \\[[甲]]','[[甲]]','任务 · [[../外部]]']){
    assert.deepEqual(planPresentation(text),{title:text,sources:[]});
  }
});
