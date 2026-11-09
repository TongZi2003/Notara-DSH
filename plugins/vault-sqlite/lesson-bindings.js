import { realpathSync } from 'node:fs';
import { z } from 'zod';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import { safeRelativePath } from './vault-path.js';
import { anchorLessonTasks, clearCurrentLessonTask, projectLessonPlan, setCurrentLessonTask, toggleLessonTask } from './lesson-plan.js';

const fail = code => { throw new Error(code); };

export const lessonBindingRecordSchema = z.object({
  workspaceId: z.string().min(1),
  root: z.string().min(1),
  path: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const lessonBindingsDomainSpec = defineDomain({
  name: 'notara_lesson_bindings',
  version: 1,
  invalidRecords: 'backup-and-skip',
  tables: {
    bindings: domainTable(lessonBindingRecordSchema),
  },
});

function createMemoryTable() {
  const records = new Map();
  return {
    get: key => records.get(key),
    entries: () => [...records.entries()][Symbol.iterator](),
    put: async (key, value) => { records.set(key, lessonBindingRecordSchema.parse(value)); },
    delete: async key => records.delete(key),
  };
}

function recordedPresetOf(header, events, liveAgent, ctx) {
  const fromEvents = events?.filter(event => event.type === 'agent-preset/selected').at(-1)?.data?.agentPreset;
  if (fromEvents) return fromEvents;
  const composed = liveAgent && ctx.get?.('agentPresets')?.composedPreset?.(liveAgent.ctx);
  return composed ?? header?.agentPreset ?? undefined;
}

function subagentModeOf(events) {
  const descriptor = events?.filter(event => event.type === 'subagent/descriptor').at(-1)?.data;
  return descriptor?.mode ?? null;
}

function isClassroomPresetEligible(preset, header, events) {
  if (header?.origin === 'subagent') {
    const mode = subagentModeOf(events);
    return preset === 'notara-teacher' && mode === 'continuable';
  }
  return preset === undefined || preset === 'notara-teacher';
}

async function inspectHostSession(ctx, sessionId) {
  if (typeof sessionId !== 'string' || !sessionId.trim()) fail('vault_session_invalid');
  const liveAgent = ctx.get?.('agents')?.get?.(sessionId);
  if (liveAgent?.session) {
    return { header: liveAgent.session.header, events: liveAgent.session.snapshotEvents?.() ?? [], liveAgent };
  }
  const attached = ctx.get?.('sessions')?.get?.(sessionId);
  if (attached) {
    return { header: attached.header, events: attached.snapshotEvents?.() ?? [], liveAgent: null };
  }
  const controller = ctx.get?.('sessionController');
  const query = ctx.get?.('sessionQuery');
  const persistence = ctx.get?.('sessionPersistence');
  if (!controller && !query && !ctx.get?.('agents') && !ctx.get?.('sessions')) {
    fail('vault_session_unavailable');
  }
  if (persistence?.stat) {
    const stat = await persistence.stat(sessionId);
    if (!stat) fail('vault_session_not_found');
  }
  if (controller?.inspect) {
    try {
      const inspected = await controller.inspect(sessionId);
      if (!inspected?.meta) fail('vault_session_not_found');
      return { header: inspected.meta, events: inspected.events ?? [], liveAgent: null };
    } catch (error) {
      if (error.message === 'vault_session_not_found' || /not[-_ ]?found|unknown session|ENOENT/i.test(String(error.code ?? error.message))) {
        fail('vault_session_not_found');
      }
      throw error;
    }
  }
  if (query?.readSession) {
    try {
      const read = await query.readSession(sessionId);
      if (!read?.session) fail('vault_session_not_found');
      return { header: read.session, events: read.events ?? [], liveAgent: null };
    } catch (error) {
      if (error.message === 'vault_session_not_found' || /not[-_ ]?found|unknown session|ENOENT/i.test(String(error.code ?? error.message))) {
        fail('vault_session_not_found');
      }
      throw error;
    }
  }
  fail('vault_session_not_found');
}

function listWorkspaceLessonCandidates(store) {
  const rows = store.query({ view: 'lessons', sort: 'updated', limit: 200 }).documents ?? [];
  return rows.map(row => {
    const tasks = Array.isArray(row.tasks) ? row.tasks : [];
    return {
      path: row.path,
      title: row.title,
      revision: row.revision,
      mtimeMs: row.mtimeMs,
      completed: tasks.filter(task => task.checked).length,
      total: tasks.length,
    };
  });
}

export function archivedSessionIdsOf(registry, ws = null) {
  const archived = new Set();
  try {
    const regArchived = registry?.archivedSessionIds;
    if (Array.isArray(regArchived) || regArchived instanceof Set) {
      for (const id of regArchived) if (typeof id === 'string' && id) archived.add(id);
    }
  } catch { /* Uninitialized registry mock. */ }
  const wsArchived = ws?.archivedSessionIds;
  if (Array.isArray(wsArchived) || wsArchived instanceof Set) {
    for (const id of wsArchived) if (typeof id === 'string' && id) archived.add(id);
  }
  return archived;
}

export function createLessonBindingsService(ctx, { resolveWorkspaceEntry, now = () => Date.now() } = {}) {
  let domain = null;
  let opening = null;
  let fallbackTable = null;
  let closed = false;
  const mutations = new Map();

  function serializeSessionMutation(mutate) {
    return (input = {}) => {
      const sessionId = input?.sessionId;
      // The domain queues durable writes, but validation and file edits must also
      // wait until the preceding mutation has published this session's binding.
      const result = (mutations.get(sessionId) ?? Promise.resolve()).then(() => mutate(input));
      const release = () => {
        if (mutations.get(sessionId) === settled) mutations.delete(sessionId);
      };
      const settled = result.then(release, release);
      mutations.set(sessionId, settled);
      return result;
    };
  }

  async function openTable() {
    if (closed) fail('vault_closed');
    if (domain) return domain.table('bindings');
    if (fallbackTable) return fallbackTable;
    const facility = ctx.get?.('storageDomain') ?? ctx.storage?.domain;
    if (!facility) {
      fallbackTable = createMemoryTable();
      return fallbackTable;
    }
    if (!opening) {
      opening = facility.open(lessonBindingsDomainSpec).then(opened => {
        if (closed) return opened.close().then(() => fail('vault_closed'));
        domain = opened;
        return domain.table('bindings');
      }).finally(() => { opening = null; });
    }
    return opening;
  }

  async function resolveVerifiedSession(workspaceId, sessionId, { requireMutationEligibility = false, rejectArchived = false, acceptsPreset = isClassroomPresetEligible } = {}) {
    const entry = resolveWorkspaceEntry(workspaceId);
    await entry.ready;
    const session = await inspectHostSession(ctx, sessionId);
    if (typeof session.header?.cwd !== 'string' || !session.header.cwd.trim()) fail('vault_workspace_mismatch');
    let sessionRoot;
    try { sessionRoot = realpathSync(session.header.cwd); }
    catch { fail('vault_workspace_mismatch'); }
    if (sessionRoot !== entry.root) fail('vault_workspace_mismatch');
    const registry = ctx.get?.('workspaceRegistry');
    let canonicalWorkspaceId = typeof workspaceId === 'string' && workspaceId.trim() ? workspaceId : 'default';
    let registeredWorkspace = null;
    if (registry) {
      if (workspaceId !== undefined) {
        const registered = registry.get(workspaceId);
        if (!registered?.path || realpathSync(registered.path) !== entry.root) fail('vault_workspace_mismatch');
        registeredWorkspace = registered;
        canonicalWorkspaceId = registered.id ?? workspaceId;
      } else if (registry.resolveByPath) {
        const resolved = await registry.resolveByPath(entry.root);
        registeredWorkspace = resolved ?? null;
        if (resolved?.id) canonicalWorkspaceId = resolved.id;
      }
    }
    const archivedIds = archivedSessionIdsOf(registry, registeredWorkspace);
    const workspaceSessionIds = Array.isArray(registeredWorkspace?.sessionIds) || registeredWorkspace?.sessionIds instanceof Set
      ? new Set(registeredWorkspace.sessionIds)
      : null;
    let archived = archivedIds.has(sessionId);
    let attached = true;
    if (session.header?.origin === 'subagent') {
      let parentId = session.header?.parentSession ?? session.header?.parentId;
      if (!parentId) {
        if (workspaceSessionIds) attached = false;
      } else {
        const seen = new Set([sessionId]);
        while (parentId) {
          if (seen.has(parentId)) { attached = false; break; }
          seen.add(parentId);
          if (archivedIds.has(parentId)) archived = true;
          let parent;
          try { parent = await inspectHostSession(ctx, parentId); }
          catch { attached = false; break; }
          if (parent.header?.origin !== 'subagent') {
            if (workspaceSessionIds && !workspaceSessionIds.has(parentId)) attached = false;
            break;
          }
          parentId = parent.header?.parentSession ?? parent.header?.parentId;
          if (!parentId && workspaceSessionIds) attached = false;
        }
      }
    } else if (workspaceSessionIds && !workspaceSessionIds.has(sessionId)) {
      attached = false;
    }
    if (!attached && (requireMutationEligibility || rejectArchived)) fail('vault_workspace_mismatch');
    if ((requireMutationEligibility || rejectArchived) && archived) fail('vault_session_archived');
    const preset = recordedPresetOf(session.header, session.events, session.liveAgent, ctx);
    const classroomRole = attached && acceptsPreset(preset, session.header, session.events);
    const eligible = !archived && classroomRole;
    if (requireMutationEligibility && !eligible) fail('vault_session_role_forbidden');
    return { entry, session, sessionRoot, canonicalWorkspaceId, preset, classroomRole, eligible, archived };
  }

  function readProjectedLesson(store, path) {
    try {
      const doc = store.read({ path });
      return { missing: false, plan: projectLessonPlan(doc) };
    } catch (error) {
      if (error.code === 'ENOENT' || ['vault_not_found', 'vault_lesson_type_required', 'vault_frontmatter_invalid'].includes(error.message)) {
        return { missing: true, plan: null };
      }
      throw error;
    }
  }

  return {
    // In-process identity check shared with other session-bound Vault surfaces;
    // it is not a remote method. Lesson callers keep their original role policy.
    resolveSession: resolveVerifiedSession,
    async close() {
      closed = true;
      if (opening) { try { await opening; } catch { /* Closed during open. */ } }
      if (domain) { const current = domain; domain = null; await current.close(); }
    },

    async isActiveClassroom({ workspaceId, sessionId } = {}) {
      try {
        await resolveVerifiedSession(workspaceId, sessionId, { requireMutationEligibility: true, rejectArchived: true });
        return true;
      } catch {
        return false;
      }
    },

    async lessonPlan(input = {}) {
      const { workspaceId, sessionId } = input ?? {};
      const { entry, classroomRole, eligible } = await resolveVerifiedSession(workspaceId, sessionId);
      if (!classroomRole) {
        return { sessionId, eligible: false, bound: false, missing: false, path: null, updatedAt: null, plan: null, candidates: [] };
      }
      const table = await openTable();
      const record = table.get(sessionId);
      const candidates = eligible ? listWorkspaceLessonCandidates(entry.store) : [];
      if (!record || record.root !== entry.root) {
        return { sessionId, eligible, bound: false, missing: false, path: null, updatedAt: null, plan: null, candidates };
      }
      const { missing, plan } = readProjectedLesson(entry.store, record.path);
      return {
        sessionId,
        eligible,
        bound: true,
        missing,
        path: record.path,
        updatedAt: record.updatedAt,
        plan,
        candidates,
      };
    },

    bindLessonPlan: serializeSessionMutation(async (input = {}) => {
      const { workspaceId, sessionId, path, expectedRevision } = input ?? {};
      const { entry, canonicalWorkspaceId } = await resolveVerifiedSession(workspaceId, sessionId, { requireMutationEligibility: true });
      const table = await openTable();
      const previous = table.get(sessionId);
      if (path === null) {
        await table.delete(sessionId);
        entry.store.notifyChange?.(previous?.path ?? '__lesson_binding__', null);
        return { sessionId, eligible: true, bound: false, missing: false, path: null, updatedAt: null, plan: null, candidates: listWorkspaceLessonCandidates(entry.store) };
      }
      if (typeof path !== 'string' || !path.trim()) fail('vault_input_invalid');
      const normalized = safeRelativePath(path);
      // Sync index immediately in case the teacher just wrote the file via native write tool before chokidar settled.
      try { entry.store.update(normalized); } catch (error) {
        if (error.code === 'ENOENT' || error.message === 'vault_not_found') fail('vault_not_found');
      }
      const plan = anchorLessonTasks(entry.store, { path: normalized, expectedRevision: expectedRevision ?? undefined });
      const updatedAt = new Date(now()).toISOString();
      await table.put(sessionId, { workspaceId: canonicalWorkspaceId, root: entry.root, path: normalized, updatedAt });
      entry.store.notifyChange?.(normalized, plan.revision);
      return {
        sessionId,
        eligible: true,
        bound: true,
        missing: false,
        path: normalized,
        revision: plan.revision,
        updatedAt,
        plan,
        candidates: listWorkspaceLessonCandidates(entry.store),
      };
    }),

    setCurrentLessonTask: serializeSessionMutation(async (input = {}) => {
      const { workspaceId, sessionId, path, line, taskId, expectedText, expectedRevision, clear = false } = input ?? {};
      const { entry, canonicalWorkspaceId } = await resolveVerifiedSession(workspaceId, sessionId, { requireMutationEligibility: true });
      const table = await openTable();
      const record = table.get(sessionId);
      if (!record || record.root !== entry.root) fail('vault_lesson_unbound');
      if (path !== undefined && safeRelativePath(path) !== record.path) fail('vault_lesson_unbound');
      try { entry.store.update(record.path); } catch { /* Handled by read below. */ }
      const plan = clear
        ? clearCurrentLessonTask(entry.store, { path: record.path, expectedRevision })
        : setCurrentLessonTask(entry.store, { path: record.path, line, taskId, expectedText, expectedRevision });
      const updatedAt = new Date(now()).toISOString();
      await table.put(sessionId, { workspaceId: canonicalWorkspaceId, root: entry.root, path: record.path, updatedAt });
      return { sessionId, eligible: true, bound: true, missing: false, path: record.path, revision: plan.revision, updatedAt, plan };
    }),

    toggleLessonTask: serializeSessionMutation(async (input = {}) => {
      const { workspaceId, sessionId, path, line, checked, expectedText, expectedRevision } = input ?? {};
      const { entry, canonicalWorkspaceId } = await resolveVerifiedSession(workspaceId, sessionId, { requireMutationEligibility: true });
      const table = await openTable();
      const record = table.get(sessionId);
      if (!record || record.root !== entry.root) fail('vault_lesson_unbound');
      if (path !== undefined && safeRelativePath(path) !== record.path) fail('vault_lesson_unbound');
      try { entry.store.update(record.path); } catch { /* Handled by read below. */ }
      const plan = toggleLessonTask(entry.store, { path: record.path, line, checked, expectedText, expectedRevision });
      const updatedAt = new Date(now()).toISOString();
      await table.put(sessionId, { workspaceId: canonicalWorkspaceId, root: entry.root, path: record.path, updatedAt });
      return { sessionId, eligible: true, bound: true, missing: false, path: record.path, revision: plan.revision, updatedAt, plan };
    }),

    async lessonBindings(input = {}) {
      const { workspaceId } = input ?? {};
      const entry = resolveWorkspaceEntry(workspaceId);
      await entry.ready;
      const table = await openTable();
      const items = [];
      for (const [sessionId, record] of table.entries()) {
        if (record.root !== entry.root) continue;
        try {
          await resolveVerifiedSession(workspaceId, sessionId, { requireMutationEligibility: true, rejectArchived: true });
        } catch {
          continue;
        }
        const { missing, plan } = readProjectedLesson(entry.store, record.path);
        items.push({
          sessionId,
          path: record.path,
          updatedAt: record.updatedAt,
          missing,
          title: plan?.title ?? record.path,
          revision: plan?.revision ?? null,
          counts: plan?.counts ?? { total: 0, completed: 0, inProgress: 0, pending: 0 },
          progressLabel: plan?.progressLabel ?? '',
          currentTask: plan?.currentTask ?? null,
          nextTask: plan?.nextTask ?? null,
        });
      }
      items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.sessionId.localeCompare(b.sessionId));
      return { bindings: items };
    },
  };
}
