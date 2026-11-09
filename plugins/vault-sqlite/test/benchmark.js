import { performance } from 'node:perf_hooks';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createVaultStore } from '../vault-indexer.js';
import assert from 'node:assert/strict';
const root = mkdtempSync(join(tmpdir(), 'notara-benchmark-'));
let store;
try {
  for (let i = 0; i < 2500; i++) writeFileSync(join(root, `${i}.md`), `---\ntype: card\ntitle: Card ${i}\ntags: [math, algebra]\n---\n# Card ${i}\n## 内容\nExample derivation ${i}\n## 参考理解\n[[${(i + 1) % 2500}]]\n## 学生理解\n[[${(i + 2) % 2500}]]\n`);
  const start = performance.now(); store = createVaultStore({ root }); const coldMs = performance.now() - start;
  assert.equal(store.metrics.indexed, 2500); assert.equal(store.metrics.fileReads, 2500);
  const readings = {};
  for (const [name, call] of Object.entries({ query: () => store.query({ q: 'derivation', limit: 50 }), graphAll: () => store.graph({}), graphFocus: () => store.graph({ focusPath: '1.md' }), homeRecommendations: () => store.homeRecommendations() })) {
    const samples = [];
    for (let i = 0; i < 100; i++) { const begin = performance.now(), result = call(); samples.push(performance.now() - begin); if (i === 0 && name === 'graphAll') { assert.equal(result.nodes.length, 2500); assert.equal(result.edges.length, 5000); } if (i === 0 && name === 'query') assert.equal(result.total, 2500); }
    const firstMs = samples[0]; samples.sort((a, b) => a - b); readings[name] = { firstMs, p50Ms: samples[50], p95Ms: samples[95], maxMs: samples.at(-1) };
  }
  const before = store.metrics.fileReads, begin = performance.now(); store.scan();
  console.log(JSON.stringify({ node: process.version, platform: `${process.platform}-${process.arch}`, fixture: '2500 generated Markdown cards; memory SQLite; 100 calls per method', coldMs, readings, unchangedScanMs: performance.now() - begin, unchangedScanFileReads: store.metrics.fileReads - before }, null, 2));
} finally { await store?.close(); rmSync(root, { force: true, recursive: true }); }
