import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots';
import { Context, Service } from '@deepseek-ai/cordis';
import hostPlugin from '../index.js';

// Slot lifecycle tests do not boot the browser module loader. Keep the native
// UI boundary explicit, including Toast; real UI behavior has browser tests.
function nativePrimitivesFixture(){return {name:'native-ui-primitive-test-seat',setup(builder){
  builder.onResolve({filter:/^@deepseek-ai\/dsh-client-ui-primitives$/},()=>({path:'primitives',namespace:'test-seat'}));
  builder.onLoad({filter:/.*/,namespace:'test-seat'},()=>({contents:"import React from 'react'; export const Toast = () => null; export const Button = () => null; export const Input = () => null; export const MarkdownText = ({text}) => React.createElement('p',null,text); export const MarkdownDelegateProvider = ({children}) => children; export const ReferenceIconMedium = () => null; export const Modal = () => null; export const projectUserText = text => text; export const writeClipboard = async () => true; export const IconCopyOutlineRegular = () => null; export const FileTypeIcon = () => null;"}));
}};}

test('host is a real loadable Cordis plugin and has no host-side service mutation', () => {
  const ctx = new Context(); assert.doesNotThrow(() => ctx.plugin(hostPlugin));
});
test('rc.1 SlotCore extension waits for native assistant, preserves native inject and restores it on disposal', async () => {
  const output = new URL('../.test-output/', import.meta.url); await mkdir(output, { recursive: true });
  const outfile = fileURLToPath(new URL('markdown-extension.cjs', output));
  await build({ entryPoints: [fileURLToPath(new URL('../src/markdown-extension.jsx', import.meta.url))], outfile, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react'], logLevel: 'warning', plugins:[nativePrimitivesFixture()] });
  const { installMarkdownBlocks } = createRequire(import.meta.url)(outfile);
  const slots = new SlotCore();
  const disposeRoot = slots.register({ name: 'root', children: { 'conversation.chat.node': { kind: 'keyed', scope: 'session' } } }, () => null);
  const userText={subscribe:()=>()=>{},getSnapshot:()=>0,createEvaluator:()=>({text})=>[{id:'text',start:0,end:text.length,data:{text}}]};
  const disposeExtension = installMarkdownBlocks({ slots,uiConversation:{userText} }, { MarkdownText: ({ text }) => React.createElement('p', { 'data-original-markdown': text }, text) });
  assert.equal(slots.entries('conversation.chat.node').length, 0);
  const Native = () => null, inject = () => ({ hooks: { presentation: {} } });
  const disposeNative = slots.register({ name: 'conversation.chat.node', key: 'assistant-step', locale: 'chat', inject }, Native);
  await new Promise(resolve => setImmediate(resolve));
  const winner = slots.entriesOfSlot('conversation.chat.node')[0]; assert.equal(winner.options.priority, -20); assert.equal(winner.inject, inject); assert.equal(winner.locale, 'chat');
  const indented = [' ```frames', ' title 推演', ' frame 当前', ' 条件', ' predict: 下一步？', ' frame 以后', ' NATIVE_SLOT_FUTURE_SECRET', ' ```'].join('\n');
  const markup = renderToStaticMarkup(React.createElement(winner.component, { sessionId: 'sdk-fixture', node: { key: 'native-fixture-node', data: { status: 'settled', blocks: [{ kind: 'text', text: indented }] } } }));
  assert.match(markup, /nv-block-card nv-block-frames/); assert.doesNotMatch(markup, /NATIVE_SLOT_FUTURE_SECRET/);
  const disposeUser = slots.register({ name: 'conversation.chat.node', key: 'user', locale: 'chat', inject }, Native);
  await new Promise(resolve => setImmediate(resolve));
  const userSlot = slots.entriesOfSlot('conversation.chat.node').find(e => e.options.key === 'user');
  assert.equal(userSlot.options.priority, -20);
  assert.equal(userSlot.inject, inject);
  const raw = '## 答案\n**我的推导** $x^Tx=25$';
  const userMarkup = renderToStaticMarkup(React.createElement(userSlot.component, { node: { data: { content: [{ type: 'text', text: raw }], referenceLabels: ['上节课堂'] } }, t: (x, params) => params?.labels ?? x }));
  assert.match(userMarkup, /nv-user-markdown/);
  assert.ok(userMarkup.includes('答案'));
  assert.ok(userMarkup.includes('$x^Tx=25$'));
  assert.ok(userMarkup.includes('上节课堂'), 'References remain visible even when their labels are not repeated in the message');
  assert.equal((userMarkup.match(/我的推导/g) ?? []).length, 2, 'The raw attribute plus the displayed body, without duplicate reference prose');
  disposeExtension(); assert.equal(slots.entriesOfSlot('conversation.chat.node')[0].component, Native);
  assert.equal(slots.entriesOfSlot('conversation.chat.node').find(e => e.options.key === 'user').component, Native);
  disposeUser();
  disposeNative(); disposeRoot();
});

test('real Cordis UI scope permits both remote namespace and exact service; disposal removes style', async () => {
  const output = new URL('../.test-output/', import.meta.url); await mkdir(output, { recursive: true });
  const outfile = fileURLToPath(new URL('client-permission.cjs', output));
  await build({ entryPoints: [fileURLToPath(new URL('../src/client.jsx', import.meta.url))], outfile, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react'], loader: { '.css': 'text' }, logLevel: 'warning', plugins: [nativePrimitivesFixture()] });
  const plugin = createRequire(import.meta.url)(outfile).default;
  const root = new Context(), scopes = [], styles = new Set();
  class Slots extends Service {
    constructor(ctx) { super(ctx, 'slots'); }
    inject(name) { scopes.push({ name, ctx: this.ctx }); return () => {}; }
  }
  new Slots(root);
  const vault = { graph: async () => ({ ok: true, value: { nodes: [], edges: [] } }) };
  root.provide('remote', { notaraVault: vault }); root.provide('remote.notaraVault', vault);
  root.provide('layout', {}); root.provide('sessions', {}); root.provide('conversation', {}); root.provide('uiConversation', {});
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  globalThis.window = new EventTarget();
  globalThis.document = { createElement: () => { const style = { dataset: {}, remove: () => styles.delete(style) }; return style; }, head: { append: style => styles.add(style) } };
  let fiber;
  try {
    fiber = root.plugin(plugin); await new Promise(resolve => setImmediate(resolve));
    assert.ok(scopes.some(s => s.name === 'main')); assert.ok(scopes.some(s => s.name === 'notara.vault.canvas'));
    for (const scope of scopes) assert.equal(scope.ctx.remote.notaraVault, vault);
    assert.equal(styles.size, 1);
    await fiber.dispose(); assert.equal(styles.size, 0);
  } finally { await fiber?.dispose(); globalThis.window = previousWindow; globalThis.document = previousDocument; }
});
