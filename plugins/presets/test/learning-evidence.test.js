import test from 'node:test';
import assert from 'node:assert/strict';
import { lessonReadbackMatches, expectedProbeDenial, groundSemanticEvidence } from './learning-evidence.js';

const lesson = '---\ntype: lesson\n---\n# 本课\n- [ ] 证明最小值。\n\n```md\n- [ ] 示例 <!-- notara-task:example -->\n```\n\n<details data-notara="teacher">\n<summary>教师参考</summary>\n答案为2。\n</details>\n';
test('lesson readback accepts only host anchors on real public tasks', () => {
  const bound = lesson.replace('证明最小值。', '证明最小值。 <!-- notara-task:lt-123abc -->');
  assert.equal(lessonReadbackMatches(lesson, bound), true);
  assert.equal(lessonReadbackMatches(lesson, bound.replace('答案为2', '答案为3')), false);
  assert.equal(lessonReadbackMatches(lesson, bound.replace('notara-task:example', 'notara-task:other')), false);
  assert.equal(lessonReadbackMatches(lesson, bound.replace('- [ ] 证明', '- [x] 证明')), false);
});

test('a blocked script is recorded as denied, never as an executed safe script', () => {
  const result = { isError: true, content: [{ type: 'text', text: 'Error: 此隔离验收只允许读写当前学习集；内置教学资源只读，外部路径和命令执行不可用。' }] };
  assert.equal(expectedProbeDenial('bash', result), true);
  assert.equal(expectedProbeDenial('write', result), false);
  assert.equal(expectedProbeDenial('bash', { ...result, isError: false }), false);
  assert.equal(expectedProbeDenial('bash', { isError: true, content: [{ type: 'text', text: 'Other error' }] }), false);
});

test('semantic evaluation references actual numbered lines instead of reconstructing quotes', () => {
  const evidence = { draft: '第一行\n实际回读了修订稿\n末行' };
  const row = { id: 'review', status: 'PASS', reason: '修订稿有真实回读证据。', evidence: [{ artifact: 'draft', from: 2, to: 2 }] };
  const result = groundSemanticEvidence({ criteria: [row] }, evidence, ['review']);
  assert.equal(result.criteria[0].evidence[0].quote, '实际回读了修订稿');
  for (const bad of [{ artifact: 'draft', from: 0, to: 2 }, { artifact: 'draft', from: 2, to: 4 }, { artifact: 'missing', from: 1, to: 1 }]) {
    assert.throws(() => groundSemanticEvidence({ criteria: [{ ...row, evidence: [bad] }] }, evidence, ['review']));
  }
  assert.throws(() => groundSemanticEvidence({ criteria: [row, row] }, evidence, ['review']));
});
