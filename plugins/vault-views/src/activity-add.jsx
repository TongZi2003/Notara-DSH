import React, { useEffect, useRef, useState } from 'react';
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import { bindVaultRemote } from '@oh-my-student/plugin-vault-sqlite/workspace-client';
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path';
import { callVault } from './logic.js';
import { NewFile } from './workspace.jsx';
import { bringReferences, draftEnd } from './composer.js';
import { activityLabel, activityUrl } from './activity-model.js';

/** Additions use the captured native session/workspace; never send a message. */
export function ActivityAdd({ ctx, state, section, onAdd, onClose, onOpenFile, isCurrent }) {
  const [tab, setTab] = useState('file'), [query, setQuery] = useState(''), [url, setUrl] = useState(''), [label, setLabel] = useState('');
  const [documents, setDocuments] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const uploadInput = React.useRef(null);
  const alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const remote = React.useMemo(() => bindVaultRemote(ctx.remote.notaraVault, state.workspaceId), [ctx, state.workspaceId]);
  const current = () => alive.current && (isCurrent ? isCurrent() : Object.values(ctx.sessions.list.getSnapshot()?.byId ?? {}).some(row => row.id === state.sessionId && row.retainedBy?.mainView > 0));
  useEffect(() => {
    let live = true;
    callVault(remote, 'query', { view: 'table', tags: [], sort: 'title', limit: 10000 }).then(value => { if (live) { setDocuments(value.documents); setLoading(false); } }, () => { if (live) { setError('资料暂时无法读取，请重新打开'); setLoading(false); } });
    return () => { live = false; };
  }, [remote]);
  const fileRow = file => ({ key: JSON.stringify([state.workspaceId ?? state.cwd ?? state.sessionId, file.path]), title: activityLabel(file.title || file.path.split('/').at(-1)), path: file.path, workspaceId: state.workspaceId, sourceSessionId: state.sessionId, address: fileAddressFor(state.sessionId, state.cwd, file.path), status: '已添加', manual: true });
  const run = async action => {
    if (busy) return;
    setBusy(true); setError('');
    try { if (!current()) throw new Error('对话已切换，请重新打开'); await action(); }
    catch (error) { setError(error.message || '添加失败，请重试'); }
    finally { setBusy(false); }
  };
  const addFile = file => run(async () => {
    if (section === 'references') await bringReferences(ctx, [{ path: file.path, workspaceId: state.workspaceId }], '', {sessionId:state.sessionId,isCurrent:current});
    if(!current())return;
    onAdd(fileRow(file)); onClose();
  });
  const addUrl = event => {
    event.preventDefault();
    void run(async () => {
      const value = activityUrl(url.trim()); if (!value) throw new Error('请输入有效的 HTTP 或 HTTPS 网页地址');
      if (section === 'references') {
        const scope = ctx.sessions.scope(state.sessionId), input = scope && ctx.conversation.input.for(scope), draft = input?.state.getSnapshot();
        if (!draft || draft.phase !== 'plain') throw new Error('当前输入暂不可编辑');
        const end = draftEnd(draft);
        if (scope.bail(scope, 'slash/input-insert-text', { text: (draft.draft ? '\n' : '') + value, span: { start: end, end, draftRev: draft.draftRev } }) !== true) throw new Error('网页未带入，请重试');
      }
      onAdd({ key: value, url: value, title: activityLabel(label.trim() || new URL(value).hostname, '网页'), status: '已添加', manual: true }); onClose();
    });
  };
  const upload = files => run(async () => {
    // Version-bounded adapter: rc.1's public input admits attachments, while
    // draft creation/release live on the installed ConversationController.
    const conversation = ctx.conversation;
    if (typeof conversation.createDrafts !== 'function' || typeof conversation.releaseDraftAttachments !== 'function') throw new Error('请使用对话输入框的附件按钮上传');
    const scope = ctx.sessions.scope(state.sessionId), input = scope && conversation.input.for(scope);
    if (!input) throw new Error('当前输入暂不可编辑');
    const drafts = conversation.createDrafts(state.sessionId, files);
    if (!input.addAttachments(drafts.map(item => item.id))) { conversation.releaseDraftAttachments(drafts); throw new Error('当前输入暂不可编辑，请稍后重试'); }
    onClose();
  });
  const rows = documents.filter(file => (file.title + ' ' + file.path).toLowerCase().includes(query.toLowerCase()));
  return <Modal open onClose={onClose} title={section === 'outputs' ? '添加输出内容' : '添加来源'} closeLabel="关闭添加窗口" className="nv-activity-add">
    <div className="nv-activity-add-tabs"><Button size="sm" aria-pressed={tab === 'file'} onClick={() => setTab('file')}>工作区文件</Button><Button size="sm" aria-pressed={tab === 'web'} onClick={() => setTab('web')}>网页</Button>{section === 'references' && <Button size="sm" aria-pressed={tab === 'upload'} onClick={() => setTab('upload')}>上传文件</Button>}</div>
    {tab === 'file' && <>
      {section === 'outputs' && <NewFile remote={remote} workspaceId={state.workspaceId} onCreated={() => {}} onOpen={file => { if(!current())return;const row = fileRow(file); onAdd(row); onClose(); onOpenFile(row); }}/>}
      <Input className="nv-themed-field" data-modal-autofocus aria-label="搜索可添加的文件" placeholder="搜索工作区文件…" value={query} onChange={event => setQuery(event.target.value)}/>
      <div className="nv-activity-picker">{loading ? <p>正在读取…</p> : rows.length ? rows.slice(0, 100).map(file => <button disabled={busy} key={file.path} title={file.path} onClick={() => addFile(file)}><span>{file.title}</span><small>{file.path}</small></button>) : <p>没有匹配文件</p>}{rows.length > 100 && <p>请继续输入以缩小范围</p>}</div>
      {section === 'references' && <p className="nv-activity-add-help">文件会带入当前草稿，由你发送。</p>}
    </>}
    {tab === 'web' && <form onSubmit={addUrl}><label>网页地址<Input className="nv-themed-field" data-modal-autofocus type="url" required placeholder="https://…" value={url} onChange={event => setUrl(event.target.value)}/></label><label>显示名称<Input className="nv-themed-field" placeholder="可选" value={label} onChange={event => setLabel(event.target.value)}/></label><p className="nv-activity-add-help">{section === 'outputs' ? '收纳已有网页，点击后在右栏浏览器中打开。' : '网页地址会带入当前草稿，由你发送。'}</p><Button type="submit" variant="primary" size="sm" disabled={busy || !url.trim()}>添加</Button></form>}
    {tab === 'upload' && <div className="nv-activity-upload"><input ref={uploadInput} aria-label="上传来源文件" type="file" multiple hidden disabled={busy} onChange={event => void upload([...event.target.files])}/><Button type="button" variant="outline" disabled={busy} icon={<span aria-hidden="true">＋</span>} onClick={() => uploadInput.current?.click()}>选择文件</Button><p>添加到对话草稿，发送后保留在来源列表。</p></div>}
    {error && <p role="alert" className="nv-activity-notice">{error}</p>}
  </Modal>;
}
