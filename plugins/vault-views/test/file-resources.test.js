import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionFileAddress, absoluteFileAddress } from '@deepseek-ai/dsh-util-workspace-path';
import { nativeFileLocator, nativeFileTitle, workspaceFileAddress } from '../src/file-resources.js';
import { workspaceForSession } from '@oh-my-student/plugin-vault-sqlite/workspace-client';

const workspaces = [
  { workspaceId: 'A', path: '/vault/A', sessionIds: ['session-a'] },
  { workspaceId: 'B', path: 'C:\\vault\\B', sessionIds: ['session-b'] },
];
test('native file routing freezes the source workspace and preserves PDF fragment', () => {
  assert.deepEqual(nativeFileLocator(sessionFileAddress('session-a', '卡片/转置.md'), workspaces), { path: '卡片/转置.md', workspaceId: 'A' });
  assert.deepEqual(nativeFileLocator(sessionFileAddress('session-a', '/vault/A/来源/讲义.pdf') + '#page=2', workspaces), { path: '来源/讲义.pdf', workspaceId: 'A', subpath: '#page=2' });
  assert.deepEqual(nativeFileLocator(sessionFileAddress('session-b', 'C:\\vault\\B\\note.md'), workspaces), { path: 'note.md', workspaceId: 'B' });
  assert.equal(nativeFileTitle(sessionFileAddress('session-a', '卡片/转置.md')), '转置');
});
test('unrelated native viewers, unknown sessions and outside paths are not claimed', () => {
  for (const address of [
    sessionFileAddress('session-a', 'sheet.xlsx'), sessionFileAddress('unknown', 'note.md'),
    sessionFileAddress('session-a', '/vault/AB/note.md'), sessionFileAddress('session-a', '../A/note.md'),
    sessionFileAddress('session-a', 'a/../note.md'), sessionFileAddress('session-a', 'a\u0000.md'),
    sessionFileAddress('session-a', 'notes.markdown'), sessionFileAddress('session-a', 'diagram.excalidraw.json'),
    sessionFileAddress('session-a', '.hidden/note.md'), sessionFileAddress('session-a', 'node_modules/note.md'),
    sessionFileAddress('session-a', 'CON.md'), sessionFileAddress('session-a', 'a*/note.md'),
    absoluteFileAddress('/vault/A/note.md'), 'https://example.com/a.md', 'dsh-resource://file/session/session-a/%xx.md',
  ]) assert.equal(nativeFileLocator(address, workspaces), null, address);
});

test('ordinary file routing remains bound to the source workspace and native viewer', () => {
  const sessions = { 'session-a': {cwd:'/vault/A'}, 'session-b': {cwd:'C:\\vault\\B'} };
  for (const path of ['代码/训练.py','结果.json','说明.txt','Makefile']) {
    const address = workspaceFileAddress({workspaceId:'A',path}, workspaces, sessions);
    assert.equal(address, sessionFileAddress('session-a',path));
    assert.equal(nativeFileLocator(address, workspaces), null);
  }
  assert.throws(() => workspaceFileAddress({workspaceId:'A',sourceSessionId:'session-b',path:'code.py'},workspaces,sessions), /工作区已不可用/);
  assert.throws(() => workspaceFileAddress({workspaceId:'missing',path:'code.py'},workspaces,sessions), /工作区已不可用/);
  assert.deepEqual(nativeFileLocator(sessionFileAddress('session-a','讲义.pdf#page=2&rect=0,0,1,1'),workspaces), {path:'讲义.pdf',workspaceId:'A',subpath:'#page=2&rect=0,0,1,1'});
  assert.equal(nativeFileLocator(sessionFileAddress('session-a','image.png'),workspaces).path, 'image.png');
});

test('native links from a child classroom use its own parent workspace, not the displaying session', () => {
  const ctx={sessions:{list:{getSnapshot:()=>({byId:{child:{origin:'subagent',parentId:'session-a'}}})}},get:name=>name==='workspaces'?{list:{getSnapshot:()=>({items:workspaces})}}:undefined};
  assert.deepEqual(nativeFileLocator(sessionFileAddress('child','notes.md'),workspaces,id=>workspaceForSession(ctx,id)),{path:'notes.md',workspaceId:'A'});
  assert.equal(nativeFileLocator(sessionFileAddress('unknown','notes.md'),workspaces,id=>workspaceForSession(ctx,id)),null);
  assert.equal(workspaceFileAddress({path:'train.py',workspaceId:'A',sourceSessionId:'child'},workspaces,{child:{}},id=>workspaceForSession(ctx,id)),sessionFileAddress('child','train.py'));
  assert.throws(()=>workspaceFileAddress({path:'train.py',workspaceId:'B',sourceSessionId:'child'},workspaces,{child:{}},id=>workspaceForSession(ctx,id)),/工作区已不可用/);
});
