import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, unlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVaultStore } from '../vault-indexer.js';

test('committed saves and external writes update the same workspace change stream', async t => {
  const root = mkdtempSync(join(tmpdir(), 'notara-changes-'));
  const store = createVaultStore({ root });
  const controller = new AbortController();
  t.after(async () => { controller.abort(); await store.close(); rmSync(root, { recursive: true, force: true }); });
  await store.startWatching();
  const stream = store.changes(AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]));
  assert.deepEqual((await stream.next()).value, { reset: true, changes: [] });
  const saved = store.save({ path: '新卡.md', content: '# 新卡\n', expectedRevision: null });
  let change = (await stream.next()).value;
  assert.deepEqual(change, { reset: false, changes: [{ path: '新卡.md', revision: saved.revision }] });
  assert.equal(store.query({}).documents[0].revision, saved.revision, 'notification follows the index commit');
  writeFileSync(join(root, '新卡.md'), '# 修改后的卡片\n');
  change = (await stream.next()).value;
  assert.equal(change.changes[0].revision, store.read({ path: '新卡.md' }).revision);
  assert.equal(store.query({}).documents[0].title, '修改后的卡片');
  unlinkSync(join(root, '新卡.md'));
  assert.deepEqual((await stream.next()).value.changes, [{ path: '新卡.md', revision: null }]);
  assert.equal(store.query({}).total, 0);
  const waiting = stream.next(); controller.abort();
  assert.equal((await waiting).done, true);
});

test('failed writes emit no change; slow consumers coalesce paths and reconnect with a reset', async t => {
  const root = mkdtempSync(join(tmpdir(), 'notara-changes-bounded-'));
  const store = createVaultStore({ root });
  t.after(async () => { await store.close(); rmSync(root, { recursive: true, force: true }); });
  const stream = store.changes(); await stream.next();
  const a = store.save({ path: 'A.md', content: '# A\n', expectedRevision: null });
  assert.throws(() => store.save({ path: 'B.md', content: '# B', expectedRevision: '0'.repeat(64) }), /revision_conflict/);
  const latest = store.save({ path: 'A.md', content: '# 新 A\n', expectedRevision: a.revision });
  assert.deepEqual((await stream.next()).value.changes, [{ path: 'A.md', revision: latest.revision }]);
  for (let i = 0; i < 257; i++) store.save({ path: `${i}.md`, content: '# 卡片', expectedRevision: null });
  assert.deepEqual((await stream.next()).value, { reset: true, changes: [] });
  await stream.return();
  const reconnected = store.changes();
  assert.deepEqual((await reconnected.next()).value, { reset: true, changes: [] });
  const waiting = reconnected.next(); await store.close();
  assert.equal((await waiting).done, true);
});
