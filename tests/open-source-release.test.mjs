import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const text = path => readFile(new URL(path, root), 'utf8');
const directories = ['presets','vault-sqlite','home-recommend','vault-views','graph-and-blocks','pomodoro','calendar','bundle'];

test('first-party packages and release locks consistently declare AGPL-3.0-only', async () => {
  const license = await text('LICENSE');
  assert.match(license, /GNU AFFERO GENERAL PUBLIC LICENSE/);
  assert.match(license, /13\. Remote Network Interaction/);
  const workspace = JSON.parse(await text('package.json'));
  const workspaceLock = JSON.parse(await text('package-lock.json'));
  const hostLock = JSON.parse(await text('scripts/release-host-lock.json'));
  assert.equal(workspace.license, 'AGPL-3.0-only');
  assert.equal(workspaceLock.packages[''].license, workspace.license);
  for (const directory of directories) {
    const pkg = JSON.parse(await text(`plugins/${directory}/package.json`));
    assert.equal(pkg.license, workspace.license);
    assert.equal(workspaceLock.packages[`plugins/${directory}`].license, pkg.license);
    assert.equal(hostLock.packages[`node_modules/${pkg.name}`].license, pkg.license);
    assert.equal(pkg.repository.directory, `plugins/${directory}`);
    assert.equal(await text(`plugins/${directory}/LICENSE`), license);
    assert.match(await text(`plugins/${directory}/COPYRIGHT`), /AGPL-3\.0-only/);
  }
});

test('release generators retain open-source terms instead of reintroducing proprietary notices', async () => {
  const pack = await text('scripts/pack.mjs');
  const notices = await text('scripts/release-notices.mjs');
  assert.doesNotMatch(pack + notices, /proprietary|UNLICENSED/);
  assert.match(pack, /'LICENSE'/);
  assert.match(notices, /excalidraw-fonts/);
  const fontNotices = await text('scripts/licenses/excalidraw-fonts.txt');
  for (const name of ['Assistant','Cascadia','ComicShanns','Excalifont','Liberation','Lilita','Nunito','Virgil','Xiaolai']) assert.ok(fontNotices.includes(name), name);
  assert.match(fontNotices, /SIL OPEN FONT LICENSE/);
});

test('the owner-confirmed original classmate assets and license statement are retained', async () => {
  const names = await readdir(new URL('plugins/vault-views/assets/companions/', root));
  assert.equal(names.filter(name => name.endsWith('.png')).length, 4);
  for (const name of ['deepseek','claude','gemini','gpt']) {
    const data = await readFile(new URL(`plugins/vault-views/assets/companions/${name}-bean-eyes.png`, root));
    assert.equal(data.subarray(1,4).toString(), 'PNG');
  }
  assert.match(await text('plugins/vault-views/src/companions.jsx'), /\$\{avatar\}-bean-eyes\.png/);
  assert.match(await text('plugins/vault-views/assets/companions/SOURCES.md'), /AGPL-3\.0-only/);
});

test('the export omits runtime archives and book-derived lesson samples', async () => {
  const names = await readdir(root);
  for (const name of ['apps','services','pi-packages','integrations']) assert.ok(!names.includes(name), name);
  const ignored=await text('.gitignore');
  // Tests may generate local evidence; it must stay out of source commits.
  for(const name of ['tmp','output','outputs','work','release'])assert.ok(ignored.split('\n').includes(`/${name}/`),name);
  const samples = await readdir(new URL('examples/lesson-preparation/', root));
  assert.ok(!samples.includes('derivatives-v8'));
  assert.ok(!samples.includes('sequences'));
});
