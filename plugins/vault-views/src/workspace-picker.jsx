import React, { useEffect, useState } from 'react';
import { Menu, MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives';
import { workspaceTitle as titleOf, workspaceGroups, rememberWorkspace, RECENT_WORKSPACES_KEY } from './workspace-picker-model.js';

function WorkspaceName({ title }) {
  const chars = Array.from(title), tail = chars.length > 16 ? chars.slice(-8).join('') : '';
  return <span className="nv-workspace-name" aria-label={title}><span>{tail ? chars.slice(0, -8).join('') : title}</span>{tail && <span>{tail}</span>}</span>;
}
function FolderIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" /><path d="M3 8h18" /></svg>;
}

export function WorkspacePicker({ workspaces, current, onChange, onAdd }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [recent, setRecent] = useState(() => { try { const ids = JSON.parse(localStorage.getItem(RECENT_WORKSPACES_KEY)); return Array.isArray(ids) ? ids.filter(id => typeof id === 'string') : []; } catch { return []; } });
  useEffect(() => {
    if (!current?.workspaceId) return;
    setRecent(ids => { const next = rememberWorkspace(ids, current.workspaceId); try { localStorage.setItem(RECENT_WORKSPACES_KEY, JSON.stringify(next)); } catch { /* Optional visit history. */ } return next; });
  }, [current?.workspaceId]);
  const groups = workspaceGroups(workspaces, current?.workspaceId, recent, search);
  const title = current ? titleOf(current) : '选择工作区';
  return <Menu
    className="nv-workspace-picker"
    listClassName="nv-workspace-menu"
    portal compact
    open={open}
    selectedId={current?.workspaceId}
    onClose={() => setOpen(false)}
    onSelect={id => { setOpen(false); if (id === 'notara:add-workspace') onAdd?.(); else if (id !== current?.workspaceId) onChange(id); }}
    footer={onAdd ? [{ id: 'notara:add-workspace', icon: <span aria-hidden="true">＋</span>, label: '添加工作区…' }] : undefined}
    anchor={<button type="button" className="nv-left-ws-select" aria-label="切换工作区" aria-haspopup="menu" aria-expanded={open} data-workspace-id={current?.workspaceId || ''} title={title} onClick={() => { setSearch(''); setOpen(value => !value); }}>
      <WorkspaceName title={title}/>
      <svg className="nv-workspace-chevron" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
    </button>}
  >
    <input className="nv-workspace-search" autoFocus aria-label="搜索学习集" placeholder="搜索学习集…" value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => {
      if (event.key === 'Escape') return;
      event.stopPropagation();
      if (event.key === 'ArrowDown' && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.closest('[role="menu"]')?.querySelector('[role="menuitem"]')?.focus(); }
    }}/>
    {groups.map(([label, items]) => <React.Fragment key={label}><div role="presentation">{label}</div>{items.map(workspace => <MenuItemButton key={workspace.workspaceId} icon={<FolderIcon/>} current={workspace.workspaceId === current?.workspaceId} onSelect={() => { setOpen(false); if (workspace.workspaceId !== current?.workspaceId) onChange(workspace.workspaceId); }}><span className="nv-workspace-option" data-workspace-option={workspace.workspaceId} data-current={workspace.workspaceId === current?.workspaceId} title={titleOf(workspace)}><WorkspaceName title={titleOf(workspace)}/></span></MenuItemButton>)}</React.Fragment>)}
    {!groups.length && <div role="status" className="nv-workspace-empty">没有匹配的学习集</div>}
  </Menu>;
}
