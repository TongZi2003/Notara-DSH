import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const req = createRequire(import.meta.url);

async function loadLessonProgress() {
  const primitivesStub = `
    const React = require('react');
    exports.IconChecklistOutlineRegular = () => React.createElement('span', { 'data-icon': 'checklist' });
    exports.IconChevronDownOutlineRegular = () => React.createElement('span', { 'data-icon': 'chevron-down' });
    exports.IconChevronUpOutlineRegular = () => React.createElement('span', { 'data-icon': 'chevron-up' });
    exports.StateDot = ({ state }) => React.createElement('span', { 'data-state-dot': state });
    exports.Modal = ({ open, title, children }) => open ? React.createElement('div', { role: 'dialog', 'aria-label': title }, children) : null;
    exports.MarkdownDelegateProvider = ({ children }) => children;
    exports.MarkdownText = ({ text }) => React.createElement(React.Fragment, null, text);
  `;
  const bundled = await build({
    entryPoints: [fileURLToPath(new URL('../src/lesson-progress.jsx', import.meta.url))],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    external: ['react', 'react/*', 'react-dom', 'react-dom/*'],
    plugins: [{
      name: 'primitives-stub',
      setup(builder) {
        builder.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ }, () => ({ path: 'primitives', namespace: 'stub' }));
        builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: primitivesStub, loader: 'js' }));
      },
    }],
  });
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(req, mod, mod.exports);
  return mod.exports;
}

test('LessonProgressSection defaults to collapsed with downward chevron, shows current task focus, and handles missing bound file', async () => {
  const { LessonProgressSection, LessonBindLauncher } = await loadLessonProgress();

  const unboundHtml = renderToStaticMarkup(React.createElement(LessonProgressSection, {
    state: { workspaceId: 'ws-a', lesson: { bound: false, eligible: true, candidates: [{ path: '备课/第一课.md', title: '第一课', revision: 'r1' }] } },
  }));
  assert.equal(unboundHtml, '');

  const launcherHtml = renderToStaticMarkup(React.createElement(LessonBindLauncher, {
    state: { workspaceId: 'ws-a', lesson: { bound: false, eligible: true, candidates: [{ path: '备课/第一课.md', title: '第一课', revision: 'r1' }] } },
    onBindLesson: async () => {},
  }));
  assert.match(launcherHtml, /关联备课本/);

  const ineligibleLauncherHtml = renderToStaticMarkup(React.createElement(LessonBindLauncher, {
    state: { workspaceId: 'ws-a', lesson: { bound: false, eligible: false, candidates: [{ path: '备课/第一课.md', title: '第一课', revision: 'r1' }] } },
    onBindLesson: async () => {},
  }));
  assert.equal(ineligibleLauncherHtml, '');

  const boundHtml = renderToStaticMarkup(React.createElement(LessonProgressSection, {
    state: {
      workspaceId: 'ws-a',
      lesson: {
        bound: true,
        missing: false,
        path: '备课/第一课.md',
        candidates: [],
        plan: {
          path: '备课/第一课.md',
          title: '第一课：奇异值几何直觉',
          revision: 'r1',
          counts: { total: 2, completed: 0, inProgress: 1, pending: 1 },
          progressLabel: '进行中 1 · 待处理 1',
          currentTask: { id: 'lt-1', line: 5, content: '观察单位圆映射为椭圆', expectedText: '观察单位圆映射为椭圆' },
          nextTask: null,
          staleCurrentTask: false,
          tasks: [
            { id: 'lt-1', line: 5, status: 'in_progress', checked: false, content: '观察单位圆映射为椭圆', expectedText: '观察单位圆映射为椭圆' },
            { id: 'lt-2', line: 6, status: 'pending', checked: false, content: '验证正交方向保持正交', expectedText: '验证正交方向保持正交' },
          ],
        },
      },
    },
    onOpenFile: () => {},
    onBindLesson: async () => {},
    onToggleTask: async () => {},
    onSetCurrentTask: async () => {},
  }));
  assert.match(boundHtml, /aria-expanded="false"/, 'checklist header starts collapsed by default');
  assert.match(boundHtml, /data-icon="chevron-down"/, 'collapsed header points chevron downward');
  assert.doesNotMatch(boundHtml, /本课任务列表/, 'task list items are hidden while collapsed');
  assert.match(boundHtml, /正在进行：观察单位圆映射为椭圆/, 'collapsed card still displays current active task');

  const missingHtml = renderToStaticMarkup(React.createElement(LessonProgressSection, {
    state: {
      workspaceId: 'ws-a',
      lesson: { bound: true, missing: true, path: '备课/已删除.md', plan: null, candidates: [] },
    },
    onOpenFile: () => {},
    onBindLesson: async () => {},
    onToggleTask: async () => {},
    onSetCurrentTask: async () => {},
  }));
  assert.match(missingHtml, /原关联备课本「备课\/已删除\.md」已改名、删除或不再是备课本/);

  // Archived classroom (bound: true, eligible: false) disables mutation buttons while keeping 打开课稿 available.
  const archivedHtml = renderToStaticMarkup(React.createElement(LessonProgressSection, {
    defaultExpanded: true,
    state: {
      workspaceId: 'ws-a',
      lesson: {
        bound: true,
        eligible: false,
        missing: false,
        path: '备课/第一课.md',
        candidates: [],
        plan: {
          path: '备课/第一课.md',
          title: '第一课：奇异值几何直觉',
          revision: 'r1',
          counts: { total: 1, completed: 0, inProgress: 0, pending: 1 },
          progressLabel: '待处理 1',
          currentTask: null,
          nextTask: { id: 'lt-1', line: 5, content: '观察单位圆映射为椭圆', expectedText: '观察单位圆映射为椭圆' },
          staleCurrentTask: false,
          tasks: [{ id: 'lt-1', line: 5, status: 'pending', checked: false, content: '观察单位圆映射为椭圆', expectedText: '观察单位圆映射为椭圆' }],
        },
      },
    },
    onOpenFile: () => {},
    onBindLesson: async () => {},
    onToggleTask: async () => {},
    onSetCurrentTask: async () => {},
  }));
  assert.match(archivedHtml, /aria-label="更换备课本"[^>]*disabled=""/);
  assert.match(archivedHtml, /role="checkbox"[^>]*disabled=""/);
  assert.match(archivedHtml, /aria-label="设为当前项：观察单位圆映射为椭圆"[^>]*disabled=""/);
  assert.doesNotMatch(archivedHtml, /nv-lesson-doc-button"[^>]*disabled=""/, '打开课稿 stays enabled in archived classroom');
});
