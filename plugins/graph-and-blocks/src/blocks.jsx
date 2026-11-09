import {useSuccessFeedback} from './success-feedback.jsx';
import React, { useMemo, useState, useSyncExternalStore } from 'react';
import { BOARD_COMPONENTS, splitBoardBody, readComponent, validateBoardAnswer, boardAnswerMessage } from './domain/board-components.js';
import { renderMath } from './domain/math-latex.js';
import { layoutFlow } from './domain/board-flow.js';
import { answerStore, answerKey } from './answer-store.js';
import { Figure } from './figure.jsx';
import { ReviewProposal } from './review-proposal.jsx';
import {studentMarkdown} from './domain/student-markdown.js';
import {figureStateKey} from './domain/figure-state.js';
import {fromMarkdown} from 'mdast-util-from-markdown';
import {math} from 'micromark-extension-math';
import {mathFromMarkdown} from 'mdast-util-math';
import {notaraParseMath} from './domain/markdown-math.js';
export {studentMarkdown} from './domain/student-markdown.js';
export {createAnswerStore} from './answer-store.js';

export const BLOCK_TYPES = Object.freeze(Object.keys(BOARD_COMPONENTS));

/** Hide teacher-only sections on student reading surfaces; source is left intact. */

export function LearningText({ text = '' }) {
  const source=String(text);
  const tree=useMemo(()=>notaraParseMath(fromMarkdown,source,{mdastExtensions:[mathFromMarkdown()]},math()),[source]);
  const walk=(node,key)=>{
    if(node.type==='math'||node.type==='inlineMath'){
      const html=renderMath(node.value,node.type==='math');
      return html?<span key={key} dangerouslySetInnerHTML={{__html:html}}/>:source.slice(node.position.start.offset,node.position.end.offset);
    }
    if(node.type==='code'||node.type==='inlineCode')return <code key={key}>{node.value}</code>;
    const children=node.children?.map((child,index)=>walk(child,`${key}-${index}`));
    if(node.type==='strong')return <strong key={key}>{children}</strong>;
    if(node.type==='emphasis')return <em key={key}>{children}</em>;
    if(node.type==='break')return <br key={key}/>;
    return <React.Fragment key={key}>{children??node.value??node.alt??''}{['paragraph','heading','listItem','blockquote'].includes(node.type)?'\n':null}</React.Fragment>;
  };
  return <span className="nv-block-prose">{tree.children.map(walk)}</span>;
}

const initialDraft = c => ({ fills: {}, order: (c.spec.items ?? []).map((_, i) => i), categories: {}, frame: 0, predictions: {}, unlocked: {}, text: '', note: '', other: false, unsure: false, values: Object.fromEntries((c.spec.params ?? []).map(p => [p.name, p.value])), point: null, step: null });

function HtmlContent({ spec, draft, update }) {
  // Parse only the already-sanitized markup into controlled React elements.
  const tree = useMemo(() => {
    if (typeof DOMParser === 'undefined') return null;
    return new DOMParser().parseFromString(spec.html, 'text/html').body;
  }, [spec.html]);
  if (!tree) return <p>互动内容正在准备…</p>;
  const firstStep = tree.querySelector('[data-step]')?.getAttribute('data-step');
  const activeStep = draft.step ?? firstStep;
  const walk = (node, key) => {
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1) return null;
    const attrs = { key }, tag = node.tagName.toLowerCase();
    const panel = node.getAttribute('data-panel'), step = node.getAttribute('data-step');
    if (panel !== null && panel !== activeStep) return null;
    for (const a of node.attributes) {
      if (/^on/i.test(a.name) || ['value', 'checked', 'style', 'class', 'tabindex', 'for'].includes(a.name)) continue;
      attrs[a.name === 'viewbox' ? 'viewBox' : a.name] = a.value;
    }
    attrs.className = node.getAttribute('class') ?? undefined;
    if (node.hasAttribute('style')) attrs.style = Object.fromEntries([...node.style].map(name => [name.startsWith('--') ? name : name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), node.style.getPropertyValue(name)]));
    if (node.hasAttribute('for')) attrs.htmlFor = node.getAttribute('for');
    if (step !== null) { attrs['aria-pressed'] = step === activeStep; attrs.onClick = () => update({ step }); }
    if (tag === 'button' && step === null && !node.hasAttribute('data-source') && !node.hasAttribute('data-ask')) return <span key={key}>{[...node.childNodes].map((child, index) => walk(child, `${key}-${index}`))}</span>;
    if (['input', 'br', 'hr', 'wbr', 'col'].includes(tag)) return React.createElement(tag, attrs);
    return React.createElement(tag, attrs, [...node.childNodes].map((child, index) => walk(child, `${key}-${index}`)));
  };
  return <div className="nv-block-html">{[...tree.childNodes].map((node, i) => walk(node, String(i)))}</div>;
}

function Flow({ spec, fills, onChange }) {
  const layout = useMemo(() => layoutFlow(spec), [spec]);
  return <div className="nv-block-flow"><svg viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-label="流程关系图">{layout.edges.map((edge, i) => <path key={i} d={edge.d ?? edge.path} fill="none" className={edge.dashed ? 'nv-block-edge-dashed' : ''} />)}{layout.nodes.map(n => <g key={n.id}><rect x={n.x} y={n.y} width={n.w} height={n.h} rx={n.shape === 'question' ? 20 : 4} />{n.lines.map((line, i) => <text key={i} x={n.x + n.w / 2} y={n.y + n.h / 2 + i * 20} textAnchor="middle">{n.blank ? fills[n.id] || '待补全' : line}</text>)}</g>)}</svg>{spec.nodes.filter(n => n.blank).map(n => <label key={n.id}>补全步骤 {n.id}<input aria-label={`补全步骤 ${n.id}`} value={fills[n.id] ?? ''} maxLength={200} onChange={e => onChange({ ...fills, [n.id]: e.target.value })} /></label>)}</div>;
}

export function InteractiveBlock({ component, scope, nodeId = '', blockId, store = answerStore, onSubmit, preview = false, reviewContext,figureState,onFigureState }) {
  if (component.type === 'notara-review') return component.error ? <p role="status">这条学习记录的信息不完整，暂时无法确认。</p> : <ReviewProposal key={`${component.index}:${component.fingerprint}:${reviewContext?.messageId ?? ''}`} component={component} context={reviewContext} renderText={text => <LearningText text={text} />} />;
  if (component.error) return <p className="nv-block-error" role="status">这道互动题暂时无法显示，请老师调整内容。</p>;
  return <ValidBlock key={`${component.index}:${component.fingerprint}`} {...{ component, scope, nodeId, blockId, store, onSubmit, preview,figureState,onFigureState }} />;
}

function ValidBlock({ component: c, scope, nodeId, blockId, store, onSubmit, preview,figureState,onFigureState }) {
  const [successToast,showSuccess,clearSuccess]=useSuccessFeedback();
  const key = answerKey({ scope, nodeId, blockId: blockId ?? c.index, fingerprint: c.fingerprint });
  const saved = useSyncExternalStore(fn => store.subscribe(key, fn), () => store.get(key), () => null);
  const fallback = useMemo(() => initialDraft(c), [c.fingerprint]), draft = saved ?? fallback;
  const [busy, setBusy] = useState(false), [status, setStatus] = useState(''), [noteOpen, setNoteOpen] = useState(false);
  const update = patch => { store.set(key, { ...draft, ...patch }); setStatus(''); };
  const spec = c.spec;
  const currentFrame = Math.min(draft.frame, spec.frames?.length - 1 || 0);
  // Earliest unfulfilled prediction always wins, including direct navigation to later frames.
  const lockedFrame = c.type === 'frames' ? spec.frames.findIndex((f, i) => i <= currentFrame && f.predict && !draft.unlocked[i]) : -1;
  const submit = async (override) => {
    if (busy) return;
    clearSuccess();
    let value, handingOff = false;
    try {
      if (c.type === 'frames') value = { frame: lockedFrame >= 0 ? lockedFrame : currentFrame, ...(draft.unsure ? { unsure: true, note: draft.note } : { text: draft.text }) };
      else if (draft.unsure) value = { unsure: true, note: draft.note };
      else if (draft.other) value = { other: draft.note };
      else if (c.type === 'flow') value = { fills: draft.fills };
      else if (c.type === 'order') value = spec.groups ? { groups: spec.groups.map((_, i) => spec.items.map((_, j) => j).filter(j => draft.categories[j] === i)) } : { order: draft.order };
      else if (c.type === 'figure') value = spec.ask?.kind === 'param' ? { value: draft.values[spec.ask.target], note: draft.note } : { point: draft.point, note: draft.note };
      value = validateBoardAnswer(c, override ?? value);
      let message = boardAnswerMessage({ blockTitle: '', component: c, answer: value });
      if (draft.note.trim() && !message.includes(draft.note.trim())) message += `\n补充想法：${draft.note.trim()}`;
      if (!onSubmit && !preview) { setStatus('请先打开课堂，再把作答交给老师。'); return; }
      setBusy(true); setStatus('');
      handingOff = true;
      if (!preview) await onSubmit({ text: message, answer: value, component: c, nodeId });
      // Handoff accepted; no correctness/mastery claim and no auto-send.
      if (c.type === 'frames') store.set(key, { ...draft, unlocked: { ...draft.unlocked, [value.frame]: true }, predictions: { ...draft.predictions, [value.frame]: value }, text: '', unsure: false });
      showSuccess(preview ? '试用完成，未发送或保存作答。' : '已放入对话草稿，请确认后发送。');
    } catch (error) {
      const reason = error?.message;
      if (!handingOff) {
        if (c.type === 'frames' && reason === 'board_answer_empty') setStatus('请先写下预测，或勾选“不确定”。');
        else setStatus('请填写作答，或勾选“不确定”后再提交。');
      } else {
        const messages = {
          '课堂不可用': '请先打开一个可继续的课堂。',
          '课堂已切换': '课堂已切换，请回到这张卡片所属的课堂再提交。',
          '这份子任务记录不支持继续作答，请打开可继续的专题课堂': '这份子任务记录不支持继续作答，请打开可继续的专题课堂。',
          '课堂暂时不可输入': '对话暂时不能输入，请稍后重试；作答内容已保留。',
          '草稿已变化': '对话草稿刚刚发生变化，请重试；作答内容已保留。',
        };
        setStatus(messages[reason] || '作答未放入对话草稿，请稍后重试；已填写内容会保留。');
      }
    }
    finally { setBusy(false); }
  };
  let body;
  if (c.type === 'order') body = <><LearningText text={spec.stem} /><ol>{draft.order.map((n, i) => <li key={n}><LearningText text={spec.items[n]} />{spec.groups ? <select aria-label={`归类：${spec.items[n]}`} value={draft.categories[n] ?? ''} onChange={e => update({ categories: { ...draft.categories, [n]: Number(e.target.value) } })}><option value="" disabled>选择组别</option>{spec.groups.map((g, j) => <option key={j} value={j}>{g}</option>)}</select> : <span><button type="button" aria-label={`上移：${spec.items[n]}`} disabled={i === 0} onClick={() => { const order = [...draft.order]; [order[i - 1], order[i]] = [order[i], order[i - 1]]; update({ order }); }}>↑</button><button type="button" aria-label={`下移：${spec.items[n]}`} disabled={i === draft.order.length - 1} onClick={() => { const order = [...draft.order]; [order[i + 1], order[i]] = [order[i], order[i + 1]]; update({ order }); }}>↓</button></span>}</li>)}</ol></>;
  else if (c.type === 'frames') body = <div className="nv-block-frames"><LearningText text={spec.title ?? '逐帧推演'} /><p>第 {currentFrame + 1} / {spec.frames.length} 帧</p>{lockedFrame >= 0 ? <div><LearningText text={spec.frames[lockedFrame].predictionPrompt ?? '先预测下一步会发生什么。'} /><textarea aria-label="我的预测" value={draft.text} maxLength={2000} onChange={e => update({ text: e.target.value })} /></div> : <div><strong><LearningText text={spec.frames[currentFrame].caption} /></strong><LearningText text={studentMarkdown(spec.frames[currentFrame].body)} /></div>}<div className="nv-block-toolbar"><button type="button" disabled={!currentFrame} onClick={() => update({ frame: currentFrame - 1 })}>上一帧</button><button type="button" disabled={lockedFrame >= 0 || currentFrame >= spec.frames.length - 1} onClick={() => update({ frame: currentFrame + 1 })}>下一帧</button></div></div>;
  else if (c.type === 'flow') body = <Flow spec={spec} fills={draft.fills} onChange={fills => update({ fills })} />;
  else if (c.type === 'figure') {const persisted=!spec.ask&&onFigureState,geometry=persisted?figureState?.[figureStateKey(c)]??{}:{};body = <><LearningText text={spec.ask?.prompt ?? ''} /><Figure spec={spec} fingerprint={c.fingerprint} values={persisted?{...fallback.values,...geometry.values}:draft.values} onValues={values => update({ values })} drags={geometry.drags} camera={geometry.camera} onExplore={persisted?patch=>onFigureState(figureStateKey(c),patch):undefined} point={draft.point} onPoint={spec.ask ? point => update({ point }) : null} /></>;}
  else if (c.type === 'html') body = <HtmlContent spec={spec} draft={draft} update={update} />;
  const canAnswer = c.answerable && (c.type !== 'frames' || lockedFrame >= 0);
  return <section className={`nv-block-card nv-block-${c.type}`} aria-label={BOARD_COMPONENTS[c.type].title}>{successToast}{body}{canAnswer && <div className="nv-block-actions"><label><input type="checkbox" checked={draft.unsure} onChange={e => update({ unsure: e.target.checked, other: false })} />不确定</label>{c.type !== 'frames' && <label><input type="checkbox" checked={draft.other} onChange={e => { update({ other: e.target.checked, unsure: false }); if (e.target.checked) setNoteOpen(true); }} />有别的想法</label>}<button type="button" className="nv-block-note-toggle" aria-expanded={noteOpen} onClick={() => setNoteOpen(!noteOpen)}>{noteOpen ? '收起补充' : '补充想法'}</button><button type="button" className="nv-block-primary" disabled={busy} onClick={() => submit()}>{busy ? '处理中…' : preview ? '试用' : '交给老师'}</button>{(noteOpen) && <textarea aria-label="补充想法" placeholder="可以补充你的判断理由" value={draft.note} maxLength={2000} onChange={e => update({ note: e.target.value })} />}</div>}{status && <p role="status">{status}</p>}</section>;
}

/** Reusable by a Canvas text node: same nodeId + block index + scope shares drafts. */
export function InteractiveBlocks({ source = '', scope = 'preview', nodeId = '', componentOffset = 0, store, onSubmit, renderMarkdown, preview = false, reviewContext,figureState,onFigureState }) {
  const parsed = useMemo(() => splitBoardBody(studentMarkdown(source.slice(0, 120000))), [source]);
  return <div className="nv-block-content" data-preview={preview || undefined}>{parsed.segments.map((segment, index) => segment.kind === 'component' ? <InteractiveBlock key={index} component={readComponent({ ...segment, index: segment.index + componentOffset })} {...{ scope, nodeId, store, onSubmit, preview, reviewContext,figureState,onFigureState }} /> : segment.kind === 'retired' ? <pre key={index} className="nv-retired-component"><code>{segment.text}</code></pre> : <div key={index}>{renderMarkdown ? renderMarkdown(segment.text) : <LearningText text={segment.text} />}</div>)}{parsed.open && <p role="status">{parsed.open.type === 'notara-review' ? '学习记录正在整理…' : '互动题正在整理…'}</p>}</div>;
}

export default InteractiveBlocks;
