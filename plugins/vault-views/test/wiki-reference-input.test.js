import test from 'node:test';
import assert from 'node:assert/strict';
import { wikiReferenceEdits, registerWikiReferenceInput } from '../src/wiki-reference-input.js';

test('pasted wiki references preserve exact source and use native detect-coordinate spans', () => {
  const existing = '[[旧资料.md|旧资料]]', token = '[[session:class-1|均值不等式]]';
  const state = { phase: 'plain', draftRev: 7, draft: existing + ' 接着 ' + token + '\n`[[代码.md]]`\n```md\n[[示例.md]]\n```\n[[笔记.md|笔记]]',
    occurrences: [{ offset: 0, length: existing.length }] };
  const edits = wikiReferenceEdits(state);
  assert.equal(edits.length, 2);
  assert.deepEqual(edits[0].span, { start: 5, end: 5 + token.length, draftRev: 7 });
  assert.equal(edits[0].reference.clipboardText, token);
  assert.equal(edits[0].reference.label, '均值不等式');
  assert.equal(edits[0].reference.appearance, 'session');
  assert.equal(edits[1].reference.label, '笔记');
  assert.deepEqual(wikiReferenceEdits({ ...state, phase: 'submitting' }), []);
  assert.deepEqual(wikiReferenceEdits({ phase: 'plain', draftRev: 1, draft: '\\[[例子]] [[session:../bad|坏引用]] [[未完成', occurrences: [] }), []);
});

test('wiki chip codec preserves semantics rather than injecting another session history', async () => {
  let source;
  const events = new EventTarget();
  const stop = registerWikiReferenceInput({ inputTriggers: { registerSource(value) { source = value; return () => { source = null; }; } } }, events);
  const token = '[[session:class-1|原课堂]]';
  assert.equal(source.codec.clipboardText(token), token);
  assert.equal(await source.codec.serialize(token), token);
  await assert.rejects(() => source.codec.serialize('[[session:../bad|坏引用]]'));
  stop(); assert.equal(source, null);
});
