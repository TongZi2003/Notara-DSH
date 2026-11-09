import { Session } from 'node:inspector';
import { performance } from 'node:perf_hooks';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createVaultStore } from '../vault-indexer.js';

// Same full 2500-file workload as benchmark.js; only measured phases are profiled.
const root = mkdtempSync(join(tmpdir(), 'notara-profile-')), session = new Session();
session.connect();
const post = (method, args = {}) => new Promise((resolve, reject) => session.post(method, args, (error, result) => error ? reject(error) : resolve(result)));
async function capture(name, fn) {
  await post('Profiler.enable'); await post('Profiler.setSamplingInterval', { interval: 100 }); await post('Profiler.start');
  const begin = performance.now(), result = fn(), ms = performance.now() - begin;
  const { profile } = await post('Profiler.stop');
  const nodes = new Map(profile.nodes.map(node => [node.id, node])), times = new Map();
  for (const [i, id] of (profile.samples ?? []).entries()) times.set(id, (times.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0));
  const self = [...times].map(([id, us]) => { const frame = nodes.get(id).callFrame; return { function: frame.functionName || '(anonymous)', source: frame.url.split('/').slice(-2).join('/'), line: frame.lineNumber + 1, selfMs: us / 1000 }; }).sort((a, b) => b.selfMs - a.selfMs).slice(0, 18);
  console.log(JSON.stringify({ phase: name, ms, topSelfSamples: self }, null, 2));
  return result;
}
let store;
try {
  for (let i = 0; i < 2500; i++) writeFileSync(join(root, `${i}.md`), `---\ntype: card\ntitle: Card ${i}\ntags: [math, algebra]\n---\n# Card ${i}\n## 内容\nExample derivation ${i}\n## 参考理解\n[[${(i + 1) % 2500}]]\n## 学生理解\n[[${(i + 2) % 2500}]]\n`);
  store = await capture('cold index (2500 complete Markdown files)', () => createVaultStore({ root }));
  await capture('first full graph (2500 nodes, 5000 edges)', () => store.graph({}));
  if (store.query({ q: 'derivation', limit: 1 }).total !== 2500) throw new Error('incomplete full-text index');
} finally { await store?.close(); session.disconnect(); rmSync(root, { recursive: true, force: true }); }
