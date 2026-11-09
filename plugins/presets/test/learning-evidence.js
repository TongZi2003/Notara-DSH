import assert from 'node:assert/strict';
import { projectLessonPlan } from '@oh-my-student/plugin-vault-sqlite/lesson-plan';
import { stripTaskAnchor } from '@oh-my-student/plugin-vault-sqlite/markdown-projection';

function withoutHostTaskAnchors(content) {
  const lines = content.split('\n');
  for (const task of projectLessonPlan({ path: '备课.md', content }).tasks) {
    const index = task.line - 1;
    if (/<!--\s*notara-task:/.test(lines[index])) lines[index] = stripTaskAnchor(lines[index]).content;
  }
  return lines.join('\n');
}
export function lessonReadbackMatches(before, after) {
  if (typeof before !== 'string' || typeof after !== 'string') return false;
  return withoutHostTaskAnchors(before) === withoutHostTaskAnchors(after);
}

// A deliberate fixture-only command denial is an observed restriction, not a
// successful script check and not an executed out-of-scope operation.
export function expectedProbeDenial(name, message) {
  return name === 'bash' && message?.isError === true && message.content?.some(block => block.type === 'text'
    && block.text.includes('此隔离验收只允许读写当前学习集；内置教学资源只读，外部路径和命令执行不可用。')) === true;
}

export function groundSemanticEvidence(verdict, evidence, expectedIds) {
  assert.ok(Array.isArray(verdict?.criteria));
  assert.deepEqual(verdict.criteria.map(row => row.id).sort(), [...expectedIds].sort());
  return { criteria: verdict.criteria.map(row => {
    assert.ok(['PASS', 'FAIL'].includes(row.status));
    assert.ok(typeof row.reason === 'string' && row.reason.trim());
    assert.ok(Array.isArray(row.evidence) && row.evidence.length);
    return { ...row, evidence: row.evidence.map(cite => {
      assert.ok(Object.hasOwn(evidence, cite.artifact));
      const lines = evidence[cite.artifact].split('\n');
      assert.ok(Number.isSafeInteger(cite.from) && Number.isSafeInteger(cite.to)
        && cite.from >= 1 && cite.to >= cite.from && cite.to <= lines.length);
      const quote = lines.slice(cite.from - 1, cite.to).join('\n');
      assert.ok(quote.trim());
      return { artifact: cite.artifact, from: cite.from, to: cite.to, quote };
    }) };
  }) };
}
