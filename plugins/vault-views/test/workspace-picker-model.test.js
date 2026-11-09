import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceGroups,rememberWorkspace,workspaceTitle} from '../src/workspace-picker-model.js';
test('workspace groups reflect visits, not modification times, without duplicates or stale IDs',()=>{
  const list=[{workspaceId:'a',title:'导数·基础',updatedAt:'2020'},{workspaceId:'b',title:'导数·进阶',updatedAt:'2030'},{workspaceId:'c',title:'化学'}];
  assert.deepEqual(workspaceGroups(list,'a',['a','gone','c','c']).map(([label,rows])=>[label,rows.map(row=>row.workspaceId)]),[['当前',['a']],['最近使用',['c']],['其他学习集',['b']]]);
  assert.deepEqual(workspaceGroups(list,'a',['c'],'进阶')[0][1],[list[1]]);
  assert.deepEqual(workspaceGroups(list,'a',[],'不存在'),[]);
  assert.deepEqual(rememberWorkspace(['a','c'],'c'),['c','a']);
  assert.equal(rememberWorkspace(Array.from({length:12},(_,i)=>String(i)),'new').length,8);
  assert.equal(workspaceTitle({title:'default-workspace'}),'默认工作区');
});
