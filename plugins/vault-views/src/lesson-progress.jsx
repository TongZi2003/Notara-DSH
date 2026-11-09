import React, { useState } from 'react';
import { NativeVaultMarkdown } from './native-markdown.jsx';
import {
  IconChecklistOutlineRegular,
  IconChevronDownOutlineRegular,
  IconChevronUpOutlineRegular,
  Modal,
  StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives';

function statusDotState(status) {
  switch (status) {
    case 'completed': return 'done';
    case 'in_progress': return 'ongoing';
    default: return 'idle';
  }
}

function statusLabel(status) {
  switch (status) {
    case 'completed': return '已完成';
    case 'in_progress': return '进行中';
    default: return '待处理';
  }
}

function LessonPickerModal({ open, currentPath, candidates = [], busy, error, onSelect, onUnbind, onClose }) {
  const [query, setQuery] = useState('');
  if (!open) return null;
  const keyword = query.trim().toLowerCase();
  const filtered = candidates.filter(item => !keyword || item.title.toLowerCase().includes(keyword) || item.path.toLowerCase().includes(keyword));
  return (
    <Modal open title="选择本课备课本" closeLabel="关闭备课本选择" onClose={onClose} className="nv-activity-add">
      <p className="nv-activity-add-help">关联当前学习集内已保存的备课本（type: lesson），右上角本课清单将与该文档保持同步。</p>
      {candidates.length > 4 && (
        <label>
          搜索备课本
          <input
            type="search"
            aria-label="搜索备课本"
            placeholder="输入标题或路径筛选"
            value={query}
            onChange={event => setQuery(event.target.value)}
          />
        </label>
      )}
      <div className="nv-activity-picker" role="listbox" aria-label="可关联的备课本">
        {filtered.length ? filtered.map(item => (
          <button
            key={item.path}
            type="button"
            disabled={busy}
            aria-current={item.path === currentPath ? 'true' : undefined}
            onClick={() => onSelect(item)}
          >
            <span>{item.title}{item.path === currentPath ? '（当前已关联）' : ''}</span>
            <small>{item.path} · 已完成 {item.completed ?? 0}/{item.total ?? 0}</small>
          </button>
        )) : <p className="nv-activity-section-empty">当前学习集暂无匹配的备课本。</p>}
      </div>
      {currentPath && (
        <div className="nv-lesson-picker-footer">
          <button type="button" className="nv-activity-more" disabled={busy} onClick={onUnbind}>解除当前课堂关联</button>
        </div>
      )}
      {error && <p role="alert" className="nv-activity-notice">{error}</p>}
    </Modal>
  );
}

export function LessonProgressSection({ state, onOpenFile, onBindLesson, onToggleTask, onSetCurrentTask, defaultExpanded = false }) {
  const lesson = state.lesson;
  const [collapsed, setCollapsed] = useState(!defaultExpanded);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  if (!lesson?.bound) return null;
  const readOnly = lesson.eligible === false;

  const runAction = async fn => {
    if (readOnly) return;
    setBusy(true);
    setActionError('');
    try {
      await fn();
    } catch (error) {
      setActionError(error?.message || '本课清单更新失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  const handleSelectCandidate = async item => {
    if (readOnly) return;
    setBusy(true);
    setActionError('');
    try {
      await onBindLesson(item.path, item.revision);
      setPicking(false);
    } catch (error) {
      setActionError(error?.message || '关联备课本失败');
    } finally {
      setBusy(false);
    }
  };

  const handleUnbind = async () => {
    if (readOnly) return;
    setBusy(true);
    setActionError('');
    try {
      await onBindLesson(null);
      setPicking(false);
    } catch (error) {
      setActionError(error?.message || '解除关联失败');
    } finally {
      setBusy(false);
    }
  };

  if (lesson.missing || !lesson.plan) {
    return (
      <section className="nv-activity-section nv-lesson-progress" aria-label="本课清单" data-testid="lesson-checklist">
        <h3>
          本课清单
          <button type="button" className="nv-lesson-switch" disabled={busy || readOnly} onClick={() => { setActionError(''); setPicking(true); }}>
            重新选择
          </button>
        </h3>
        <p className="nv-activity-notice" role="status">
          原关联备课本「{lesson.path}」已改名、删除或不再是备课本，请重新选择或解除关联。
        </p>
        <div className="nv-lesson-missing-actions">
          <button type="button" className="nv-activity-more" disabled={busy || readOnly} onClick={() => { setActionError(''); setPicking(true); }}>重新选择备课本</button>
          <button type="button" className="nv-activity-more" disabled={busy || readOnly} onClick={handleUnbind}>解除关联</button>
        </div>
        {actionError && <p role="alert" className="nv-activity-notice">{actionError}</p>}
        <LessonPickerModal
          open={picking && !readOnly}
          currentPath={lesson.path}
          candidates={lesson.candidates}
          busy={busy || readOnly}
          error={actionError}
          onSelect={handleSelectCandidate}
          onUnbind={handleUnbind}
          onClose={() => setPicking(false)}
        />
      </section>
    );
  }

  const { plan } = lesson;
  const summaryText = plan.progressLabel || '暂无公开任务';

  return (
    <section className="nv-activity-section nv-lesson-progress" aria-label="本课清单" data-testid="lesson-checklist">
      <h3>
        本课清单
        {plan.counts.total > 0 && <span>{plan.counts.completed}/{plan.counts.total}</span>}
        <button
          type="button"
          className="nv-lesson-switch"
          aria-label="更换备课本"
          title={readOnly ? '已归档课堂只读' : '更换或解除关联备课本'}
          disabled={busy || readOnly}
          onClick={() => { setActionError(''); setPicking(true); }}
        >
          更换
        </button>
      </h3>
      <div className="nv-lesson-doc-row">
        <button
          type="button"
          className="nv-activity-file nv-activity-line nv-lesson-doc-button"
          title={`打开备课本：${plan.path}`}
          onClick={() => onOpenFile({ path: plan.path, title: plan.title, workspaceId: state.workspaceId, revision: plan.revision })}
        >
          <span className="nv-activity-name">{plan.title}</span>
          <span className="nv-activity-status">打开课稿</span>
        </button>
      </div>
      <div className="nv-lesson-card">
        <button
          type="button"
          className="nv-lesson-header"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(value => !value)}
        >
          <span className="nv-lesson-lead" aria-hidden="true"><IconChecklistOutlineRegular /></span>
          <span className="nv-lesson-progress-label">{summaryText}</span>
          <span className="nv-lesson-chevron" aria-hidden="true">
            {collapsed ? <IconChevronDownOutlineRegular /> : <IconChevronUpOutlineRegular />}
          </span>
        </button>
        {collapsed && (plan.currentTask ? (
          <div className="nv-lesson-focus" data-focus-kind="in_progress">
            <StateDot state="ongoing" />
            <span className="nv-lesson-task-markdown">正在进行：<NativeVaultMarkdown text={plan.currentTask.content} onOpen={onOpenFile} /></span>
          </div>
        ) : plan.nextTask ? (
          <div className="nv-lesson-focus" data-focus-kind="next">
            <StateDot state="idle" />
            <span className="nv-lesson-task-markdown">下一项：<NativeVaultMarkdown text={plan.nextTask.content} onOpen={onOpenFile} /></span>
          </div>
        ) : plan.counts.total > 0 ? (
          <div className="nv-lesson-focus" data-focus-kind="completed">
            <StateDot state="done" />
            <span>本课公开任务已全部勾选</span>
          </div>
        ) : null)}
        {plan.staleCurrentTask && (
          <p className="nv-lesson-stale-hint" role="status">原当前项已变动，可重新定位当前环节。</p>
        )}
        {!collapsed && plan.tasks.length > 0 && (
          <ul className="nv-lesson-list" aria-label="本课任务列表">
            {plan.tasks.map(task => (
              <li key={`${task.id ?? 'line'}-${task.line}`} className="nv-lesson-item" data-status={task.status}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={task.checked}
                  aria-label={`${task.checked ? '取消完成' : '标记完成'}：${task.content}`}
                  className={'nv-lesson-check' + (task.checked ? ' is-checked' : '')}
                  disabled={busy || readOnly}
                  onClick={() => runAction(() => onToggleTask(task, !task.checked))}
                >
                  {task.checked ? '✓' : ''}
                </button>
                <span className="nv-lesson-glyph" role="img" aria-label={statusLabel(task.status)}>
                  <StateDot state={statusDotState(task.status)} />
                </span>
                <span className="nv-lesson-content nv-lesson-task-markdown"><NativeVaultMarkdown text={task.content} onOpen={onOpenFile} /></span>
                {!task.checked && (
                  <button
                    type="button"
                    className={'nv-lesson-current-btn' + (task.status === 'in_progress' ? ' is-active' : '')}
                    aria-label={task.status === 'in_progress' ? `取消当前项：${task.content}` : `设为当前项：${task.content}`}
                    title={readOnly ? '已归档课堂只读' : (task.status === 'in_progress' ? '取消进行中标记' : '设为当前进行中环节')}
                    disabled={busy || readOnly}
                    onClick={() => runAction(() => onSetCurrentTask(task, task.status === 'in_progress'))}
                  >
                    {task.status === 'in_progress' ? '当前' : '设为当前'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {(actionError || state.lessonError) && <p role="alert" className="nv-activity-notice">{actionError || state.lessonError}</p>}
      <LessonPickerModal
        open={picking && !readOnly}
        currentPath={plan.path}
        candidates={lesson.candidates}
        busy={busy || readOnly}
        error={actionError}
        onSelect={handleSelectCandidate}
        onUnbind={handleUnbind}
        onClose={() => setPicking(false)}
      />
    </section>
  );
}

export function LessonBindLauncher({ state, onBindLesson }) {
  const lesson = state.lesson;
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!lesson || lesson.bound || !lesson.eligible || !lesson.candidates?.length) return null;

  const handleSelect = async item => {
    setBusy(true);
    setError('');
    try {
      await onBindLesson(item.path, item.revision);
      setPicking(false);
    } catch (err) {
      setError(err?.message || '关联备课本失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="nv-lesson-bind-row">
      <button type="button" className="nv-lesson-bind-launch" onClick={() => { setError(''); setPicking(true); }}>
        <IconChecklistOutlineRegular />
        <span>关联备课本</span>
        <small>选用已有课稿同步清单</small>
      </button>
      <LessonPickerModal
        open={picking}
        currentPath={null}
        candidates={lesson.candidates}
        busy={busy}
        error={error}
        onSelect={handleSelect}
        onClose={() => setPicking(false)}
      />
    </div>
  );
}
