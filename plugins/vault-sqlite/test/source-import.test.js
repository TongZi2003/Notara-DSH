import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { importSourceAttachment } from '../source-import.js';
import { safeWorkspaceRelativePath } from '../vault-path.js';

const hash = data => createHash('sha256').update(data).digest('hex');
function fixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'notara-source-import-')));
  const root = join(base, '学习集');
  mkdirSync(root);
  t.after(() => rmSync(base, { recursive: true, force: true }));
  return { base, root };
}
function input(root, name, data, extra = {}) {
  return { root, name, sha256: hash(data), bytes: data.length,
    readChunks: async function* () {
      for (let offset = 0; offset < data.length; offset += 3) yield data.subarray(offset, offset + 3);
    }, ...extra };
}
const files = root => existsSync(join(root, '来源')) ? readdirSync(join(root, '来源')).sort() : [];

test('copies exact binary chunks, including typed-array offsets and an empty file', async t => {
  const { root } = fixture(t), data = Buffer.from([0, 255, 1, 128, 10, 13, 0]);
  const backing = new Uint8Array([99, ...data, 88]);
  const result = await importSourceAttachment(input(root, '原始材料.bin', data, {
    sha256: hash(data).toUpperCase(),
    readChunks: async function* () { yield backing.subarray(1, 5); yield new Uint8Array(); yield backing.subarray(5, backing.length - 1); },
  }));
  assert.deepEqual(result, { path: '来源/原始材料.bin', sha256: hash(data), bytes: data.length, created: true });
  assert.deepEqual(readFileSync(join(root, result.path)), data);
  assert.equal(lstatSync(join(root, result.path)).nlink, 1);
  const empty = await importSourceAttachment(input(root, '空文件.txt', Buffer.alloc(0)));
  assert.equal(empty.bytes, 0);
  assert.equal(readFileSync(join(root, empty.path)).length, 0);
  assert.deepEqual(files(root), ['原始材料.bin', '空文件.txt'].sort());
});

test('writes incrementally and keeps the final name invisible until the stream is validated', async t => {
  const { root } = fixture(t), chunk = Buffer.alloc(64 * 1024, 0xa5), hasher = createHash('sha256');
  for (let index = 0; index < 128; index++) hasher.update(chunk);
  const result = await importSourceAttachment({ root, name: '大附件.bin', sha256: hasher.digest('hex'), bytes: chunk.length * 128,
    readChunks: async function* () {
      for (let index = 0; index < 128; index++) {
        assert.equal(existsSync(join(root, '来源/大附件.bin')), false);
        const staged = files(root);
        assert.equal(staged.length, 1);
        assert.ok(staged[0].startsWith('.'));
        assert.equal(lstatSync(join(root, '来源', staged[0])).size, index * chunk.length);
        yield chunk;
      }
    },
  });
  assert.equal(lstatSync(join(root, result.path)).size, chunk.length * 128);
  assert.deepEqual(files(root), ['大附件.bin']);
});

test('reuses the same name and bytes across calls without replacing the file', async t => {
  const { root } = fixture(t), data = Buffer.from('教材内容\r\n');
  const first = await importSourceAttachment(input(root, '教材.pdf', data));
  const before = lstatSync(join(root, first.path));
  const second = await importSourceAttachment(input(root, '教材.pdf', data));
  assert.deepEqual(second, { ...first, created: false });
  assert.equal(lstatSync(join(root, first.path)).ino, before.ino);
  assert.deepEqual(files(root), ['教材.pdf']);
});

test('preserves collisions and user edits and progressively resolves occupied hash names', async t => {
  const { root } = fixture(t), original = Buffer.from('原附件'), incoming = Buffer.from('另一附件');
  const first = await importSourceAttachment(input(root, '资料.pdf', original));
  const digest = hash(incoming), fallback = `来源/资料--${digest.slice(0, 12)}.pdf`;
  const second = await importSourceAttachment(input(root, '资料.pdf', incoming));
  assert.equal(second.path, fallback);
  writeFileSync(join(root, first.path), '用户修改原名');
  writeFileSync(join(root, fallback), '用户修改短哈希副本');
  for (const size of [24, 64]) writeFileSync(join(root, `来源/资料--${digest.slice(0, size)}.pdf`), '已占用');
  const third = await importSourceAttachment(input(root, '资料.pdf', incoming));
  assert.equal(third.path, `来源/资料--${digest}--2.pdf`);
  assert.deepEqual(readFileSync(join(root, third.path)), incoming);
  assert.equal(readFileSync(join(root, first.path), 'utf8'), '用户修改原名');
  assert.equal(readFileSync(join(root, fallback), 'utf8'), '用户修改短哈希副本');
  assert.deepEqual(await importSourceAttachment(input(root, '资料.pdf', incoming)), { ...third, created: false });
});

test('simultaneous imports converge both for the original name and an occupied original', async t => {
  const { root } = fixture(t), data = Buffer.from('并发流内容');
  for (const occupied of [false, true]) {
    const name = occupied ? '重名.txt' : '并发.txt';
    if (occupied) writeFileSync(join(root, '来源', name), '用户内容');
    const results = await Promise.all(Array.from({ length: 12 }, () => importSourceAttachment(input(root, name, data))));
    assert.equal(new Set(results.map(result => result.path)).size, 1);
    assert.equal(results.filter(result => result.created).length, 1);
    assert.deepEqual(readFileSync(join(root, results[0].path)), data);
    assert.equal(lstatSync(join(root, results[0].path)).nlink, 1);
  }
  assert.equal(files(root).length, 3);
});

test('independent Node processes reuse one create-only publication', async t => {
  const { root } = fixture(t), moduleUrl = new URL('../source-import.js', import.meta.url).href;
  const script = `
    import { importSourceAttachment } from ${JSON.stringify(moduleUrl)};
    import { createHash } from 'node:crypto';
    const data = Buffer.alloc(64 * 1024, 7);
    const result = await importSourceAttachment({root: process.argv[1], name: '进程.pdf',
      bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'),
      readChunks: async function* () { for (let i = 0; i < data.length; i += 1024) {
        yield data.subarray(i, i + 1024); await new Promise(resolve => setImmediate(resolve));
      } }
    });
    process.stdout.write(JSON.stringify(result));
  `;
  const results = await Promise.all(Array.from({ length: 6 }, async () => {
    const { stdout, stderr } = await promisify(execFile)(process.execPath, ['--input-type=module', '--eval', script, root]);
    assert.equal(stderr, '');
    return JSON.parse(stdout);
  }));
  assert.equal(new Set(results.map(result => result.path)).size, 1);
  assert.equal(results.filter(result => result.created).length, 1);
  assert.deepEqual(files(root), ['进程.pdf']);
});

test('a concurrent publication is reused after its temporary hard link is removed', async t => {
  const { root } = fixture(t), data = Buffer.from('完整且已校验的资料');
  mkdirSync(join(root, '来源'));
  const staged = join(root, '来源/.source-import-publishing.tmp'), target = join(root, '来源/资料.pdf');
  writeFileSync(staged, data);
  linkSync(staged, target);
  assert.equal(lstatSync(target).nlink, 2);
  // Hold exactly the cross-process link/unlink window that failed in the suite.
  const timer = setTimeout(() => { if (existsSync(staged)) unlinkSync(staged); }, 30);
  t.after(() => clearTimeout(timer));
  const result = await importSourceAttachment(input(root, '资料.pdf', data));
  assert.equal(result.created, false);
  assert.equal(result.path, '来源/资料.pdf');
  assert.equal(lstatSync(target).nlink, 1);
  assert.deepEqual(files(root), ['资料.pdf']);
  assert.deepEqual(readFileSync(target), data);
});

test('cancellation after the final target lookup prevents create-only publication', async t => {
  const { root } = fixture(t), moduleUrl = new URL('../source-import.js', import.meta.url).href;
  const script = `
    import fs from 'node:fs';
    import { join } from 'node:path';
    import { createHash } from 'node:crypto';
    import { syncBuiltinESMExports } from 'node:module';
    import { importSourceAttachment } from ${JSON.stringify(moduleUrl)};
    const root = process.argv[1], target = join(root, '来源/取消.pdf');
    const control = new AbortController(), originalStat = fs.lstatSync, originalLink = fs.linkSync;
    let lookups = 0, publishedAfterAbort = false;
    fs.lstatSync = (path, ...args) => {
      if (path === target && ++lookups === 2) queueMicrotask(() => control.abort(new Error('cancelled-before-publication')));
      return originalStat(path, ...args);
    };
    fs.linkSync = (...args) => { publishedAfterAbort ||= control.signal.aborted; return originalLink(...args); };
    syncBuiltinESMExports();
    const data = Buffer.from('cancel this import');
    let result, error;
    try { result = await importSourceAttachment({root, name:'取消.pdf', bytes:data.length,
      sha256:createHash('sha256').update(data).digest('hex'), signal:control.signal,
      readChunks:async function*(){yield data;} }); } catch (e) { error=e.message; }
    process.stdout.write(JSON.stringify({result,error,publishedAfterAbort,exists:fs.existsSync(target)}));
  `;
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '--eval', script, root]);
  assert.deepEqual(JSON.parse(stdout), { error: 'cancelled-before-publication', publishedAfterAbort: false, exists: false });
  assert.deepEqual(files(root), []);
});

test('normalizes unsafe leaves while keeping Chinese names and ordinary extensions', async t => {
  const { root, base } = fixture(t), data = Buffer.from('内容');
  for (const name of ['../越界.pdf', 'C:\\临时\\中文?.pdf', '.隐藏.pdf', 'CON.pdf', 'LPT1.txt', 'a<b>:c|d*e?.txt', '尾点. ', '..', 'node_modules', '讲义.app', '存档.notara-lock', '中'.repeat(150) + '.pdf']) {
    const result = await importSourceAttachment(input(root, name, data));
    assert.equal(safeWorkspaceRelativePath(result.path), result.path);
    assert.equal(result.path.split('/').length, 2);
    assert.ok(Buffer.byteLength(result.path.split('/')[1]) <= 255);
    if (name.endsWith('.pdf')) assert.ok(result.path.endsWith('.pdf'));
    if (name.includes('中文')) assert.ok(result.path.includes('中文'));
  }
  assert.equal(existsSync(join(base, '越界.pdf')), false);
});

test('portable normalization retains the extension after trailing dots/spaces and escapes Windows device names', async t => {
  const { root } = fixture(t), data = Buffer.from('内容');
  for (const [name, leaf] of [
    ['讲义.pdf. ', '讲义.pdf'], ['CON .pdf', '_CON .pdf'],
    ['COM¹.txt', '_COM¹.txt'], ['LPT².txt', '_LPT².txt'], ['LPT³.txt', '_LPT³.txt'],
  ]) {
    const result = await importSourceAttachment(input(root, name, data));
    assert.equal(result.path, `来源/${leaf}`);
  }
});

test('invalid metadata is rejected before reading or writing', async t => {
  const { root } = fixture(t), data = Buffer.from('valid');
  for (const extra of [
    { sha256: 'ab' }, { sha256: 'g'.repeat(64) }, { sha256: hash(data) + '\n' },
    { bytes: -1 }, { bytes: 1.5 }, { bytes: Number.MAX_SAFE_INTEGER + 1 }, { bytes: NaN },
    { name: '' }, { name: null }, { root: '' },
  ]) {
    await assert.rejects(importSourceAttachment(input(root, '材料.txt', data, {
      readChunks() { assert.fail('invalid metadata must not read'); }, ...extra,
    })), /invalid/);
  }
  await assert.rejects(importSourceAttachment(input(root, '材料.txt', data, { readChunks: null })), /invalid/);
  assert.deepEqual(readdirSync(root), []);
});

test('hash mismatch, short/long streams, reader errors and invalid chunks leave no partial files', async t => {
  const { root } = fixture(t), data = Buffer.from('abc');
  for (const extra of [
    { sha256: hash(Buffer.from('bad')) }, { bytes: 2 }, { bytes: 4 },
    { readChunks: async function* () { yield data; throw new Error('source_read_failed'); } },
    { readChunks: async function* () { yield 'abc'; } },
    { readChunks: () => [data] },
  ]) {
    await assert.rejects(importSourceAttachment(input(root, '材料.txt', data, extra)));
    assert.deepEqual(files(root), []);
  }
  const saved = await importSourceAttachment(input(root, '材料.txt', data));
  await assert.rejects(importSourceAttachment(input(root, '材料.txt', data, {
    readChunks: async function* () { yield Buffer.from('bad'); },
  })));
  assert.deepEqual(files(root), ['材料.txt']);
  assert.deepEqual(readFileSync(join(root, saved.path)), data);
});

test('abort before reading and during streaming removes temporary files and closes the producer', async t => {
  const { root } = fixture(t), data = Buffer.from('abc'), pre = new AbortController();
  pre.abort();
  await assert.rejects(importSourceAttachment(input(root, '取消.txt', data, {
    signal: pre.signal, readChunks() { assert.fail('aborted input must not read'); },
  })), { name: 'AbortError' });
  const active = new AbortController();
  let closed = false;
  await assert.rejects(importSourceAttachment(input(root, '取消.txt', data, {
    signal: active.signal, readChunks: async function* () {
      try { yield data.subarray(0, 1); active.abort(); yield data.subarray(1); }
      finally { closed = true; }
    },
  })), { name: 'AbortError' });
  assert.equal(closed, true);
  assert.deepEqual(files(root), []);
});

test('abort interrupts a pending next() without waiting for a blocked producer', { timeout: 2000 }, async t => {
  const { root } = fixture(t), controller = new AbortController();
  let started, returned = false;
  const ready = new Promise(resolve => { started = resolve; });
  const pending = importSourceAttachment(input(root, '取消.txt', Buffer.from('abc'), {
    signal: controller.signal, readChunks: () => ({
      [Symbol.asyncIterator]() { return this; },
      next() { started(); return new Promise(() => {}); },
      return() { returned = true; return { done: true }; },
    }),
  }));
  await ready;
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(returned, true);
  assert.deepEqual(files(root), []);
});

test('a failing or cancelled stream cannot publish even when it has already yielded all bytes', async t => {
  const { root } = fixture(t), data = Buffer.from('abc'), controller = new AbortController();
  await assert.rejects(importSourceAttachment(input(root, '取消.txt', data, {
    signal: controller.signal, readChunks: async function* () { yield data; controller.abort(); },
  })), { name: 'AbortError' });
  assert.deepEqual(files(root), []);
});

test('source directory, targets and fallback targets cannot be symlinks or hardlinks', async t => {
  const { root, base } = fixture(t), outside = join(base, '外部'), data = Buffer.from('abc');
  mkdirSync(outside);
  writeFileSync(join(outside, '文件.txt'), data);
  symlinkSync(outside, join(root, '来源'), 'dir');
  await assert.rejects(importSourceAttachment(input(root, '文件.txt', data)), /vault_path_invalid/);
  assert.deepEqual(readdirSync(outside), ['文件.txt']);
  unlinkSync(join(root, '来源'));
  mkdirSync(join(root, '来源'));
  for (const makeLink of [symlinkSync, linkSync]) {
    makeLink(join(outside, '文件.txt'), join(root, '来源/文件.txt'));
    await assert.rejects(importSourceAttachment(input(root, '文件.txt', data)), /vault_path_invalid/);
    rmSync(join(root, '来源/文件.txt'));
    assert.deepEqual(files(root), []);
  }
  writeFileSync(join(root, '来源/文件.txt'), '已占用');
  symlinkSync(join(outside, '文件.txt'), join(root, `来源/文件--${hash(data).slice(0, 12)}.txt`));
  await assert.rejects(importSourceAttachment(input(root, '文件.txt', data)), /vault_path_invalid/);
  assert.equal(files(root).length, 2);
  assert.deepEqual(readFileSync(join(outside, '文件.txt')), data);
});

test('a symlink root and a non-directory source parent are rejected', async t => {
  const { root, base } = fixture(t), data = Buffer.from('abc'), alias = join(base, 'alias');
  symlinkSync(root, alias, 'dir');
  await assert.rejects(importSourceAttachment(input(alias, '材料.txt', data)), /vault_path_invalid/);
  writeFileSync(join(root, '来源'), '用户文件');
  await assert.rejects(importSourceAttachment(input(root, '材料.txt', data)), /vault_path_invalid/);
  assert.equal(readFileSync(join(root, '来源'), 'utf8'), '用户文件');
});

test('root and source directory identities are checked again before publishing', async t => {
  for (const move of ['root', 'parent']) {
    const { root, base } = fixture(t), outside = join(base, '外部'), data = Buffer.from('abc');
    mkdirSync(outside);
    await assert.rejects(importSourceAttachment(input(root, '材料.txt', data, {
      readChunks: async function* () {
        yield data;
        const target = move === 'root' ? root : join(root, '来源');
        renameSync(target, target + '-moved');
        symlinkSync(outside, target, 'dir');
      },
    })), /vault_path_invalid/);
    assert.deepEqual(readdirSync(outside), []);
    const original = move === 'root' ? join(root + '-moved', '来源') : join(root, '来源-moved');
    assert.ok(readdirSync(original).every(name => name.startsWith('.')), 'no final attachment in the moved directory');
  }
});

test('a user file created during streaming wins the original filename', async t => {
  const { root } = fixture(t), data = Buffer.from('abc');
  const result = await importSourceAttachment(input(root, '材料.txt', data, {
    readChunks: async function* () { yield data; writeFileSync(join(root, '来源/材料.txt'), '用户新建'); },
  }));
  assert.equal(result.path, `来源/材料--${hash(data).slice(0, 12)}.txt`);
  assert.equal(readFileSync(join(root, '来源/材料.txt'), 'utf8'), '用户新建');
});

test('copying a same-volume cached attachment keeps independent bytes after both sides change', async t => {
  const { root, base } = fixture(t), cached = join(base, 'cached.pdf'), data = Buffer.from('原缓存内容');
  writeFileSync(cached, data);
  const result = await importSourceAttachment(input(root, '缓存.pdf', data, { readChunks: () => createReadStream(cached, { highWaterMark: 2 }) }));
  const imported = join(root, result.path);
  assert.notEqual(lstatSync(imported).ino, lstatSync(cached).ino);
  assert.equal(lstatSync(imported).nlink, 1);
  assert.equal(lstatSync(cached).nlink, 1);
  writeFileSync(cached, '缓存已变化');
  assert.deepEqual(readFileSync(imported), data);
  writeFileSync(imported, '用户改稿');
  assert.equal(readFileSync(cached, 'utf8'), '缓存已变化');
});
