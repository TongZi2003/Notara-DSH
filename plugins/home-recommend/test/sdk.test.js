import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { build } from 'esbuild';
import * as cordis from '@deepseek-ai/cordis';
import * as slots from '@deepseek-ai/dsh-client-ui-slots';
import { REMOTE_CONTRIBUTION } from '@oh-my-student/plugin-vault-sqlite/remote';
import { createRecommendationLoader } from '../src/model.js';

const require = createRequire(import.meta.url);
const modules = new Map(await Promise.all(['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'].map(async name => [name, await import(name)])));
modules.set('@deepseek-ai/cordis', cordis);
modules.set('@deepseek-ai/dsh-client-ui-slots', slots);
modules.set('@deepseek-ai/dsh-client-ui-primitives', { MarkdownText: () => null });
const nativeRequire = name => { if (modules.has(name)) return modules.get(name); return require(name); };
let renderer;
vm.runInNewContext(await readFile(require.resolve('@deepseek-ai/dsh-client-ui-renderer/client'), 'utf8'), {
  window: { __ModuleLoader__: { load(definition) { renderer = definition.factory(nativeRequire); } } },
  console, queueMicrotask,
});
const compiled = await build({ entryPoints: [fileURLToPath(new URL('../src/client.jsx', import.meta.url))], bundle: true,
  write: false, platform: 'browser', format: 'cjs', jsx: 'automatic', external: ['react', 'react/*', '@deepseek-ai/*'], loader: { '.css': 'text' }, logLevel: 'silent' });

function loadPlugin() {
  const styles = new Set();
  const module = { exports: {} };
  vm.runInNewContext(compiled.outputFiles[0].text, {
    module, exports: module.exports, require: nativeRequire, console,
    document: { createElement() { return { dataset: {}, remove() { styles.delete(this); } }; }, head: { append(style) { styles.add(style); } } },
  });
  return { plugin: module.exports.default, styles };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

function host({ vaultAvailable = true } = {}) {
  const ctx = new cordis.Context();
  ctx.plugin(renderer.SlotRegistry);
  let sourceCount = 0;
  ctx.provide('remote', { $mount() { throw new Error('P3 must never mount a remote contribution'); }, notaraVault: { homeRecommendations: async () => ({}) } });
  const mountVault = () => ctx.provide('remote.notaraVault', { homeRecommendations: async () => ({}) });
  if (vaultAvailable) mountVault();
  ctx.provide('conversation', {});
  ctx.provide('sessions', {});
  ctx.provide('inputTriggers', { registerSource() { sourceCount++; return () => { sourceCount--; }; } });
  return { ctx, sourceCount: () => sourceCount, mountVault };
}

test('actual Cordis: blank-session skill entrances preserve references without restoring the withdrawn home', async () => {
  const { ctx, sourceCount } = host();
  const { plugin, styles } = loadPlugin();
  let fiber = ctx.plugin(plugin);
  await settle();
  assert.equal(styles.size, 0);
  assert.equal(sourceCount(), 1);
  // The published conversation.content factory declares this public native seat.
  const undeclare = ctx.slots.registerFactory({ name: 'notara-test-content', scope: 'root',
    children: { 'conversation.input.dock': { kind: 'list', scope: 'session' }, 'conversation.composer.dock': { kind:'list',scope:'session' } } }, () => null);
  await settle();
  assert.equal(ctx.slots.entries('conversation.input.dock').length, 0);
  assert.equal(ctx.slots.entries('conversation.composer.dock')[0].options.id,'notara-skill-entrances');
  assert.equal(ctx.get('notaraHomeNavigation'), undefined);
  await fiber.dispose();
  assert.equal(styles.size, 0);
  assert.equal(sourceCount(), 0);
  assert.equal(ctx.slots.entries('conversation.composer.dock').length,0);
  assert.equal(ctx.slots.entries('conversation.input.dock').length, 0);
  fiber = ctx.plugin(plugin); await settle();
  assert.equal(styles.size, 0);
  assert.equal(sourceCount(), 1);
  assert.equal(ctx.slots.entries('conversation.input.dock').length, 0);
  assert.equal(ctx.get('notaraHomeNavigation'), undefined);
  await fiber.dispose();
  assert.equal(styles.size, 0);
  assert.equal(sourceCount(), 0);
  assert.equal(ctx.slots.entries('conversation.input.dock').length, 0);
  undeclare();
  await ctx.fiber.dispose();
});

test('actual Cordis: reference activation follows P2 without restoring withdrawn UI', async () => {
  const { ctx, sourceCount, mountVault } = host({ vaultAvailable: false });
  const { plugin, styles } = loadPlugin();
  const fiber = ctx.plugin(plugin);
  await settle();
  assert.equal(styles.size, 0);
  assert.equal(sourceCount(), 0);
  const unmountVault = mountVault(); await settle();
  assert.equal(styles.size, 0);
  assert.equal(sourceCount(), 1);
  await unmountVault(); await settle();
  assert.equal(styles.size, 0);
  assert.equal(sourceCount(), 0);
  await fiber.dispose();
  await ctx.fiber.dispose();
});

test('published SDK client Gateway returns RemoteResult consumed by the recommendation loader', async () => {
  const loadSdkClient = async name => {
    let result;
    vm.runInNewContext(await readFile(require.resolve(`${name}/client`).replace('client.node.js','client.browser.js'), 'utf8'), {
      window: { __ModuleLoader__: { load(definition) { result = definition.factory(nativeRequire); } } },
      console, queueMicrotask, crypto: globalThis.crypto, AbortController, AbortSignal, DOMException, setTimeout, clearTimeout,
    });
    return result;
  };
  const registry = await loadSdkClient('@deepseek-ai/dsh-typert-registry');
  const gateway = await loadSdkClient('@deepseek-ai/dsh-api-gateway');
  const ctx = new cordis.Context();
  const dto = { due: { total: 0, cards: [] }, guide: null, diary: { path: '日记/2026-10-24.md', exists: false } };
  let response = { ok: true, value: dto };
  let transportThrows = false;
  ctx.provide('connection', {
    rpc: { call: async () => { if (transportThrows) throw new Error('PRIVATE_NETWORK_ERROR'); return response; }, open() { throw new Error('no stream expected'); } },
    registerGenerationSource: () => () => {}, start: () => ({ stop() {} }),
    generation: { getSnapshot: () => undefined, subscribe: () => () => {} }, isLoopback: true,
  });
  try {
    await ctx.plugin(registry);
    await ctx.plugin(gateway);
    const unmount = await ctx.remote.$mount(REMOTE_CONTRIBUTION);
    const success = await ctx.remote.notaraVault.homeRecommendations({});
    assert.equal(success.ok, true);
    assert.deepEqual(success.value, dto);
    const updates = [];
    const loader = createRecommendationLoader(() => ctx.remote.notaraVault.homeRecommendations({}), update => updates.push(update));
    await loader.load(); assert.equal(updates.at(-1).phase, 'ready');
    response = { ok: false, error: { code: 'gateway/internal', message: 'PRIVATE_REMOTE_ERROR' } };
    const failed = await ctx.remote.notaraVault.homeRecommendations({});
    assert.equal(failed.ok, false);
    await loader.load(); assert.equal(updates.at(-1).phase, 'error');
    transportThrows = true;
    await loader.load(); assert.equal(updates.at(-1).phase, 'error');
    assert.equal(JSON.stringify(updates).includes('PRIVATE_'), false);
    loader.dispose(); await unmount();
  } finally { await ctx.fiber.dispose(); }
});
