import test from 'node:test';
import assert from 'node:assert/strict';
import { resource } from '../resources.js';
import { ROLES } from '../catalog.js';
import { projectLessonPlan } from '../../vault-sqlite/lesson-plan.js';

// Prompt-contract omission guards, not evidence of real-model adherence.
test('preparation keeps peer questions optional, hidden and separate from actual classroom events', () => {
  const prep = resource('role-skills/teacher/notara-lesson-preparation/SKILL.md');
  assert.match(prep, /可选的同学问题/);
  assert.match(prep, /教师参考/);
  assert.match(prep, /学生[^。\n]*邀请/);
  assert.match(prep, /仅供参考/);
  assert.doesNotMatch(prep, /主老师在实际课堂中决定是否邀请/);
  assert.match(prep, /不[^。\n]*每个单元/);
  assert.match(prep, /纯备课[^。\n]*不[^。\n]*调用[^。\n]*同学/);
  assert.match(prep, /不[^。\n]*(?:虚构|预写)[^。\n]*学生回答/);
});

test('students own invitations while teachers hand off background and leave exploration to the peer', () => {
  const teacher = resource('base.md');
  assert.match(teacher, /学生主动邀请/);
  assert.match(teacher, /未[^。\n]*邀请[^。\n]*不[^。\n]*调用/);
  assert.doesNotMatch(teacher, /主老师判断邀请时机/);
  assert.match(teacher, /已有[^。\n]*同学会话[^。\n]*send_message/);
  assert.match(teacher, /给过[^。\n]*帮助/);
  assert.match(teacher, /不[^。\n]*预定结论/);
  assert.match(teacher, /可选问题[^。\n]*参考/);
  assert.match(teacher, /问完[^。\n]*学生接话/);
  assert.match(teacher, /创建回执[^。\n]*不[^。\n]*学生回答/);
});

test('optional peer questions in teacher reference do not become required lesson checklist items', () => {
  const plan = projectLessonPlan({ path: '备课/向量.md', revision: 'fixture', content: [
    '---', 'type: lesson', '---', '# 向量相加',
    '- [ ] 画出两个向量相加的结果',
    '<details data-notara="teacher">', '<summary>教师参考</summary>', '',
    '可选的同学问题：学生主动邀请同学后，可以参考这个角度：',
    '- [ ] 换一个顺序，结果还一样吗？',
    '问题仅供参考，同学可以独立选择角度；问完留给学生接话。', '', '</details>',
  ].join('\n') });
  assert.deepEqual(plan.tasks.map(task => task.content), ['画出两个向量相加的结果']);
  assert.deepEqual(plan.counts, { total: 1, completed: 0, inProgress: 0, pending: 1 });
});

for (const id of ['deepseek', 'claude', 'gemini', 'gpt']) {
  test(`${id} can ask one peer question without its usual explanatory style answering it first`, () => {
    const body = resource(`companions/${id}.md`);
    assert.equal(ROLES.find(role => role.id === `companion-${id}`).prompt, body);
    assert.match(body, /学生邀请[^。\n]*(?:提问|讨论)/);
    assert.match(body, /独立[^。\n]*(?:提问|提出|探索)/);
    assert.match(body, /可选问题[^。\n]*参考/);
    assert.match(body, /一个[^。\n]*问题/);
    assert.match(body, /不[^。\n]*自问自答/);
    assert.match(body, /等待[^。\n]*学生接话/);
    assert.match(body, /学生[^。\n]*(?:拒绝|不想)/);
    assert.match(body, /同学[^。\n]*(?:问题|想法)[^。\n]*不[^。\n]*学生[^。\n]*(?:作答|认识|证据)/);
  });
}
