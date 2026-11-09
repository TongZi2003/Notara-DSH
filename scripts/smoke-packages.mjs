import { mkdtemp, mkdir, readdir, readFile, rm, symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { workspaceRoot } from './native-runtime.mjs';

const root = await mkdtemp(join(workspaceRoot, 'work/packed-'));
try {
  const dependencies = join(root, 'node_modules');
  await mkdir(join(dependencies, '@notara'), { recursive: true });
  for (const entry of await readdir(join(workspaceRoot, 'node_modules'))) {
    if (entry === '@notara') continue;
    await symlink(join(workspaceRoot, 'node_modules', entry), join(dependencies, entry));
  }
  for (const folder of ['presets', 'vault-sqlite', 'home-recommend', 'vault-views', 'graph-and-blocks', 'pomodoro', 'calendar', 'bundle']) {
    const manifest = JSON.parse(await readFile(join(workspaceRoot, 'plugins', folder, 'package.json'), 'utf8'));
    const destination = join(root, folder);
    await mkdir(destination);
    const file = join(workspaceRoot, 'work/packages', `${manifest.name.replace('@','').replace('/','-')}-${manifest.version}.tgz`);
    const extract = spawnSync('tar', ['-xzf', file, '-C', destination, '--strip-components=1'], { stdio: 'inherit' });
    if (extract.status !== 0) throw new Error(`Could not extract ${manifest.name}`);
    await symlink(destination, join(dependencies, manifest.name), 'dir');
  }
  // Current native protocol/UI checks use an isolated deterministic provider;
  // an account-onboarding modal must not stand in for package acceptance.
  const test = spawnSync(process.execPath, ['--test', ...['bundle-integration','pomodoro-integration','calendar-integration','remote-integration'].map(name=>join(workspaceRoot,`tests/${name}.test.mjs`))], {
    cwd: workspaceRoot, stdio: 'inherit', env: { ...process.env, NOTARA_TEST_DEPENDENCIES: dependencies },
  });
  process.exitCode = test.status ?? 1;
} finally { await rm(root, { recursive: true, force: true }); }
