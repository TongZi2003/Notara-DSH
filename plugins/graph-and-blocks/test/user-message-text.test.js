import test from 'node:test';
import assert from 'node:assert/strict';
import {editableUserText,restoreUserTextEdit} from '../src/user-message-text.js';

test('editing visible queue prose restores every original reference exactly, including adjacent references',()=>{
  const raw='内部邀请内部来源我的提问';
  const nodes=[{id:'text',start:0,end:4,data:{text:'内部邀请',display:'【大小姐】'}},{id:'notara-source',start:4,end:8,data:{label:'讲义'}},{id:'text',start:8,end:12,data:{text:'我的提问'}}];
  const view=editableUserText(raw,nodes);
  assert.equal(view.text,'【大小姐】【讲义】我的提问');
  assert.equal(restoreUserTextEdit(view.text+'（补充条件）',view.references),raw+'（补充条件）');
  assert.throws(()=>restoreUserTextEdit('【讲义】我的提问',view.references),/保留完整引用标签/);
  assert.throws(()=>restoreUserTextEdit(view.text+'【大小姐】',view.references),/保留完整引用标签/);
  assert.equal(raw,'内部邀请内部来源我的提问');
});

test('ordinary prose with the same label is never restored as a reference',()=>{
  const before='请解释【讲义】中的概念。',raw=before+'SOURCE_WIRE',nodes=[{id:'text',start:0,end:before.length,data:{text:before}},{id:'notara-source',start:before.length,end:raw.length,data:{label:'讲义'}}];
  const view=editableUserText(raw,nodes);
  assert.equal(restoreUserTextEdit(view.text+'补充条件',view.references),raw+'补充条件');
  assert.equal(restoreUserTextEdit('补充条件'+view.text,view.references),'补充条件'+raw);
  assert.equal(restoreUserTextEdit(view.text.replace('中的概念','里的定义'),view.references),raw.replace('中的概念','里的定义'));
});

test('separate prose edits map actual reference spans, including repeated adjacent labels',()=>{
  const raw='旧开头WIRE_AWIRE_B旧结尾',nodes=[{id:'text',start:0,end:3,data:{text:'旧开头'}},{id:'notara-source',start:3,end:9,data:{label:'讲义'}},{id:'notara-source',start:9,end:15,data:{label:'讲义'}},{id:'text',start:15,end:18,data:{text:'旧结尾'}}];
  const view=editableUserText(raw,nodes);
  assert.deepEqual(view.references.map(ref=>[ref.start,ref.end]),[[3,7],[7,11]]);
  assert.equal(restoreUserTextEdit(view.text+'补充',view.references),raw+'补充');
  assert.equal(restoreUserTextEdit(view.text.replace('旧开头','新开头').replace('旧结尾','新结尾'),view.references),'新开头WIRE_AWIRE_B新结尾');
  assert.throws(()=>restoreUserTextEdit(view.text.replace('【讲义】','【笔记】'),view.references),/保留完整引用标签/);
  assert.throws(()=>restoreUserTextEdit(view.text.replace('【讲义】',''),view.references),/保留完整引用标签/);
});

test('ambiguous duplicate deletion never rebinds a real reference to ordinary prose',()=>{
  const view=editableUserText('WIRE【讲义】',[{id:'notara-source',start:0,end:4,data:{label:'讲义'}},{id:'text',start:4,end:8,data:{text:'【讲义】'}}]);
  assert.throws(()=>restoreUserTextEdit('【讲义】',view.references),/保留完整引用标签/);
});
