import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVaultChanges } from '../changes.js';
import { bindVaultRemote, subscribeVaultChanges, notifyVaultChanged, vaultChangeIncludes } from '../workspace-client.js';
import { Context, Service } from '@deepseek-ai/cordis';

test('views share one workspace stream, isolate changes and release the final subscription', async t => {
  const previous = globalThis.window;
  globalThis.window = new EventTarget();
  const opened = [], closed = [], channels = new Map();
  const remote = { changes({ workspaceId }) {
    opened.push(workspaceId);
    const channel = createVaultChanges(), control = new AbortController(); channels.set(workspaceId, channel);
    const stream = channel.subscribe(control.signal);
    return { [Symbol.asyncIterator]: () => stream, dispose() { if (!control.signal.aborted) { closed.push(workspaceId); control.abort(); } } };
  } };
  const a = [], b = [], releases = [];
  t.after(() => { for (const release of releases) release(); globalThis.window = previous; });
  const frame = () => new Promise(resolve => setTimeout(resolve, 40));
  releases.push(subscribeVaultChanges(bindVaultRemote(remote, 'A'), change => a.push(change)));
  releases.push(subscribeVaultChanges(bindVaultRemote(remote, 'A'), () => {}));
  releases.push(subscribeVaultChanges(bindVaultRemote(remote, 'B'), change => b.push(change)));
  await frame();
  assert.deepEqual(opened, ['A', 'B']);
  assert.equal(a[0].reset, true); assert.equal(b[0].reset, true);
  channels.get('A').publish([{ path: '同名.md', revision: 'one' }]);
  await frame();
  assert.equal(a.at(-1).path, '同名.md'); assert.equal(b.length, 1);
  releases[0](); assert.deepEqual(closed, []);
  releases[1](); assert.deepEqual(closed, ['A']);
  releases[2](); await frame(); assert.deepEqual(closed, ['A', 'B']);
});

test('Cordis wrappers share one stream; a batch invalidates once and retains every path', async t => {
  const previous = globalThis.window; globalThis.window = new EventTarget();
  const ctx = new Context(), channel = createVaultChanges(); let opens = 0;
  class Remote extends Service {
    constructor(ctx) { super(ctx, 'auditVault'); }
    changes() { opens++; const control = new AbortController(), stream = channel.subscribe(control.signal); return { [Symbol.asyncIterator]: () => stream, dispose: () => control.abort() }; }
  }
  const plugin = await ctx.plugin({ apply(ctx) { new Remote(ctx); } });
  const releases = [], a = [], b = [];
  t.after(async () => { releases.forEach(off => off()); channel.close(); await plugin.dispose(); globalThis.window = previous; });
  assert.notEqual(ctx.auditVault, ctx.auditVault, 'real host access creates fresh wrappers');
  releases.push(subscribeVaultChanges(bindVaultRemote(ctx.auditVault, 'A'), x => a.push(x)));
  releases.push(subscribeVaultChanges(bindVaultRemote(ctx.auditVault, 'A'), x => b.push(x)));
  await new Promise(r => setTimeout(r, 40));
  assert.equal(opens, 1);
  a.length = b.length = 0;
  const changes = Array.from({length:20}, (_,i) => ({path:`${i}.md`,revision:`r${i}`}));
  channel.publish(changes);
  await new Promise(r => setTimeout(r, 40));
  assert.equal(a.length, 1); assert.equal(b.length, 1);
  assert.deepEqual(a[0].changes, changes);
  assert.equal(vaultChangeIncludes(a[0],'19.md'),true);
  assert.equal(vaultChangeIncludes(a[0],'absent.md'),false);
  channel.publish(changes);
  await new Promise(r => setTimeout(r, 40));
  assert.equal(a.length, 1, 'same revisions do not trigger another read');
  notifyVaultChanged(bindVaultRemote(ctx.auditVault,'A'),{path:'saved.md',revision:'saved'});
  await new Promise(r=>setTimeout(r,40));
  channel.publish([{path:'saved.md',revision:'saved'}]);
  await new Promise(r=>setTimeout(r,40));
  assert.equal(a.length,2,'a delayed stream echo of a local save is deduplicated');
  channel.publish([{path:'saved.md',revision:null}]);
  await new Promise(r=>setTimeout(r,40));
  assert.equal(a.at(-1).revision,null,'deletion is a different revision');
});
