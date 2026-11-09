import test from 'node:test';
import assert from 'node:assert/strict';
import { resource } from '../resources.js';
import { ROLES } from '../catalog.js';

// Omission/assembly guards, not a claim that a model obeys the prose. The same
// saved learner scenarios and defective draft are replayed with a real model.
test('material interpretation keeps unsupported experience and motives conditional even in teacher analysis', () => {
  const material = resource('role-skills/organizer/notara-pdf-learning-set/SKILL.md');
  assert.match(material, /身份、经历、动机/);
  assert.match(material, /参考理解[^。\n]*条件/);
  assert.match(material, /原句[^。\n]*推导依据/);
  assert.match(resource('material-organizer.md'), /回读[^。\n]*因果依据/);
  const conversation = resource('conversation-judgments.md');
  assert.match(conversation, /漏写不等于没想到/);
  assert.match(conversation, /教学假设[^。\n]*画像事实/);
});

test('teacher, researcher and reviewer share premise checks covering supplemental and oral examples', () => {
  const shared = resource('lesson-judgments.md');
  for (const term of ['补充', '备用', '口头', '前提', '反例']) assert.ok(shared.includes(term), term);
  assert.match(shared, /反例[^。\n]*前提[^。\n]*结论/);
  for (const id of ['notara-teacher', 'worker-general', 'worker-review']) {
    const role = ROLES.find(role => role.id === id);
    assert.equal(role.prompt.split(shared.trim()).length - 1, 1, id);
  }
  assert.match(resource('workers/review.md'), /共享[^。\n]*核验|核验[^。\n]*共享/);
});

test('ordinary exploration closes with actual progress while assessment retains help and scope', () => {
  const shared = resource('conversation-judgments.md');
  assert.doesNotMatch(resource('base.md'), /交接与落盘[^。\n]*未验证项/);
  assert.match(shared, /考试[^。\n]*(?:独立|限时|迁移)[^。\n]*检验/);
  assert.match(shared, /普通探索[^。\n]*掌握判词/);
  assert.match(shared, /具体[^。\n]*(?:未解决|未处理)[^。\n]*问题/);
  assert.match(shared, /没有新变化[^。\n]*复用/);
});
