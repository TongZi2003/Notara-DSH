import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resource, resourceProvenance } from '../resources.js';
import { ROLES } from '../catalog.js';

// Omission and packaging guards; actual clarification and correction behavior
// must be checked separately against native tools and real model conversations.
test('home and teacher share one complete conversation-judgment source without exposing it to blind workers', async () => {
  const shared = resource('conversation-judgments.md');
  assert.equal(shared, await readFile(new URL('../../../prompts/conversation-judgments.md', import.meta.url), 'utf8'));
  assert.equal(resourceProvenance.origins['conversation-judgments.md'], 'prompts/conversation-judgments.md');
  for (const role of ROLES) {
    assert.equal(role.prompt.split(shared.trim()).length - 1, ['coordinator', 'teacher'].includes(role.kind) ? 1 : 0, role.id);
  }
});

test('clarification narrows an ambiguous task progressively and does not turn guesses into learner facts', () => {
  const shared = resource('conversation-judgments.md');
  for (const pattern of [/模糊|模棱两可/, /几个[^。\n]*问题/, /范围/, /具体[^。\n]*(?:步骤|例子|题目)/,
    /足够[^。\n]*(?:停止|行动|推进)/, /已[^。\n]*明确[^。\n]*不[^。\n]*重复/, /先[^。\n]*尝试[^。\n]*再[^。\n]*看/,
    /学生[^。\n]*澄清/, /未确认[^。\n]*不[^。\n]*(?:画像|事实)/, /能力[^。\n]*作答/]) {
    assert.match(shared, pattern);
  }
});

test('delivery review returns concrete corrections to the existing class and distinguishes uncertain student interpretations', async () => {
  const load = path => readFile(new URL(`../../../prompts/${path}`, import.meta.url), 'utf8');
  const [home, teacher, contract, tutor] = await Promise.all(['coordinator.md', 'base.md', 'skills/quest-orchestrator.md', 'skills/quest-tutor.md'].map(load));
  assert.match(home, /关键结论[^。\n]*核对|核对[^。\n]*关键结论/);
  assert.match(contract, /原题[^。\n]*学生[^。\n]*作答/);
  assert.match(contract, /send_message[^。\n]*原[^。\n]*会话/);
  assert.match(contract, /worker-review/);
  assert.match(contract, /不[^。\n]*每[^。\n]*(?:全稿|审核|核验)/);
  assert.match(contract, /投递[^。\n]*不[^。\n]*(?:纠正|补充)[^。\n]*完成/);
  for (const body of [teacher, tutor]) {
    assert.match(body, /纠错[^。\n]*补充|补充[^。\n]*纠错/);
    assert.match(body, /老师[^。\n]*(?:口误|错误)[^。\n]*不[^。\n]*学生/);
  }
  assert.match(contract, /修订[^。\n]*deliver/);
});
