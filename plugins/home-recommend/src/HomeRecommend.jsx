import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { buildHomeActions, createRecommendationLoader, QUICK_REQUESTS } from './model.js';
import { canOpenSession, currentSessionId, openContinuationSession, prefillComposer } from './composer.js';
import { bindVaultRemote, currentWorkspace, subscribeVaultChanges, subscribeWorkspace } from '@oh-my-student/plugin-vault-sqlite/workspace-client';

const emptySubscribe = () => () => {};
const emptySnapshot = () => undefined;

/** Principal component; native hero props pass through without replacing its composer. */
export function HomeRecommend({ ctx, nativeWorkspaceSelector, needsWorkspace = false, sessionId: boundSessionId, compact = false, renderMarkdown }) {
  const sessions = ctx.sessions.list;
  const snapshot = useSyncExternalStore(
    useMemo(() => sessions ? listener => sessions.subscribe(listener) : emptySubscribe, [sessions]),
    useMemo(() => sessions ? () => sessions.getSnapshot() : emptySnapshot, [sessions]),
  );
  const workspacesList = ctx.get?.('workspaces')?.list;
  const workspacesSnapshot = useSyncExternalStore(
    useMemo(() => workspacesList ? listener => workspacesList.subscribe(listener) : emptySubscribe, [workspacesList]),
    useMemo(() => workspacesList ? () => workspacesList.getSnapshot() : emptySnapshot, [workspacesList]),
  );
  const sessionId = currentSessionId(snapshot);
  const subscribeWs = useCallback(listener => subscribeWorkspace(ctx, listener), [ctx]);
  const getWsSnapshot = useCallback(() => currentWorkspace(ctx), [ctx]);
  const workspaceId = useSyncExternalStore(subscribeWs, getWsSnapshot);
  if (boundSessionId && boundSessionId !== sessionId) return null;
  // A keyed subtree clears old cards and notices synchronously on session or workspace changes.
  return <HomeContent key={`${sessionId ?? 'none'}:${workspaceId}:${needsWorkspace}`} ctx={ctx} sessionId={sessionId} workspaceId={workspaceId}
    sessionsSnapshot={snapshot} workspacesSnapshot={workspacesSnapshot}
    nativeWorkspaceSelector={nativeWorkspaceSelector} needsWorkspace={needsWorkspace} compact={compact} renderMarkdown={renderMarkdown} />;
}

/** The native dock exists before the same composer in both blank and used chats. */
export function HomeRecommendDock({ ctx, session, actions, renderMarkdown }) {
  const workspaceId = useSyncExternalStore(useCallback(l => subscribeWorkspace(ctx, l), [ctx]), useCallback(() => currentWorkspace(ctx), [ctx]));
  const [homeId, setHomeId] = useState(null);
  const navigation = ctx.get?.('notaraHomeNavigation');
  const request = useSyncExternalStore(navigation?.subscribe ?? emptySubscribe, navigation?.getSnapshot ?? emptySnapshot);
  const consumed = useRef(null);
  useEffect(() => {
    let active = true;
    setHomeId(null);
    if (workspaceId !== null) void ctx.remote.notaraVault.homeSession({ ...(workspaceId === undefined ? {} : { workspaceId }) })
      .then(result => { if (active && result?.ok) setHomeId(result.value.sessionId); }).catch(() => {});
    return () => { active = false; };
  }, [ctx, workspaceId, session.sessionId, session.promptAttempted]);
  const isHome = homeId === session.sessionId && !session.removed;
  useEffect(() => {
    if (!isHome || !ctx.slots) return;
    return ctx.slots.register({ name: 'conversation.view', id: 'notara-learning-home', order: -5, label: '首页' },
      () => <div className="nr-home-page"><HomeRecommend ctx={ctx} sessionId={session.sessionId} renderMarkdown={renderMarkdown}/></div>);
  }, [ctx, isHome, session.sessionId, renderMarkdown]);
  useEffect(() => {
    if (!isHome || !actions || request?.sessionId !== session.sessionId || consumed.current === request) return;
    consumed.current = request;
    actions.setView('notara-learning-home');
  }, [isHome, actions, request, session.sessionId]);
  // Native local submission echoes distinguish the student's send from
  // background replies. Selection is presentation only; the composer stays put.
  useEffect(() => {
    if (isHome && session.pendingSubmissions?.length) actions?.setView('chat');
  }, [isHome, session.pendingSubmissions, actions]);
  if (!isHome || !session.blank || session.promptAttempted) return null;
  return <div className="nr-home-dock" data-home-blank="true"><HomeRecommend ctx={ctx} sessionId={session.sessionId} renderMarkdown={renderMarkdown}/></div>;
}

function sessionListSignature(snapshot) {
  if (!snapshot?.byId) return '';
  const parts = [];
  for (const id of Object.keys(snapshot.byId).sort()) {
    const row = snapshot.byId[id];
    if (!row) continue;
    const proj = snapshot.projectionsBySession?.[id]?.values ?? row.projectionValues;
    const preset = proj?.agentPreset ?? row.agentPreset ?? '';
    const mode = proj?.subagent?.mode ?? '';
    const catalog = Array.isArray(proj?.subagentCatalog)
      ? proj.subagentCatalog.map(item => `${item?.id ?? ''}:${item?.mode ?? ''}:${item?.running ? 1 : 0}`).join(',')
      : '';
    parts.push(`${id}:${row.removed ? 1 : 0}:${row.running ? 1 : 0}:${row.updatedAt ?? ''}:${row.origin ?? ''}:${row.parentId ?? ''}:${preset}:${mode}:[${catalog}]`);
  }
  return parts.join('|');
}

function HomeContent({ ctx, sessionId, workspaceId, sessionsSnapshot, workspacesSnapshot, nativeWorkspaceSelector, needsWorkspace, compact, renderMarkdown }) {
  const [state, setState] = useState({ phase: 'loading' });
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (needsWorkspace || !sessionId) return undefined;
    const remote = bindVaultRemote(ctx.remote.notaraVault, workspaceId);
    const loader = createRecommendationLoader(() => remote.homeRecommendations({}), setState);
    void loader.load();
    const offVault = subscribeVaultChanges(remote, () => { void loader.refresh(); }, workspaceId);
    let lastSig = sessionListSignature(ctx.sessions?.list?.getSnapshot?.());
    const offSessions = ctx.sessions?.list?.subscribe?.(() => {
      const nextSnap = ctx.sessions?.list?.getSnapshot?.();
      if (currentSessionId(nextSnap) !== sessionId) return;
      const nextSig = sessionListSignature(nextSnap);
      if (nextSig === lastSig) return;
      lastSig = nextSig;
      void loader.refresh();
    });
    const offWorkspaces = ctx.get?.('workspaces')?.list?.subscribe?.(() => { void loader.refresh(); });
    return () => {
      offVault?.();
      offSessions?.();
      offWorkspaces?.();
      loader.dispose();
    };
  }, [ctx, sessionId, workspaceId, needsWorkspace, attempt]);

  const choose = request => {
    try {
      setNotice(prefillComposer(ctx, sessionId, request)
        ? ''
        : '暂时无法带入，请回到当前对话的输入框后再试。');
    } catch { setNotice('没有带入成功，请稍后再试。'); }
  };

  const executeAction = item => {
    if (!item) return;
    if (item.kind === 'open-session') {
      try {
        setNotice(openContinuationSession(ctx, item.sessionId, workspaceId, { verifiedClassroom: true })
          ? ''
          : '原课堂暂时无法打开，已为你保留当前页面，可从左侧会话列表查看。');
      } catch { setNotice('打开原课堂失败，请从左侧会话列表重试。'); }
      return;
    }
    if (item.request) choose(item.request);
  };

  const data = state.phase === 'ready' ? state.data : null;
  const ready = Boolean(sessionId) && !needsWorkspace;
  const { primary, alternatives, continuation } = useMemo(
    () => buildHomeActions(data, { canOpenSession: id => canOpenSession(ctx, id, workspaceId, { verifiedClassroom: true }) }),
    [data, ctx, workspaceId, sessionsSnapshot, workspacesSnapshot],
  );

  return <section className="nr-home" aria-label="学习推荐">
    {!compact && primary && <header className="nr-home-heading">
      <h1>今天推荐做的事情</h1>
    </header>}
    {nativeWorkspaceSelector && <div className="nr-home-workspace">{nativeWorkspaceSelector}</div>}
    {!ready ? <p className="nr-home-status" role="status">{needsWorkspace ? '先选择学习目录，再开始学习。' : '正在准备输入框…'}</p>
      : state.phase === 'loading' ? <p className="nr-home-status" role="status">正在读取学习进展…</p>
      : state.phase === 'error' ? <div className="nr-home-status" role="status">
        <span>学习进展暂时没有读出来，你仍可以写下想学的内容。</span>
        <button className="nr-home-link" type="button" onClick={() => setAttempt(value => value + 1)}>重新读取</button>
      </div> : null}

    {primary && <div className={`nr-home-actions${alternatives.length ? ' has-alternatives' : ''}`}>
      <section className="nr-home-panel nr-home-primary" aria-label="建议下一步">
        <button type="button" className="nr-home-action" aria-label={primary.ctaLabel} disabled={!ready} onClick={() => executeAction(primary)}>
          <span className="nr-home-card-top"><span className="nr-home-badge">{primary.badge}</span><span className="nr-home-arrow" aria-hidden="true">↗</span></span>
          <div role="heading" aria-level="2" className="nr-home-primary-title">{renderMarkdown ? renderMarkdown(primary.title) : primary.title}</div>
          {primary.detail && <div className="nr-home-next">{renderMarkdown ? renderMarkdown(primary.detail) : primary.detail}</div>}
        </button>
      </section>

      {alternatives.length > 0 && <section className="nr-home-panel nr-home-secondary" aria-label="其他可选行动">
        <ul className="nr-home-reviews">
          {alternatives.map(item => <li key={item.id}>
            <button type="button" className="nr-home-review" disabled={!ready} onClick={() => executeAction(item)}>
              <span className="nr-home-title">{renderMarkdown ? renderMarkdown(item.title) : item.title}</span>
              {item.detail && <small>{renderMarkdown ? renderMarkdown(item.detail) : item.detail}</small>}
              <span className="nr-home-review-arrow" aria-hidden="true">↗</span>
            </button>
          </li>)}
        </ul>
      </section>}
    </div>}

    {continuation && <button type="button" className="nr-home-resume" aria-label="继续上次课堂"
      onClick={() => executeAction(continuation)}>
      <span className="nr-home-resume-label">继续上次课堂</span>
      {continuation.title && <span className="nr-home-resume-title">{continuation.title}</span>}
      <span className="nr-home-resume-arrow" aria-hidden="true">↗</span>
    </button>}

    <section className="nr-home-scenarios" aria-label="学习场景入口">
      <div className="nr-home-pills">{QUICK_REQUESTS.map(item => <button key={item.id} type="button"
        className="nr-home-pill" disabled={!ready} onClick={() => choose({ text: item.text })}>
        {item.label}
      </button>)}</div>
    </section>

    {notice && <p className="nr-home-feedback" role="status" aria-live="polite">{notice}</p>}
  </section>;
}

export default HomeRecommend;
