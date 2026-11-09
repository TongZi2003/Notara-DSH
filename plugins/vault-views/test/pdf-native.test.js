import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { createPdfAssetHandler } from '../index.js';
import { samplePdf } from '../../../tests/sample-pdf.mjs';

test('real PDF.js renders the chosen source region into a nonblank PNG attachment', { timeout: 30000 }, async () => {
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/pdf-source.js', import.meta.url))], bundle: true, write: false, format: 'iife', globalName: 'pdfSource', platform: 'browser', logLevel: 'silent' });
  const assets = createPdfAssetHandler();
  const server = createServer((request, response) => {
    if (request.url === '/module.js') { response.setHeader('content-type', 'text/javascript'); response.end(bundle.outputFiles[0].text); }
    else if (request.url === '/') { response.setHeader('content-type', 'text/html'); response.end('<!doctype html><script src="/module.js"></script>'); }
    else void assets(request, response).catch(() => { response.statusCode = 500; response.end(); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const result = await page.evaluate(async content => {
      const render = async rect => {
        const blob = await pdfSource.renderPdfReference({ content, encoding: 'base64' }, { page: 1, rect });
        const bitmap = await createImageBitmap(blob), canvas = document.createElement('canvas');
        canvas.width = bitmap.width; canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let dark = 0;
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 200 && pixels[i + 1] < 200 && pixels[i + 2] < 200 && pixels[i + 3] > 200) dark++;
        bitmap.close();
        return { type: blob.type, size: blob.size, width: canvas.width, height: canvas.height, dark };
      };
      return { text: await render([0, 0, .6, .2]), blank: await render([0, .7, .6, .2]) };
    }, samplePdf().toString('base64'));
    assert.equal(result.text.type, 'image/png');
    assert.equal(result.text.width, 1102); assert.equal(result.text.height, 476);
    assert.ok(result.text.dark > 100, JSON.stringify(result));
    assert.equal(result.blank.dark, 0, 'the second crop must not include text from the top of the page');
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
});
