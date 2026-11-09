import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { subscribeVaultChanges } from '@oh-my-student/plugin-vault-sqlite/workspace-client';
import { callVault, documentType, projectRouteDocument } from './logic.js';

function verificationPrompt(milestone) {
  return `请围绕阶段「${milestone.text}」继续学习。结合已有记录${milestone.criteria?`、阶段依据（${milestone.criteria}）`:''}和本次目的，选择解释、应用、拓展或检验${milestone.remediation?`，需要时为「${milestone.remediation}」提供支撑`:''}；考试检验按相应要求核对实际表现，保留认识变化与下一步。`;
}

export function RouteAndLessonBar({ record, content, dirty = false, workspaceId, remote, onOpen, onBring, renderMarkdown }) {
  const renderInline = text => renderMarkdown ? renderMarkdown(text, onOpen) : text;
  const type = useMemo(() => documentType(content), [content]);
  const [bindings, setBindings] = useState([]);
  const [lessonsByPath, setLessonsByPath] = useState(null);

  const reloadBindings = useCallback(() => {
    if ((type !== 'route' && type !== 'lesson') || typeof remote?.lessonBindings !== 'function') {
      setBindings([]);
      setLessonsByPath(null);
      return () => {};
    }
    let alive = true;
    void callVault(remote, 'lessonBindings', {}).then(
      result => {
        if (alive) setBindings(Array.isArray(result?.bindings) ? result.bindings : []);
      },
      () => {
        if (alive) setBindings([]);
      },
    );
    if (type === 'route' && typeof remote?.query === 'function') {
      void callVault(remote, 'query', { view: 'lessons', limit: 200 }).then(
        result => {
          if (!alive) return;
          const docs = Array.isArray(result?.documents) ? result.documents : [];
          setLessonsByPath(new Map(docs.map(doc => [doc.path, { type: 'lesson', title: doc.title, revision: doc.revision }])));
        },
        () => {
          if (alive) setLessonsByPath(null);
        },
      );
    } else {
      setLessonsByPath(null);
    }
    return () => { alive = false; };
  }, [remote, type, workspaceId]);

  useEffect(() => reloadBindings(), [reloadBindings, record?.revision]);

  useEffect(() => {
    if ((type !== 'route' && type !== 'lesson') || !remote) return undefined;
    return subscribeVaultChanges(remote, () => { reloadBindings(); }, workspaceId);
  }, [remote, workspaceId, type, reloadBindings]);

  const openClassroom = useCallback(sessionId => {
    onOpen?.({ sessionId, workspaceId });
  }, [onOpen, workspaceId]);

  const projection = useMemo(() => {
    if (type !== 'route') return null;
    return projectRouteDocument(content, {
      path: record?.path || '',
      revision: record?.revision ?? null,
      ...(lessonsByPath ? { documentsByPath: lessonsByPath } : {}),
      bindings,
    });
  }, [type, content, record?.path, record?.revision, lessonsByPath, bindings]);

  if (type === 'lesson') {
    const lessonSessions = bindings.filter(b => b && !b.missing && b.path === record?.path && b.sessionId);
    if (!lessonSessions.length) return null;
    const currentTaskText = lessonSessions[0].currentTask?.content || lessonSessions[0].currentTask?.text;
    return (
      <section className="nv-route-bar" aria-label="关联课堂">
        <div className="nv-route-bar-header">
          <strong>关联课堂</strong>
          <span className="nv-route-bar-meta">
            {lessonSessions[0].progressLabel || `共 ${lessonSessions.length} 节已关联课堂`}
          </span>
          <div className="nv-route-bar-actions">
            {lessonSessions.map(item => (
              <button
                key={item.sessionId}
                type="button"
                className="nv-route-action-btn"
                onClick={() => openClassroom(item.sessionId)}
              >
                打开关联课堂
              </button>
            ))}
          </div>
        </div>
        {currentTaskText && (
          <div className="nv-route-bar-sub nv-inline-markdown">当前进行：{renderMarkdown ? renderMarkdown(currentTaskText, onOpen) : currentTaskText}</div>
        )}
      </section>
    );
  }

  if (type !== 'route' || !projection || (projection.total === 0 && !projection.nextAction)) return null;

  const routePin = {
    path: record.path,
    ...(dirty || !record.revision ? {} : { revision: record.revision }),
    title: projection.title || record.path.split('/').at(-1).replace(/\.md$/i, ''),
  };

  const next = projection.nextAction;
  const milestone = projection.nextMilestone;
  const session = next ? next.sessions[0] : milestone?.sessions[0];
  const reference = next ? next.references[0] : milestone?.lessonRefs[0] || milestone?.materialRefs[0];
  const targetTitle = session?.label || reference?.label || reference?.path?.split('/').at(-1).replace(/\.md$/i, '') || milestone?.text;
  const continueLearning = () => onBring?.([routePin], next?.rawText || verificationPrompt(milestone));

  return (
    <section className="nv-route-bar" aria-label="路线里程碑概览">
      <div className="nv-route-bar-header">
        <strong>路线进度</strong>
        <span className="nv-route-bar-meta">{projection.completed} / {projection.total}</span>
      </div>
      {(next || milestone) && <div className="nv-route-next-row">
        {targetTitle && <div className="nv-route-next-label nv-inline-markdown">{renderInline(targetTitle)}</div>}
        <div className="nv-route-bar-actions">
          {session ? <button className="nv-route-action-btn" onClick={() => openClassroom(session.sessionId)}>继续课堂</button>
            : reference ? <button className="nv-route-action-btn" onClick={() => onOpen?.({...reference, workspaceId})}>打开资料</button>
            : onBring && <button className="nv-route-action-btn" onClick={continueLearning}>继续讨论</button>}
        </div>
      </div>}
      <details className="nv-route-details">
        <summary>路线详情</summary>
        {next && <div className="nv-route-next-description nv-inline-markdown">{renderInline(next.rawText)}</div>}
        {(next || milestone) && onBring && (session || reference) && <button className="nv-route-action-btn" onClick={continueLearning}>带入当前对话</button>}
        {projection.milestones.length > 0 && <ul className="nv-route-milestone-list">
          {projection.milestones.map((item, idx) => {
            const statusText = item.needsRemediation ? '待补' : item.checked ? '活动已完成' : item === milestone ? '当前阶段' : '尚未开始';
            const statusClass = item.needsRemediation ? 'is-remediation' : item.checked ? 'is-done' : 'is-pending';
            return <li key={`${item.line}-${idx}`} className={`nv-route-milestone-item ${statusClass}`}>
              <div className="nv-route-milestone-main">
                <span className="nv-route-milestone-state" title={statusText} aria-label={statusText}>●</span>
                <div className="nv-route-milestone-title nv-inline-markdown">{renderInline(item.text)}</div>
              </div>
              {item.criteria && <div className="nv-route-remediation-note nv-inline-markdown">阶段依据：{renderInline(item.criteria)}</div>}
              {item.remediation && <div className="nv-route-remediation-note nv-inline-markdown">待补内容：{renderInline(item.remediation)}</div>}
              <div className="nv-route-reference-list">
                {item.sessions.map(s => <button key={s.sessionId} className="nv-route-reference" onClick={() => openClassroom(s.sessionId)}>{s.label || '关联课堂'}</button>)}
                {[...item.lessonRefs, ...item.materialRefs, ...item.summaries].map((ref, i) => <button key={ref.path+i} className="nv-route-reference" onClick={() => onOpen?.({...ref, workspaceId})}>{ref.label || ref.path.split('/').at(-1).replace(/\.md$/i, '')}</button>)}
                {onBring && (!item.checked || item.needsRemediation || item.criteria) && <button className="nv-route-reference" onClick={() => onBring([routePin], verificationPrompt(item))}>讨论这个阶段</button>}
              </div>
            </li>;
          })}
        </ul>}
      </details>
    </section>
  );
}
