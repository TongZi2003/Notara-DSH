import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES } from '../../presets/catalog.js';
import { mainPresetGroups, SUBAGENT_ONLY_PRESETS } from '../src/main-preset-options.js';

test('main picker hides exactly the worker/blind roles while preserving user-facing and custom choices', () => {
  const hidden = ROLES.filter(role => ['worker', 'blind'].includes(role.kind));
  assert.deepEqual([...SUBAGENT_ONLY_PRESETS].sort(), hidden.map(role => role.id).sort());
  const options = [...ROLES, { id: 'standard' }, { id: 'custom-research', name: '我自己的角色' }];
  const before = options.map(option => option.id);
  const groups = mainPresetGroups(options);
  assert.deepEqual(groups.map(group => group.label), ['学习', '伙伴', '通用']);
  assert.deepEqual(groups[0].options.map(option => option.id), ['notara-coordinator', 'notara-teacher', 'notara-material-organizer']);
  assert.equal(groups[1].options.length, 4);
  assert.deepEqual(groups[2].options.map(option => option.id), ['standard', 'custom-research']);
  assert.deepEqual(options.map(option => option.id), before, 'Does not mutate the native roster');
  assert.deepEqual(mainPresetGroups(hidden), []);
});
