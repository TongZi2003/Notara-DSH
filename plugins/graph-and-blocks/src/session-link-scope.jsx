import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { parseSessionReference } from '@oh-my-student/plugin-vault-sqlite/file-reference';
import { workspaceForSession } from '@oh-my-student/plugin-vault-sqlite/workspace-client';
import { fileMediaUrl, resolveWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path';

/** Display-only navigation, bound to the message's workspace, not the active tab. */
export function SessionLinkScope({ ctx, sessionId, primitives, children }) {
  const { MarkdownDelegateProvider, ReferenceIconMedium } = primitives;
  // rc.4 publishes the provider but not its context hook. Reuse the native
  // view's injected navigation callbacks and the same public image resolver.
  const owner = ctx.slots.entries('conversation.view').find(entry => entry.options.id === 'chat').inject(sessionId);
  const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd;
  const fileImages = { resolve: path => fileMediaUrl(document.baseURI, resolveWorkspacePath(cwd, path)),
    labels: { open: '打开图片', loading: '正在加载图片', failed: '图片加载失败', dialog: '图片', close: '关闭' } };
  const [error, setError] = useState('');
  const root = useRef(null);
  const [icons, setIcons] = useState([]);
  useLayoutEffect(() => {
    // rc.4 has no per-link icon slot. Keep the native button/navigation and
    // mount its public session glyph in our own child, not in its SVG tree.
    const next = [];
    for (const button of root.current?.querySelectorAll('button[title]') ?? []) {
      if (parseSessionReference(button.title)) {
        button.title = button.textContent;
        button.dataset.notaraReference = 'session';
      }
      if (button.dataset.notaraReference !== 'session') continue;
      if (button.title !== button.textContent) {
        delete button.dataset.notaraReference;
        button.querySelector(':scope > .nv-session-link-icon')?.remove();
        continue;
      }
      let mount = button.querySelector(':scope > .nv-session-link-icon');
      if (!mount) {
        mount = document.createElement('span'); mount.className = 'nv-session-link-icon';
        mount.setAttribute('aria-hidden', 'true'); button.prepend(mount);
      }
      next.push(mount);
    }
    setIcons(previous => previous.length === next.length && previous.every((mount, i) => mount === next[i]) ? previous : next);
  }, [children]);
  const openFile = (path, options) => {
    const ref = parseSessionReference(path);
    if (!ref) return owner.openFile(path, options);
    const workspaceId = workspaceForSession(ctx, sessionId);
    setError('');
    if (workspaceId === null || window.dispatchEvent(new CustomEvent('notara:open-session', {
      cancelable: true, detail: { sessionId: ref.sessionId, workspaceId },
    }))) setError('这节课暂时无法打开，请从会话列表查看。');
  };
  return <MarkdownDelegateProvider openExternalLink={owner.openExternalLink} fileImages={fileImages} openFile={openFile}>
    <div ref={root} className="nv-session-link-scope">{children}{icons.map((mount, i) => createPortal(<ReferenceIconMedium kind="session" />, mount, i))}{error && <p role="status">{error}</p>}</div>
  </MarkdownDelegateProvider>;
}
