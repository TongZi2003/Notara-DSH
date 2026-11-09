import test from 'node:test';
import assert from 'node:assert/strict';
import { createPdfAssetHandler, PDF_ASSET_ROOT } from '../index.js';

test('PDF worker route serves real installed assets and rejects traversal/non-GET', async () => {
  const handler = createPdfAssetHandler();
  const response = () => ({ status: null, headers: null, body: null, writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } });
  const worker = response(); await handler({ method: 'GET', url: `${PDF_ASSET_ROOT}/pdf.worker.min.mjs` }, worker);
  assert.equal(worker.status, 200); assert.ok(worker.body.length > 100000); assert.match(worker.headers['content-type'], /javascript/);
  for (const suffix of ['../../package.json', 'cmaps/../../package.json', '%2e%2e/package.json', 'file.pdf']) { const res = response(); await handler({ method: 'GET', url: `${PDF_ASSET_ROOT}/${suffix}` }, res); assert.equal(res.status, 404); }
  const head = response(); await handler({ method: 'HEAD', url: `${PDF_ASSET_ROOT}/pdf.worker.min.mjs` }, head); assert.equal(head.status, 200); assert.equal(head.body, undefined);
  const excluded = response(); await handler({ method: 'GET', url: `${PDF_ASSET_ROOT}/claude-fonts/c66fc489e-C-BHYa_K.ttf` }, excluded); assert.equal(excluded.status, 404);
  const font = response(); await handler({ method: 'GET', url: `${PDF_ASSET_ROOT}/claude-fonts/NotoSerifSC-VariableFont_wght.ttf` }, font);
  assert.equal(font.status, 200); assert.ok(font.body.length > 50000); assert.equal(font.headers['content-type'], 'font/ttf');
  const post = response(); await handler({ method: 'POST', url: `${PDF_ASSET_ROOT}/pdf.worker.min.mjs` }, post); assert.equal(post.status, 405);
});
