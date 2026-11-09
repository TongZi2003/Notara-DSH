import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { renderToStaticMarkup } from 'react-dom/server';
import * as cordis from '@deepseek-ai/cordis';
import * as slots from '@deepseek-ai/dsh-client-ui-slots';
import * as hostPlugin from '../index.js';

const require = createRequire(import.meta.url);
const nativeRequire = name => name.endsWith('.css') ? '' : name === '@xyflow/react' ? { Position: { Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' } } : /^@milkdown\/|^zustand|^zundo$/.test(name) ? {} : name === '@deepseek-ai/cordis' ? cordis : name === '@deepseek-ai/dsh-client-ui-slots' ? slots : name === '@deepseek-ai/dsh-client-store' ? { defineStore: spec => ({ spec }) } : name === '@deepseek-ai/dsh-client-ui-primitives' ? { MarkdownText: () => null, MarkdownDelegateProvider: ({ children }) => children } : require(name);
let renderer;
vm.runInNewContext(await readFile(require.resolve('@deepseek-ai/dsh-client-ui-renderer/client'), 'utf8'), {
  window: { __ModuleLoader__: { load(definition) { renderer = definition.factory(nativeRequire); } } }, console, queueMicrotask,
});
// This suite verifies Cordis registration/lifecycle; actual editors are exercised
// with their real packages in visual-editors-integration.test.mjs.
const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/client.jsx', import.meta.url))], bundle: true, write: false, format: 'cjs', platform: 'browser', conditions: ['production'], define: { 'process.env.NODE_ENV': '"production"' }, external: ['react', 'react/*', 'react-dom', 'react-dom/*', '@deepseek-ai/*', 'codemirror', '@codemirror/*', '@lezer/*', '@milkdown/crepe', '@milkdown/kit/*', '@xyflow/react', 'zustand', 'zustand/vanilla', 'zundo'], loader: { '.css': 'text' }, logLevel: 'silent' });
const settle = () => new Promise(resolve => setImmediate(resolve));

function pluginFixture() {
  const styles = new Set(), window = new EventTarget(), module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, {
    module, exports: module.exports, require: nativeRequire, console, window, CustomEvent,
    document: { createElement: () => ({ dataset: {}, remove() { styles.delete(this); } }), head: { append(element) { styles.add(element); } } },
  });
  return { plugin: module.exports.default, installNativeStartTitle: module.exports.installNativeStartTitle, installMainPresetPicker: module.exports.installMainPresetPicker, styles, window };
}

test('main preset picker follows late native registration and restores it on unload', async () => {
  const ctx = new cordis.Context(), fixture = pluginFixture();
  await ctx.plugin(renderer.SlotRegistry);
  const slot = 'conversation.hero.agentPreset';
  const undeclare = ctx.slots.registerFactory({ name: 'native-preset-test', scope: 'root', children: { [slot]: { kind: 'single', scope: 'session-maybe' } } }, () => null);
  const dispose = fixture.installMainPresetPicker(ctx);
  const inject = () => ({ hooks: {}, load() {}, select() {} });
  const original = ctx.slots.register({ name: slot, inject }, () => null);
  await settle();
  assert.equal(ctx.slots.entries(slot).length, 2);
  assert.equal(ctx.slots.entriesOfSlot(slot)[0].options.priority, -20);
  assert.equal(ctx.slots.entriesOfSlot(slot)[0].inject, ctx.slots.entries(slot).find(entry => entry.options.priority !== -20).inject);
  dispose(); await settle();
  assert.equal(ctx.slots.entries(slot).length, 1);
  original(); undeclare(); await ctx.fiber.dispose();
});

test('native start-page title compatibility shadows and restores the original title slot', async () => {
  const ctx = new cordis.Context(), fixture = pluginFixture();
  await ctx.plugin(renderer.SlotRegistry);
  const undeclare = ctx.slots.registerFactory({ name: 'native-title-test-root', scope: 'root', children: { 'sidebar.right.pane.tab.title': { kind: 'keyed', scope: 'root' } } }, () => null);
  const key = '@deepseek-ai/dsh-client-ui-sidebar-right/guide';
  const original = ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key }, props => props.useTabInfo().tab.title);
  const dispose = fixture.installNativeStartTitle(ctx, { get: () => ({ title: () => '开始' }) });
  await settle();
  const entry = ctx.slots.entries('sidebar.right.pane.tab.title').find(item => item.options.priority === -20);
  assert.ok(entry, 'Uses a distinct native shadowing priority');
  const render = title => renderToStaticMarkup(entry.component({ useTabInfo: () => ({ tab: { kind: 'guide', contentId: 'sidebar://guide', title } }) }));
  assert.equal(render('资料库'), '开始');
  assert.equal(render('Start'), 'Start', 'Other native titles are untouched');
  dispose(); await settle();
  assert.equal(ctx.slots.entries('sidebar.right.pane.tab.title').length, 1);
  original(); undeclare(); await ctx.fiber.dispose();
});

test('actual Cordis + published SlotRegistry: two native seats, namespace dependency, unload/re-enable', async () => {
  const ctx = new cordis.Context(), fixture = pluginFixture();
  await ctx.plugin(renderer.SlotRegistry);
  const panels = []; let references = 0;
  ctx.provide('remote', { $mount() { throw new Error('P4 must not mount the shared namespace'); } });
  ctx.provide('conversation', {}); ctx.provide('sessions', {});
  ctx.provide('uiConversation', {});
  ctx.provide('theme', {overrideTokens(){return ()=>{};}});
  ctx.provide('layout', { selectPanel: value => panels.push(value) });
  ctx.provide('inputTriggers', { registerSource() { references++; return () => references--; } });
  const undeclare = ctx.slots.registerFactory({ name: 'vault-views-test-root', scope: 'root', children: { main: { kind: 'keyed', scope: 'root' }, 'sidebar.panellist': { kind: 'list', scope: 'root' } } }, () => null);
  let owner = ctx.plugin(fixture.plugin); await settle();
  assert.equal(fixture.styles.size, 0, 'does not activate before P2 namespace');
  const unprovide = ctx.provide('remote.notaraVault', { query: async () => ({ ok: true, value: { documents: [], total: 0 } }) });
  await settle();
  assert.equal(fixture.styles.size, 1); assert.equal(references, 3);
  assert.equal(ctx.slots.entries('main')[0].options.key, 'notara-vault');
  assert.doesNotThrow(() => ctx.slots.entries('main')[0].component({ renderSlot() {} }), 'native entry render obeys Cordis property inject authorization');
  assert.equal(ctx.slots.entries('main')[0].children['notara.vault.canvas'].kind, 'single');
  const removeCanvas = ctx.slots.register({ name: 'notara.vault.canvas' }, () => null);
  assert.equal(ctx.slots.entries('notara.vault.canvas').length, 1);
  assert.equal(ctx.slots.entries('sidebar.panellist')[0].options.id, 'notara-vault');
  fixture.window.dispatchEvent(new CustomEvent('notara:open-document', { detail: { path: '卡片/甲.md' } }));
  assert.deepEqual(panels, ['notara-vault']);
  await owner.dispose(); await settle();
  assert.equal(fixture.styles.size, 0); assert.equal(references, 0);
  assert.equal(ctx.slots.entries('main').length, 0); assert.equal(ctx.slots.entries('sidebar.panellist').length, 0);
  assert.equal(ctx.slots.entries('notara.vault.canvas').length, 0); removeCanvas();
  fixture.window.dispatchEvent(new CustomEvent('notara:open-document', { detail: { path: '卡片/乙.md' } }));
  assert.equal(panels.length, 1, 'event listener removed on unload');
  owner = ctx.plugin(fixture.plugin); await settle();
  assert.equal(fixture.styles.size, 1); assert.equal(ctx.slots.entries('main').length, 1);
  await unprovide(); await settle();
  assert.equal(fixture.styles.size, 0); assert.equal(references, 0);
  await owner.dispose(); undeclare(); await ctx.fiber.dispose();
});

test('actual Cordis host: optional web carrier registers and disposes package-only PDF route', async () => {
  const ctx = new cordis.Context(), routes = new Set();
  const owner = ctx.plugin(hostPlugin); await settle();
  assert.equal(routes.size, 0);
  const unprovide = ctx.provide('webServer', { register(route) { routes.add(route); return () => routes.delete(route); } });
  await settle();
  assert.equal(routes.size, 3); assert.deepEqual([...routes].map(route => route.path), [hostPlugin.PDF_ASSET_ROOT, hostPlugin.DRAWING_ASSET_ROOT, hostPlugin.COMPANION_ASSET_ROOT]);
  await owner.dispose(); assert.equal(routes.size, 0);
  await unprovide(); await ctx.fiber.dispose();
});
