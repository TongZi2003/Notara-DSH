import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { callVault, createViewState, reviewInput, SUPPORT_LABELS } from './logic.js';
import { BaseWorkspace } from './base-workspace.jsx';
import { MarkdownBody, MarkdownReader } from './markdown.jsx';
import { PdfReader } from './pdf-reader.jsx';
import { SearchField } from './search.jsx';
import { SimpleSearchDialog } from './search-dialog.jsx';
import { EditableMarkdown } from './markdown-editor.jsx';
import {FileToolbar} from './file-toolbar.jsx';
import { markdownGeneration } from './markdown-drafts.js';
import { CanvasEditor } from './canvas-editor.jsx';
import { ExcalidrawEditor } from './excalidraw-editor.jsx';
import { EMPTY_CANVAS, EMPTY_DRAWING } from '@oh-my-student/plugin-vault-sqlite/drawing-files';
import { Button, Input, Menu, Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import { isVaultFormat } from '@oh-my-student/plugin-vault-sqlite/vault-path';
import { subscribeVaultChanges, vaultChangeIncludes, notifyVaultChanged } from '@oh-my-student/plugin-vault-sqlite/workspace-client';
import {parseMarkdown} from '@oh-my-student/plugin-vault-sqlite/frontmatter';
import {isCardType} from '@oh-my-student/plugin-vault-sqlite/review-contract';
import {useSuccessFeedback} from '@oh-my-student/plugin-graph-and-blocks/success-feedback';

function useRemote(remote, method, input, revision = 0, stamp) {
  const key = JSON.stringify(input), [state, setState] = useState({ key: null, loading: true, value: null, error: false });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    const readGeneration = stamp?.();
    setState(previous => ({ key, loading: true, value: previous.key === key ? previous.value : null, error: false }));
    void callVault(remote, method, JSON.parse(key)).then(value => { if (live) setState({ key, loading: false, value: stamp ? { ...value, readGeneration } : value, error: false }); }, () => { if (live) setState(previous => ({ ...previous, key, loading: false, error: true })); });
    return () => { live = false; };
  }, [remote, method, key, revision, retry, stamp]);
  return { ...(state.key === key ? state : { loading: true, value: null, error: false }), retry: () => setRetry(value => value + 1) };
}

function LoadState({ resource, children }) {
  if (resource.loading && !resource.value) return <p className="nv-vault-empty" role="status">正在读取资料…</p>;
  return <>{resource.error && <p className="nv-vault-empty" role="alert">{resource.value ? '资料暂时无法同步，当前内容与草稿已保留。' : '资料暂时无法读取。'}<button onClick={resource.retry}>重试</button></p>}{children}</>;
}

export function ReviewForm({ document, remote, onChanged, draftStore, onBusy }) {
  const [successToast,showSuccess,clearSuccess]=useSuccessFeedback();
  const [form, setForm] = useState(() => draftStore?.get(document.path)?.form || { keyStep: '', result: '', support: '', note: '' }), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [saved, setSaved] = useState(() => draftStore?.get(document.path)?.saved || false);
  useEffect(() => { draftStore?.set(document.path,{form,saved}); }, [draftStore,document.path,form,saved]);
  useEffect(() => { onBusy?.(busy); return () => onBusy?.(false); }, [busy,onBusy]);
  const resource=useRemote(remote,'read',{path:document.path});
  const current=resource.value;let history=[];
  try{const value=current&&parseMarkdown(current.content).fields.review_history;if(Array.isArray(value))history=value.filter(row=>row&&typeof row==='object');}catch{}
  const latest=history.findLast(row=>!row.revertedAt);
  useEffect(()=>subscribeVaultChanges(remote,change=>{if(vaultChangeIncludes(change,document.path))resource.retry();}),[remote,document.path]);
  const changed=()=>{resource.retry();onChanged?.();};
  const update = event => { setSaved(false); setForm(value => ({ ...value, [event.target.name]: event.target.value })); };
  const submit = async event => {
    event.preventDefault(); if(busy)return; setMessage('');clearSuccess();
    let input;
    try { if(!current)throw Error('请先等待读取当前记录');input = {...reviewInput(document.path, form),expectedRevision:current.revision}; } catch (error) { setMessage(error.message); return; }
    setBusy(true);
    try { const saved=await callVault(remote, 'recordReview', input); notifyVaultChanged(remote,{path:document.path,revision:saved.revision}); setSaved(true); showSuccess('已记录本次实况'); changed(); }
    catch(error) { setMessage(/review_history_invalid|review_date_invalid|review_baseline_unavailable/.test(error.code??error.message)?'已有记录需要核对；本次填写仍保留。':'未能保存，请刷新后重试；本次填写仍保留'); }
    finally { setBusy(false); }
  };
  const undo = async () => {
    setBusy(true);clearSuccess();
    try { const saved=await callVault(remote, 'undoReview', { path: document.path,expectedRevision:current.revision,expectedRecordId:latest.id }); notifyVaultChanged(remote,{path:document.path,revision:saved.revision}); setSaved(false); setMessage('');showSuccess('已撤销最近一次记录'); changed(); }
    catch { setMessage('未能撤销，请刷新后重试'); }
    finally { setBusy(false); }
  };
  return <form className="nv-vault-review-form" onSubmit={submit}>
    {document.reviewIssue&&<p role="status">已有复习排期需要核对，原有学习记录仍保留。</p>}
    {!isCardType(document.type)&&<label>日记小节<input name="heading" value={form.heading??''} onChange={update}/></label>}
    <label>本次关键步<input name="keyStep" value={form.keyStep} onChange={update} maxLength={200} placeholder="这次具体做了什么？" /></label>
    <label>本次结果<select name="result" value={form.result} onChange={update} required><option value="" disabled>请选择</option><option value="done">走通</option><option value="missed">卡住 / 未通过</option><option value="unchecked">仅记笔记，暂未检验</option></select></label>
    <label>本次帮助条件<select name="support" value={form.support} onChange={update} required><option value="" disabled>请按实际情况选择</option>{Object.entries(SUPPORT_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
    <label>实况备注<textarea name="note" value={form.note} onChange={update} rows={2} /></label>
    <div className="nv-vault-toolbar"><button disabled={busy || saved || !current || !form.result || !form.support} type="submit">{busy ? '保存中…' : saved ? '已记录' : '记录这次复习'}</button><button type="button" disabled={busy || !latest} onClick={undo}>撤销最近一次</button></div>
    {successToast}{message && <p role="status">{message}</p>}
  </form>;
}

export function DocumentReader(props) {
  if (!isVaultFormat(props.locator.path)) return <p className="nv-vault-empty">{props.locator.path.split('/').at(-1)} <button type="button" onClick={() => props.onOpen?.(props.locator)}>打开文件</button></p>;
  if (/\.base$/i.test(props.locator.path)) return <BaseWorkspace path={props.locator.path} remote={props.remote} workspaceId={props.locator.workspaceId} onOpen={props.onOpen} onBring={props.onBring} onReviewQuestion={props.onReviewQuestion} renderSlot={props.renderSlot} renderMarkdown={props.renderMarkdown} onGraph={props.onGraph} />;
  return <FileDocumentReader {...props} />;
}

function FileDocumentReader({ locator, remote, onOpen, onBring, onGraph, onChanged, revision, loadPdf, renderSlot, renderMarkdown, showDocHeader = false, captureOwner,onSnapshot,renderWhiteboardStatus }) {
  const stamp = useCallback(() => markdownGeneration(locator.workspaceId, locator.path), [locator.workspaceId, locator.path]);
  const resource = useRemote(remote, 'read', { path: locator.path }, revision, stamp);
  useEffect(() => subscribeVaultChanges(remote, change => {
    if (vaultChangeIncludes(change, locator.path)) resource.retry();
  }, locator.workspaceId), [remote, locator.path, locator.workspaceId]);
  const isPdf = /\.pdf$/i.test(locator.path), isCanvas = /\.canvas$/i.test(locator.path);
  const isDrawing = /\.excalidraw$/i.test(locator.path), isImage = /\.(png|jpe?g|webp|gif)$/i.test(locator.path);
  const nativeMarkdown = (text, open) => renderMarkdown ? renderMarkdown(text, open) : <MarkdownBody content={text} onOpen={open} />;
  const renderRich = (text, open) => renderSlot?.('notara.vault.blocks', { source: text, scope: JSON.stringify([locator.workspaceId, locator.path]), renderMarkdown: value => nativeMarkdown(value, open) }, { fallback: nativeMarkdown(text, open) }) ?? nativeMarkdown(text, open);
  const renderContent = (text, id) => <MarkdownReader content={text} onOpen={onOpen} renderMarkdown={(source, open) => renderSlot?.('notara.vault.blocks', { source, scope: JSON.stringify([locator.workspaceId, locator.path, id]), renderMarkdown: value => nativeMarkdown(value, open) }, { fallback: nativeMarkdown(source, open) }) ?? nativeMarkdown(source, open)} remote={remote} loadPdf={loadPdf} />;
  const changed = () => { resource.retry(); onChanged?.(); };
  const title = locator.title || locator.path.split('/').at(-1).replace(/\.(md|canvas|pdf)$/i, '');
  const documentHeader=showDocHeader?{onRefresh:resource.retry,onGraph:onGraph&&(()=>onGraph({focusPath:locator.path})),onBring:onBring&&(()=>onBring([{path:locator.path,revision:resource.value.revision,title}],`请围绕「${title}」和我一起讨论。`))}:undefined;
  return <LoadState resource={resource}>{resource.value && <>
    {showDocHeader&&isImage&&<FileToolbar path={locator.path} actions={documentHeader}/>}
    {isPdf
      ? <PdfReader captureOwner={captureOwner} record={resource.value} locator={locator} workspaceId={locator.workspaceId} remote={remote} onBring={onBring} onOpen={onOpen} onSaved={onChanged} onRefresh={resource.retry} loadPdf={loadPdf} />
      : isCanvas ? <CanvasEditor record={resource.value} documentHeader={documentHeader} workspaceId={locator.workspaceId} remote={remote} onChanged={changed} onOpen={onOpen} renderContent={renderContent} renderWhiteboardStatus={renderWhiteboardStatus} />
      : isDrawing ? <ExcalidrawEditor locator={locator} captureOwner={captureOwner} onSnapshot={onSnapshot} record={resource.value} documentHeader={documentHeader} workspaceId={locator.workspaceId} remote={remote} onChanged={changed} />
      : isImage ? <img className="nv-file-image" src={`data:${resource.value.mimeType};base64,${resource.value.content}`} alt={title} />
      : <EditableMarkdown captureOwner={captureOwner} record={resource.value} locator={locator} workspaceId={locator.workspaceId} onChanged={changed} onBring={onBring} onOpen={onOpen} documentHeader={documentHeader} renderMarkdown={renderRich} remote={remote} loadPdf={loadPdf} renderContent={renderContent} />}
  </>}</LoadState>;
}

export function NewFile({ remote, workspaceId, onOpen, onCreated, dialog = false }) {
  const [expanded, setExpanded] = useState(false), [name, setName] = useState(''), [kind, setKind] = useState('md'), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [typesOpen, setTypesOpen] = useState(false);
  const types = [{ value: 'md', label: 'Markdown 文档' }, { value: 'canvas', label: 'Canvas 白板' }, { value: 'excalidraw', label: 'Excalidraw 手绘' }];
  const create = async event => {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    const path = name.trim().replace(/\.(md|canvas|excalidraw)$/i, '') + `.${kind}`;
    try {
      if (!name.trim()) throw new Error('请输入文件名');
      const content = kind === 'canvas' ? EMPTY_CANVAS : kind === 'excalidraw' ? EMPTY_DRAWING : `# ${name.trim().split('/').at(-1).replace(/\.md$/i, '')}\n\n`;
      const saved = await callVault(remote, 'save', { path, content, expectedRevision: null });
      notifyVaultChanged(remote, { path, revision: saved.revision }, workspaceId);
      onCreated(); onOpen({ path }); setExpanded(false); setName('');
    } catch (error) { setError(error.message === '请输入文件名' ? error.message : '无法新建，请检查文件名；同名文件不会被覆盖。'); }
    finally { setBusy(false); }
  };
  const close = () => { setTypesOpen(false); setExpanded(false); };
  const form = <form className="nv-new-file-form" onSubmit={create}>
    <div className="nv-new-file-field">
      <Input className="nv-themed-field nv-new-file-name" autoFocus aria-label="新文件名称" placeholder="文件名称" value={name} onChange={event => setName(event.target.value)} />
      <Menu portal align="end" listClassName="nv-new-file-types" open={typesOpen} onClose={() => setTypesOpen(false)} selectedId={kind} onSelect={id => { setKind(id); setTypesOpen(false); }} items={types.map(item => ({ id: item.value, label: item.label }))} anchor={<Button className="nv-new-file-type-trigger" type="button" size="sm" variant="ghost" aria-label="新建文件类型" title={types.find(item => item.value === kind).label} aria-haspopup="menu" aria-expanded={typesOpen} onClick={() => setTypesOpen(!typesOpen)}><span>.{kind}</span><svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><path d="m3 4.5 3 3 3-3"/></svg></Button>}/>
    </div>
    <p className="nv-new-file-help">支持文件夹路径，如“数学/矩阵笔记”</p><div className="nv-new-file-actions"><Button size="sm" type="button" variant="ghost" onClick={close}>取消</Button><Button size="sm" variant="primary" disabled={busy || !name.trim()} type="submit">新建</Button></div>{error && <p role="alert">{error}</p>}
  </form>;
  const trigger = <Button type="button" size="sm" variant="ghost" className="nv-new-file-toggle" aria-haspopup={dialog ? 'dialog' : undefined} onClick={() => setExpanded(true)}>＋ 新建资料</Button>;
  return dialog ? <>{trigger}<Modal open={expanded} onClose={close} title="新建资料" closeLabel="关闭新建资料" className="nv-new-file-dialog">{form}</Modal></> : expanded ? form : trigger;
}

export function VaultSidebar({ remote, workspaceId, store, onOpen, activePath, tree = true, revision = 0, hideHeader = false, onOpenOverview, onOpenGraph }) {
  const [advanced, setAdvanced] = useState(false), [fileType, setFileType] = useState('');
  const searchButton = useRef(null);
  const resource = useRemote(remote, 'query', { view: 'table', tags: [], sort: 'title', limit: 10000 }, revision);
  useEffect(() => subscribeVaultChanges(remote, () => resource.retry(), workspaceId), [remote, workspaceId]);
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    const map = new Map();
    for (const doc of resource.value?.documents ?? []) {
      if (fileType && !doc.path.toLowerCase().endsWith(fileType)) continue;
      if (q && !`${doc.title} ${doc.path}`.toLowerCase().includes(q.toLowerCase())) continue;
      const folder = doc.path.includes('/') ? doc.path.split('/').slice(0, -1).join('/') : '根目录';
      if (!map.has(folder)) map.set(folder, []); map.get(folder).push(doc);
    }
    return [...map];
  }, [resource.value, q, fileType]);
  const open = locator => onOpen ? onOpen(locator) : store?.open(locator);
  return <nav className={`nv-vault-sidebar${tree ? ' nv-vault-sidebar-open' : ''}`} aria-label="学习资料">{!hideHeader && <div className="nv-vault-sidebar-header"><span>工作区目录</span></div>}<div className="nv-file-search"><SearchField compact label="查找文件" placeholder="查找文件…" value={q} onChange={setQ} advanced={advanced} onToggle={() => setAdvanced(true)} buttonRef={searchButton} count={fileType ? 1 : 0} />{advanced && <SimpleSearchDialog title="文件高级搜索" query={q} value={fileType} label="文件类型" options={[['', '全部文件'], ['.md', '文档'], ['.pdf', 'PDF'], ['.canvas', '白板'], ['.excalidraw', '手绘']]} anchorRef={searchButton} onClose={() => setAdvanced(false)} onApply={(text, type) => { setQ(text); setFileType(type); setAdvanced(false); }} />}</div>
    <div className="nv-vault-create"><NewFile dialog remote={remote} workspaceId={workspaceId} onOpen={open} onCreated={resource.retry} /></div>
    {onOpenOverview && <button className="nv-left-overview" onClick={onOpenOverview}><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><rect x="3" y="3" width="14" height="14" rx="2" /><path d="M3 8h14M8 8v9" /></svg><span>资料库总览</span><span aria-hidden="true">↗</span></button>}
    {onOpenGraph && <button className="nv-left-overview nv-left-graph" onClick={onOpenGraph}><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><circle cx="5" cy="5" r="2"/><circle cx="15" cy="5" r="2"/><circle cx="10" cy="15" r="2"/><path d="M7 5h6M6 7l3 6m5-6-3 6"/></svg><span>知识图谱</span><span aria-hidden="true">↗</span></button>}
    <LoadState resource={resource}>{groups.map(([folder, documents]) => <details key={folder} open><summary>{folder.split('/').at(-1)}<span className="nv-vault-folder-count" aria-hidden="true">{documents.length}</span></summary><ul role="tree">{documents.map(doc => <li key={doc.path} role="none"><button role={tree ? 'button' : 'treeitem'} title={doc.title} draggable onDragStart={event => { event.dataTransfer.setData('application/x-notara-file', JSON.stringify({ workspaceId, path: doc.path })); event.dataTransfer.effectAllowed = 'copy'; }} className={activePath === doc.path ? 'is-active' : undefined} onClick={() => open({ path: doc.path })}><span>{doc.title}</span></button></li>)}</ul></details>)}{!groups.length && <p className="nv-vault-muted">没有匹配的文件</p>}</LoadState>
  </nav>;
}

const noopSub = () => () => {};
const noopSnap = () => null;

export function VaultWorkspace({ remote, workspaceId, store: suppliedStore, onBring = async () => { throw new Error('对话暂不可用'); }, onReviewQuestion, onGraph, onBack, loadPdf, renderSlot, renderMarkdown, nativeTabs = false, onOpenDocument, externalViewStore,captureOwner,onSnapshot,renderWhiteboardStatus }) {
  const ownStore = useMemo(() => createViewState({ visible: true }), []), store = suppliedStore || ownStore;
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const externalCmd = useSyncExternalStore(externalViewStore ? externalViewStore.subscribe : noopSub, externalViewStore ? externalViewStore.getSnapshot : noopSnap, noopSnap);
  const [revision, setRevision] = useState(0), [tree, setTree] = useState(false);
  const locator = nativeTabs ? null : state.tabs.find(tab => tab.path === state.active);
  const onOpen = useCallback(locator => {
    if (locator && typeof locator === 'object' && locator.sessionId && !locator.path) {
      if (onOpenDocument) onOpenDocument(locator);
      else if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('notara:open-session', { detail: { ...locator, workspaceId } }));
      return;
    }
    if (nativeTabs && onOpenDocument) onOpenDocument(locator);
    else { store.open(locator); setTree(false); }
  }, [nativeTabs, onOpenDocument, store, workspaceId]);
  useEffect(() => { if (externalCmd?.view) store.update({active:null}); }, [externalCmd?.seq]);
  return <div className="nv-vault-workspace">
    {!nativeTabs && <div className="nv-vault-toolbar nv-vault-topbar"><button aria-label="显示文件树" aria-pressed={tree} onClick={() => setTree(value => !value)}>☰</button><div role="tablist" aria-label="资料标签"><button role="tab" aria-selected={!state.active} onClick={() => store.update({active:null})}>资料库.base</button>{state.tabs.map(tab => <span className="nv-vault-document-tab" key={tab.path}><button role="tab" aria-selected={tab.path === state.active} onClick={() => store.update({active:tab.path})}>{tab.path.split('/').at(-1)}</button><button aria-label={`关闭 ${tab.path.split('/').at(-1)}`} onClick={() => store.close(tab.path)}>×</button></span>)}</div>{onBack && <button onClick={onBack}>返回对话</button>}</div>}
    <div className="nv-vault-body">{!nativeTabs && <VaultSidebar {...{remote,workspaceId,store,onOpen,tree,revision}} activePath={state.active} />}<div className="nv-vault-main">
      <div className="nv-base-host" hidden={Boolean(locator)}><BaseWorkspace {...{remote,workspaceId,onOpen,onBring,onReviewQuestion,onGraph,renderSlot,renderMarkdown,externalCmd}} /></div>
      {locator && <DocumentReader key={locator.path} locator={{...locator,workspaceId}} {...{remote,onOpen,onBring,onReviewQuestion,loadPdf,renderSlot,renderMarkdown,revision,onSnapshot,renderWhiteboardStatus}} captureOwner={captureOwner} onChanged={() => setRevision(value => value+1)} />}
    </div></div>
  </div>;
}
