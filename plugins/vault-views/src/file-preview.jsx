import React, { useEffect, useState } from 'react';
import { parseCanvasDocument } from '@oh-my-student/plugin-vault-sqlite/drawing-files';
import { callVault, parseReference, stripFrontmatter, resolveFileLocator } from './logic.js';
import { PdfRegionPreview } from './pdf-reader.jsx';
import { readPdfRecord } from './pdf-source.js';
import { DrawingPreview } from './excalidraw-editor.jsx';
import {MathReference} from './math-reference.jsx';
import {mathElementId} from '@oh-my-student/plugin-vault-sqlite/math-reference';
import {markdownGeneration} from './markdown-drafts.js';
import { DocumentProperties } from './document-properties.jsx';
import { isVaultFormat } from '@oh-my-student/plugin-vault-sqlite/vault-path';
import {sourceStatus,sourceText} from '@oh-my-student/plugin-vault-sqlite/file-reference';
import { subscribeVaultChanges, vaultChangeIncludes } from '@oh-my-student/plugin-vault-sqlite/workspace-client';

export function useFilePreview(remote, path) {
  const [state, setState] = useState({ path, remote, loading: true });
  useEffect(() => {
    let live = true, generation = 0;
    const read = async () => { const current = ++generation,readGeneration=markdownGeneration(remote.workspaceId,path); try {
      const record = await (/\.pdf$/i.test(path) ? readPdfRecord(remote,path) : callVault(remote, 'read', { path }));
      // Bytes and rebuildable index metadata have separate contracts. Never
      // attach a target from another file or a different revision to this read.
      let knowledgeTags=[];
      if(/\.md$/i.test(path)&&typeof remote.query==='function')try{
        const value=await callVault(remote,'query',{paths:[path],limit:1});
        const metadata=value.documents?.find(doc=>doc.path===path&&doc.revision===record.revision);
        knowledgeTags=metadata?.knowledgeTags??[];
      }catch{/* The file remains readable while index metadata is unavailable. */}
      if (live && current === generation) setState({ path, remote, record:{...record,knowledgeTags,readGeneration} });
    } catch { if (live && current ===generation) setState(previous => previous.path===path && previous.remote===remote && previous.record ? {...previous,syncError:true} : {path,remote,error:true}); } };
    setState({ path, remote, loading: true }); void read();
    const changed = change => { if (vaultChangeIncludes(change, path) || /\.md$/i.test(path) && (change.changes ?? [change]).some(item => /\.md$/i.test(item.path ?? ''))) void read(); };
    // A referenced drawing can change through the teacher while its editor is closed.
    const timer=/\.excalidraw$/i.test(path)?setInterval(()=>{if(document.visibilityState!=='hidden')void read();},1500):null;
    const unsubscribe = subscribeVaultChanges(remote, changed);
    return () => { live = false; clearInterval(timer); unsubscribe(); };
  }, [remote, path]);
  return state.path === path && state.remote === remote ? state : { loading: true };
}

export function CanvasThumbnail({ content }) {
  let doc; try { doc = parseCanvasDocument(content); } catch { return <p>白板预览不可用</p>; }
  if (!doc.nodes.length) return <p className="nv-preview-empty">空白画布</p>;
  const x = Math.min(...doc.nodes.map(n => n.x)), y = Math.min(...doc.nodes.map(n => n.y));
  const w = Math.max(...doc.nodes.map(n => n.x + n.width)) - x, h = Math.max(...doc.nodes.map(n => n.y + n.height)) - y;
  return <svg className="nv-canvas-thumbnail" viewBox={`${x - 16} ${y - 16} ${w + 32} ${h + 32}`} aria-label="白板缩略图">{doc.nodes.map(n => <g key={n.id}><rect x={n.x} y={n.y} width={n.width} height={n.height} rx="8" fill={n.type === 'group' ? '#eeeae2' : '#fff'} stroke="#b3aaa0" /><text x={n.x + 10} y={n.y + 24} fontSize="14" fill="#393833">{String(n.text || n.file || n.label || '节点').slice(0, 40)}</text></g>)}</svg>;
}

export function FilePreview({ remote, locator, renderContent, onOpen }) {
  const [resolved,setResolved]=useState(null);
  useEffect(()=>{
    if(isVaultFormat(locator.path))return;
    let live=true;
    const read=()=>resolveFileLocator(remote,locator).then(value=>{if(live)setResolved({remote,path:locator.path,value:value.path});},()=>{if(live)setResolved({remote,path:locator.path,value:locator.path});});
    void read();const off=subscribeVaultChanges(remote,read);
    return()=>{live=false;off();};
  },[remote,locator.path]);
  if(!isVaultFormat(locator.path)){
    if(resolved?.remote!==remote||resolved.path!==locator.path)return <p className="nv-preview-empty">正在加载预览…</p>;
    locator={...locator,path:resolved.value};
  }
  if (!isVaultFormat(locator.path)) return <div className="nv-preview-empty"><span>{locator.path.split('/').at(-1)}</span><button type="button" onClick={() => onOpen?.(locator)}>打开文件</button></div>;
  return <VaultFilePreview {...{ remote, locator, renderContent, onOpen }} />;
}

function VaultFilePreview({ remote, locator, renderContent, onOpen }) {
  const resource = useFilePreview(remote, locator.path);
  if (resource.loading) return <p className="nv-preview-empty">正在加载预览…</p>;
  if (resource.error) return <div className="nv-preview-empty">文件不存在或暂不可读<button onClick={() => onOpen?.(locator)}>打开文件</button></div>;
  const record = resource.record;
  if((locator.page||locator.range)&&sourceStatus(record,locator)==='stale')return <p role="alert">来源已更新，旧选区不能确认。请打开原文件重新定位。</p>;
  if(locator.range){let excerpt;try{excerpt=sourceText(record,locator);}catch(error){return <p role="alert">{error.message}</p>;}return <div className="nv-source-text-preview"><small>{locator.revision?'来源文字选区':'旧引用：未记录来源版本'}</small><blockquote>{renderContent?renderContent(excerpt,locator.path):excerpt}</blockquote></div>;}
  if (record.mimeType?.startsWith('image/')) return <img className="nv-file-image" src={`data:${record.mimeType};base64,${record.content}`} alt={locator.path.split('/').at(-1)} />;
  if (/\.excalidraw$/i.test(locator.path)){let id;try{id=mathElementId(locator.subpath);}catch{return <p role="alert">数学图引用无效，请重新选择。</p>;}return id?<MathReference key={JSON.stringify([remote.workspaceId,locator.path,id])} record={record} unavailable={resource.syncError} remote={remote} locator={locator} elementId={id} onOpen={onOpen}/>:<><DrawingPreview content={record.content}/>{resource.syncError&&<p role="status">源白板暂时无法读取，显示上次预览。</p>}</>;}
  if (/\.canvas$/i.test(locator.path)) return <CanvasThumbnail content={record.content} />;
  if (/\.pdf$/i.test(locator.path)) {
    const parsed = parseReference(`[[${locator.path}${locator.subpath || ''}]]`);
    const reference = { ...parsed, ...locator, page: locator.page || parsed?.page || 1, rect: locator.rect || parsed?.rect || [0, 0, 1, 1] };
    return <PdfRegionPreview key={record.revision} remote={remote} reference={reference} record={record} />;
  }
  // File metadata is not Markdown prose. Normalize at this boundary so every
  // preview caller gets the same body, including recursively embedded files.
  let content = stripFrontmatter(record.content);
  if (locator.subpath?.startsWith('#')) {
    const heading = locator.subpath.slice(1), lines = content.split(/\r?\n/);
    const start = lines.findIndex(line => /^#{1,6}\s+/.test(line) && line.replace(/^#+\s+/, '') === heading);
    if (start >= 0) { const level = /^#+/.exec(lines[start])[0].length; let end = start + 1; while (end < lines.length && !new RegExp(`^#{1,${level}}\\s`).test(lines[end])) end++; content = lines.slice(start, end).join('\n'); }
  }
  return <div className="nv-file-content-preview"><DocumentProperties content={record.content} knowledgeTags={record.knowledgeTags} onOpen={onOpen} compact onSource={onOpen ? () => onOpen(locator) : undefined} /><div className="nv-file-preview-body">{renderContent ? renderContent(content, locator.path) : <pre>{content}</pre>}</div></div>;
}
