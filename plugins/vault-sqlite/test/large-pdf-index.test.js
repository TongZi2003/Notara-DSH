import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, openSync, writeSync, ftruncateSync, closeSync, writeFileSync, rmSync, appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createVaultStore} from '../vault-indexer.js';

test('a textbook above the former 64 MiB limit stays indexed and readable with bounded PDF reads', async t => {
  const root = mkdtempSync(join(tmpdir(), 'notara-large-pdf-'));
  let store;
  t.after(async () => { await store?.close(); rmSync(root, {recursive: true, force: true}); });
  mkdirSync(join(root, '来源'));
  const path = '来源/大教材.pdf', full = join(root, path), fd = openSync(full, 'w');
  try {
    writeSync(fd, Buffer.from('%PDF-1.7\n'));
    ftruncateSync(fd, 64 * 1024 * 1024 + 1);
  } finally { closeSync(fd); }
  writeFileSync(join(root, '方法.md'), `---\ntype: method\n---\n# 比较方法\n## 来源\n[[${path}#page=1]]\n`);
  const errors = [];
  store = createVaultStore({root, onError: error => errors.push(error.message)});
  assert.deepEqual(errors, []);
  assert.equal(store.errors.size, 0);
  const graph = store.graph(), pdf = graph.nodes.find(node => node.path === path);
  assert.equal(pdf?.type, 'source');
  assert.equal(pdf?.isSource, true);
  assert.deepEqual(graph.nodes.find(node => node.path === '方法.md').sourcePaths, [path]);
  assert.ok(graph.edges.some(edge => edge.kind === 'source' && [edge.source, edge.target].includes(path)));
  assert.match(pdf.revision, /^[a-f0-9]{64}$/);
  const read = store.read({path});
  assert.equal(read.mimeType, 'application/pdf');
  assert.equal(read.encoding, 'base64');
  assert.equal(read.revision, pdf.revision);
  assert.equal(read.content.length, 4 * Math.ceil((64 * 1024 * 1024 + 1) / 3));
  const reads = store.metrics.fileReads;
  store.scan(); store.query({}); store.graph();
  assert.equal(store.metrics.fileReads, reads, 'unchanged metadata must not rehash the large PDF');
  appendFileSync(full, '\n%%EOF');
  assert.equal(store.update(path), true);
  assert.notEqual(store.query({paths: [path]}).documents[0].revision, pdf.revision);
});

test('PDF reads still reject oversized responses and do not widen image reads', async t => {
  const root = mkdtempSync(join(tmpdir(), 'notara-pdf-read-limit-'));
  let store;
  t.after(async () => { await store?.close(); rmSync(root, {recursive: true, force: true}); });
  for (const [path, size] of [['过大.pdf', 128 * 1024 * 1024 + 1], ['过大.png', 64 * 1024 * 1024 + 1]]) {
    const fd = openSync(join(root, path), 'w');
    try { ftruncateSync(fd, size); } finally { closeSync(fd); }
  }
  store = createVaultStore({root});
  assert.ok(store.query({paths: ['过大.pdf']}).documents.length);
  assert.throws(() => store.read({path: '过大.pdf'}), /vault_content_too_large/);
  assert.throws(() => store.read({path: '过大.png'}), /vault_content_too_large/);
});

test('small PDF index revisions keep the existing full-read revision contract', async t => {
  const root = mkdtempSync(join(tmpdir(), 'notara-small-pdf-'));
  writeFileSync(join(root, '讲义.pdf'), '%PDF-1.7\nsource bytes\n%%EOF');
  const store = createVaultStore({root});
  t.after(async () => { await store.close(); rmSync(root, {recursive: true, force: true}); });
  const indexed = store.query({paths: ['讲义.pdf']}).documents[0];
  const read = store.read({path: '讲义.pdf'});
  assert.equal(indexed.revision, read.revision);
  assert.equal(Buffer.from(read.content, 'base64').toString(), '%PDF-1.7\nsource bytes\n%%EOF');
});
