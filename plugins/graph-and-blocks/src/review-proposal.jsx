import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { bindVaultRemote, workspaceForSession, subscribeWorkspace, subscribeVaultChanges, vaultChangeIncludes, notifyVaultChanged } from '@oh-my-student/plugin-vault-sqlite/workspace-client';
import { parseMarkdown } from '@oh-my-student/plugin-vault-sqlite/frontmatter';
import { answerStore } from './answer-store.js';
import {REVIEW_SUPPORT_LABELS as supports,isReviewDocument} from '@oh-my-student/plugin-vault-sqlite/review-contract';

import {reviewPlans} from '@oh-my-student/plugin-vault-sqlite/review-schedule';

const results = { done: '这次走通了', missed: '仍有卡点', unchecked: '尚未检验' };
const studentNote = text => String(text).replace(/\bsupport\s*(?:建议\s*)?(?:[:：=]\s*)?(independent|hint|explanation|unknown)\b/g, (_, value) => `帮助情况建议：${supports[value]}`);
const noop = () => () => {};
async function call(remote, method, input) {
  const reply = await remote[method](input);
  if (!reply?.ok) throw new Error(reply?.error?.message || 'review_unavailable');
  return reply.value;
}

/** Only an explicit student confirmation writes the existing card history. */
export function ReviewProposal({ component, context, renderText }) {
  const { ctx, sessionId, messageId, settled } = context ?? {};
  const spec = component.spec;
  const workspaceId = useSyncExternalStore(ctx ? fn => subscribeWorkspace(ctx, fn) : noop, () => ctx ? workspaceForSession(ctx, sessionId) : null, () => null);
  const remote = useMemo(() => ctx ? bindVaultRemote(ctx.remote.notaraVault, workspaceId) : null, [ctx, workspaceId]);
  const source = useMemo(() => messageId ? { messageId, index: component.index } : null, [messageId, component.index]);
  const key = JSON.stringify(['review', workspaceId, sessionId, messageId, component.index, component.fingerprint]);
  const draft = useSyncExternalStore(fn => answerStore.subscribe(key, fn), () => answerStore.get(key), () => null);
  const form = draft ?? { support: '', result: spec.result, note: studentNote(spec.note), keyStep: spec.keyStep, expanded: false };
  const keyStep = form.keyStep ?? spec.keyStep;
  const update = patch => answerStore.set(key, { ...form, ...patch });
  const [loaded, setDocument] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [version, refresh] = useState(0), [receipt, setReceipt] = useState(null);
  const document = loaded?.workspaceId === workspaceId ? loaded : null;
  const acknowledged = receipt?.workspaceId === workspaceId ? receipt.status : null;
  const lock = useRef(false);
  const load = async () => {
    const doc = await call(remote, 'read', { path: spec.targetPath }), fields = parseMarkdown(doc.content).fields;
    if (!isReviewDocument(fields.type,spec.targetPath) || fields.review_history !== undefined && !Array.isArray(fields.review_history)) throw new Error('review_card_required');
    let plans=[];try{plans=reviewPlans(fields);}catch{}
    return { ...doc, workspaceId, history: fields.review_history ?? [],plans };
  };
  useEffect(() => {
    let active = true; setDocument(null); setError('');
    if (remote && workspaceId !== null && source && settled) load().then(doc => { if (active) { setDocument(doc); setReceipt(null); } }).catch(() => { if (active) setError('暂时无法读取最新记录，请重试。'); });
    return () => { active = false; };
  }, [remote, spec.targetPath, source, settled, version]);
  useEffect(() => {
    return subscribeVaultChanges(remote, change => { if (vaultChangeIncludes(change, spec.targetPath)) refresh(n => n + 1); }, workspaceId);
  }, [remote, workspaceId, spec.targetPath]);
  const record = document?.history.find(row => row.source?.messageId === source?.messageId && row.source?.index === source?.index);
  const currentPlan=document?.plans.find(plan=>plan.heading===(spec.heading??''));
  const latest = document?.history.findLast(row => !row.revertedAt);
  const saved = acknowledged === 'saved' || Boolean(record && !record.revertedAt);
  const status = busy ? '保存中…' : record?.revertedAt || acknowledged === 'reverted' ? '已撤销' : saved ? '已记录' : error ? '待核对' : '待确认';
  const mutate = async undo => {
    if (lock.current || !document || !source || !settled || !undo && (!form.support || record || acknowledged || form.result !== 'unchecked' && !keyStep.trim())) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const saved = await call(remote, undo ? 'undoReview' : 'recordReview', { path: spec.targetPath, expectedRevision: document.revision,
        ...(undo ? { expectedRecordId: record.id } : { source, keyStep, result: form.result, support: form.support, note: studentNote(form.note),...spec.heading?{heading:spec.heading}:{},...Object.hasOwn(spec,'followUp')?{followUp:spec.followUp}:{} }) });
      setReceipt({ workspaceId, status: undo ? 'reverted' : 'saved' });
      // Publish the successful write independently of the subsequent read.
      // The listener restores state from the card, replacing this short ack.
      notifyVaultChanged(remote, {path:spec.targetPath,revision:saved.revision}, workspaceId);
    } catch (cause) {
      if(/review_history_invalid|review_date_invalid|review_baseline_unavailable/.test(cause.message)){setError('已有复习记录的日期、结果或排期依据不完整，请先核对原记录；本次填写仍保留。');}
      else if (/revision_conflict|proposal_conflict|record_conflict|proposal_reverted/.test(cause.message)) { setError('记录已发生变化，请刷新后核对；本次填写仍保留。'); }
      else setError(undo ? '暂未收到撤销确认，请刷新记录后重试。' : '暂未收到保存确认，请重试；本次填写仍保留。');
    } finally { lock.current = false; setBusy(false); }
  };
  return <details className="nv-review-proposal" open={form.expanded} onToggle={event => { if (event.currentTarget.open !== form.expanded) update({ expanded: event.currentTarget.open }); }}>
    <summary><span>学习记录 · {spec.targetPath.split('/').at(-1).replace(/\.md$/i, '')}</span><span className="nv-review-status" role="status">{status}</span></summary>
    <div className="nv-review-body">
      <div className="nv-review-step">{renderText(spec.keyStep || '本次学习笔记')}</div>
      {record ? <><p>{results[record.result]} · {supports[record.support]??supports.unknown}</p><p>{renderText(studentNote(record.note))}</p></> : <>
        {!spec.keyStep.trim() && <label className="nv-review-note">本次检验的关键步<input value={keyStep} maxLength={200} disabled={busy || saved} onChange={event => update({ keyStep: event.target.value })} placeholder="写下这次具体检验了哪一步" /></label>}
        <fieldset disabled={busy || saved}><legend>这次的结果</legend><div className="nv-review-options">{Object.entries(results).map(([value, label]) => <button type="button" key={value} aria-pressed={form.result === value} onClick={() => update({ result: value })}>{label}</button>)}</div></fieldset>
        <fieldset disabled={busy || saved}><legend>完成时获得了哪些帮助？</legend><div className="nv-review-options">{Object.entries(supports).map(([value, label]) => <button type="button" key={value} aria-pressed={form.support === value} onClick={() => update({ support: value })}>{label}</button>)}</div><p className="nv-review-hint">老师建议：{supports[spec.support]}。请按实际情况选择。</p></fieldset>
        <label className="nv-review-note">实况备注<textarea value={studentNote(form.note)} rows={2} disabled={busy || saved} onChange={event => update({ note: event.target.value })} /></label>
      </>}
      {!record&&spec.followUp&&<p>{spec.followUp.afterDays} 天后：{renderText(spec.followUp.question)}</p>}
      {!record&&spec.followUp===null&&<p>确认后取消这项续接安排。</p>}
      {record&&currentPlan?.question&&<p>{currentPlan.nextReview}：{renderText(currentPlan.question)}</p>}
      {error && <p role="alert">{error} <button type="button" disabled={busy} onClick={() => refresh(n => n + 1)}>刷新记录</button></p>}
      {!context && <p className="nv-review-hint">请在原课堂中确认这次学习记录。</p>}
      {context && !settled && <p className="nv-review-hint">回复完成后即可确认。</p>}
      <div className="nv-review-footer">{record ? !record.revertedAt && <button type="button" disabled={busy || latest?.id !== record.id} title={latest?.id !== record.id ? '已有更新的复习记录，请到资料库查看' : undefined} onClick={() => mutate(true)}>撤销这次记录</button> : <button className="nv-block-primary" type="button" disabled={busy || Boolean(acknowledged) || !document || !form.support || !form.note.trim() || !settled || form.result !== 'unchecked' && !keyStep.trim()} onClick={() => mutate(false)}>{saved ? '已记录' : '确认记录'}</button>}</div>
    </div>
  </details>;
}
