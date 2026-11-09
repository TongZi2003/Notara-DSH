import { fileAddressFor, isAbsoluteWorkspacePath, relativizeToCwd } from '@deepseek-ai/dsh-util-workspace-path';
import { parseStructure, walkStructure } from './markdown-structure.js';
import { serializedSourcePins } from './reference-facts.js';

export const activityLabel = (text, fallback = '任务') => String(text || fallback).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\bsk-[a-z\d_-]{16,}\b/gi, '[已隐藏]').replace(/\bBearer\s+\S+/gi, 'Bearer [已隐藏]').replace(/((?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|\S+)/gi, '$1[已隐藏]').slice(0, 120);
const kinds = { read: 'read', write: 'write', edit: 'edit' };
const statuses = { running: '进行中', stopping: '正在停止', completed: '已完成', killed: '已停止', failed: '失败' };
const toolCache = new WeakMap();

function operation(block) {
  if (toolCache.has(block)) return toolCache.get(block);
  const settled = block.kind === 'tool-result', name = settled ? block.call?.name : block.name;
  let value = null;
  if ((settled || block.phase === 'start') && (kinds[name] || name === 'str_replace_editor')) {
    const raw = settled ? block.call?.argsRaw : block.argsRaw;
    try {
      const args = typeof raw === 'string' && raw.length <= 2_000_000 ? JSON.parse(raw) : null;
      const kind = name === 'str_replace_editor' ? ({ view: 'read', create: 'write', str_replace: 'edit', insert: 'edit' })[args?.command] : kinds[name];
      const path = args?.file_path ?? args?.path;
      if (kind && typeof path === 'string') value = { callId: block.callId, kind, path, time: Number(block.time) || 0, settled, failed: settled && block.isError === true };
    } catch { /* Partial/malformed args are not evidence of a file operation. */ }
  }
  toolCache.set(block, value);
  return value;
}

export function fileInSource(raw, source) {
  const path = relativizeToCwd(raw.replace(/\\/g, '/'), source.cwd?.replace(/\\/g, '/'));
  if (!path || path.length > 1000 || isAbsoluteWorkspacePath(path) || path.split('/').some(part => !part || part === '.' || part === '..') || /[\u0000-\u001f\u007f]/.test(path)) return null;
  return path;
}

/** A bounded projection of already-materialized native facts; never a second log. */
export function projectActivity({ sessionId, sources = [], children = [], jobs = [] }) {
  const files = new Map(), actionsBySession = {}, outputs = new Map(), references = new Map();
  for (const source of sources) {
    const resource = (raw, title) => {
      const path = typeof raw === 'string' && fileInSource(raw, source);
      if (!path) return null;
      return { key: JSON.stringify([source.workspaceId ?? source.cwd ?? source.sessionId, path]), path, title: activityLabel(title || path.split('/').at(-1), '文件'), sourceSessionId: source.sessionId, workspaceId: source.workspaceId, address: fileAddressFor(source.sessionId, source.cwd, path) };
    };
    const actions = [], seen = new Set(), objects = new Set();
    const visit = (block, turn, seq, depth = 0) => {
      if (!block || objects.has(block) || depth > 32 || seen.size >= 5000) return;
      objects.add(block);
      if (!seen.has(block.callId)) {
        seen.add(block.callId);
        const item = operation(block), path = item && fileInSource(item.path, source);
        if (path) {
          const status = item.failed ? ({ read: '读取失败', write: '写入失败', edit: '修改失败' })[item.kind] : !item.settled ? ({ read: '正在读取', write: '正在写入', edit: '正在修改' })[item.kind] : ({ read: '已读取', write: '已写入', edit: '已修改' })[item.kind];
          const changed = item.settled && !item.failed && item.kind !== 'read';
          const action = { id: item.callId, path, kind: item.kind, status, failed: item.failed, changed, pending: !item.settled, time: item.time, sourceSessionId: source.sessionId, turn, seq };
          actions.push(action);
          const key = JSON.stringify([source.workspaceId ?? source.cwd ?? source.sessionId, path]);
          const previous = files.get(key);
          const next = { ...action, key, title: activityLabel(path.split('/').at(-1), '文件'), workspaceId: source.workspaceId, address: fileAddressFor(source.sessionId, source.cwd, path), changed: changed || previous?.changed || false };
          if (!previous || action.time >= previous.time) files.set(key, next);
          else if (changed) files.set(key, { ...previous, changed: true });
        }
      }
      for (const child of block.subCalls ?? []) visit(child, turn, seq, depth + 1);
    };
    for (const node of source.nodes ?? []) if (node.data?.root) visit(node.data.root, node.location?.turn?.turn, node.anchorSeq);
    actionsBySession[source.sessionId] = actions.sort((a, b) => b.time - a.time);
    // Native explicit presentation is distinct from merely writing a file.
    for (const turn of source.turns ?? []) for (const file of turn.data?.get('deliverables')?.presented ?? []) {
      const row = resource(file.path); if (row) outputs.set(row.key, { ...row, status: '已交付' });
    }
    // Closing prose may explicitly link a successfully produced file even when
    // this preset has no present tool. Code blocks and ordinary citations stay out.
    for (const node of source.nodes ?? []) {
      if (node.kind === 'turn-tail') for (const block of node.data?.closing?.blocks ?? []) {
        if (block.kind !== 'text' || typeof block.text !== 'string' || block.text.length > 100000) continue;
        walkStructure(parseStructure(block.text), link => {
          if (link.type !== 'link') return;
          let path; try { path = decodeURIComponent(link.url); } catch { return; }
          const row = resource(path);
          const writes = row && actions.filter(action => action.path === row.path && action.kind !== 'read' && action.turn != null && action.turn === node.data.turn && action.seq <= node.data.seq).sort((a, b) => b.seq - a.seq || b.time - a.time);
          if (writes?.[0]?.changed) outputs.set(row.key, { ...row, status: '回复文件' });
        });
      }
      if (source.sessionId === sessionId && ['user', 'steering'].includes(node.kind)) for (const part of node.data?.content ?? []) {
        if (part.type === 'text' && typeof part.text === 'string' && part.text.length <= 200000) {
          for (const pin of serializedSourcePins(part.text)) {
            const row = resource(pin.path);
            if (row) {const key=row.key+JSON.stringify([pin.page,pin.rect,pin.range,pin.revision]);references.set(key, { ...row,key, title: row.title.replace(/\.md$/i, ''), page: pin.page, rect: pin.rect,range:pin.range,revision:pin.revision, status: '已发送' });}
          }
        }
        if (!['file', 'image'].includes(part.type) || !part.attachment?.attachmentId) continue;
        const key = source.sessionId + ':' + part.attachment.attachmentId;
        references.set(key, { key, type: part.type, attachment: part.attachment, sourceSessionId: source.sessionId, title: activityLabel(part.attachment.name, part.type === 'image' ? '图片' : '附件'), status: '已发送' });
      }
    }
    if (source.sessionId === sessionId) for (const occurrence of source.occurrences ?? []) {
      if (!['notara-vault-reference', 'notara-home-reference'].includes(occurrence.source)) continue;
      try {
        const pin = JSON.parse(occurrence.ref);
        if (pin.workspaceId !== source.workspaceId) continue;
        const row = resource(pin.path, pin.title); if (row) {const key=row.key+JSON.stringify([pin.page,pin.rect,pin.range,pin.revision]);references.set(key, { ...row,key,page:pin.page,rect:pin.rect,range:pin.range,revision:pin.revision,status: '待发送' });}
      } catch { /* An invalid reference must not gain file access. */ }
    }
  }
  const agents = children.map(child => {
    const actions = actionsBySession[child.id] ?? [];
    const running = typeof child.running === 'boolean' ? child.running : Boolean(child.timing?.active);
    const failed = !running && child.timing?.lastTurnCompleted === false;
    const status = running ? '进行中' : failed ? '未完成' : child.timing?.lastTurnCompleted === true ? child.mode === 'continuable' ? '可继续' : '已完成' : child.loadError ? '记录未加载' : '状态待确认';
    const counts = { read: 0, write: 0, failed: 0 };
    for (const action of actions) if (action.failed) counts.failed++; else if (!action.pending) counts[action.kind === 'read' ? 'read' : 'write']++;
    return {
      id: child.id, preset:child.preset, label: activityLabel(child.label, child.mode === 'continuable' ? '专题课堂' : '子任务'),
      address: { parentSessionId: child.parentSessionId??sessionId, childSessionId: child.id, mode: child.mode },
      canOpen: ['one-shot', 'continuable'].includes(child.mode), status, running, failed,
      summary: actions.length ? '读取 ' + counts.read + ' · 写入 ' + counts.write + ' · 失败 ' + counts.failed : child.loading ? '正在读取操作记录…' : '暂无已加载的文件操作',
      actions: actions.slice(0, 12), createdAt: child.createdAt ?? 0,
    };
  }).sort((a, b) => Number(b.running) - Number(a.running) || b.createdAt - a.createdAt);
  const owners = new Set([sessionId, ...children.map(child => child.id)]);
  const jobRows = [...new Map(jobs.filter(job => job.owner && owners.has(job.owner)).map(job => [job.id, job])).values()].map(job => ({
    id: job.id, owner: job.owner, label: job.kind === 'subagent' ? activityLabel(job.label, '子智能体任务') : job.kind === 'bash' ? '后台命令' : '后台任务', status: statuses[job.status] ?? '状态待确认',
    running: ['running', 'stopping'].includes(job.status), canStop: job.status === 'running', failed: job.status === 'failed',
    progress: '', startedAt: job.startedAt ?? 0,
  })).sort((a, b) => Number(b.running) - Number(a.running) || b.startedAt - a.startedAt);
  return { outputs: [...outputs.values()], references: [...references.values()], files: [...files.values()].sort((a, b) => b.time - a.time), agents, jobs: jobRows, actionsBySession, partial: sources.some(source => source.hasMore), activeCount: agents.filter(agent => agent.running).length + jobRows.filter(job => job.running).length };
}

export function activityUrl(raw) {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || raw.length > 4000) return null;
    return url.href;
  } catch { return null; }
}
