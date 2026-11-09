import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPdfReference, decodePdf } from '../src/pdf-source.js';
import * as pdfSource from '../src/pdf-source.js';
import {bindVaultRemote} from '@oh-my-student/plugin-vault-sqlite/workspace-client';

const record = { content: btoa('%PDF-fixture'), encoding: 'base64' };
test('PDF decoding uses native base64 bytes without per-character callbacks', t => {
  const native = Uint8Array.fromBase64, from = Uint8Array.from;
  t.after(() => { Uint8Array.fromBase64=native; Uint8Array.from=from; });
  let calls=0;
  Uint8Array.fromBase64 = content => { calls++; return new Uint8Array(Buffer.from(content,'base64')); };
  Uint8Array.from = () => { throw Error('slow callback conversion'); };
  assert.deepEqual(decodePdf(record),new Uint8Array(Buffer.from('%PDF-fixture')));
  assert.equal(calls,1);
  Uint8Array.fromBase64=undefined;
  assert.deepEqual(decodePdf(record),new Uint8Array(Buffer.from('%PDF-fixture')),'older engines keep the synchronous byte contract');
  assert.throws(()=>decodePdf({...record,encoding:'utf8'}),/PDF/);
});
test('PDF attachment rendering crops the selected page and releases its document and canvas', async () => {
  let page, options, rendered, destroyed = 0;
  const canvas = { toBlob(callback) { callback(new Blob(['pixels'], { type: 'image/png' })); } };
  const loadPdf = async () => ({ getDocument(value) { options = value; return { destroy: async () => { destroyed++; }, promise: Promise.resolve({ numPages: 3, getPage: async value => { page = value; return {
    getViewport: ({ scale }) => ({ width: 1000 * scale, height: 2000 * scale }),
    render: value => { rendered = { ...value, width: value.canvas.width, height: value.canvas.height }; return { promise: Promise.resolve() }; },
  }; } }) }; } });
  const blob = await renderPdfReference(record, { page: 2, rect: [.1, .2, .3, .4] }, undefined, { loadPdf, createCanvas: () => canvas });
  assert.equal(page, 2); assert.equal(options.isEvalSupported, false); assert.equal(blob.type, 'image/png');
  assert.deepEqual(rendered.transform, [1, 0, 0, 1, -256, -1024]);
  assert.equal(rendered.width, 768); assert.equal(rendered.height, 2048);
  assert.equal(destroyed, 1); assert.equal(canvas.width, 0); assert.equal(canvas.height, 0);
});
test('invalid page and canceled reads cannot produce a PDF attachment', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(renderPdfReference(record, { page: 1 }, controller.signal), { name: 'AbortError' });
  let destroyed = 0;
  const loadPdf = async () => ({ getDocument: () => ({ promise: Promise.resolve({ numPages: 1 }), destroy: async () => { destroyed++; } }) });
  await assert.rejects(renderPdfReference(record, { page: 2 }, undefined, { loadPdf }), /页码超出范围/);
  assert.equal(destroyed, 1);
});

test('concurrent PDF users share a document, but not workspaces or revisions', async () => {
  assert.equal(typeof pdfSource.acquirePdfDocument,'function');
  const {acquirePdfDocument}=pdfSource, remote={}, a=bindVaultRemote(remote,'A'), a2=bindVaultRemote(remote,'A'), b=bindVaultRemote(remote,'B');
  let loads=0,destroys=0;
  const loadPdf=async()=>({getDocument:()=>{loads++;return {promise:Promise.resolve({numPages:1}),destroy:async()=>{destroys++;}};}});
  const doc={...record,path:'教材.pdf',revision:'v1'};
  const first=acquirePdfDocument(a,doc,loadPdf),second=acquirePdfDocument(a2,{...doc},loadPdf);
  assert.equal(await first.promise,await second.promise);assert.equal(loads,1);
  first.release();await Promise.resolve();assert.equal(destroys,0);
  const other=acquirePdfDocument(b,doc,loadPdf),next=acquirePdfDocument(a,{...doc,revision:'v2'},loadPdf);
  await Promise.all([other.promise,next.promise]);assert.equal(loads,3);
  second.release();second.release();other.release();next.release();await Promise.resolve();assert.equal(destroys,3);
  const reopened=acquirePdfDocument(a,doc,loadPdf);await reopened.promise;assert.equal(loads,4);reopened.release();
});

test('released and failed PDF loads cannot poison the next document lease', async () => {
  const remote={},doc={...record,path:'教材.pdf',revision:'v1'};let ready,loads=0,destroys=0;
  const loadPdf=()=>new Promise(r=>{ready=r;});
  const lease=pdfSource.acquirePdfDocument(remote,doc,loadPdf);await Promise.resolve();lease.release();
  ready({getDocument(){loads++;}});
  await assert.rejects(lease.promise,/released/);assert.equal(loads,0);
  let failed=true;
  const retry=async()=>({getDocument:()=>({promise:failed?Promise.reject(Error('load failed')):Promise.resolve({numPages:1}),destroy:async()=>{destroys++;}})});
  const broken=pdfSource.acquirePdfDocument(remote,doc,retry);await assert.rejects(broken.promise,/load failed/);broken.release();
  failed=false;const fresh=pdfSource.acquirePdfDocument(remote,doc,retry);await fresh.promise;fresh.release();await Promise.resolve();assert.equal(destroys,2);
});
