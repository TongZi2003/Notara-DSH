import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordReviewContent, undoReviewContent, reviewProjection, reviewSchedule } from '../review.js';
import { parseMarkdown, patchFields } from '../frontmatter.js';
const base = '---\ntype: card\nlearned: false\ncustom: |\n  Keep exactly\n  these lines\n---\n## 学生理解\n正文不动\n';
const request = { result: 'done', support: 'independent', keyStep: '判据', note: '实况' };
const date = day => new Date(`${day}T12:00:00`);
// Historical v2 rows are replay fixtures, not new writer output.
const legacyRecord=(content,input,day)=>{const fields=parseMarkdown(content).fields;return patchFields(content,{review_history:[...(fields.review_history??[]),{...input,day,scheduleVersion:2,before:reviewSchedule(fields)}]});};
const followUp={question:'再解释关键判据',afterDays:1,reason:'保留当前续接点'};
test('a conversation proposal is recorded once, conflicts stay explicit and undo cannot resurrect it', () => {
  const input = { ...request, source: { messageId: 'native-message-1', index: 0 } };
  const content = recordReviewContent(base, input, date('2026-10-24'));
  assert.deepEqual(parseMarkdown(content).fields.review_history[0].source, input.source);
  assert.equal(recordReviewContent(content, input, date('2026-10-25')), content);
  assert.throws(() => recordReviewContent(content, { ...input, support: 'hint' }, date('2026-10-25')), /proposal_conflict/);
  const reverted = undoReviewContent(content, date('2026-10-25'));
  assert.throws(() => recordReviewContent(reverted, input, date('2026-10-25')), /proposal_reverted/);
  for (const source of [{}, { messageId: '', index: 0 }, { messageId: 'm', index: -1 }, { messageId: 'm', index: 0, extra: true }]) {
    assert.throws(() => recordReviewContent(base, { ...request, source }, date('2026-10-24')), /source_invalid/);
  }
});
test('a proposal undo cannot accidentally revert a later review', () => {
  const first = recordReviewContent(base, request, date('2026-10-24'));
  const id = parseMarkdown(first).fields.review_history[0].id;
  const second = recordReviewContent(first, request, date('2026-10-25'));
  assert.throws(() => undoReviewContent(second, date('2026-10-25'), id), /record_conflict/);
});
test('independent success only advances when due; full 1/3/7/16/35 ladder', () => {
  let content = base, day = '2026-10-24';
  for (const interval of [1, 3, 7, 16, 35, 35]) {
    content = legacyRecord(content, request, day);
    const fields = parseMarkdown(content).fields;
    assert.equal(reviewSchedule(fields).intervalDays, interval);
    assert.equal(fields.learned,false);
    assert.equal(fields.mastery,undefined);
    day = reviewProjection(fields).reviewDue;
  }
  const before = parseMarkdown(content).fields;
  for (const support of ['hint', 'explanation', 'unknown']) {
    content = legacyRecord(content, { ...request, support }, day);
    assert.equal(reviewProjection(parseMarkdown(content).fields).reviewDue, reviewProjection(before).reviewDue);
  }
  content = legacyRecord(content, { ...request, result: 'missed' }, day);
  assert.equal(reviewSchedule(parseMarkdown(content).fields).intervalDays, 1);
  assert.ok(content.includes('custom: |\n  Keep exactly\n  these lines\n'));
});
test('unchecked never schedules, missing old support is unknown without rewriting history', () => {
  const content = recordReviewContent(base, { ...request, result: 'unchecked', keyStep: '' }, date('2026-10-24'));
  assert.equal(parseMarkdown(content).fields.next_review, undefined);
  assert.equal(reviewProjection(parseMarkdown(content).fields).reviewCount, 1);
  const old = { type: 'card', review_history: [{ passed: true, note: 'old' }] };
  assert.equal(reviewProjection(old).lastSupport, 'unknown');
  assert.equal(Object.hasOwn(old.review_history[0], 'support'), false);
});
test('graph evidence counts only explicit active independent done and never fills legacy gaps', () => {
  const fields = { type: 'card', review_history: [
    { result: 'done', support: 'independent' },
    { result: 'done', support: 'hint' },
    { result: 'done' },
    { passed: true, support: 'independent' },
    { result: 'done', support: 'independent', revertedAt: '2026-10-24T00:00:00Z' },
    { result: 'missed', support: 'independent' },
    { result: 'unchecked', support: 'independent' },
  ] };
  const original = JSON.stringify(fields);
  assert.equal(reviewProjection(fields).independentReviewCount, 1);
  assert.equal(reviewProjection(fields).lastResult, 'unchecked');
  assert.equal(reviewProjection({ type: 'card', review_history: [{ passed: true }] }).lastResult, null);
  assert.equal(reviewProjection({ type: 'source' }).independentReviewCount, 0);
  assert.equal(JSON.stringify(fields), original);
});
test('undo ignores legacy schedule drift and retains original fields', () => {
  const content = recordReviewContent(base, request, date('2026-10-24'));
  const restored = parseMarkdown(undoReviewContent(content, date('2026-10-25'))).fields;
  assert.equal(restored.learned, false);
  assert.equal(Object.hasOwn(restored, 'next_review'), false);
  assert.equal(restored.review_history[0].revertedAt, date('2026-10-25').toISOString());
  const drift=content.replace('learned: false','learned: false\nmastery: 5\nnext_review: 2000-01-01');
  assert.equal(reviewProjection(parseMarkdown(undoReviewContent(drift,date('2026-10-25'))).fields).reviewDue,null);
  assert.throws(() => recordReviewContent(base.replace('type: card', 'type: source'), request, date('2026-10-24')), /card_required/);
});
test('concept, method, and exercise card types all participate in review scheduling', () => {
  for (const type of ['concept', 'method', 'exercise']) {
    const doc = base.replace('type: card', `type: ${type}`);
    const recorded = recordReviewContent(doc, {...request,followUp}, date('2026-10-24'));
    const fields = parseMarkdown(recorded).fields;
    assert.equal(fields.type, type);
    assert.equal(fields.learned, false);
    assert.equal(reviewSchedule(fields).intervalDays, 1);
    assert.equal(reviewProjection(fields).independentReviewCount, 1);
    const undone = parseMarkdown(undoReviewContent(recorded, date('2026-10-25'))).fields;
    assert.equal(undone.learned, false);
  }
});

test('A: changing learned or cache dates cannot block confirmed review or undo',()=>{
  let content=recordReviewContent(base,{...request,followUp},date('2026-10-24'));
  content=content.replace('learned: false','learned: false\nmastery: 5\ninterval: 35\nlast_review: 2001-01-01\nnext_review: 2000-01-01');
  const driftFields=parseMarkdown(content).fields;
  assert.equal(reviewProjection(driftFields).reviewDue,'2026-10-25');
  assert.equal(reviewProjection(driftFields).reviewIssue,null);
  const next=recordReviewContent(content,request,date('2026-10-25'));
  const fields=parseMarkdown(next).fields;
  assert.equal(reviewSchedule(fields).stage,null);
  for(const key of ['learned','mastery','interval','last_review','next_review'])assert.deepEqual(fields[key],driftFields[key]);
  const undone=parseMarkdown(undoReviewContent(next,date('2026-10-26'))).fields;
  assert.equal(reviewProjection(undone).reviewDue,'2026-10-25');
  assert.equal(undone.review_history.length,2);
});
test('result and assistance are independent; new failures do not claim mastery',()=>{
  for(const support of ['hint','explanation','unknown']){
    const fields=parseMarkdown(recordReviewContent(base,{...request,support},date('2026-10-24'))).fields;
    assert.equal(reviewSchedule(fields),null);assert.equal(reviewProjection(fields).independentReviewCount,0);
  }
  const failed=parseMarkdown(recordReviewContent(base,{...request,result:'missed'},date('2026-10-24'))).fields;
  assert.equal(failed.learned,false);assert.equal(failed.mastery,undefined);assert.equal(reviewSchedule(failed),null);
  const onlyRead=parseMarkdown(recordReviewContent(base,{...request,result:'unchecked',support:'explanation',keyStep:''},date('2026-10-24'))).fields;
  assert.equal(reviewSchedule(onlyRead),null);assert.equal(reviewProjection(onlyRead).lastSupport,'explanation');
});
test('history facts are replayed, absent assistance stays unknown, bad baselines remain explicit',()=>{
  const fields={type:'card',review_history:[{day:'2026-10-24',result:'done',before:{learned:false},after:{mastery:5}}, {day:'2026-10-25',result:'done',support:'independent'}]};
  const raw=JSON.stringify(fields);
  assert.equal(reviewSchedule(fields).stage,2);assert.equal(JSON.stringify(fields),raw);
  assert.equal(reviewProjection({type:'card',review_history:[{day:'2026-10-24',result:'unchecked'}]}).reviewIssue,'review_history_invalid');
  assert.equal(reviewProjection({type:'card',review_history:[{day:'2026-10-24',result:'unchecked',before:{learned:true}}]}).reviewIssue,'review_history_invalid');
  const saved=recordReviewContent(base,request,date('2026-10-24'));
  const history=parseMarkdown(saved).fields.review_history;history[0].baseline={stage:99};
  const broken=patchFields(saved,{review_history:history});
  assert.equal(reviewProjection(parseMarkdown(broken).fields).reviewIssue,'review_history_invalid');
  const reverted=parseMarkdown(undoReviewContent(broken,date('2026-10-25'))).fields;
  assert.ok(reverted.review_history[0].revertedAt);assert.equal(reviewProjection(reverted).reviewIssue,'review_history_invalid');
});
