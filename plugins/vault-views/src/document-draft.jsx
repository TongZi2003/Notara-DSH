import { notifyVaultChanged } from '@oh-my-student/plugin-vault-sqlite/workspace-client';
import React, { useEffect, useMemo, useSyncExternalStore } from 'react';
import { markdownDraft } from './markdown-drafts.js';
import { preserveDraftCopy } from './document-recovery.js';
import {FileToolbar} from './file-toolbar.jsx';
import {useSuccessFeedback} from '@oh-my-student/plugin-graph-and-blocks/success-feedback';
import {documentStatus} from './document-feedback.js';

export function useDocumentDraft({ record, workspaceId, remote, onChanged }) {
  const [saveToast,showSuccess,clearSuccess]=useSuccessFeedback();
  const draft = useMemo(() => markdownDraft(record, workspaceId), [record.path, workspaceId]);
  const state = useSyncExternalStore(draft.subscribe, draft.getSnapshot);
  useEffect(() => {
    if (state.saving) return;
    if (record.readGeneration !== undefined && record.readGeneration !== state.generation && record.revision !== state.baseRevision && record.revision !== state.conflict?.revision) { onChanged?.(); return; }
    draft.receive(record, record.readGeneration);
  }, [draft, record.revision, record.readGeneration, state.generation, state.saving]);
  const save = async ({quiet=false}={}) => {
    if (draft.getSnapshot().conflict) return;
    clearSuccess();
    const result=await draft.save(remote);if (result) { if(!quiet&&!draft.getSnapshot().conflict)showSuccess(draft.getSnapshot().message);onChanged?.(); notifyVaultChanged(remote,{path:record.path,revision:result.revision},workspaceId); }return result;
  };
  const recover = async () => {
    const result = await preserveDraftCopy(draft, remote, record.path);
    if (!result) return;
    if(result.loaded)showSuccess('草稿已另存，已载入文件版本');
    onChanged?.(); notifyVaultChanged(remote,{path:result.path,revision:result.revision},workspaceId);
    return result.loaded ? '' : '之前的草稿已另存，刚输入的新修改仍保留在这里。';
  };
  return { draft, state, dirty: state.text !== state.baseContent, save, recover, saveToast };
}

export function DocumentSaveBar({ state, dirty, save, recover, record, header, children }) {
  const [recovering, setRecovering] = React.useState(false), [notice, setNotice] = React.useState('');
  return <><FileToolbar path={record.path} actions={header}>{children}<span className="nv-markdown-status" role="status">{documentStatus(state,dirty)}</span><button type="button" className="nv-markdown-save" aria-label="保存" disabled={!dirty || state.saving || Boolean(state.conflict)} onClick={save} title={state.saving?'正在保存…':dirty?'保存（⌘ / Ctrl + S）':'没有未保存的修改'}><svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M4 3h10l3 3v11H3V3h1Zm2 0v5h7V3M6 17v-6h8v6"/></svg><span className="nv-doc-action-label">{state.saving?'保存中…':'保存'}</span></button></FileToolbar>
    {state.message?.startsWith('保存失败')&&<p role="alert" className="nv-markdown-warning">{state.message}</p>}
    {state.storageWarning && <p role="alert" className="nv-markdown-warning">草稿暂时无法存入浏览器，请保存文件后再关闭。</p>}
    {state.conflict && <div role="alert" className="nv-markdown-conflict">文件已在其他地方更新，当前草稿已保留。<button disabled={recovering} onClick={async () => { setRecovering(true); setNotice(''); try { setNotice(await recover() || ''); } catch { setNotice('操作未完成，当前草稿仍保留，请重试。'); } finally { setRecovering(false); } }}>保留草稿副本并载入文件版本</button><button onClick={() => { const url = URL.createObjectURL(new Blob([state.text], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = '未保存草稿.json'; a.click(); URL.revokeObjectURL(url); }}>导出草稿</button>{notice && <span>{notice}</span>}</div>}
  </>;
}

export function saveShortcut(event, save) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); event.stopPropagation(); void save(); }
}
