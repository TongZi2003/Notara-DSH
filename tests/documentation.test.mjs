import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const paths = ['README.md', 'docs/INSTALL.md', 'docs/USAGE.md', 'docs/RELEASE.md'];
const documents = await Promise.all(paths.map(async path => ({ path, text: await readFile(join(root, path), 'utf8') })));
const install = documents.find(document => document.path === 'docs/INSTALL.md').text;
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const shellBlocks = text => [...text.matchAll(/```sh\n([\s\S]*?)\n```/g)].map(match => match[1]);

test('public getting-started documents link to files and sections that exist', async () => {
  const anchor = title => title.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/ /g, '-');
  for (const document of documents) {
    assert.doesNotMatch(document.text, /\/Users\/|\.codex\/|\.gemini\//, document.path);
    for (const [, href] of document.text.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)) {
      if (/^[\w+.-]+:/.test(href)) continue;
      const [file, fragment] = href.split('#');
      const target = resolve(root, dirname(document.path), decodeURIComponent(file));
      await access(target);
      if (fragment && target.endsWith('.md')) {
        const contents = await readFile(target, 'utf8');
        const anchors = [...contents.matchAll(/^#{1,6} (.+)$/gm)].map(match => anchor(match[1]));
        assert.ok(anchors.includes(decodeURIComponent(fragment)), `${document.path}: ${href}`);
      }
    }
  }
});

test('source-install commands use the current release and valid shell syntax', () => {
  for (const document of documents) {
    for (const command of shellBlocks(document.text)) {
      if (process.platform === 'win32') continue; // These examples target a POSIX shell.
      const syntax = spawnSync('bash', ['-n'], { input: command, encoding: 'utf8' });
      assert.equal(syntax.status, 0, `${document.path}: ${syntax.stderr}`);
    }
  }
  assert.ok(install.includes(`npm run pack:plugins -- release/${version}`));
  assert.ok(install.includes(`node release/${version}/install-release.mjs "$notara_home/profiles/web"`));
  assert.match(install, /DSH_HOME/);
  assert.match(install, /完整网页地址/);
  assert.match(install, /尚未发布/);
});

test('copyable installation configuration preserves dependencies and binds the selected Vault', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'notara-docs-'));
  try {
    const home = join(temporary, '安装目录 with spaces');
    const vault = join(temporary, '学习资料 with spaces');
    const profile = join(home, 'profiles', 'web');
    await mkdir(profile, { recursive: true });
    const original = { name: 'notara-local-host', private: true, dependencies: { 'example-dependency': '1.0.0' }, overrides: { example: '2.0.0' } };
    await writeFile(join(profile, 'package.json'), JSON.stringify(original));
    const source = install.match(/node --input-type=module <<'NODE'\n([\s\S]*?)\nNODE/);
    assert.ok(source, 'installation guide must contain its executable configuration example');
    const result = spawnSync(process.execPath, ['--input-type=module'], {
      input: source[1], encoding: 'utf8',
      env: { ...process.env, NOTARA_HOME: home, NOTARA_VAULT: vault }
    });
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'));
    assert.deepEqual(manifest, { ...original, dsh: { profile: { bundles: [
      '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@oh-my-student/dsh-bundle'
    ] } } });
    assert.deepEqual(parse(await readFile(join(profile, 'cordis.patch.yml'), 'utf8')), [
      { id: 'notara-vault-sqlite', config: { root: vault, cachePath: join(home, 'vault-index.sqlite') } }
    ]);
    await access(vault);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
