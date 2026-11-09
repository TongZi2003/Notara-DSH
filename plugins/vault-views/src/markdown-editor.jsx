import { notifyVaultChanged } from '@oh-my-student/plugin-vault-sqlite/workspace-client';
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { basicSetup } from 'codemirror';
import { EditorView, keymap } from '@codemirror/view';
import { Compartment, EditorState, Prec, Transaction } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { undo as cmUndo, undoDepth as cmUndoDepth } from '@codemirror/commands';
import {useSuccessFeedback} from '@oh-my-student/plugin-graph-and-blocks/success-feedback';
import {documentStatus} from './document-feedback.js';
import { markdownDraft } from './markdown-drafts.js';
import { MarkdownReader } from './markdown.jsx';
import {FileToolbar} from './file-toolbar.jsx';
import {FollowUpText} from './followup-text.jsx';
import { EditableDocumentProperties } from './document-properties.jsx';
import { LiveMarkdownEditor } from './live-markdown-editor.jsx';
import {SelectionActions,useSourceCards} from './source-selection.jsx';
import { RouteAndLessonBar } from './route-overview.jsx';
import {sourceStatus} from '@oh-my-student/plugin-vault-sqlite/file-reference';

const theme = EditorView.theme({
  '&': { color: 'var(--dsw-alias-label-primary)', backgroundColor: 'var(--dsw-alias-bg-base)', minHeight: '360px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--claude-font-mono)', fontSize: '14px', lineHeight: '1.75', overflow: 'auto' },
  '.cm-content': { padding: '20px 0', caretColor: 'var(--claude-clay)' },
  '.cm-line': { padding: '0 18px' },
  '.cm-gutters': { backgroundColor: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-tertiary)', border: 'none' },
  '.cm-activeLineGutter,.cm-activeLine': { backgroundColor: 'var(--dsw-alias-interactive-bg-hover)' },
  '.cm-cursor': { borderLeftColor: 'var(--claude-clay)' },
  '&.cm-focused .cm-selectionBackground,.cm-selectionBackground,::selection': { backgroundColor: 'var(--claude-clay-soft)' },
  '.cm-panels,.cm-tooltip': { backgroundColor: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)' },
});
const highlighting = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.heading, fontWeight: '600', color: 'var(--claude-clay)' },
  { tag: tags.strong, fontWeight: '600' }, { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: [tags.link, tags.url], color: 'var(--claude-clay)' },
  { tag: [tags.meta, tags.comment, tags.processingInstruction], color: 'var(--dsw-alias-label-tertiary)' },
  { tag: tags.monospace, fontFamily: 'var(--claude-font-mono)' },
]));

export function CodeMirrorEditor({ value, onChange, onSave, onActions }) {
  const host = useRef(null), view = useRef(null), callbacks = useRef({ onChange, onSave, onActions }), syncing = useRef(false), separator = useRef(new Compartment());
  callbacks.current = { onChange, onSave, onActions };
  useEffect(() => {
    const owner = Symbol('source-editor'); let alive = true, lastUndo;
    const publish = editor => {
      const canUndo = cmUndoDepth(editor.state) > 0;
      if (canUndo === lastUndo) return; lastUndo = canUndo;
      callbacks.current.onActions?.(owner, { canUndo, undo: () => { if (!alive) return false; editor.focus(); return cmUndo(editor); } });
    };
    const previousStyles = new Set(document.querySelectorAll('style'));
    const editor = new EditorView({ parent: host.current, state: EditorState.create({ doc: value, extensions: [
      basicSetup, markdown(), theme, highlighting, EditorView.lineWrapping,
      separator.current.of(EditorState.lineSeparator.of(value.includes('\r\n') ? '\r\n' : '\n')),
      EditorView.contentAttributes.of({ 'aria-label': 'Markdown 正文编辑器' }),
      Prec.highest(keymap.of([{ key: 'Mod-s', run: () => { callbacks.current.onSave?.(); return true; } }])),
      EditorView.updateListener.of(update => { publish(update.view); if (update.docChanged && !syncing.current) callbacks.current.onChange?.(update.state.sliceDoc()); }),
    ] }) });
    for (const style of document.querySelectorAll('style')) if (!previousStyles.has(style) && !style.dataset.plugin) style.dataset.plugin = '@oh-my-student/plugin-vault-views';
    view.current = editor; editor.focus(); publish(editor);
    return () => { alive = false; callbacks.current.onActions?.(owner, null); view.current = null; editor.destroy(); };
  }, []);
  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.state.sliceDoc() === value) return;
    syncing.current = true;
    try { editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value }, effects: separator.current.reconfigure(EditorState.lineSeparator.of(value.includes('\r\n') ? '\r\n' : '\n')), annotations: Transaction.addToHistory.of(false) }); }
    finally { syncing.current = false; }
  }, [value]);
  return <div ref={host} className="nv-markdown-code" />;
}

export function EditableMarkdown({ record, workspaceId, remote, onChanged, ...readerProps }) {
  const [saveToast,showSuccess,clearSuccess]=useSuccessFeedback();
  const [selection,setSelection]=useState(null);
  const selectedRevision=useRef(record.revision);
  const references=useSourceCards(remote,record.path,record), locator=readerProps.locator||{};
  const draft = useMemo(() => markdownDraft(record, workspaceId), [record.path, workspaceId]);
  const state = useSyncExternalStore(draft.subscribe, draft.getSnapshot), [mode, setMode] = useState('live'), [compare, setCompare] = useState(false);
  const [editors, setEditors] = useState({ edit: null, properties:null });
  const registerActions = useCallback((mode, owner, actions) => setEditors(previous => {
    if (!actions && previous[mode]?.owner !== owner) return previous;
    return { ...previous, [mode]: actions ? { ...actions, owner } : null };
  }), []);
  const sourceActions = useCallback((owner, actions) => registerActions('edit', owner, actions), [registerActions]);
  const [propertyFocus,setPropertyFocus] = useState(false);
  const propertyActions=useCallback((owner,actions)=>registerActions('properties',owner,actions),[registerActions]);
  const activeEditor = editors[mode !== 'edit' && propertyFocus ? 'properties' : mode === 'live' ? 'edit' : mode];
  const dirty = state.text !== state.baseContent;
  const status=sourceStatus(record,locator),focusRange=!dirty&&status!=='stale'?locator.range:null;
  const sourceLinks=dirty||state.conflict?[]:references.references.filter(row=>row.reference.range&&sourceStatus(record,row.reference)!=='stale');
  useEffect(() => { if(selectedRevision.current!==record.revision){selectedRevision.current=record.revision;setSelection(null);} }, [record.revision]);
  useEffect(() => {
    if (state.saving) return;
    if (record.readGeneration !== undefined && record.readGeneration !== state.generation && record.revision !== state.baseRevision && record.revision !== state.conflict?.revision) { onChanged?.(); return; }
    draft.receive(record, record.readGeneration);
  }, [draft, record.revision, record.readGeneration, state.generation, state.saving]);
  const save = async merged => { clearSuccess();const saved = await draft.save(remote, merged); if (saved) { if(!draft.getSnapshot().conflict)showSuccess(draft.getSnapshot().message);onChanged?.(); notifyVaultChanged(remote,{path:record.path,revision:saved.revision},workspaceId); } };
  return <div className="nv-editable-document">{saveToast}
    <FileToolbar path={record.path} actions={readerProps.documentHeader}>
      <span role="status" className="nv-markdown-status">{documentStatus(state,dirty)}</span>
        <button type="button" aria-label={mode==='edit'?'返回正文':'查看源码'} title={mode==='edit'?'切换到正文':'切换到源码'} aria-pressed={mode==='edit'} onMouseDown={event=>event.preventDefault()} onClick={()=>setMode(value=>value==='edit'?'live':'edit')}><svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">{mode==='edit'?<path d="M4 4h12M4 8h12M4 12h8M4 16h10"/>:<path d="m6 5-4 5 4 5m8-10 4 5-4 5m-3-13-2 16"/>}</svg><span className="nv-doc-action-label">{mode==='edit'?'正文':'源码'}</span></button>
        <button type="button" aria-label="撤销" disabled={!activeEditor?.canUndo} title="撤销上一步编辑（⌘ / Ctrl + Z）" onMouseDown={event => event.preventDefault()} onClick={() => activeEditor?.undo()}><svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M7 4 3 8l4 4M3 8h8a5 5 0 0 1 0 10" /></svg><span className="nv-doc-action-label">撤销</span></button>
        <button type="button" aria-label={state.saving?'保存中…':'保存'} className="nv-markdown-save" disabled={!dirty || state.saving || Boolean(state.conflict)} title={dirty ? '保存（⌘ / Ctrl + S）' : '没有未保存的修改'} onClick={() => save(false)}><svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M4 3h10l3 3v11H3V3h1Zm2 0v5h7V3M6 17v-6h8v6" /></svg><span className="nv-doc-action-label">{state.saving ? '保存中…' : '保存'}</span>{state.saving&&<span aria-hidden="true" className="nv-doc-saving">·</span>}</button>
    </FileToolbar>
    {!state.conflict && state.message?.startsWith('保存失败') && <p className="nv-markdown-warning" role="alert">{state.message}</p>}
    {state.storageWarning && <p className="nv-markdown-warning" role="alert">草稿暂时无法存入浏览器，请保存到文件后再关闭页面。</p>}
    {locator.range&&status==='stale'&&<p role="alert" className="nv-markdown-warning">来源已更新，旧文字选区不能确认，请重新选择。</p>}
    {locator.range&&status==='unverified'&&<p role="status">旧引用未记录来源版本，请核对原文。</p>}
    {selection&&<SelectionActions record={record} selection={selection} disabled={dirty||state.saving||Boolean(state.conflict)} captureOwner={readerProps.captureOwner} remote={remote} workspaceId={workspaceId} onBring={readerProps.onBring} onOpen={readerProps.onOpen} onSaved={onChanged}/>}
    {state.conflict && <div className="nv-markdown-conflict" role="alert"><span>文件已有更新，当前草稿未覆盖文件。</span><button type="button" onClick={() => { setCompare(value => !value); setMode('edit'); }}>{compare ? '收起对照' : '对照最新内容'}</button><button type="button" disabled={state.saving} onClick={() => save(true)}>确认合并并保存</button></div>}
    {mode !== 'edit' && <EditableDocumentProperties content={state.text} knowledgeTags={record.knowledgeTags} onOpen={readerProps.onOpen} onChange={draft.edit} onFocus={() => setPropertyFocus(true)} onActions={propertyActions} onSource={() => setMode('edit')} />}
    {mode !== 'edit' && <RouteAndLessonBar record={record} content={state.text} dirty={dirty} workspaceId={workspaceId} remote={remote} onOpen={readerProps.onOpen} onBring={readerProps.onBring} renderMarkdown={readerProps.renderMarkdown} />}
    <div className={`nv-markdown-edit-area${mode === 'live' ? ' nv-markdown-live-area' : ''}${compare && state.conflict ? ' nv-markdown-comparing' : ''}`} onFocusCapture={() => setPropertyFocus(false)}>
      <LiveMarkdownEditor value={state.text} preview={mode === 'live'} onChange={draft.edit} onActions={sourceActions} onSelection={next=>setSelection(next?{...next,revision:record.revision}:null)} sourceRevision={record.revision} sourceLinks={sourceLinks} onOpenSource={readerProps.onOpen} focusRange={focusRange} onSave={() => { if (!draft.getSnapshot().conflict) void save(false); }} renderContent={readerProps.renderContent || (text => <MarkdownReader content={text} remote={remote} {...readerProps} />)} />
      {compare && state.conflict && <section className="nv-markdown-latest" aria-label="文件最新内容"><h3>文件最新内容</h3><pre>{state.conflict.content}</pre></section>}
      {mode==='live'&&<FollowUpText record={record} renderMarkdown={readerProps.renderMarkdown} onOpen={readerProps.onOpen} remote={remote} loadPdf={readerProps.loadPdf}/>}
    </div>
  </div>;
}
