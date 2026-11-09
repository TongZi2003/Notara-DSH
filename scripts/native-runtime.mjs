import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { basename, dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { samplePdf } from '../tests/sample-pdf.mjs';
import {PROFILE_TEMPLATES} from '@deepseek-ai/dsh-app-boot';

export const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginNames = ['presets', 'vault-sqlite', 'home-recommend', 'vault-views', 'graph-and-blocks', 'pomodoro', 'calendar'];
const redact = text => text.replace(/([?&]token=)[^\s&"<>]+/g, '$1[redacted]');

/** Uses only a copied learning set and its own DSH home, port and child process. */
export async function startNativeRuntime({ fixture = 'showcase-examples/case-a-svd', enabled = pluginNames, bundle = false, testModel = false, modelFixture = 'tests/native-model.mjs', sessionSearch = false, dependencyDirectory = process.env.NOTARA_TEST_DEPENDENCIES || join(workspaceRoot, 'node_modules') } = {}) {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Run with Node >=24 (node_modules/.bin/node).');
  const work = join(workspaceRoot, 'work');
  await mkdir(work, { recursive: true });
  const root = await mkdtemp(join(work, 'native-'));
  const home = join(root, 'home');
  const vault = join(root, 'vault');
  await cp(resolve(workspaceRoot, fixture), vault, { recursive: true });
  await mkdir(join(vault, '来源'), { recursive: true });
  await writeFile(join(vault, '来源/集成测试讲义.pdf'), samplePdf());
  // Native first-use Workspace and the Vault service must address the same
  // copied files; no default Documents directory outside this run is touched.
  await mkdir(join(root, 'Documents/deepseek-harness'), { recursive: true });
  await symlink(vault, join(root, 'Documents/deepseek-harness/default-workspace'), 'dir');
  await mkdir(join(home, 'profiles/web'), { recursive: true });
  for (const location of [home, join(home, 'profiles/web')]) {
    await symlink(dependencyDirectory, join(location, 'node_modules'), 'dir');
  }
  if(bundle)await writeFile(join(home,'profiles/web/package.json'),JSON.stringify({name:'notara-test-profile',private:true,dependencies:{'@oh-my-student/dsh-bundle':JSON.parse(await readFile(join(workspaceRoot,'package.json'),'utf8')).version},dsh:{profile:{bundles:[...PROFILE_TEMPLATES.web.bundles,'@oh-my-student/dsh-bundle']}}}));
  const insert = (bundle?[]:enabled).map(name => ({
    id: `notara-${name}`, name: `@oh-my-student/plugin-${name}`,
    ...(name === 'vault-sqlite' ? { config: { root: vault, cachePath: join(root, 'vault-index.sqlite') } } : {}),
  }));
  if (testModel) insert.push({ id: 'notara-integration-fixture', name: join(workspaceRoot, modelFixture) });
  const patch = [
    { id: 'workspace-controller', config: { documentsDirectory: join(root, 'Documents') } },
    ...(sessionSearch ? [{ id: 'session-query-sqlite', config: { path: ':memory:', openAt: 'first-search' } }] : []),
    // This web preview is operated inside a browser, so keep its chooser in that browser.
    { id: 'directory-picker', disabled: true },
    { insert: [
      { id: 'notara-directory-browser-host', name: '@deepseek-ai/dsh-host-directory-picker-browse' },
      { id: 'notara-directory-browser-ui', name: '@deepseek-ai/dsh-client-ui-directory-picker-browse' },
      { id: 'notara-native-sidebar-browser', name: '@deepseek-ai/dsh-client-ui-sidebar-browser' },
    ] },
    ...(testModel ? [
      { id: 'agent-default-model', config: { provider: 'notara-integration-fixture', model: 'fixed-response' } },
      { id: 'llm-deepseek', disabled: true },
      { id: 'llm-deepseek-account', disabled: true },
    ] : []),
    ...(!bundle&&enabled.includes('presets') ? [{ id: 'agent-preset-registry', config: { default: 'notara-coordinator' } }] : []),
    { insert },
  ];
  await writeFile(join(home, 'cordis.patch.yml'), JSON.stringify(patch, null, 2));
  await writeFile(join(home, 'profiles/web/cordis.patch.yml'), JSON.stringify(bundle?[{id:'notara-vault-sqlite',config:{root:vault,cachePath:join(root,'vault-index.sqlite')}}]:[]));
  const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'SystemRoot'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  Object.assign(env, { DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' });
  const child = spawn(process.execPath, ['--max-http-header-size=65536', join(dependencyDirectory, '.bin/dsh'), 'web', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
    cwd: vault, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '', authUrl = '', spawnError;
  const collect = chunk => {
    output = (output + chunk.toString()).slice(-1_000_000);
    authUrl = /dsh web: (http:\/\/\S+)/.exec(output)?.[1] ?? authUrl;
  };
  child.stdout.on('data', collect); child.stderr.on('data', collect);
  const exited = new Promise(resolveExit => {
    child.once('exit', resolveExit);
    child.once('error', error => { spawnError = error; resolveExit(); });
  });
  let stopped = false;
  async function stop({ preserve = false } = {}) {
    if (stopped) return;
    stopped = true;
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      try { await exited; } finally { clearTimeout(timer); }
    }
    await writeFile(join(work, `${basename(root)}.log`), redact(output));
    if (!preserve) await rm(root, { recursive: true, force: true });
  }
  try {
    const deadline = Date.now() + 45_000;
    while (!authUrl) {
      if (spawnError || child.exitCode !== null || child.signalCode !== null) throw new Error(`Native DSH failed: ${spawnError?.message ?? ''}\n${redact(output)}`);
      if (Date.now() >= deadline) throw new Error(`Native DSH timed out\n${redact(output)}`);
      await new Promise(resolveReady => setTimeout(resolveReady, 50));
    }
    return { root, home, vault, authUrl, log: () => redact(output), stop, patch, async setEnabled(name, enabled) {
      const row = insert.find(value => value.id === `notara-${name}`);
      if (!row) throw new Error(`Unknown plugin ${name}`);
      row.disabled = !enabled;
      await writeFile(join(home, 'cordis.patch.yml'), JSON.stringify(patch, null, 2));
    } };
  } catch (error) { await stop(); throw error; }
}
