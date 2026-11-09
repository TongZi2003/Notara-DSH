import { validateRect } from '@oh-my-student/plugin-vault-sqlite/file-reference';
import { vaultRemoteScope } from '@oh-my-student/plugin-vault-sqlite/workspace-client';
import { callVault } from './logic.js';

export const PDF_ASSET_ROOT = '/notara/vault-views/pdf/6.3.289';
let library, attempts = 0;
export async function loadPdfLibrary() {
  library ??= import(`${PDF_ASSET_ROOT}/pdf.min.mjs${attempts ? `?retry=${attempts}` : ''}`).then(pdfjs => {
    pdfjs.GlobalWorkerOptions.workerSrc = `${PDF_ASSET_ROOT}/pdf.worker.min.mjs`;
    return pdfjs;
  }).catch(error => { library = null; attempts++; throw error; });
  return library;
}

export function decodePdf(record) {
  if (record.encoding !== 'base64' || typeof record.content !== 'string') throw new Error('PDF 内容暂时无法读取');
  if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(record.content);
  const text = atob(record.content), bytes = new Uint8Array(text.length);
  for (let i=0;i<text.length;i++) bytes[i]=text.charCodeAt(i);
  return bytes;
}

const documents = new WeakMap(), reads = new WeakMap();
function scopedEntries(registry, remote) {
  const {source,workspaceId}=vaultRemoteScope(remote);
  if (!source) return {entries:new Map(),workspaceId};
  let entries=registry.get(source);if(!entries)registry.set(source,entries=new Map());
  return {entries,workspaceId};
}

// Coalesce only in-flight reads. A later read still verifies the current file.
export function readPdfRecord(remote,path) {
  const {entries,workspaceId}=scopedEntries(reads,remote),key=JSON.stringify([workspaceId,path]);
  if (!entries.has(key)) {
    const request=callVault(remote,'read',{path}).finally(()=>{if(entries.get(key)===request)entries.delete(key);});
    entries.set(key,request);
  }
  return entries.get(key);
}

/** Share the document, never the transferable input buffer or a render task. */
export function acquirePdfDocument(remote,record,loadPdf=loadPdfLibrary) {
  const {entries,workspaceId}=scopedEntries(documents,remote);
  const key=record.path&&record.revision?JSON.stringify([workspaceId,record.path,record.revision]):Symbol();
  let loaders=entries.get(key);if(!loaders)entries.set(key,loaders=new Map());
  let entry=loaders.get(loadPdf);
  if(!entry){
    entry={users:0,loading:null,closed:false,destroyed:false};loaders.set(loadPdf,entry);
    const forget=()=>{if(loaders.get(loadPdf)===entry)loaders.delete(loadPdf);if(!loaders.size&&entries.get(key)===loaders)entries.delete(key);};
    entry.destroy=()=>{if(entry.loading&&!entry.destroyed){entry.destroyed=true;void Promise.resolve(entry.loading.destroy()).catch(()=>{});}};
    entry.close=()=>{entry.closed=true;forget();entry.destroy();};
    entry.promise=Promise.resolve().then(loadPdf).then(pdfjs=>{
      if(entry.closed)throw new Error('PDF preview released');
      entry.loading=pdfjs.getDocument(pdfDocumentOptions(record));return entry.loading.promise;
    }).catch(error=>{entry.close();throw error;});
  }
  entry.users++;let released=false;
  return {promise:entry.promise,release(){if(released)return;released=true;if(--entry.users===0)entry.close();}};
}

export function pdfDocumentOptions(record) {
  return { data: decodePdf(record), isEvalSupported: false, cMapUrl: `${PDF_ASSET_ROOT}/cmaps/`, cMapPacked: true,
    standardFontDataUrl: `${PDF_ASSET_ROOT}/standard_fonts/`, wasmUrl: `${PDF_ASSET_ROOT}/wasm/` };
}

/** Render only the admitted page/region. This is a native message attachment,
 * not a new Vault asset; the original PDF remains the source of truth. */
export async function renderPdfReference(record, { page = 1, rect = [0, 0, 1, 1] }, signal, {
  loadPdf = loadPdfLibrary, createCanvas = () => document.createElement('canvas'),
} = {}) {
  if (!Number.isSafeInteger(page) || page < 1) throw new Error('PDF 页码无效，请重新选择');
  rect = validateRect(rect);
  signal?.throwIfAborted();
  const pdfjs = await loadPdf();
  signal?.throwIfAborted();
  const loading = pdfjs.getDocument(pdfDocumentOptions(record));
  let render, canvas, destroyed;
  const destroy = () => destroyed ??= Promise.resolve().then(() => loading.destroy());
  const abort = () => { render?.cancel(); void destroy().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const pdf = await loading.promise;
    signal?.throwIfAborted();
    if (page > pdf.numPages) throw new Error('PDF 页码超出范围，请重新选择');
    const pdfPage = await pdf.getPage(page);
    signal?.throwIfAborted();
    const natural = pdfPage.getViewport({ scale: 1 }), [x, y, width, height] = rect;
    const scale = Math.min(3, 2048 / Math.max(natural.width * width, natural.height * height));
    const viewport = pdfPage.getViewport({ scale });
    canvas = createCanvas();
    canvas.width = Math.max(1, Math.ceil(viewport.width * width));
    canvas.height = Math.max(1, Math.ceil(viewport.height * height));
    render = pdfPage.render({ canvas, viewport, transform: [1, 0, 0, 1, -viewport.width * x, -viewport.height * y], background: '#ffffff' });
    await render.promise;
    signal?.throwIfAborted();
    const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PDF 选区图片生成失败，请重试')), 'image/png'));
    signal?.throwIfAborted();
    return blob;
  } finally {
    signal?.removeEventListener('abort', abort);
    try { await destroy(); } finally { if (canvas) canvas.width = canvas.height = 0; }
  }
}
