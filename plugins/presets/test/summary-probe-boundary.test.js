import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkSummaryProbeAccess } from './summary-probe-boundary.js';

test('real summary probe keeps writes and traversals inside its fixture and permits only explicit resource reads', async t => {
  const parent = await mkdtemp(join(tmpdir(), 'notara-summary-boundary-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = join(parent, 'workspace'), resources = join(parent, 'resources'), outside = join(parent, 'private');
  for (const path of [root, resources, outside]) await mkdir(path);
  const check = (name, args) => checkSummaryProbeAccess(root, resources, name, args);
  assert.equal(await check('write', { file_path: '路线/新建.md' }), true);
  assert.equal(await check('read', { file_path: join(resources, 'lesson.md') }), true);
  assert.equal(await check('edit', { file_path: join(resources, 'lesson.md') }), false);
  assert.equal(await check('read', { file_path: '../private/secret' }), false);
  assert.equal(await check('write', { file_path: join(outside, 'secret') }), false);
  assert.equal(await check('glob', { pattern: '../../**/*' }), false);
  assert.equal(await check('glob', { pattern: '**/*.md' }), true);
  assert.equal(await check('grep', { pattern: 'secret', path: outside }), false);
  await symlink(outside, join(root, 'escape'));
  assert.equal(await check('write', { file_path: 'escape/new.md' }), false);
  assert.equal(await check('read', { file_path: 'escape/new.md' }), false);
  assert.equal(await check('bash', { command: 'pwd' }), false);
});
