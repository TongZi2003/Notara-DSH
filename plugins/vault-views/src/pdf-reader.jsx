import { notifyVaultChanged } from '@oh-my-student/plugin-vault-sqlite/workspace-client';
import React, { useEffect, useRef, useState } from 'react';
import {Menu} from '@deepseek-ai/dsh-client-ui-primitives';
import {useSuccessFeedback} from '@oh-my-student/plugin-graph-and-blocks/success-feedback';
import { dragRect, sourceCard, callVault, verifyDisplayedSource } from './logic.js';
import {sourceStatus} from '@oh-my-student/plugin-vault-sqlite/file-reference';
import {useSourceCards} from './source-selection.jsx';
import { loadPdfLibrary, acquirePdfDocument, readPdfRecord } from './pdf-source.js';
export { PDF_ASSET_ROOT, loadPdfLibrary, decodePdf } from './pdf-source.js';

export function PdfReader({ record, locator = {}, remote, onBring, onOpen, onSaved, onRefresh, workspaceId, captureOwner,loadPdf = loadPdfLibrary }) {
  const [successToast,showSuccess,clearSuccess]=useSuccessFeedback();
  const sourceCards=useSourceCards(remote,record.path,record),stale=sourceStatus(record,locator)==='stale';
  const canvas = useRef(null), stage = useRef(null), drag = useRef(null), documentRef = useRef(null);
  const [documentVersion, setDocumentVersion] = useState(0), [page, setPage] = useState(locator.page || 1), [total, setTotal] = useState(0);
  const [rect, setRect] = useState(locator.rect || null), [size, setSize] = useState(null), [status, setStatus] = useState('loading'), [retry, setRetry] = useState(0);
  const [notice, setNotice] = useState(''), [title, setTitle] = useState(''), [creating, setCreating] = useState(false), [busy, setBusy] = useState(false);
  const [menu,setMenu]=useState(false);
  const [manual, setManual] = useState(['0', '0', '1', '1']);
  const displayedRevision = useRef(record.revision);
  useEffect(() => { if (displayedRevision.current !== record.revision) { displayedRevision.current = record.revision; setRect(null); } }, [record.revision]);

  useEffect(() => { setPage(locator.page || 1); setRect(stale?null:locator.rect || null); }, [locator.page, JSON.stringify(locator.rect),stale]);
  useEffect(() => {
    let live = true;
    const lease = acquirePdfDocument(remote,record,loadPdf);
    setStatus('loading'); setSize(null); setTotal(0); documentRef.current = null;
    void (async () => {
      const pdf = await lease.promise;
      if (!live) return;
      documentRef.current = pdf; setTotal(pdf.numPages); setDocumentVersion(value => value + 1);
    })().catch(() => { if (live) setStatus('error'); });
    return () => { live = false; documentRef.current = null; lease.release(); };
  }, [remote,record.path, record.revision, loadPdf, retry]);

  useEffect(() => {
    const pdf = documentRef.current;
    if (!pdf) return;
    let live = true, render;
    setStatus('loading'); setSize(null);
    void (async () => {
      if (page < 1 || page > pdf.numPages) throw new Error('页码超出范围');
      const pdfPage = await pdf.getPage(page);
      if (!live || !canvas.current) return;
      const natural = pdfPage.getViewport({ scale: 1 });
      const viewport = pdfPage.getViewport({ scale: Math.min(1.6, 1000 / natural.width) });
      const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
      canvas.current.width = Math.ceil(viewport.width * ratio); canvas.current.height = Math.ceil(viewport.height * ratio);
      setSize({ width: viewport.width, height: viewport.height });
      render = pdfPage.render({ canvas: canvas.current, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
      await render.promise; if (live) setStatus('ready');
    })().catch(() => { if (live) setStatus('error'); });
    return () => { live = false; render?.cancel(); };
  }, [documentVersion, page]);

  const move = event => {
    if (!drag.current || !stage.current) return;
    const bounds = stage.current.getBoundingClientRect();
    setRect(dragRect(drag.current, { x: event.clientX - bounds.left, y: event.clientY - bounds.top }, bounds.width, bounds.height));
  };
  const changePage = number => { setRect(null); setPage(number); };
  const bring = async () => {
    setBusy(true); setNotice('');clearSuccess();
    try { await onBring([{ path: record.path, revision: record.revision, page, rect, title: record.path.split('/').at(-1) }], '请和我一起阅读这个选区。'); showSuccess('已带入当前对话，可编辑后发送'); }
    catch (error) { setNotice(error.code === 'STALE_SOURCE' ? error.message : '未能带入，请打开可编辑的对话后重试'); }
    finally { setBusy(false); }
  };
  const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const saveCard = async event => {
    const isCurrent=captureOwner?.()??(()=>true);
    event.preventDefault(); setBusy(true); setNotice('');
    try { const input = sourceCard({ title, path: record.path, page, rect,revision:record.revision }); await verifyDisplayedSource(remote, record);if(!alive.current||!isCurrent())return; const saved=await callVault(remote, 'save', input);notifyVaultChanged(remote,{path:input.path,revision:saved.revision},workspaceId); if(alive.current&&isCurrent()){onSaved?.(); setCreating(false); setTitle(''); onOpen?.({ path: input.path });} }
    catch (error) { if(alive.current&&isCurrent())setNotice(error.code === 'STALE_SOURCE' ? error.message : '未能创建；请检查标题是否重复或稍后重试'); }
    finally { if(alive.current)setBusy(false); }
  };
  return <div className="nv-vault-pdf">
    <div className="nv-vault-toolbar nv-pdf-toolbar nv-surface-toolbar"><button title="上一页" aria-label="上一页" disabled={!total || page <= 1} onClick={() => changePage(page - 1)}>‹</button><input aria-label="PDF 页码" className="nv-vault-page-number" type="number" min="1" max={total || 1} value={page} onChange={event => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 1 && value <= total) changePage(value); }} /><span className="nv-pdf-page-total">/ {total || '…'}</span><button title="下一页" aria-label="下一页" disabled={!total || page >= total} onClick={() => changePage(page + 1)}>›</button>
      <span className="nv-toolbar-spacer"/><button title="带入选区" aria-label="带入选区" disabled={!rect || status !== 'ready' || busy} onClick={bring}>↗</button><button title="基于选区创建卡片" aria-label="基于选区创建卡片" disabled={!rect || status !== 'ready' || busy} onClick={() => setCreating(value => !value)}>＋</button>
      <Menu portal compact align="end" open={menu} onClose={()=>setMenu(false)} items={[...(onRefresh?[{id:'refresh',label:'刷新来源',disabled:busy}]:[]),{id:'generate',label:'请老师生成卡片',disabled:!rect||busy||status!=='ready'||!onBring}]} onSelect={async id=>{setMenu(false);if(id==='refresh'){onRefresh?.();return;}if(!rect||busy||status!=='ready'||!onBring)return;setBusy(true);clearSuccess();try{await onBring([{path:record.path,revision:record.revision,page,rect}],'请基于这个选区整理一张知识卡片，写入摘要并原样保留资料引用中的来源定位，包括页码、区域和来源版本。不要把来源内容记为我的掌握证据。');showSuccess('已加入对话草稿，可补充问题后发送。');}catch(error){setNotice(error.message);}finally{setBusy(false);}}} anchor={<button type="button" aria-label="PDF 选项" title="PDF 选项" aria-haspopup="menu" aria-expanded={menu} onClick={()=>setMenu(value=>!value)}>⋯</button>}/>
    </div>
    {stale&&<p role="alert">来源已更新，旧选区不能确认。请在当前文件重新框选。</p>}
    {!stale&&locator.rect&&!locator.revision&&<p role="status">旧引用未记录来源版本，请核对原文。</p>}
    {status === 'loading' && <p role="status">正在渲染页面…</p>}{status === 'error' && <p role="alert">页面未能加载。<button onClick={() => { setRetry(value => value + 1); }}>重试</button></p>}
    <div className="nv-vault-pdf-scroll"><div ref={stage} className="nv-vault-pdf-stage" style={size ? { width: `${size.width}px`, aspectRatio: `${size.width} / ${size.height}` } : undefined}>
      <canvas ref={canvas} aria-label={`PDF 第 ${page} 页`} />
      {status === 'ready' && <div className="nv-vault-pdf-layer" aria-hidden="true" onPointerDown={event => { if (event.button !== 0) return; const bounds = stage.current.getBoundingClientRect(); drag.current = { x: event.clientX - bounds.left, y: event.clientY - bounds.top }; event.currentTarget.setPointerCapture(event.pointerId); setRect(null); }} onPointerMove={move} onPointerUp={event => { move(event); drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { drag.current = null; setRect(null); }}>
        {rect && <div className="nv-vault-pdf-selection" style={{ left: `${rect[0] * 100}%`, top: `${rect[1] * 100}%`, width: `${rect[2] * 100}%`, height: `${rect[3] * 100}%` }} />}
      </div>}
      {status==='ready'&&sourceCards.references.filter(row=>row.reference.page===page&&row.reference.rect&&sourceStatus(record,row.reference)!=='stale').map((row,i)=>{const [x,y,w,h]=row.reference.rect;return <div key={row.path+JSON.stringify(row.reference)} className="nv-source-region-highlight" style={{left:`${x*100}%`,top:`${y*100}%`,width:`${w*100}%`,height:`${h*100}%`}}><button type="button" className="nv-source-region-link" aria-label={`关联卡片：${row.title} ${i+1}`} title={`打开卡片：${row.title}${row.reference.revision?'':'（未记录来源版本）'}`} onClick={()=>onOpen?.({path:row.path})}>{i+1}</button></div>;})}
    </div></div>
    {creating && <form className="nv-vault-toolbar" onSubmit={saveCard}><label>卡片标题 <input autoFocus value={title} maxLength={100} onChange={event => setTitle(event.target.value)} required /></label><button disabled={busy || !title.trim()}>创建卡片</button><button type="button" disabled={busy} onClick={() => setCreating(false)}>取消</button></form>}
    {successToast}{notice && <p role="status">{notice}</p>}
  </div>;
}

export function PdfRegionPreview({ remote, reference, record: suppliedRecord, loadPdf = loadPdfLibrary }) {
  const canvas = useRef(null);
  const [status, setStatus] = useState('loading');
  useEffect(() => {
    if (!remote || !reference?.path || !reference?.page || !Array.isArray(reference?.rect)) return undefined;
    let live = true, lease, render;
    setStatus('loading');
    void (async () => {
      const record = suppliedRecord?.path===reference.path ? suppliedRecord : await readPdfRecord(remote,reference.path);
      if (!live) return;
      if(sourceStatus(record,reference)==='stale'){if(live)setStatus('stale');return;}
      lease = acquirePdfDocument(remote,record,loadPdf);
      const pdf = await lease.promise;
      if (!live) return;
      const pdfPage = await pdf.getPage(reference.page);
      if (!live || !canvas.current) return;
      const viewport = pdfPage.getViewport({ scale: 1.5 });
      const [rx, ry, rw, rh] = reference.rect;
      const cropW = Math.max(40, Math.ceil(viewport.width * rw));
      const cropH = Math.max(30, Math.ceil(viewport.height * rh));
      canvas.current.width = cropW;
      canvas.current.height = cropH;
      const sx=cropW/(viewport.width*rw),sy=cropH/(viewport.height*rh);
      render = pdfPage.render({canvas:canvas.current,viewport,transform:[sx,0,0,sy,-viewport.width*rx*sx,-viewport.height*ry*sy]});
      await render.promise;
      if (!live || !canvas.current) return;
      setStatus('ready');
    })().catch(() => { if (live) setStatus('error'); });
    return () => { live = false; render?.cancel(); lease?.release(); };
  }, [remote, suppliedRecord?.path, suppliedRecord?.revision, reference?.path, reference?.page, reference?.revision,JSON.stringify(reference?.rect), loadPdf]);
  return <div className="nv-vault-pdf-crop">{status === 'loading' && <span role="status">正在读取原页…</span>}{status==='stale'&&<span role="alert">来源已更新，旧选区不能确认，请打开原文件重新定位。</span>}{status === 'error' && <span role="status">原页预览暂不可用，请检查页码或打开原文件。</span>}{status==='ready'&&!reference.revision&&<small>旧引用未记录来源版本</small>}<canvas ref={canvas} hidden={status !== 'ready'} aria-label={`原页摘录 · 第 ${reference.page} 页`} /></div>;
}
