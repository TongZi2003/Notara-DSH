import { projectActivity } from './activity-model.js';
import { bindVaultRemote, subscribeVaultChanges, workspaceForSession } from '@oh-my-student/plugin-vault-sqlite/workspace-client';
import { callVault } from './logic.js';
import {currentSessionId} from './composer.js';

const empty = () => projectActivity({ sessionId: null });
function readableLessonError(error) {
  const code = String(error?.code ?? error?.message ?? error);
  if (code === 'vault_revision_conflict') return '备课本已更新，清单已刷新最新内容，请核对后再操作';
  if (code === 'vault_task_conflict') return '该任务位置或文字已变化，已刷新最新清单';
  if (code === 'vault_task_completed') return '已完成勾选的任务不能直接设为进行中';
  if (code === 'vault_not_found') return '备课本不存在或已被移动';
  if (code === 'vault_lesson_type_required') return '所选文件不是 type: lesson 备课本';
  if (code === 'vault_workspace_mismatch' || code === 'vault_workspace_not_found') return '不能跨学习集关联备课本';
  if (code === 'vault_session_archived') return '已归档课堂为只读，无法修改本课清单';
  if (code === 'vault_session_role_forbidden') return '当前会话角色不支持绑定本课清单';
  return String(error?.message ?? code) || '本课清单暂时无法同步';
}

export function createActivityController(ctx, { openAgent } = {}) {
  const listeners = new Set(), entries = new Map();
  let disposed = false, scheduled = false, syncing = false, mainId = null, ownerId = null;
  let lessonScope = null, lessonEpoch = 0;
  let state = { open: false, sessionId: null, loading: false, error: false, data: empty(), limited: false, anchorVersion: 0, lesson: null, lessonLoading: false, lessonError: '' };
  const anchorRef = { current: null };
  const update = patch => { state = { ...state, ...patch }; for (const fn of listeners) fn(); };
  const root = () => ctx.sessions.list.getSnapshot()?.byId?.[currentSessionId(ctx)];
  const current = () => ctx.sessions.list.getSnapshot()?.byId?.[ownerId ?? root()?.id];
  const belongsToRoot = id => {
    const rootId=root()?.id,rows=ctx.sessions.list.getSnapshot().byId??{},seen=new Set();
    let cursor=id;
    while(cursor&&cursor!==rootId&&!seen.has(cursor)){
      seen.add(cursor);
      const row=rows[cursor],address=ctx.sessions.subagentAddress?.(cursor)??row?.subagent?.address;
      cursor=address?.parentSessionId??(row?.origin==='subagent'?row.parentId:undefined);
    }
    return Boolean(rootId&&cursor===rootId&&rows[id]);
  };
  const jobs = ctx.get('jobs');
  const uiConversation = ctx.get('uiConversation');
  const rawVaultRemote = () => ctx.remote?.notaraVault ?? ctx.get?.('remote')?.notaraVault;
  const dropLessonScope = () => {
    lessonEpoch++;
    if (!lessonScope) return;
    const active = lessonScope;
    lessonScope = null;
    active.live = false;
    active.off?.();
  };
  const refreshLesson = scope => {
    const active = scope ?? lessonScope;
    if (!active?.live || disposed) return Promise.resolve(null);
    const epoch = ++lessonEpoch;
    const isCurrent = () => !disposed && active.live && lessonScope === active && epoch === lessonEpoch && state.open && state.sessionId === active.sessionId;
    return callVault(active.remote, 'lessonPlan', { sessionId: active.sessionId }).then(
      value => {
        if (isCurrent()) update({ lesson: value, lessonLoading: false, lessonError: '' });
        return value;
      },
      error => {
        if (isCurrent()) update({ lessonLoading: false, lessonError: readableLessonError(error) });
        return null;
      },
    );
  };
  const ensureLessonScope = (row, sessionId, workspaceId) => {
    const vault = rawVaultRemote();
    if (!state.open || !sessionId || !row || row.blank || workspaceId === null || typeof vault?.lessonPlan !== 'function') {
      const hadLesson = Boolean(lessonScope || state.lesson || state.lessonLoading || state.lessonError);
      dropLessonScope();
      if (hadLesson) return { lesson: null, lessonLoading: false, lessonError: '' };
      return {};
    }
    const list = ctx.sessions?.list?.getSnapshot?.();
    const archivedIds = new Set(ctx.get('workspaces')?.list.getSnapshot()?.archivedSessionIds ?? []);
    let archived = archivedIds.has(sessionId);
    for (let cur = row, guard = 0; !archived && cur?.origin === 'subagent' && guard < 8; guard++) {
      const pid = ctx.sessions.subagentAddress?.(cur.id)?.parentSessionId ?? cur.parentId;
      if (!pid) break;
      if (archivedIds.has(pid)) archived = true;
      cur = list?.byId?.[pid];
    }
    const preset = list?.projectionsBySession?.[sessionId]?.values?.agentPreset
      ?? row.projectionValues?.agentPreset
      ?? row.agentPreset
      ?? '';
    const key = `${sessionId}:${workspaceId ?? 'default'}:${archived ? 1 : 0}:${preset}`;
    if (lessonScope?.key === key) return {};
    dropLessonScope();
    const remote = bindVaultRemote(vault, workspaceId);
    const nextScope = { key, sessionId, workspaceId, remote, live: true, off: null };
    lessonScope = nextScope;
    nextScope.off = subscribeVaultChanges(remote, detail => {
      if (detail?.reset && !state.lesson && state.lessonLoading) return;
      void refreshLesson(nextScope);
    });
    void refreshLesson(nextScope);
    return { lesson: null, lessonLoading: true, lessonError: '' };
  };
  const schedule = () => {
    if (disposed || scheduled) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; if (!disposed) sync(); });
  };
  const drop = entry => {
    entry.live = false;
    for (const off of entry.off) off();
    entry.reference.release();
    entries.delete(entry.id);
  };
  const release = () => {
    dropLessonScope();
    for (const entry of [...entries.values()]) drop(entry);
  };
  const acquire = (id, target) => {
    if (entries.has(id)) return entries.get(id);
    const reference = ctx.sessions.retain(target, { source: 'notaraActivity' });
    const entry = { id, reference, live: true, off: [], ready: false, error: false };
    entries.set(id, entry);
    try { if (jobs) entry.off.push(jobs.watchRows(id)); } catch { /* Native roster failure does not erase conversation facts. */ }
    Promise.resolve(reference.ready).then(binding => {
      if (!entry.live || disposed) return;
      entry.binding = binding;
      entry.chat = uiConversation.binding(binding).target('chat');
      entry.catalog = binding.session.projections.faceOf('subagentCatalog');
      entry.timing = binding.session.projections.faceOf('subagentTiming');
      entry.ready = true;
      for (const source of [binding.session, entry.chat, entry.catalog, entry.timing]) entry.off.push(source.subscribe(schedule));
      const scope = ctx.sessions.scope?.(id);
      entry.input = scope && ctx.conversation?.input.for(scope);
      if (entry.input) entry.off.push(entry.input.state.subscribe(schedule));
      schedule();
    }).catch(() => { if (entry.live && !disposed) { entry.error = true; schedule(); } });
    return entry;
  };
  const sync = () => {
    if (syncing || disposed) return;
    syncing = true;
    try {
      const rootId=root()?.id??null;
      if (rootId !== mainId || ownerId && !belongsToRoot(ownerId)) {
        release(); mainId=rootId; ownerId=null;
        update({open:false,sessionId:rootId,data:empty(),loading:false,error:false,limited:false,workspaceId:undefined,cwd:undefined,lesson:null,lessonLoading:false,lessonError:''});
      }
      const row = current(), sessionId = row?.id ?? null;
      if (!state.open || !sessionId) return;
      const subagentTarget = row.origin === 'subagent'
        ? (ctx.sessions.subagentAddress?.(sessionId)
          ?? row.subagent?.address
          ?? (typeof row.parentId === 'string' && row.parentId ? { parentSessionId: row.parentId, childSessionId: sessionId, mode: row.projectionValues?.subagent?.mode ?? 'continuable' } : sessionId))
        : sessionId;
      const parent = acquire(sessionId, subagentTarget);
      const catalog = parent.catalog?.getSnapshot();
      const children=[],seen=new Set([sessionId]);
      const visit=(parentSessionId,rows)=>{for(const child of Array.isArray(rows)?rows:[]){if(seen.has(child.id))continue;seen.add(child.id);children.push({...child,parentSessionId});visit(child.id,entries.get(child.id)?.catalog?.getSnapshot());}};
      visit(sessionId,catalog);
      const recent = children.filter(child => ['one-shot', 'continuable'].includes(child.mode)).slice(-8);
      const wanted = new Set([sessionId, ...recent.map(child => child.id)]);
      // Keep the path to a loaded nested child so its catalog identity
      // cannot disappear when the recent-detail window changes.
      for(const child of [...recent])for(let node=child;node&&node.parentSessionId!==sessionId;){const parentNode=children.find(row=>row.id===node.parentSessionId);if(!parentNode)break;if(!recent.some(row=>row.id===parentNode.id))recent.push(parentNode);wanted.add(parentNode.id);node=parentNode;}
      for (const entry of [...entries.values()]) if (!wanted.has(entry.id)) drop(entry);
      for (const child of recent) if (child.id !== sessionId) acquire(child.id, { parentSessionId: child.parentSessionId, childSessionId: child.id, mode: child.mode });
      const list = ctx.sessions.list.getSnapshot();
      const parentWorkspace = workspaceForSession(ctx, sessionId);
      const workspaceRoot = ctx.get('workspaces')?.list.getSnapshot()?.items?.find(item => item.workspaceId === parentWorkspace)?.path;
      const sources = [...entries.values()].filter(entry => entry.ready).map(entry => {
        const snapshot = entry.binding.session.getSnapshot(), record = list.byId[entry.id];
        const cwd = record?.cwd ?? row.cwd ?? workspaceRoot;
        const sameRoot = cwd?.replace(/\\/g, '/').replace(/\/+$/, '') === workspaceRoot?.replace(/\\/g, '/').replace(/\/+$/, '');
        const chat = entry.chat.getSnapshot();
        return {
          sessionId: entry.id, cwd, workspaceId: sameRoot ? parentWorkspace : undefined,
          nodes: [...(chat?.nodes.values() ?? [])], turns: chat?.timeline?.turns.values() ?? [], occurrences: entry.input?.state.getSnapshot().occurrences ?? [], hasMore: snapshot.hasMore === true,
        };
      });
      const childViews = children.map(child => {
        const entry = entries.get(child.id);
        const metadata = list.projectionsBySession?.[child.id]?.values ?? list.byId[child.id]?.projectionValues;
        return { ...child, preset:metadata?.agentPreset, running: list.byId[child.id]?.running, timing: entry?.timing?.getSnapshot() ?? metadata?.subagentTiming, loading: Boolean(entry && !entry.ready && !entry.error), loadError: entry?.error };
      });
      const rows = jobs?.state.getSnapshot()?.rows ?? {};
      const data = projectActivity({ sessionId, sources, children: childViews, jobs: [...entries.keys()].flatMap(id => rows[id] ?? []) });
      const failed = entry => entry.error || entry.binding?.session.getSnapshot().openState === 'error';
      const parentState = parent.binding?.session.getSnapshot();
      const lessonPatch = ensureLessonScope(row, sessionId, parentWorkspace);
      update({ sessionId, workspaceId: parentWorkspace, cwd: row.cwd ?? workspaceRoot, loading: !failed(parent) && (!parent.ready || parentState?.openState === 'opening'), error: [...entries.values()].some(failed), limited: children.length > recent.length, data, ...lessonPatch });
    } catch { update({ loading: false, error: true }); }
    finally { syncing = false; }
  };
  const off = [ctx.sessions.list.subscribe(schedule)];
  const selection=ctx.get('uiSession')?.adapter?.current;
  if(selection)off.push(selection.subscribe(schedule));
  if (jobs) off.push(jobs.state.subscribe(schedule));
  const workspaces = ctx.get('workspaces')?.list;
  if (workspaces) off.push(workspaces.subscribe(schedule));
  sync();
  const revealSession = id => {
    if(!state.open||!belongsToRoot(id))return;
    if(id===root()?.id)ctx.get('uiWorkspace')?.openSession(id);
    else {
      const address=state.data.agents.find(row=>row.id===id&&row.canOpen)?.address
        ?? ctx.sessions.subagentAddress?.(id)
        ?? ctx.sessions.list.getSnapshot().byId[id]?.subagent?.address;
      if(!address||!openAgent)return;
      openAgent(address);
    }
    update({open:false,lesson:null,lessonLoading:false,lessonError:''});release();
  };
  return {
    getSnapshot: () => state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    anchorRef,
    setAnchor(element) {
      if (anchorRef.current === element) return;
      anchorRef.current = element;
      queueMicrotask(() => { if (!disposed && anchorRef.current === element) update({ anchorVersion: state.anchorVersion + 1 }); });
    },
    setOpen(open) { if (disposed) return; if (open) sync(); update({ open, ...(open ? {} : { lesson: null, lessonLoading: false, lessonError: '' }) }); if (!open) release(); sync(); },
    toggle(sessionId=state.sessionId) {
      if(state.open&&state.sessionId===sessionId)this.setOpen(false);
      else this.openFrom(sessionId);
    },
    openFrom(sessionId) {
      // Settle a pending native selection change before accepting a header click.
      sync();
      if(!belongsToRoot(sessionId))return;
      if(state.sessionId!==sessionId){release();ownerId=sessionId;update({open:false,sessionId,data:empty(),loading:false,error:false,limited:false,workspaceId:undefined,cwd:undefined,lesson:null,lessonLoading:false,lessonError:''});}
      this.setOpen(true);
    },
    retry() { release(); sync(); },
    async bindLesson(path, expectedRevision) {
      const active = lessonScope;
      if (!active?.live || !state.open || state.sessionId !== active.sessionId) throw new Error('活动面板已关闭或切换会话');
      const epoch = ++lessonEpoch;
      try {
        const result = await callVault(active.remote, 'bindLessonPlan', {
          sessionId: active.sessionId,
          path,
          ...(typeof expectedRevision === 'string' ? { expectedRevision } : {}),
        });
        if (!disposed && active.live && lessonScope === active && epoch === lessonEpoch) {
          update({ lesson: result, lessonLoading: false, lessonError: '' });
        }
        return result;
      } catch (error) {
        void refreshLesson(active);
        throw new Error(readableLessonError(error));
      }
    },
    async toggleLessonTask(task, checked) {
      const active = lessonScope;
      const revision = state.lesson?.plan?.revision;
      if (!active?.live || !state.open || state.sessionId !== active.sessionId || !revision) throw new Error('本课清单状态已改变，请刷新后重试');
      const epoch = ++lessonEpoch;
      try {
        const updated = await callVault(active.remote, 'toggleLessonTask', {
          sessionId: active.sessionId,
          line: task.line,
          checked,
          expectedText: task.expectedText,
          expectedRevision: revision,
        });
        if (!disposed && active.live && lessonScope === active && epoch === lessonEpoch) {
          update({ lesson: { ...state.lesson, ...updated }, lessonLoading: false, lessonError: '' });
        }
        return updated;
      } catch (error) {
        await refreshLesson(active);
        throw new Error(readableLessonError(error));
      }
    },
    async setCurrentLessonTask(task, clear = false) {
      const active = lessonScope;
      const revision = state.lesson?.plan?.revision;
      if (!active?.live || !state.open || state.sessionId !== active.sessionId || !revision) throw new Error('本课清单状态已改变，请刷新后重试');
      const epoch = ++lessonEpoch;
      try {
        const updated = await callVault(active.remote, 'setCurrentLessonTask', {
          sessionId: active.sessionId,
          ...(clear ? { clear: true } : { line: task.line, expectedText: task.expectedText }),
          expectedRevision: revision,
        });
        if (!disposed && active.live && lessonScope === active && epoch === lessonEpoch) {
          update({ lesson: { ...state.lesson, ...updated }, lessonLoading: false, lessonError: '' });
        }
        return updated;
      } catch (error) {
        await refreshLesson(active);
        throw new Error(readableLessonError(error));
      }
    },
    openAgent(agent) {
      const actual=state.data.agents.find(row=>row.id===agent.id&&row.canOpen);
      if (!actual || state.sessionId!==current()?.id || !openAgent) return;
      openAgent(actual.address);
      this.setOpen(false);
    },
    openJob(job) {
      sync();
      const actual=state.data.jobs.find(row=>row.id===job.id&&row.owner===job.owner);
      if(actual)revealSession(actual.owner);
    },
    async stopJob(job) {
      const actual = state.data.jobs.find(row => row.id === job.id && row.owner === job.owner && row.canStop);
      if (!actual) throw new Error('任务状态已改变，请刷新后重试');
      const result = await jobs.kill(actual.owner, actual.id);
      if (!result?.ok) throw new Error('暂时无法停止任务，请打开记录查看');
    },
    openSource(row) { sync();revealSession(row.sourceSessionId); },
    dispose() { disposed = true; release(); off.forEach(dispose => dispose()); listeners.clear(); },
  };
}
