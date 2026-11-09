import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { posix } from 'node:path';
import { Service } from '@deepseek-ai/cordis';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { messagesOf } from './topic-conversations.js';
import { extractLessonSummary, hasSummaryReference } from '@oh-my-student/plugin-vault-sqlite/summary-document';
import { openSummaryReceipts, pendingSummaryTarget, summaryReceiptComplete } from '@oh-my-student/plugin-vault-sqlite/summary-receipts';
import { parseMarkdown } from '@oh-my-student/plugin-vault-sqlite/frontmatter';
import { civilDay } from '@oh-my-student/plugin-vault-sqlite/review';
import { ensureDeliveryDiary } from './diary-delivery.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const fail = (code, note) => { throw new Error(`${code}: ${note}`); };
const presetOf = snapshot => snapshot?.events.filter(event => event.type === 'agent-preset/selected').at(-1)?.data.agentPreset ?? snapshot?.session.agentPreset;
const canonical = path => { try { return realpathSync(path); } catch { return null; } };
const stopSeq = snapshot => snapshot?.events.filter(event => event.type === 'turn/end' && event.data.reason?.kind === 'aborted' && event.data.reason.reason?.kind === 'user').at(-1)?.seq ?? 0;
const sourceLocator = (row, targetPath = '') => {
  if (!/[\[\]|#]/.test(row.source.path) && !/[\[\]|]/.test(row.source.heading)) return `[[${row.source.path}#${row.source.heading}]]`;
  const path = posix.relative(posix.dirname(targetPath || '.'), row.source.path);
  return `[本课总结](<${encodeURIComponent(path).replaceAll('%2F', '/')}#${encodeURIComponent(row.source.heading)}>)`;
};
const transportKey = (id, row) => `notara-summary:${id}:${row.version}:${row.delivery.round}`;
const targetType = target => target === 'profile' ? 'learner-profile' : 'route';
const senderPresets = ['notara-teacher', 'notara-material-organizer'];
const reportKinds = ['lesson', 'preparation', 'question', 'materials'];

export class SummaryDeliveries extends Service {
  static inject = ['storageDomain', 'agents', 'sessions', 'sessionQuery', 'workspaceRegistry', 'notaraVault', 'notaraTopics', 'agentPresets'];
  constructor(ctx) {
    super(ctx, 'notaraSummaryDeliveries');
    this.ready = openSummaryReceipts(ctx.storageDomain).then(store => (this.store = store));
    this.timers = new Map(); this.attemptCounts = new Map(); this.reconcileFailures = new Map(); this.closed = false;
    ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
      const decision = await next();
      // The first effective user request establishes the workspace home. Merely
      // inspecting a prompt or opening a tab must not change routing ownership.
      if (decision.kind === 'enter' && decision.messages.some(message => message.source?.kind === 'user')
        && ctx.agentPresets.composedPreset(agent.ctx) === 'notara-coordinator' && agent.session.header.origin !== 'subagent') {
        signal.throwIfAborted();
        await this.rememberHome(agent);
      }
      return decision;
    });
    // A user stop blocks later transport retries; normal turn end does not
    // create a delivery or another model turn.
    ctx.on('session/event', (session, event) => {
      if (event.type !== 'turn/end' || event.data.reason?.kind !== 'aborted' || event.data.reason.reason?.kind !== 'user') return;
      void this.suspendSession(session.id, event.seq).catch(error => ctx.logger.warn(error.message));
    });
    ctx.effect(() => async () => {
      this.closed = true;
      for (const timer of this.timers.values()) clearTimeout(timer);
      this.timers.clear();
      this.attemptCounts.clear();
      this.reconcileFailures.clear();
      const store = await this.ready;
      await store.close();
    });
  }
  async [Service.init]() {
    const store = await this.ready;
    for (const [id, row] of store.entries()) if (!summaryReceiptComplete(row) && !row.delivery.messageId
      && (!row.delivery.suspended || row.delivery.suspended === 'awaiting_home')) this.schedule(id, 0);
  }
  schedule(id, delay) {
    if (this.closed) return;
    clearTimeout(this.timers.get(id));
    const timer = setTimeout(() => {
      this.timers.delete(id);
      void this.attempt(id).catch(error => this.ctx.logger.warn(`Summary delivery: ${error.message}`));
    }, delay);
    timer.unref?.(); this.timers.set(id, timer);
  }
  async actor(agent) {
    if (!agent || this.ctx.agents.get(agent.id) !== agent) fail('summary_actor_unavailable', '需要当前真实会话');
    const role = this.ctx.agentPresets.composedPreset(agent.ctx);
    if (![...senderPresets, 'notara-coordinator'].includes(role)) fail('summary_role_forbidden', '仅工作会话和首页老师可操作交付');
    if (this.ctx.workspaceRegistry.archivedSessionIds.includes(agent.id)) fail('summary_session_archived', '归档会话只读');
    const workspace = await this.ctx.workspaceRegistry.resolveByPath(agent.session.header.cwd);
    if (!workspace) fail('summary_workspace_missing', '当前会话没有学习集');
    return { role, workspace, root: canonical(workspace.path) };
  }
  async snapshot(id) {
    const live = id && this.ctx.agents.get(id);
    return live ? { session: live.session.header, events: live.session.snapshotEvents() } : id ? this.ctx.sessionQuery.readSession(id) : null;
  }
  async validHome(id, root) {
    if (!id || this.ctx.workspaceRegistry.archivedSessionIds.includes(id)) return false;
    try {
      const snapshot = await this.snapshot(id);
      return presetOf(snapshot) === 'notara-coordinator' && snapshot.session.origin !== 'subagent' && canonical(snapshot.session.cwd) === root;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }
  async originHome(senderId, root) {
    const seen = new Set([senderId]);
    let id = senderId;
    while ((id = await this.ctx.notaraTopics.origin(id))) {
      if (seen.has(id)) fail('summary_origin_cycle', '会话来源循环，保留报告待核对');
      seen.add(id);
      const snapshot = await this.snapshot(id);
      if (!snapshot || canonical(snapshot.session.cwd) !== root || snapshot.session.origin === 'subagent') return null;
      if (presetOf(snapshot) === 'notara-coordinator') return id;
      if (!senderPresets.includes(presetOf(snapshot))) return null;
    }
    return null;
  }
  async recipient(agent, actor) {
    const origin = await this.originHome(agent.id, actor.root);
    if (origin) return { recipientSessionId: origin, routing: 'origin' };
    const store = await this.ready;
    // Once a direct conversation has delivered to a home, retain that receiver
    // even if another home later becomes active. Do not silently reroute facts.
    const prior = store.entries().find(([, row]) => row.workspaceId === actor.workspace.id && row.root === actor.root && row.senderSessionId === agent.id && row.recipientSessionId)?.[1];
    if (prior) return { recipientSessionId: prior.recipientSessionId, routing: prior.routing ?? 'origin' };
    const bound = store.home(actor.workspace.id);
    return { recipientSessionId: bound?.root === actor.root && await this.validHome(bound.sessionId, actor.root) ? bound.sessionId : null, routing: 'workspace' };
  }
  async rememberHome(agent) {
    const actor = await this.actor(agent);
    if (actor.role !== 'notara-coordinator' || agent.session.header.origin === 'subagent') return;
    const store = await this.ready;
    const home = await store.exclusive(`home:${actor.workspace.id}`, async () => {
      const prior = store.home(actor.workspace.id);
      if (prior?.root === actor.root && await this.validHome(prior.sessionId, actor.root)) return prior.sessionId;
      if (!await this.ctx.sessions.flush(agent.session)) fail('summary_home_not_saved', '首页会话尚未保存，不能绑定交付接收方');
      await store.putHome(actor.workspace.id, { root: actor.root, sessionId: agent.id });
      return agent.id;
    });
    if (home !== agent.id) return;
    await this.bindHomeDeliveries(actor, home);
  }
  /** Explicit home navigation, not prompt inspection, may establish the home.
   * Native SessionController owns creation/model selection/drafts and history. */
  async homeSession({ workspaceId, open = false } = {}) {
    if (typeof workspaceId !== 'string') fail('home_workspace_required', '请先选择学习集');
    const workspace = this.ctx.workspaceRegistry.get(workspaceId), root = canonical(workspace?.path);
    if (!workspace || !root) fail('home_workspace_missing', '学习集不可用');
    if (typeof open !== 'boolean') fail('home_open_invalid', 'open 必须是布尔值');
    const store = await this.ready;
    const sessionId = await store.exclusive(`home:${workspaceId}`, async () => {
      const prior = store.home(workspaceId);
      if (prior?.root === root && await this.validHome(prior.sessionId, root)) return prior.sessionId;
      if (!open) return null;
      const controller = this.ctx.get('sessionController');
      if (!controller) fail('home_controller_unavailable', '原生会话服务暂不可用');
      const created = await controller.create({ workspaceId, agentPreset: 'notara-coordinator' });
      const agent = this.ctx.agents.get(created.sessionId);
      if (!agent || !await this.validHome(agent.id, root)) fail('home_create_invalid', '首页会话归属不一致');
      if (!await this.ctx.sessions.flush(agent.session)) fail('summary_home_not_saved', '首页会话尚未保存，请重试');
      await store.putHome(workspaceId, { root, sessionId: agent.id });
      return agent.id;
    });
    if (open && sessionId) await this.bindHomeDeliveries({ workspace, root }, sessionId);
    return { sessionId };
  }
  async bindHomeDeliveries(actor, home) {
    const store = await this.ready;
    for (const [id, row] of store.entries()) {
      if (row.workspaceId !== actor.workspace.id || row.root !== actor.root || row.recipientSessionId || row.routing !== 'workspace') continue;
      await store.exclusive(id, async () => {
        const current = store.get(id); if (current.recipientSessionId) return;
        const resume = !current.delivery.suspended || current.delivery.suspended === 'awaiting_home';
        await store.put(id, { ...current, recipientSessionId: home, updatedAt: now(), delivery: { ...current.delivery,
          recipientStopSeq: stopSeq(await this.snapshot(home)),
          ...(resume ? { suspended: null, attempts: 0, error: null } : {}) } });
        if (resume) { this.attemptCounts.delete(transportKey(id, current)); this.reconcileFailures.delete(transportKey(id, current)); }
      });
      if (!store.get(id).delivery.suspended) this.schedule(id, 0);
    }
  }
  async authorized(agent, id) {
    const actor = await this.actor(agent), store = await this.ready, row = store.get(id);
    if (!row || row.workspaceId !== actor.workspace.id || row.root !== actor.root || ![row.senderSessionId, row.recipientSessionId].includes(agent.id)) fail('summary_delivery_unavailable', '请从 lesson_summary read 返回的本会话交付中选择');
    return { ...actor, row };
  }
  async source(row) {
    const document = await this.ctx.notaraVault.read({ workspaceId: row.workspaceId, path: row.source.path });
    const source = extractLessonSummary(document, { heading: row.source.heading });
    if (source.version !== row.source.contentHash) fail('summary_source_changed', '总结正文已经修订，请由原老师对同一位置重新 deliver；旧回执不能用于新总结');
    return source;
  }
  view(id, row) {
    return { deliveryId: id, version: row.version, senderSessionId: row.senderSessionId, recipientSessionId: row.recipientSessionId,
      source: { path: row.source.path, heading: row.source.heading }, sourceLocator: sourceLocator(row),
      kind: row.kind ?? 'lesson', journal: row.journal ?? null, decision: row.decision ?? null,
      targets: row.targets, complete: summaryReceiptComplete(row),
      delivery: { sent: Boolean(row.delivery.messageId), attempts: row.delivery.attempts, error: row.delivery.error, suspended: row.delivery.suspended },
      note: '处理回执只说明本次总结交接状态；不表示学生掌握、课程结束或已归档。' };
  }
  async deliver(agent, args) {
    const actor = await this.actor(agent);
    if (!senderPresets.includes(actor.role) || agent.session.header.origin === 'subagent') fail('summary_teacher_required', '仅普通老师或资料整理会话交付；内部子课堂沿 send_message 交回直接父老师汇总');
    if (args.kind !== undefined && !reportKinds.includes(args.kind)) fail('summary_kind_invalid', 'kind 选择 lesson/preparation/question/materials');
    if (args.summary !== undefined && (typeof args.summary !== 'string' || args.summary.length > 1000)) fail('summary_brief_invalid', 'summary 是不超过1000字符的简短结果，长报告使用文件定位');
    const routing = await this.recipient(agent, actor), { recipientSessionId } = routing;
    const source = extractLessonSummary(await this.ctx.notaraVault.read({ workspaceId: actor.workspace.id, path: args.path }), { heading: args.heading });
    const id = hash(JSON.stringify([actor.workspace.id, agent.id, source.path, source.heading]));
    const store = await this.ready;
    await store.exclusive(id, async () => {
      const prior = store.get(id);
      const kind = args.kind ?? prior?.kind ?? (actor.role === 'notara-material-organizer' ? 'materials' : 'lesson');
      const summary = args.summary?.trim() ?? (prior?.source.contentHash === source.version ? prior.summary ?? '' : '');
      if (prior?.source.contentHash === source.version && (prior.kind ?? 'lesson') === kind && (prior.summary ?? '') === summary) return;
      const [sender, home] = await Promise.all([this.snapshot(agent.id), this.snapshot(recipientSessionId)]);
      const at = now();
      const row = { workspaceId: actor.workspace.id, root: actor.root, senderSessionId: agent.id, recipientSessionId,
        kind, summary, senderPreset: actor.role, routing: routing.routing,
        source: { path: source.path, heading: source.heading, contentHash: source.version }, version: (prior?.version ?? 0) + 1,
        createdAt: prior?.createdAt ?? at, updatedAt: at, retryKeys: prior?.retryKeys ?? [],
        targets: { profile: pendingSummaryTarget(), route: pendingSummaryTarget() },
        journal: { date: prior?.journal?.date ?? civilDay(new Date(prior?.createdAt ?? at)), version: 0, path: null, heading: null, revision: null, locator: null },
        decision: { state: 'pending', targets: [], note: '' },
        delivery: { round: 0, attempts: 0, messageId: null, error: null, suspended: null, senderStopSeq: stopSeq(sender), recipientStopSeq: stopSeq(home) } };
      // The pending receipt is durable before any recipient is awakened.
      await store.put(id, row);
    });
    await this.attempt(id);
    return this.view(id, store.get(id));
  }
  async route(row) {
    const workspace = this.ctx.workspaceRegistry.get(row.workspaceId);
    if (!workspace || canonical(workspace.path) !== row.root) return 'route_invalid';
    if ([row.senderSessionId, row.recipientSessionId].some(id => this.ctx.workspaceRegistry.archivedSessionIds.includes(id))) return 'session_archived';
    const [sender, recipient] = await Promise.all([this.snapshot(row.senderSessionId), this.snapshot(row.recipientSessionId)]);
    if (presetOf(sender) !== (row.senderPreset ?? 'notara-teacher') || sender.session.origin === 'subagent' || canonical(sender.session.cwd) !== row.root) return 'route_invalid';
    if (stopSeq(sender) > row.delivery.senderStopSeq) return 'user_stopped';
    if (!row.recipientSessionId) return 'awaiting_home';
    if (presetOf(recipient) !== 'notara-coordinator' || canonical(recipient.session.cwd) !== row.root || recipient.session.origin === 'subagent') return 'route_invalid';
    if ((row.routing ?? 'origin') === 'origin' && await this.originHome(row.senderSessionId, row.root) !== row.recipientSessionId) return 'route_invalid';
    if (stopSeq(recipient) > row.delivery.recipientStopSeq) return 'user_stopped';
    return null;
  }
  async bindPendingRecipient(id, row) {
    if (row.recipientSessionId || row.routing !== 'workspace') return row;
    const store = await this.ready, home = store.home(row.workspaceId);
    if (home?.root !== row.root || !await this.validHome(home.sessionId, row.root)) return row;
    const resume = !row.delivery.suspended || row.delivery.suspended === 'awaiting_home';
    const next = { ...row, recipientSessionId: home.sessionId, updatedAt: now(), delivery: { ...row.delivery,
      recipientStopSeq: stopSeq(await this.snapshot(home.sessionId)),
      ...(resume ? { suspended: null, attempts: 0, error: null } : {}) } };
    await store.put(id, next);
    if (resume) { this.attemptCounts.delete(transportKey(id, row)); this.reconcileFailures.delete(transportKey(id, row)); }
    return next;
  }
  async reconcileMessage(id, row, retryKey) {
    if (!row.recipientSessionId || row.delivery.messageId) return row;
    const message = messagesOf(await this.snapshot(row.recipientSessionId)).find(item => item.source?.rpcId === transportKey(id, row));
    if (!message) return row;
    const live = this.ctx.agents.get(row.recipientSessionId);
    if (live && !await this.ctx.sessions.flush(live.session)) throw Error('已有交付消息尚未保存');
    const next = { ...row, ...(retryKey ? { retryKeys: [...row.retryKeys, retryKey] } : {}), updatedAt: now(), delivery: { ...row.delivery, messageId: message.id, error: null } };
    await (await this.ready).put(id, next);
    this.attemptCounts.delete(transportKey(id, row));
    return next;
  }
  async attempt(id) {
    if (this.closed) return;
    const store = await this.ready;
    return store.exclusive(id, async () => {
      let row = store.get(id);
      if (this.closed || !row || summaryReceiptComplete(row) || row.delivery.messageId) return;
      if (row.delivery.suspended && row.delivery.suspended !== 'awaiting_home') return;
      const key = transportKey(id, row);
      if ((this.reconcileFailures.get(key) ?? 0) >= 3) return;
      let attempts = row.delivery.attempts, preflight = true;
      try {
        // A home may be bound between deliver's lookup and receipt checkpoint.
        row = await this.bindPendingRecipient(id, row);
        // Read-only reconciliation has its own bounded recovery and never
        // spends or extends the three-send budget.
        row = await this.reconcileMessage(id, row);
        this.reconcileFailures.delete(key);
        if (this.closed || row.delivery.messageId || row.delivery.suspended || row.delivery.attempts >= 3) return;
        preflight = false;
        // In-memory accounting also bounds failures to persist an attempt.
        attempts = Math.max(row.delivery.attempts, this.attemptCounts.get(key) ?? 0) + 1;
        if (attempts > 3) return;
        this.attemptCounts.set(key, attempts);
        row = { ...row, updatedAt: now(), delivery: { ...row.delivery, attempts } };
        await store.put(id, row);
        const suspended = await this.route(row);
        if (suspended && suspended !== 'awaiting_home') { await store.put(id, { ...row, updatedAt: now(), delivery: { ...row.delivery, suspended } }); return; }
        await this.source(row);
        if (row.journal) {
          const journal = await ensureDeliveryDiary(this.ctx.notaraVault, { workspaceId: row.workspaceId, deliveryId: id, version: row.version,
            date: row.journal.date, kind: row.kind, source: row.source, summary: row.summary });
          row = { ...row, journal: { ...journal, date: row.journal.date, version: row.version } };
          await store.put(id, row);
          // Diary edits must not accidentally change a report in the same file.
          await this.source(row);
        }
        if (suspended) { await store.put(id, { ...row, delivery: { ...row.delivery, suspended } }); return; }
        const rpcId = transportKey(id, row);
        // Reconcile an inbox/history success whose receipt write was interrupted.
        const snapshot = await this.ctx.sessionQuery.readSession(row.recipientSessionId);
        let message = messagesOf(snapshot).find(item => item.source?.rpcId === rpcId);
        if (!message) {
          const home = await this.ctx.notaraTopics.resume(row.recipientSessionId);
          if (this.closed) return;
          const blocked = await this.route(row);
          if (blocked) { await store.put(id, { ...row, delivery: { ...row.delivery, suspended: blocked } }); return; }
          if (this.closed) return;
          message = messagesOf({ events: home.session.snapshotEvents() }).find(item => item.source?.rpcId === rpcId);
          if (!message) {
            const audience = row.kind === 'preparation'
              ? '\n首页回复本身也是学生可见内容。本次只交付真实材料链接、所需时间和下一步安排；核验无误只报已核对，未尝试题目的答案、关键值与逐题验算留在教师参考或内部回执，不在首页展示“我核对了什么”。备课稿在学生尚未使用前修正的错误也只更新稿件，不先把该题答案讲给学生；已向学生讲错的内容仍须回原课堂补充。'
              : '';
            message = createUserMessage({ source: { kind: 'agent-message', form: 'relay', senderSessionId: row.senderSessionId, rpcId, summaryDeliveryId: id, summaryVersion: row.version },
              content: [{ type: 'text', text: `学习工作交付（${row.kind ?? 'lesson'}；不是学生发言）。来源：${sourceLocator(row)}。${row.journal ? `当日日记：${row.journal.locator}。` : ''}${row.summary ? `结果摘要：${row.summary}\n` : ''}请用 lesson_summary read（deliveryId:"${id}"）核对当前版本、关键数学结论与真实结果，判断对下一步安排的影响。发现明确错误时，用 send_message 向原会话 ${row.senderSessionId} 简短回信，请原老师补充并更正原记录。用 decide 的 targets 只选择确需处理的 profile/route；无需调整用 targets:[] 并说明依据即可。已有已完成项保持，已选未完成项不能丢掉。确需更新才读写对应文档并保留 sourceLocator，read 回读版本后 acknowledge；失败如实留 retryable/blocked。纯备课或整理不产生新的学生掌握证据。内部通知无需自动致谢或复述教学细节。${audience}` }] });
            home.followup(message);
          }
          if (!await this.ctx.sessions.flush(home.session)) throw new Error('交付消息尚未保存');
        } else {
          const live = this.ctx.agents.get(row.recipientSessionId);
          if (live && !await this.ctx.sessions.flush(live.session)) throw new Error('已有交付消息尚未保存');
        }
        await store.put(id, { ...row, updatedAt: now(), delivery: { ...row.delivery, messageId: message.id, error: null } });
        this.attemptCounts.delete(key);
      } catch (error) {
        if (this.closed) return;
        const retryCount = preflight ? (this.reconcileFailures.get(key) ?? 0) + 1 : attempts;
        if (preflight) this.reconcileFailures.set(key, retryCount);
        const sourceChanged = /^(?:summary_source_changed|vault_summary_)/.test(error.message);
        try {
          await store.put(id, { ...row, updatedAt: now(), delivery: { ...row.delivery, error: error.message.slice(0, 1000), ...(sourceChanged ? { suspended: 'source_changed' } : {}) } });
        } finally {
          // Schedule even if writing the error receipt itself failed. At most
          // three attempts in this runtime; a restart reconciles persisted data.
          if (!sourceChanged && retryCount < 3) this.schedule(id, retryCount < 2 ? 500 : 1500);
        }
      }
    });
  }
  async read(agent, args = {}) {
    const actor = await this.actor(agent), store = await this.ready;
    if (!args.deliveryId) return { deliveries: store.entries().filter(([, row]) => row.workspaceId === actor.workspace.id && row.root === actor.root && [row.senderSessionId, row.recipientSessionId].includes(agent.id))
      .sort((a, b) => Number(summaryReceiptComplete(a[1])) - Number(summaryReceiptComplete(b[1])) || b[1].updatedAt.localeCompare(a[1].updatedAt)).slice(0, 30).map(([id, row]) => this.view(id, row)) };
    const { row } = await this.authorized(agent, args.deliveryId);
    const result = this.view(args.deliveryId, row);
    try { result.summary = (await this.source(row)).content; result.sourceCurrent = true; }
    catch (error) { result.sourceCurrent = false; result.sourceError = error.message; }
    if (args.path) {
      const document = await this.ctx.notaraVault.read({ workspaceId: row.workspaceId, path: args.path });
      const type = parseMarkdown(document.content).fields.type;
      if (!['learner-profile', 'route'].includes(type)) fail('summary_target_type', '目标须是 type: learner-profile 或 type: route 文档');
      const large = document.content.length > 40000;
      result.sourceLocator = sourceLocator(row, document.path);
      result.document = { path: document.path, type, revision: document.revision, content: large ? null : document.content, hasSourceReference: hasSummaryReference(document, row.source),
        ...(large ? { contentOmitted: true, note: '正文较长，需用普通 read 分段阅读；此处仅提供真实 revision 和来源引用检查，未改写或截断原文件。' } : {}) };
    }
    return result;
  }
  async decide(agent, args) {
    const { role } = await this.authorized(agent, args.deliveryId);
    if (role !== 'notara-coordinator') fail('summary_receiver_required', '只有接收首页可以判断下一步');
    if (!Array.isArray(args.targets) || args.targets.length > 2 || new Set(args.targets).size !== args.targets.length || args.targets.some(name => !['profile', 'route'].includes(name))) fail('summary_targets_invalid', 'targets 只选择确需处理的 profile/route；无需调整用 []');
    if (typeof args.note !== 'string' || !args.note.trim() || args.note.length > 2000) fail('summary_note_required', '说明此次结果对下一步的影响或为何保持原安排');
    const store = await this.ready;
    return store.exclusive(args.deliveryId, async () => {
      const { row } = await this.authorized(agent, args.deliveryId);
      if (agent.id !== row.recipientSessionId) fail('summary_receiver_required', '只有绑定接收首页可以处理');
      if (args.version !== row.version) fail('summary_version_conflict', '先 read 最新报告版本');
      await this.source(row);
      if (row.journal && row.journal.version !== row.version) fail('summary_diary_pending', '当日日记尚未保存，请先完成交付重试');
      const targets = [...args.targets].sort();
      const existing = row.decision?.state === 'decided' ? row.decision.targets : Object.keys(row.targets).filter(name => row.targets[name].state !== 'pending');
      if (existing.some(name => !targets.includes(name))) fail('summary_decision_conflict', '不能丢掉已选择或部分处理的项目来宣称完成；沿原回执续接');
      if (row.decision?.state === 'decided' && JSON.stringify([...row.decision.targets].sort()) === JSON.stringify(targets)) return this.view(args.deliveryId, row);
      if (summaryReceiptComplete(row)) fail('summary_already_complete', '该版本已处理；有新事实时由原会话修订报告重新交付');
      const next = { ...row, updatedAt: now(), decision: { state: 'decided', targets, note: args.note.trim() } };
      await store.put(args.deliveryId, next);
      return this.view(args.deliveryId, next);
    });
  }
  async acknowledge(agent, args) {
    const { role } = await this.authorized(agent, args.deliveryId);
    if (role !== 'notara-coordinator') fail('summary_receiver_required', '只有接收首页可以登记处理回执');
    if (!['profile', 'route'].includes(args.target) || !['updated', 'unchanged', 'retryable', 'blocked'].includes(args.outcome)) fail('summary_outcome_invalid', '选择 profile/route 与 updated/unchanged/retryable/blocked');
    if (typeof args.note !== 'string' || !args.note.trim() || args.note.length > 2000) fail('summary_note_required', '请简述处理结果、无需更新的依据或失败原因');
    const store = await this.ready;
    return store.exclusive(args.deliveryId, async () => {
      const { row } = await this.authorized(agent, args.deliveryId);
      if (agent.id !== row.recipientSessionId) fail('summary_receiver_required', '此回执只能由其接收首页处理');
      if (args.version !== row.version) fail('summary_version_conflict', '请重新 read 当前总结版本及已有回执，不沿用旧稿判断');
      await this.source(row);
      if (row.journal && row.journal.version !== row.version) fail('summary_diary_pending', '日记未保存，不能确认交付完成');
      if (row.decision?.state === 'decided' && !row.decision.targets.includes(args.target)) fail('summary_target_not_selected', '先用 decide 补选实际需要处理的文档');
      const completed = ['updated', 'unchanged'].includes(args.outcome);
      let path = null, revision = null;
      if (completed && args.path) {
        const document = await this.ctx.notaraVault.read({ workspaceId: row.workspaceId, path: args.path });
        if (parseMarkdown(document.content).fields.type !== targetType(args.target)) fail('summary_target_type', `此项只接受 type: ${targetType(args.target)} 文档`);
        if (typeof args.expectedRevision !== 'string' || document.revision !== args.expectedRevision) fail('summary_target_revision_conflict', '目标文件已变化；用 lesson_summary read 加 path 回读，再使用返回的 revision');
        if (args.outcome === 'updated' && !hasSummaryReference(document, row.source)) fail('summary_source_reference_missing', `目标文档须保留本次总结来源 ${sourceLocator(row, document.path)}，已有记录应原位核对而非重复追加`);
        path = document.path; revision = document.revision;
      } else if (completed) {
        if (args.outcome !== 'unchanged' || args.expectedRevision !== undefined) fail('summary_target_required', 'updated 必须提供实际目标路径及回读 revision');
        const { total } = await this.ctx.notaraVault.query({ workspaceId: row.workspaceId, type: targetType(args.target), limit: 1 });
        if (total) fail('summary_target_required', '已有这类文档，请明确读取目标并提供 path/revision 后说明无需更新的原因');
      } else if (args.path !== undefined || args.expectedRevision !== undefined) fail('summary_outcome_fields', 'retryable/blocked 仅记录原因，不伪装为已核实的文件回执');
      const next = { ...row, updatedAt: now(), targets: { ...row.targets, [args.target]: { state: args.outcome, path, revision, note: args.note.trim() } } };
      if (next.decision?.state === 'pending' && Object.values(next.targets).every(item => ['updated', 'unchanged'].includes(item.state))) {
        next.decision = { state: 'decided', targets: ['profile', 'route'], note: '两项文档均已按实际结果核实处理。' };
      }
      if (['updated', 'unchanged'].includes(row.targets[args.target].state)) {
        const previous = row.targets[args.target];
        if (previous.state === args.outcome && previous.path === path && previous.revision === revision) return this.view(args.deliveryId, row);
        fail('summary_target_already_settled', '此项已处理，迟到回执不能覆盖；若原总结有更正，由老师修订后重新交付');
      }
      await store.put(args.deliveryId, next);
      return this.view(args.deliveryId, next);
    });
  }
  async retry(agent, args, callId) {
    await this.authorized(agent, args.deliveryId);
    const store = await this.ready;
    await store.exclusive(args.deliveryId, async () => {
      let { row } = await this.authorized(agent, args.deliveryId);
      if (summaryReceiptComplete(row)) return;
      const key = hash(JSON.stringify([agent.id, callId]));
      if (row.retryKeys.includes(key)) return;
      row = await this.bindPendingRecipient(args.deliveryId, row);
      if (!row.delivery.messageId) {
        row = await this.reconcileMessage(args.deliveryId, row, key);
        if (row.delivery.messageId) return;
      }
      await this.source(row);
      if ([row.senderSessionId, row.recipientSessionId].some(id => this.ctx.workspaceRegistry.archivedSessionIds.includes(id))) fail('summary_session_archived', '先恢复原会话，不能用重试绕过归档');
      const [sender, recipient] = await Promise.all([this.snapshot(row.senderSessionId), this.snapshot(row.recipientSessionId)]);
      const targets = Object.fromEntries(Object.entries(row.targets).map(([target, value]) => [target, ['retryable', 'blocked'].includes(value.state) ? { ...value, state: 'pending' } : value]));
      await store.put(args.deliveryId, { ...row, targets, retryKeys: [...row.retryKeys, key], updatedAt: now(), delivery: { round: row.delivery.round + 1, attempts: 0, messageId: null, error: null, suspended: null, senderStopSeq: stopSeq(sender), recipientStopSeq: stopSeq(recipient) } });
      this.reconcileFailures.delete(transportKey(args.deliveryId, row));
    });
    await this.attempt(args.deliveryId);
    return this.view(args.deliveryId, store.get(args.deliveryId));
  }
  async suspendSession(sessionId, seq) {
    const store = await this.ready;
    if (this.closed) return;
    for (const [id, row] of store.entries()) if (!summaryReceiptComplete(row) && [row.senderSessionId, row.recipientSessionId].includes(sessionId)) {
      await store.exclusive(id, async () => {
        const latest = store.get(id);
        const baseline = latest.delivery[sessionId === latest.senderSessionId ? 'senderStopSeq' : 'recipientStopSeq'];
        if (seq <= baseline || summaryReceiptComplete(latest)) return;
        clearTimeout(this.timers.get(id)); this.timers.delete(id);
        await store.put(id, { ...latest, delivery: { ...latest.delivery, suspended: 'user_stopped' } });
      });
    }
  }
  async context(agent) {
    const { deliveries } = await this.read(agent);
    const pending = deliveries.filter(row => !row.complete);
    const actor = await this.actor(agent);
    let handoff = '';
    if (senderPresets.includes(actor.role)) {
      if (agent.session.header.origin === 'subagent') handoff = '这是内部子课堂，结果向直接父老师汇总，不另向首页交付。';
      else {
        const receiver = await this.recipient(agent, actor);
        handoff = receiver.recipientSessionId
          ? '已有同学习集首页归属：本会话保存事实、卡片与课稿，首页根据交付判断长期画像、路线和下一步。'
          : '尚无首页归属：先保存报告，用交付工具保留日记和待回传回执；本课必要记录仍可自维护，不能声称已通知首页。';
      }
    }
    if (!pending.length && !handoff) return null;
    return { name: 'notara-summary-receipts', interpolate: false,
      text: `当前本地日期：${civilDay(new Date())}。` + handoff + '\n学习工作交付回执（仅本会话相关）。先 read 真实报告，首页判断是否影响下一步；确需处理的文档用 decide 选出，无需调整用空 targets。已有成功项保留，只处理剩余项；等待首页归属不等于已送达，用户暂停或 blocked 不自行解除。\n' + pending.slice(0, 12).map(row => JSON.stringify(row)).join('\n') };
  }
}
