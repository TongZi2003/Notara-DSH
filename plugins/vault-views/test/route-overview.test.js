import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const fixtureCode = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { RouteAndLessonBar } from './src/route-overview.jsx';

const bindings = [
  {
    sessionId: 'cls-svd-1',
    path: '备课/第一课.md',
    updatedAt: '2026-10-31T00:00:00.000Z',
    missing: false,
    title: '第一课：奇异值几何直觉',
    revision: 'rev-lesson-1',
    counts: { total: 2, completed: 0, inProgress: 1, pending: 1 },
    progressLabel: '进行中 1 · 待处理 1',
    currentTask: { id: 'lt-1', line: 5, content: '观察 **单位圆** 与 [[卡片/椭圆.md|椭圆]] $x>0$', expectedText: '观察 **单位圆** 与 [[卡片/椭圆.md|椭圆]] $x>0$' },
    nextTask: null,
  },
];

const remote = {
  async lessonBindings() { return { ok: true, value: { bindings } }; },
  changes() {
    return {
      async *[Symbol.asyncIterator]() {
        await new Promise(() => {});
      },
    };
  },
};

const opened = [];
const brought = [];
const markdown = [];
window.__events = { opened, brought, markdown };

const lessonContent = [
  '---',
  'type: lesson',
  '---',
  '# 第一课：奇异值几何直觉',
  '- [ ] 观察单位圆映射为椭圆',
  '',
].join('\\n');

const routeContent = [
  '---',
  'type: route',
  '---',
  '# 线性代数进阶路线',
  '',
  '## 阶段里程碑',
  '- [ ] 掌握奇异值几何意义（关联 [[备课/第一课.md]]）',
  '  - 达标标准：能无提示画出单位圆映射后的长短半轴',
  '  - 待补：正交矩阵旋转方向解释不完整',
  '- [ ] 迁移到新的矩阵',
  '  - 阶段依据：对比两个矩阵的相同结构',
  '',
  '## 下一步行动',
  '- 进入 [[备课/第一课.md]] 补齐正交方向验证',
  '',
].join('\\n');

createRoot(document.getElementById('root')).render(
  <div>
    <div id="lesson-host">
      <RouteAndLessonBar
        record={{ path: '备课/第一课.md', revision: 'rev-lesson-1' }}
        content={lessonContent}
        workspaceId="ws-a"
        remote={remote}
        onOpen={payload => opened.push(payload)}
        onBring={(pins, prompt) => brought.push({ pins, prompt })}
        renderMarkdown={(text, onOpen) => { markdown.push(text); return <span><strong>单位圆</strong><button onClick={()=>onOpen({path:'卡片/椭圆.md',label:'椭圆'})}>椭圆</button></span>; }}
      />
    </div>
    <div id="route-host">
      <RouteAndLessonBar
        record={{ path: '路线/线性代数路线.md', revision: 'rev-route-1' }}
        content={routeContent}
        workspaceId="ws-a"
        remote={remote}
        onOpen={payload => opened.push(payload)}
        onBring={(pins, prompt) => brought.push({ pins, prompt })}
      />
    </div>
  </div>
);
`;

test('RouteAndLessonBar renders currentTask.content on bound lessons and milestone verification/remediation on routes', { timeout: 30000 }, async () => {
  const bundled = await build({
    stdin: {
      contents: fixtureCode,
      resolveDir: fileURLToPath(new URL('../', import.meta.url)),
      loader: 'jsx',
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    conditions: ['production'],
    target: 'es2022',
    define: { 'process.env.NODE_ENV': '"development"' },
    logLevel: 'silent',
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.route('https://route-bar.test/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/fixture.js') {
        return route.fulfill({ contentType: 'text/javascript', body: bundled.outputFiles[0].text });
      }
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><div id="root"></div><script src="/fixture.js"></script>' });
    });
    const page = await context.newPage();
    await page.goto('https://route-bar.test/');

    const lessonBar = page.locator('#lesson-host').getByRole('region', { name: '关联课堂' });
    await expect(lessonBar).toBeVisible();
    await expect(lessonBar).toContainText('进行中 1 · 待处理 1');
    await expect(lessonBar.locator('strong').filter({hasText:'单位圆'})).toBeVisible();
    await lessonBar.getByRole('button', { name: '椭圆', exact: true }).click();
    await lessonBar.getByRole('button', { name: '打开关联课堂', exact: true }).click();

    const routeBar = page.locator('#route-host').getByRole('region', { name: '路线里程碑概览' });
    await expect(routeBar).toBeVisible();
    await expect(routeBar.locator('.nv-route-next-description')).not.toBeVisible();
    await routeBar.getByRole('button',{name:'继续课堂',exact:true}).click();
    await routeBar.locator('summary').click();
    await expect(routeBar).toContainText('待补内容：正交矩阵旋转方向解释不完整');
    await routeBar.getByRole('button', { name: '带入当前对话', exact: true }).click();

    const events = await page.evaluate(() => window.__events);
    assert.deepEqual(events.opened, [{path:'卡片/椭圆.md',label:'椭圆'}, { sessionId: 'cls-svd-1', workspaceId: 'ws-a' }, { sessionId: 'cls-svd-1', workspaceId: 'ws-a' }]);
    assert.ok(events.markdown.includes('观察 **单位圆** 与 [[卡片/椭圆.md|椭圆]] $x>0$'));
    assert.equal(events.brought.length, 1);
    assert.equal(events.brought[0].pins[0].path, '路线/线性代数路线.md');
    assert.equal(events.brought[0].pins[0].revision, 'rev-route-1');
    assert.equal(events.brought[0].prompt, '进入 [[备课/第一课.md]] 补齐正交方向验证');
    await expect(routeBar.locator('.nv-route-milestone-list')).toHaveCount(1);
    await routeBar.getByRole('button',{name:'讨论这个阶段',exact:true}).nth(1).click();
    const stage=await page.evaluate(()=>window.__events.brought.at(-1));
    assert.match(stage.prompt,/迁移到新的矩阵/);assert.match(stage.prompt,/对比两个矩阵/);
    assert.equal(stage.pins[0].revision,'rev-route-1');
  } finally {
    await browser.close();
  }
});
