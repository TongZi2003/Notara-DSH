import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'notara-vault-views';
export const PDF_ASSET_ROOT = '/notara/vault-views/pdf/6.3.289';
export const DRAWING_ASSET_ROOT = '/notara/vault-views/excalidraw/0.18.1';
export const COMPANION_ASSET_ROOT = '/notara/vault-views/companions/v1';
const require = createRequire(import.meta.url);
const pdfRoot = dirname(require.resolve('pdfjs-dist/package.json'));
const packageAssetsRoot = join(dirname(fileURLToPath(import.meta.url)), 'assets');
const drawingAssetsRoot = dirname(require.resolve('@excalidraw/excalidraw'));

export function createCompanionAssetHandler(root=join(packageAssetsRoot,'companions')){
  return async(req,res)=>{
    const pathname=new URL(req.url||'/','http://localhost').pathname,suffix=pathname.slice(COMPANION_ASSET_ROOT.length+1);
    if(!['GET','HEAD'].includes(req.method)||!pathname.startsWith(COMPANION_ASSET_ROOT+'/')||! /^(deepseek|claude|gemini|gpt)-bean-eyes\.png$/.test(suffix)){res.writeHead(404);res.end();return;}
    try{const data=await readFile(join(root,suffix));res.writeHead(200,{'content-type':'image/png','content-length':String(data.length),'cache-control':'public, max-age=31536000, immutable','x-content-type-options':'nosniff'});res.end(req.method==='HEAD'?undefined:data);}catch{res.writeHead(404);res.end();}
  };
}

export function createDrawingAssetHandler(root = drawingAssetsRoot) {
  return async (req, res) => {
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;
    const suffix = pathname.slice(DRAWING_ASSET_ROOT.length + 1);
    if (!['GET', 'HEAD'].includes(req.method) || !/^fonts\/[\w-]+\/[\w.-]+\.woff2$/.test(suffix)) { res.writeHead(404); res.end(); return; }
    try { const data = await readFile(join(root, suffix)); res.writeHead(200, { 'content-type': 'font/woff2', 'cache-control': 'public, max-age=31536000, immutable' }); res.end(req.method === 'HEAD' ? undefined : data); }
    catch { res.writeHead(404); res.end(); }
  };
}

/** Package assets only. This endpoint never accepts or resolves a Vault path. */
export function createPdfAssetHandler(root = pdfRoot, assetsRoot = packageAssetsRoot) {
  return async (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { allow: 'GET, HEAD' }); res.end(); return; }
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;
    const suffix = pathname.startsWith(`${PDF_ASSET_ROOT}/`) ? pathname.slice(PDF_ASSET_ROOT.length + 1) : '';
    let file, mime, baseRoot = root;
    if (suffix === 'pdf.worker.min.mjs' || suffix === 'pdf.min.mjs') { file = `build/${suffix}`; mime = 'text/javascript; charset=utf-8'; }
    else if (/^cmaps\/[\w-]+\.bcmap$/.test(suffix)) { file = suffix; mime = 'application/octet-stream'; }
    else if (/^standard_fonts\/[\w.-]+\.(?:pfb|ttf)$/.test(suffix)) { file = suffix; mime = 'application/octet-stream'; }
    else if (/^wasm\/[\w.-]+\.wasm$/.test(suffix)) { file = suffix; mime = 'application/wasm'; }
    else if (/^claude-fonts\/Noto(?:Sans|Serif)SC-VariableFont_wght\.ttf$/.test(suffix)) { file = suffix; mime = 'font/ttf'; baseRoot = assetsRoot; }
    else { res.writeHead(404); res.end(); return; }
    let data;
    try { data = await readFile(join(baseRoot, file)); } catch { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': mime, 'content-length': String(data.byteLength), 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : data);
  };
}

export function apply(ctx) {
  ctx.plugin({
    name: 'notara-vault-pdf-assets', inject: ['webServer'],
    apply(scope) {
      scope.effect(() => scope.webServer.register({ kind: 'prefix', path: PDF_ASSET_ROOT, handler: createPdfAssetHandler() }));
      scope.effect(() => scope.webServer.register({ kind: 'prefix', path: DRAWING_ASSET_ROOT, handler: createDrawingAssetHandler() }));
      scope.effect(() => scope.webServer.register({ kind: 'prefix', path: COMPANION_ASSET_ROOT, handler: createCompanionAssetHandler() }));
    },
  });
}
