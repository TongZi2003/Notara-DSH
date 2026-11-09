import { createHash, randomUUID } from 'node:crypto';
import { constants, closeSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, unlinkSync, writeSync } from 'node:fs';
import { extname, isAbsolute, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ignoredPart, safeWorkspaceRelativePath } from './vault-path.js';

const fail = code => { throw new Error(code); };
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino;
const sameVersion = (a, b) => sameFile(a, b) && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.nlink === b.nlink;
const reserved = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]) *(?:\.|$)/i;

function truncateUtf8(text, limit) {
  let result = '', size = 0;
  for (const char of text) {
    const bytes = Buffer.byteLength(char);
    if (size + bytes > limit) break;
    result += char; size += bytes;
  }
  return result;
}
function leafName(name) {
  if (typeof name !== 'string' || !name || name.length > 1000) fail('source_import_name_invalid');
  let leaf = name.replace(/[\/\\\x00-\x1f\x7f<>:"|?*]/g, '_').replace(/^\.+/, '_').replace(/[. ]+$/, '') || '_';
  if (reserved.test(leaf)) leaf = '_' + leaf;
  // These names cannot pass the shared workspace contract even as plain files.
  if (/\.(?:app|notara-lock)$/i.test(leaf)) leaf += '_';
  if (ignoredPart(leaf)) leaf = '_' + leaf;
  safeWorkspaceRelativePath(`来源/${leaf}`);
  return leaf;
}
function* candidates(leaf, digest) {
  const ext = extname(leaf), stem = leaf.slice(0, leaf.length - ext.length);
  // Leave room for a stem even when an attachment has an exceptionally long extension.
  if (Buffer.byteLength(ext) > 160) fail('source_import_name_invalid');
  const make = suffix => safeWorkspaceRelativePath(`来源/${truncateUtf8(stem, 255 - Buffer.byteLength(ext + suffix))}${suffix}${ext}`);
  yield make('');
  for (const length of [12, 24, 64]) yield make(`--${digest.slice(0, length)}`);
  for (let ordinal = 2; ; ordinal++) yield make(`--${digest}--${ordinal}`);
}

async function nextChunk(iterator, signal) {
  signal?.throwIfAborted();
  if (!signal) return iterator.next();
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try { return await Promise.race([iterator.next(), aborted]); }
  finally { signal.removeEventListener('abort', onAbort); }
}

/** Host-bound attachment bytes -> an independent, create-only workspace source file.
 * No reader allowlist, index, session state or persistent import receipt is involved.
 */
export async function importSourceAttachment({ root, name, sha256, bytes, readChunks, signal }) {
  if (typeof root !== 'string' || !isAbsolute(root) || typeof sha256 !== 'string' || sha256.length !== 64 || !/^[a-f0-9]{64}$/i.test(sha256) || !Number.isSafeInteger(bytes) || bytes < 0 || typeof readChunks !== 'function') fail('source_import_input_invalid');
  const leaf = leafName(name), digest = sha256.toLowerCase();
  // Validate the bounded leaf and extension before creating any directory.
  const firstPath = candidates(leaf, digest).next().value;
  signal?.throwIfAborted();
  const workspace = resolve(root), directory = join(workspace, '来源');
  const rootStat = lstatSync(workspace);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory() || realpathSync(workspace) !== workspace) fail('vault_path_invalid');
  function checkRoot() {
    const current = lstatSync(workspace);
    if (current.isSymbolicLink() || !current.isDirectory() || !sameFile(rootStat, current) || realpathSync(workspace) !== workspace) fail('vault_path_invalid');
  }
  checkRoot();
  try { mkdirSync(directory); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const directoryStat = lstatSync(directory);
  function checkParents() {
    checkRoot();
    const current = lstatSync(directory);
    if (current.isSymbolicLink() || !current.isDirectory() || !sameFile(directoryStat, current)) fail('vault_path_invalid');
  }
  async function checkedTarget(path) {
    safeWorkspaceRelativePath(path);
    const full = join(workspace, path);
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      checkParents();
      let stat;
      try { stat = lstatSync(full); }
      catch (error) { if (error.code === 'ENOENT') return { full, stat: null }; throw error; }
      if (stat.isSymbolicLink() || !stat.isFile()) fail('vault_path_invalid');
      if (stat.nlink === 1) return { full, stat };
      // A different process publishes by link + unlink. Never read a multiply
      // linked file; briefly allow that interval to settle, then revalidate.
      // Persistent hard links remain rejected, and cancellation stays prompt.
      if (stat.nlink !== 2 || attempt >= 40) fail('vault_path_invalid');
      await delay(5, undefined, { signal });
    }
  }
  await checkedTarget(firstPath);

  const temp = join(directory, `.source-import-${randomUUID()}.tmp`);
  let fd, tempStat, iterator, finished = false;
  try {
    checkParents();
    fd = openSync(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
    tempStat = fstatSync(fd);
    const stream = readChunks();
    if (typeof stream?.[Symbol.asyncIterator] !== 'function') fail('source_import_stream_invalid');
    iterator = stream[Symbol.asyncIterator]();
    const hasher = createHash('sha256');
    let received = 0;
    while (true) {
      const chunk = await nextChunk(iterator, signal);
      signal?.throwIfAborted();
      if (chunk.done) { finished = true; break; }
      if (!(chunk.value instanceof Uint8Array)) fail('source_import_chunk_invalid');
      received += chunk.value.byteLength;
      if (received > bytes) fail('source_import_length_mismatch');
      checkParents();
      hasher.update(chunk.value);
      for (let offset = 0; offset < chunk.value.byteLength;) {
        const written = writeSync(fd, chunk.value, offset, chunk.value.byteLength - offset);
        if (!written) fail('source_import_write_failed');
        offset += written;
      }
    }
    if (received !== bytes) fail('source_import_length_mismatch');
    if (hasher.digest('hex') !== digest) fail('source_import_hash_mismatch');
    fsyncSync(fd);
    closeSync(fd); fd = undefined;

    async function matches({ full, stat }, path) {
      if (stat.size !== bytes) return false;
      const existing = openSync(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const before = fstatSync(existing);
        if (!before.isFile() || before.nlink !== 1 || !sameVersion(stat, before)) fail('vault_path_invalid');
        const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(64 * 1024);
        let count, length = 0;
        while ((count = readSync(existing, buffer, 0, buffer.length, null)) > 0) {
          signal?.throwIfAborted();
          length += count;
          if (length > bytes) return false;
          hash.update(buffer.subarray(0, count));
        }
        const after = fstatSync(existing), current = (await checkedTarget(path)).stat;
        if (!current || !sameVersion(before, after) || !sameVersion(after, current)) fail('source_import_conflict');
        return length === bytes && hash.digest('hex') === digest;
      } finally { closeSync(existing); }
    }

    for (const path of candidates(leaf, digest)) {
      // This check/link/unlink interval is synchronous, just like Vault create-only
      // save, so another call in this process cannot observe our temporary link.
      signal?.throwIfAborted();
      const target = await checkedTarget(path);
      signal?.throwIfAborted();
      if (target.stat) {
        if (await matches(target, path)) return { path, sha256: digest, bytes, created: false };
        continue;
      }
      checkParents();
      const staged = lstatSync(temp);
      if (!staged.isFile() || staged.nlink !== 1 || !sameFile(staged, tempStat) || staged.size !== bytes) fail('vault_path_invalid');
      try { linkSync(temp, target.full); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        // Another process may have won publication after our lstat. Re-read its
        // actual bytes instead of selecting a second path for identical content.
        const winner = await checkedTarget(path);
        if (winner.stat && await matches(winner, path)) return { path, sha256: digest, bytes, created: false };
        continue;
      }
      unlinkSync(temp);
      return { path, sha256: digest, bytes, created: true };
    }
  } finally {
    if (!finished && iterator) {
      // A producer blocked in next() must not block abort cleanup in return().
      try { Promise.resolve(iterator.return?.()).catch(() => {}); } catch { /* retain the import error */ }
    }
    try { if (fd !== undefined) closeSync(fd); }
    finally {
      if (tempStat) {
        // Never follow a replacement parent or unlink a replacement temp inode.
        // An externally moved directory can retain its staged file; Node has no
        // portable unlinkat(dirfd) to clean it safely at its unknown new location.
        let unchanged = false;
        try { checkParents(); unchanged = sameFile(lstatSync(temp), tempStat); }
        catch (error) { if (error.code !== 'ENOENT' && error.message !== 'vault_path_invalid') throw error; }
        if (unchanged) unlinkSync(temp);
      }
    }
  }
}
