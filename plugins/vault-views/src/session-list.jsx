import React, { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives';
import { SearchField } from './search.jsx';
import { SimpleSearchDialog } from './search-dialog.jsx';
import { openWorkspaceSession, workspaceSessionRows } from './session-list.js';

const noSubscribe = () => () => {};
const noSnapshot = () => null;
function useSource(source) {
  return useSyncExternalStore(source ? l => source.subscribe(l) : noSubscribe, source ? () => source.getSnapshot() : noSnapshot);
}

/** A scoped list only; all conversation state and actions remain with DSH. */
export function WorkspaceSessions({ ctx, workspace, registry, list, visible, onSearch, useWorkspaceView, workspaceActions }) {
  const [query, setQuery] = useState(''), [advanced, setAdvanced] = useState(false);
  const archivedFilter = useWorkspaceView(state => state.archivedFilter ?? 'default');
  const [menu, setMenu] = useState(null), [error, setError] = useState('');
  const [search, setSearch] = useState(null);
  const input = useRef(null), filterButton = useRef(null);
  const ui = ctx.get('uiWorkspace'), uiSession = ctx.get('uiSession');
  const selected = useSource(uiSession?.adapter.current)?.key;
  const statuses = useSource(uiSession?.sessionStatus);
  const native = ctx.slots.entries('sidebar.workspaces').find(entry => entry.inject)?.inject?.();
  const shortcuts = useSource(native?.hooks?.workspaceShortcuts);
  const lastSearch = useRef(shortcuts?.searchRequest);
  const focusRequested = useRef(false);
  useEffect(() => {
    if (shortcuts?.searchRequest === lastSearch.current) return;
    lastSearch.current = shortcuts?.searchRequest;
    if (!shortcuts?.searchRequest) return;
    focusRequested.current = true;
    onSearch();
  }, [shortcuts?.searchRequest]);
  useEffect(() => {
    if (!visible) { setMenu(null); setAdvanced(false); return; }
    if (focusRequested.current) { input.current?.focus(); focusRequested.current = false; }
  }, [visible, shortcuts?.searchRequest]);

  const normalized = query.trim();
  useEffect(() => {
    if (!normalized) { setSearch(null); return; }
    const controller = new AbortController();
    setSearch({ query: normalized, loading: true, items: [] });
    const timer = setTimeout(async () => {
      try {
        const result = await ctx.sessions.search(normalized, controller.signal);
        if (controller.signal.aborted) return;
        if (!result.ok) throw new Error(result.error.message);
        setSearch({ query: normalized, ...result.value });
      } catch (reason) {
        if (!controller.signal.aborted) setSearch({ query: normalized, items: [], error: '正文搜索暂不可用，仍可按标题查找。' });
      }
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [ctx, normalized]);
  const currentSearch = search?.query === normalized ? search : null;
  const rows = workspaceSessionRows({ list, workspace, registry, currentId: selected, query, archivedFilter, content: currentSearch?.items });
  const actions = id => ctx.slots.entries('sidebar.workspaces.session.menu.item').find(entry => entry.options.id === id)?.inject?.();
  const act = async (row, action) => {
    setMenu(null); setError('');
    try {
      if (action === 'rename') actions('rename').requestSessionRename(row.id, row.renameTitle);
      else if (action === 'pin') await (row.pinned ? actions('pin').unpinSession : actions('pin').pinSession)(row.id);
      else if (action === 'fork') actions('fork').forkSession(row.id);
      else if (action === 'archive') actions('archive').archiveSession(row.id);
      else if (action === 'restore') await actions('archive').unarchiveSession(row.id);
    } catch { setError('操作未完成，请重试。'); }
  };
  const open = row => { if (!row.archived) openWorkspaceSession(ctx, row.id, workspace?.workspaceId); };
  const pending = list?.phase !== 'ready' || registry?.phase !== 'ready';
  return <div className="nv-workspace-sessions">
    <SearchField compact label="搜索会话" placeholder="搜索会话…" value={query} onChange={setQuery} inputRef={input} advancedLabel="筛选会话" advanced={advanced} onToggle={() => setAdvanced(true)} buttonRef={filterButton} count={archivedFilter !== 'default' ? 1 : 0} />
    {advanced && visible && <SimpleSearchDialog title="会话高级搜索" query={query} value={archivedFilter} label="会话范围" options={[['default', '当前会话'], ['show', '包含已归档'], ['only', '只看已归档']]} anchorRef={filterButton} onClose={() => setAdvanced(false)} onApply={(text, value) => { setQuery(text); workspaceActions.setArchivedFilter(value); setAdvanced(false); }} />}
    {error && <p className="nv-session-note" role="alert">{error}</p>}
    <div className="nv-session-scroll">
      {archivedFilter === 'only' && <p className="nv-session-heading">已归档</p>}
      <ul aria-label="当前工作区会话">
        {rows.map(row => {
          const status = statuses?.get(row.id);
          const pendingInteraction = status?.pendingInteraction;
          const statusLabel = row.archived ? '已归档' : pendingInteraction ? '等待处理' : (status?.running ?? row.running) ? '进行中' : status?.completionUnread ? '已完成' : '';
          const items = row.archived ? [{ id: 'restore', label: '恢复会话' }] : [
            { id: 'pin', label: row.pinned ? '取消置顶' : '置顶会话' },
            { id: 'rename', label: '重命名' },
            ...(!row.blank ? [{ id: 'fork', label: '从这里分支' }] : []),
            { id: 'archive', label: '归档会话' },
          ];
          return <li key={row.id} className="nv-session-row" data-selected={!row.archived && selected === row.id} data-pinned={row.pinned}>
            <button type="button" className="nv-session-open" aria-current={!row.archived && selected === row.id ? 'page' : undefined} aria-disabled={row.archived || undefined} title={row.kindLabel ? `${row.title}（${row.kindLabel}）` : row.title} onClick={() => open(row)}>
              <span className="nv-session-title">{row.title}</span>
              {row.kindLabel && <span className="nv-session-kind">{row.kindLabel}</span>}
              {row.pinned && <span className="nv-session-pin" aria-label="已置顶">⌃</span>}
              {statusLabel && <span className="nv-session-status" title={statusLabel} aria-label={statusLabel}>{statusLabel === '进行中' ? '◌' : statusLabel === '等待处理' ? '!' : '·'}</span>}
              {row.snippet && <span className="nv-session-snippet">{row.snippet}</span>}
            </button>
            <Menu portal compact autoFocus align="end" open={menu === row.id} onClose={() => setMenu(null)} items={items} onSelect={action => void act(row, action)} anchor={<button type="button" className="nv-session-more" aria-label={`${row.title}的操作`} aria-haspopup="menu" aria-expanded={menu === row.id} onClick={() => setMenu(menu === row.id ? null : row.id)}>⋯</button>} />
          </li>;
        })}
      </ul>
      {!rows.length && <p className="nv-session-note">{pending ? '正在加载会话…' : normalized ? (currentSearch?.loading ? '正在搜索…' : currentSearch?.hasMore ? '暂未找到当前工作区的匹配会话，请缩小搜索范围。' : currentSearch?.error ? '没有匹配的会话标题' : '当前工作区没有匹配的会话') : archivedFilter === 'only' ? '没有已归档会话' : '在这个工作区开始新会话'}</p>}
      {currentSearch?.error && <p className="nv-session-note" role="status">{currentSearch.error}</p>}
      {currentSearch?.hasMore && <p className="nv-session-note">正文搜索结果较多，请输入更具体的关键词。</p>}
    </div>
  </div>;
}
