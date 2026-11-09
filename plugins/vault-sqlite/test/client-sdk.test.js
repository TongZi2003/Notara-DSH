import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import * as cordis from '@deepseek-ai/cordis';
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry';
import { TypertGatewayService } from '@deepseek-ai/dsh-api-gateway';
import { RemoteAccessService } from '@deepseek-ai/dsh-api-remote-access';
import { Peer } from '@deepseek-ai/dsh-client-connection';
import { REMOTE_CONTRIBUTION } from '../remote.js';
import hostPlugin from '../index.js';
const require = createRequire(import.meta.url);

test('actual browser Gateway mounts the single bootstrap and withdraws namespace on unload', async t => {
  let gatewayClient;
  const gatewaySource = join(dirname(require.resolve('@deepseek-ai/dsh-api-gateway')), 'client.browser.js');
  runInNewContext(readFileSync(gatewaySource, 'utf8'), {
    window: { __ModuleLoader__: { load(row) { gatewayClient = row.factory(id => { assert.equal(id, '@deepseek-ai/cordis'); return cordis; }); } } },
    crypto: globalThis.crypto, AbortController, AbortSignal, setTimeout, clearTimeout,
  });
  const bundled = await build({ entryPoints: [new URL('../src/client.jsx', import.meta.url).pathname], bundle: true, format: 'cjs', platform: 'browser', write: false });
  const module = { exports: {} };
  runInNewContext(bundled.outputFiles[0].text, { module, exports: module.exports });
  const client = module.exports.default, ctx = new cordis.Context(), host = new cordis.Context();
  const root = mkdtempSync(join(tmpdir(), 'notara-client-sdk-'));
  t.after(async () => { await ctx.fiber.dispose(); await host.fiber.dispose(); rmSync(root, { recursive: true, force: true }); });
  writeFileSync(join(root, '资料.md'), '# 资料\n');
  await host.plugin(TypertRegistry); await host.plugin(RemoteAccessService); await host.plugin(TypertGatewayService, {}); await host.plugin(hostPlugin, { root });
  const peer = new Peer(host,{principal:{kind:'owner'}});t.after(()=>peer.dispose());
  await ctx.plugin(TypertRegistry);
  ctx.provide('connection', {
    isLoopback: true,
    generation: { getSnapshot: () => undefined },
    registerGenerationSource: () => () => {},
    start: () => ({ stop() {} }),
    rpc: { open() {}, async call(_base, endpoint, payload) {
      const [namespace, method] = endpoint.split('/');
      return { ok: true, value: await host.typertGateway.invoke({ namespace, method, args: payload.args, peer }) };
    } },
  });
  await ctx.plugin(gatewayClient);
  const owner = ctx.plugin(client); await owner;
  assert.equal(ctx.typert.remotes.list().length, REMOTE_CONTRIBUTION.descriptors.length);
  assert.equal((await ctx.remote.notaraVault.query({})).value.total, 1);
  await assert.rejects(() => ctx.remote.$mount(REMOTE_CONTRIBUTION), /already mounted/);
  await owner.dispose();
  assert.equal(ctx.get('remote.notaraVault'), undefined);
  assert.equal(ctx.typert.remotes.list().length, 0);
  const reloaded = ctx.plugin(client); await reloaded;
  assert.equal(ctx.typert.remotes.list().length, REMOTE_CONTRIBUTION.descriptors.length);
});
