import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { bindVaultRemote, currentWorkspace, subscribeWorkspace } from '@oh-my-student/plugin-vault-sqlite/workspace-client';
import { MarkdownText, MarkdownDelegateProvider, ReferenceIconMedium, writeClipboard, IconCopyOutlineRegular, FileTypeIcon } from '@deepseek-ai/dsh-client-ui-primitives';
import styles from './styles.css';
import { ForceGraphView } from './graph-view.jsx';
import { installMarkdownBlocks } from './markdown-extension.jsx';
import { CanvasBlocks } from './canvas.jsx';
import { InteractiveBlocks } from './blocks.jsx';
import { createAnswerStore } from './answer-store.js';
import { appendAnswer } from './composer.js';
export { ForceGraphView } from './graph-view.jsx';
export { InteractiveBlocks, InteractiveBlock } from './blocks.jsx';
export { CanvasBlocks, CanvasTextNode } from './canvas.jsx';
export { createAnswerStore, answerStore } from './answer-store.js';

export const PANEL_ID = 'notara-graph';
function ComponentPreview({ source, scope, renderMarkdown }) {
  const store = useMemo(() => createAnswerStore(), [scope]);
  return <InteractiveBlocks source={source} scope={scope} store={store} renderMarkdown={renderMarkdown} preview />;
}
export function CanvasView({ content, path, ctx, onSubmitted }) {
  const snapshot = useSyncExternalStore(fn => ctx.sessions.list.subscribe(fn), () => ctx.sessions.list.getSnapshot());
  const sessionId = Object.values(snapshot.byId ?? {}).find(row => row.retainedBy?.mainView > 0)?.id;
  return <CanvasBlocks content={content} scope={JSON.stringify([sessionId ?? 'unbound', path])} renderMarkdown={text => <MarkdownText text={text} labels={{ code: { copyLabel: '复制', copiedLabel: '已复制' }, footnotes: '注释' }} />} onSubmit={({ text }) => { appendAnswer(ctx, sessionId, text); onSubmitted?.(); window.dispatchEvent(new CustomEvent('notara:exit-fullscreen')); }} />;
}
export function GraphWorkspace({ ctx, focusPath, workspaceId:pinnedWorkspace, ...props }) {
  const activeWorkspace = useSyncExternalStore(l => subscribeWorkspace(ctx, l), () => currentWorkspace(ctx));
  const workspaceId=pinnedWorkspace ?? activeWorkspace;
  const remote = useMemo(() => bindVaultRemote(ctx.remote.notaraVault, workspaceId), [ctx, workspaceId]);
  const [focus, setFocus] = useState(focusPath ?? null);
  useEffect(() => { setFocus(focusPath ?? null); }, [focusPath]);
  useEffect(() => { if(pinnedWorkspace !== undefined)return;const open = event => setFocus(event.detail?.focusPath ?? null); window.addEventListener('notara:open-graph', open); return () => window.removeEventListener('notara:open-graph', open); }, [pinnedWorkspace]);
  const onOpenDocument = props.onOpenDocument || (locator => window.dispatchEvent(new CustomEvent('notara:open-document', { detail: { ...locator, workspaceId } })));
  return <ForceGraphView {...props} onOpenDocument={onOpenDocument} key={workspaceId ?? 'default'} ctx={ctx} remote={remote} focusPath={focus} />;
}

export default {
  name: 'notara-graph-and-blocks',
  inject: ['remote', 'remote.notaraVault'],
  apply(ctx) {
    ctx.plugin({
      name: 'notara-graph-and-blocks-ui',
      inject: ['slots', 'remote', 'remote.notaraVault', 'layout', 'sessions', 'conversation', 'uiConversation'],
      apply(scope) {
        let pendingFocus = null;
        scope.effect(() => { const style = document.createElement('style'); style.dataset.notaraGraphBlocks = ''; style.dataset.plugin = '@oh-my-student/plugin-graph-and-blocks'; style.textContent = styles; document.head.append(style); return () => style.remove(); });
        scope.effect(() => scope.slots.inject('main', () => scope.slots.register({ name: 'main', key: PANEL_ID }, props => <GraphWorkspace {...props} ctx={scope} focusPath={pendingFocus} />)));
        scope.effect(() => scope.slots.inject('notara.vault.graph', () => scope.slots.register({ name: 'notara.vault.graph' }, props => <GraphWorkspace {...props} ctx={scope} focusPath={Object.hasOwn(props,'focusPath')?props.focusPath:pendingFocus} />)));
        scope.effect(() => { const open = event => { pendingFocus = typeof event.detail?.focusPath === 'string' ? event.detail.focusPath : null; }; window.addEventListener('notara:open-graph', open); return () => window.removeEventListener('notara:open-graph', open); });
        scope.effect(() => scope.slots.inject('conversation.chat.node', () => installMarkdownBlocks(scope, { MarkdownText, MarkdownDelegateProvider, ReferenceIconMedium, writeClipboard, IconCopyOutlineRegular, FileTypeIcon })));
        scope.effect(() => scope.slots.inject('notara.vault.canvas', () => scope.slots.register({ name: 'notara.vault.canvas' }, props => <CanvasView {...props} ctx={scope} />)));
        scope.effect(() => scope.slots.inject('notara.vault.blocks', () => scope.slots.register({ name: 'notara.vault.blocks' }, ComponentPreview)));
      },
    });
  },
};
