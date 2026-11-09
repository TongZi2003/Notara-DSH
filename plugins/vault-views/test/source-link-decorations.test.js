import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorState} from '@codemirror/state';
import {sourceLinkDecorations} from '../src/source-link-decorations.js';

test('source markers preserve each backlink and disappear when text changes',()=>{
  const row=(path,range)=>({path,title:path,reference:{range}});
  const field=sourceLinkDecorations([row('a.md',[0,2]),row('b.md',[0,2]),row('bad.md',[0,500])],()=>{},false);
  const state=EditorState.create({doc:'第一段\n第二段',extensions:[field]});
  assert.equal(state.field(field).size,4);
  assert.equal(state.update({changes:{from:0,to:1,insert:'新'}}).state.field(field).size,0);
});

test('live source markers do not expose collapsed answer or source folds',()=>{
  const doc='# 标题\n\n普通正文\n\n<details><summary>查看原页</summary>\n\n折叠内容\n</details>\n';
  const from=doc.indexOf('折叠内容'),rows=[{path:'卡片.md',title:'隐藏的卡片',reference:{range:[from,from+4]}}];
  const field=sourceLinkDecorations(rows,()=>{},true);
  assert.equal(EditorState.create({doc,extensions:[field]}).field(field).size,0);
});
