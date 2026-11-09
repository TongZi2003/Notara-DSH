import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export function registerHomeSessionTests({ harness, mountSummaryVault }) {
  test('home session: explicit entrance binds once, isolates workspaces and resumes across restart without a model turn', { timeout: 30000 }, async t => {
    const root = await mkdtemp(join(tmpdir(), 'notara-home-session-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const h = await harness(t, { existingRoot: root, withController: true });
    await mountSummaryVault(h);
    const ws = await h.ctx.workspaceRegistry.resolveByPath(root);
    assert.deepEqual(await h.ctx.notaraVault.homeSession({ workspaceId: ws.id }), { sessionId: null });
    const [first, duplicate] = await Promise.all([1, 2].map(() => h.ctx.notaraVault.homeSession({ workspaceId: ws.id, open: true })));
    assert.ok(first.sessionId); assert.equal(duplicate.sessionId, first.sessionId);
    assert.equal(h.requests.length, 0, 'opening home is not a prompt');
    const home = h.ctx.agents.get(first.sessionId);
    assert.equal(h.ctx.agentPresets.composedPreset(home.ctx), 'notara-coordinator');
    const another = await h.create('notara-teacher');
    assert.notEqual(another.id, first.sessionId, 'explicit new working sessions remain independent');
    const otherPath = join(root, 'other'); await mkdir(otherPath);
    const otherWs = await h.ctx.workspaceRegistry.create(otherPath);
    const second = await h.ctx.notaraVault.homeSession({ workspaceId: otherWs.id, open: true });
    assert.notEqual(second.sessionId, first.sessionId);
    assert.equal((await h.ctx.notaraVault.homeSession({ workspaceId: ws.id })).sessionId, first.sessionId);
    await assert.rejects(h.ctx.notaraVault.homeSession({ workspaceId: 'missing', open: true }));
    await h.ctx.fiber.dispose();
    const restarted = await harness(t, { existingRoot: root, withController: true });
    await mountSummaryVault(restarted);
    const restored = await restarted.ctx.notaraVault.homeSession({ workspaceId: ws.id, open: true });
    assert.equal(restored.sessionId, first.sessionId);
    assert.equal(restarted.requests.length, 0);
  });

  test('home session: existing ownership is retained and archived homes are not resurrected', { timeout: 30000 }, async t => {
    const h = await harness(t, { withController: true }); await mountSummaryVault(h);
    const ws = await h.ctx.workspaceRegistry.resolveByPath(h.root);
    const home = await h.create('notara-coordinator');
    await h.ctx.notaraSummaryDeliveries.rememberHome(home);
    assert.equal((await h.ctx.notaraVault.homeSession({ workspaceId: ws.id, open: true })).sessionId, home.id);
    await h.ctx.workspaceRegistry.archiveSession(home.id);
    assert.equal((await h.ctx.notaraVault.homeSession({ workspaceId: ws.id })).sessionId, null);
    const next = await h.ctx.notaraVault.homeSession({ workspaceId: ws.id, open: true });
    assert.notEqual(next.sessionId, home.id);
    assert.ok(h.ctx.workspaceRegistry.archivedSessionIds.includes(home.id));
  });
}
