import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'resources'].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (/\.test\.(m?js)$/.test(entry.name)) files.push(path);
  }
}
await walk(resolve(root, 'plugins'));
if (!files.length) throw new Error('No plugin tests found');
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=3', ...files.sort()], { cwd: root, stdio: 'inherit' });
process.exitCode = result.status ?? 1;
if (process.exitCode === 0) {
  const browser = spawnSync(process.execPath, [resolve(root, 'plugins/graph-and-blocks/test/browser.mjs')], { cwd: root, stdio: 'inherit' });
  process.exitCode = browser.status ?? 1;
}
