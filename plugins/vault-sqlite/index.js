import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { Service } from '@deepseek-ai/cordis';
import { createVaultStore } from './vault-indexer.js';
import { archivedSessionIdsOf, createLessonBindingsService } from './lesson-bindings.js';
import { createWhiteboardBindingsService } from './whiteboard-bindings.js';
import { VAULT_REMOTE_METHODS } from './remote.js';
import { realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';

export { createVaultStore } from './vault-indexer.js';
export const name = '@oh-my-student/plugin-vault-sqlite';

const LESSON_METHODS = new Set(['lessonPlan', 'bindLessonPlan', 'setCurrentLessonTask', 'toggleLessonTask', 'lessonBindings']);
const WHITEBOARD_METHODS = new Set(['whiteboard', 'setWhiteboard']);

export class NotaraVaultRemote extends TypertRemoteService {
  constructor(ctx, config) {
    super(ctx, 'notaraVault');
    this.config = config;
    this.stores = new Map();
    this.registry = () => ctx.get('workspaceRegistry');
    const entry = this.forRoot(realpathSync(config.root), true);
    this.store = entry.store;
    this.ready = entry.ready;
    this.lessons = createLessonBindingsService(ctx, {
      resolveWorkspaceEntry: workspaceId => this.forWorkspace(workspaceId),
      ...(config.now ? { now: config.now } : {}),
    });
    this.whiteboards = createWhiteboardBindingsService(ctx, { resolveSession: this.lessons.resolveSession });
    // Avoid an unhandled rejection before the Host's first invocation.
    this.ready.catch(error => ctx.emit('internal/error', error));
    ctx.effect(() => () => {
      this.closed = true;
      return this.whiteboards.close().then(() => Promise.all([this.lessons.close(), ...[...this.stores.values()].map(({ store }) => store.close())]));
    });
  }
  async [Service.init]() { await this.ready; }
  forRoot(root, initial = false) {
    let entry = this.stores.get(root);
    if (!entry) {
      const base = this.config.cachePath;
      const cachePath = initial || !base || base === ':memory:' ? base : `${base}.${createHash('sha256').update(root).digest('hex').slice(0, 20)}`;
      const store = createVaultStore({ ...this.config, root, cachePath });
      entry = { root, store, ready: store.startWatching() };
      entry.ready.catch(() => {});
      this.stores.set(root, entry);
    }
    return entry;
  }
  forWorkspace(workspaceId) {
    if (this.closed) throw new Error('vault_closed');
    if (workspaceId === undefined) return { root: realpathSync(this.config.root), store: this.store, ready: this.ready };
    if (typeof workspaceId !== 'string' || !workspaceId.trim()) throw new Error('vault_workspace_invalid');
    const workspace = this.registry()?.get(workspaceId);
    if (!workspace?.path) throw new Error('vault_workspace_not_found');
    return this.forRoot(realpathSync(workspace.path));
  }
  async *changes(input, signal) {
    const entry = this.forWorkspace(input?.workspaceId);
    await entry.ready;
    yield* entry.store.changes(signal);
  }
  async homeSession(input) {
    this.forWorkspace(input?.workspaceId);
    const deliveries = this.ctx.get('notaraSummaryDeliveries');
    if (!deliveries) throw new Error('home_service_unavailable');
    return deliveries.homeSession(input);
  }
}
for (const method of VAULT_REMOTE_METHODS.filter(method => !['changes', 'homeRecommendations', 'homeSession'].includes(method) && !LESSON_METHODS.has(method) && !WHITEBOARD_METHODS.has(method))) Object.defineProperty(NotaraVaultRemote.prototype, method, {
  value: async function(input) {
    const { workspaceId, ...request } = input ?? {};
    const entry = this.forWorkspace(workspaceId);
    await entry.ready;
    const result = entry.store[method](request);
    if (method === 'read' && typeof request.path === 'string') {
      try { entry.store.update(request.path); } catch {}
    }
    return result;
  },
});
Object.defineProperty(NotaraVaultRemote.prototype, 'homeRecommendations', {
  value: async function(input) {
    const { workspaceId } = input ?? {};
    const entry = this.forWorkspace(workspaceId);
    await entry.ready;
    const { bindings } = await this.lessons.lessonBindings({ workspaceId }).catch(() => ({ bindings: [] }));
    const registry = this.registry();
    const ws = workspaceId !== undefined ? registry?.get?.(workspaceId) : await registry?.resolveByPath?.(entry.root);
    const archivedIds = archivedSessionIdsOf(registry, ws);
    const activeBindings = bindings.filter(item => !archivedIds.has(item.sessionId));
    entry.store.syncHomeFiles?.({ bindings: activeBindings });
    const hasHostSessions = Boolean(
      this.ctx.get?.('sessionController')
      || this.ctx.get?.('sessionQuery')
      || this.ctx.get?.('agents')
      || this.ctx.get?.('sessions'),
    );
    let validSessionIds = null;
    if (hasHostSessions) {
      validSessionIds = new Set(activeBindings.map(item => item.sessionId));
      const candidates = new Set([
        ...(Array.isArray(ws?.sessionIds) ? ws.sessionIds : []),
        ...(entry.store.routeSessionRefs?.() ?? []),
      ]);
      for (const candidateId of candidates) {
        if (typeof candidateId !== 'string' || !candidateId || archivedIds.has(candidateId) || validSessionIds.has(candidateId)) continue;
        if (await this.lessons.isActiveClassroom({ workspaceId, sessionId: candidateId })) {
          validSessionIds.add(candidateId);
        }
      }
    } else if (Array.isArray(ws?.sessionIds)) {
      validSessionIds = new Set([
        ...ws.sessionIds.filter(id => !archivedIds.has(id)),
        ...activeBindings.map(item => item.sessionId),
      ]);
    }
    return {
      ...entry.store.homeRecommendations({
        bindings: activeBindings,
        skipSync: true,
        ...(input?.routeContext === undefined ? {} : {routeContext:input.routeContext}),
        ...(validSessionIds ? { validSessionIds } : {}),
      }),
      bindings: activeBindings,
    };
  },
});
for (const method of LESSON_METHODS) Object.defineProperty(NotaraVaultRemote.prototype, method, {
  value: async function(input) {
    if (this.closed) throw new Error('vault_closed');
    return this.lessons[method](input ?? {});
  },
});
for (const method of WHITEBOARD_METHODS) Object.defineProperty(NotaraVaultRemote.prototype, method, {
  value: async function(input) {
    if (this.closed) throw new Error('vault_closed');
    return this.whiteboards[method](input ?? {});
  },
});
Object.defineProperty(NotaraVaultRemote.prototype, '@deepseek-ai/dsh-typert-protocol/remote-methods', {
  value: Object.freeze({ version: 1, methods: Object.freeze(VAULT_REMOTE_METHODS.map(method => ({ method, ...(method === 'changes' ? { mode: 'stream' } : {}), invocation: { kind: 'direct' } }))) }),
});

export async function apply(ctx, config = {}) {
  if (typeof config.root !== 'string') throw new Error('vault_root_required');
  await ctx.plugin(NotaraVaultRemote, config);
}
export default { name, apply };
