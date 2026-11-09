import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { startNativeRuntime, workspaceRoot } from '../scripts/native-runtime.mjs';
import { openLibrary, openDocumentSource, blurDocumentEditor } from '../scripts/ui-navigation.mjs';

test('nested document previews keep metadata separate and toolbar undo uses the active editor history', { timeout: 90_000 }, async () => {
  const fixture = await mkdtemp(join(workspaceRoot, 'work/preview-actions-'));
  const output = join(workspaceRoot, 'work/editor-validation'); await mkdir(output, { recursive: true });
  const main = '---\ntype: card\ntitle: 预览回归\ntags: [测试]\n---\n# 预览回归\n\n可编辑正文。\n\n<details>\n<summary>查看原页</summary>\n\n- 本地来源摘录：![[来源.md]]\n\n</details>\n';
  const source = [
    '---', 'type: source', 'title: 原始资料', 'tags: [来源, 线性代数]', '---',
    '# 原始资料', '', '这是一段来源摘要，包含公式 $x^2$。', '',
    '## 来源说明', '', '### 推导步骤', '',
    '1. 保留清楚的序号和正文间距。', '   - 窄栏中的嵌套列表也应有可读的宽度。',
    '2. 原始链接：https://example.test/' + 'long-source-path-'.repeat(8), '',
    '> 引文和普通正文需要有明确但紧凑的间隔。', '',
    '$$', 'A = B + C + D + E + F + G + H + I + J + K + L + M + N + O + P', '$$', '',
    '```text', 'type: literal', '  keep indentation', 'long_code_token_'.repeat(10), '```', '',
    '| 来源 | 作者 | 版本 | 页码 | 主题 | 备注 |', '| --- | --- | --- | --- | --- | --- |',
    '| 讲义 | 作者甲 | 初版 | 123 | 矩阵 | 原始推导 |', '',
    '![[循环.md]]', '', '## 参考理解', 'HIDDEN_REFERENCE_MUST_STAY_FOLDED', '',
  ].join('\n');
  const cycle = '---\ntitle: 循环引用\ntags: [嵌入]\n---\n# 循环引用\n\n![[来源.md]]\n';
  await writeFile(join(fixture, '预览回归.md'), main); await writeFile(join(fixture, '来源.md'), source); await writeFile(join(fixture, '循环.md'), cycle);
  const runtime = await startNativeRuntime({ fixture, testModel: true }), browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 761, height: 746 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const doc = page.locator('.nv-vault-doc-tab:visible');
  try {
    await page.goto(runtime.authUrl); await page.getByRole('button', { name: /^(Continue|继续)$/ }).click();
    await page.locator('[data-composer-input]:visible').waitFor(); await page.waitForLoadState('networkidle'); await openLibrary(page);
    await page.locator('.nv-vault-workspace:visible').getByRole('button', { name: '预览回归', exact: true }).click();
    await page.getByRole('button', { name: '全屏', exact: true }).click();
    await page.getByRole('button', { name: '最小化会话', exact: true }).click();
    const rich = doc.getByRole('textbox', { name: 'Markdown 实时预览编辑器' }); await rich.waitFor();
    await expect(doc.locator('.nv-document-toolbar')).toHaveCount(1);
    await expect(doc.locator('.nv-vault-doc-header')).toHaveCount(0);
    await expect(doc.getByRole('button',{name:'查看源码',exact:true})).toBeVisible();
    const bar=doc.locator('.nv-document-toolbar');
    assert.equal(await bar.evaluate(el=>getComputedStyle(el).fontSize),'13px');
    assert.ok((await bar.boundingBox()).height<55);
    await doc.locator('.nv-live-preview-block summary').filter({ hasText: '查看原页' }).click();
    const embed = doc.locator('.nv-file-content-preview').first(), body = embed.locator(':scope > .nv-file-preview-body');
    await expect(embed.locator(':scope > .nv-document-properties [data-property="type"]')).toContainText('来源');
    const tags=embed.locator(':scope > .nv-document-properties [aria-label="文档标签"] .nv-vault-tag');
    await expect(tags).toHaveText(['来源','线性代数']);for(const tag of await tags.all())await expect(tag).toBeVisible();
    await expect(body.getByRole('heading', { name: /^type:/ })).toHaveCount(0);
    await expect(body.locator('hr')).toHaveCount(0);
    await expect(body.getByRole('heading', { name: '原始资料', exact: true })).toHaveCount(1);
    await expect(body.getByText('HIDDEN_REFERENCE_MUST_STAY_FOLDED', { exact: true })).toBeHidden();
    await expect(doc.locator('.nv-file-content-preview')).toHaveCount(2, { timeout: 10000 });
    const style = await body.getByRole('heading', { name: '原始资料', exact: true }).evaluate(element => ({ font: parseFloat(getComputedStyle(element).fontSize), margin: parseFloat(getComputedStyle(element).marginTop), whitespace: getComputedStyle(element).whiteSpace }));
    assert.ok(style.font <= 18 && style.margin <= 16, JSON.stringify(style)); assert.equal(style.whitespace, 'normal');
    assert.ok(await body.locator('pre').first().evaluate(element => getComputedStyle(element).whiteSpace.includes('pre')));
    await expect(body.locator('pre').first()).toContainText('type: literal\n  keep indentation');
    await expect(body.locator('.katex')).toHaveCount(2);
    const typography = await body.evaluate(element => {
      const style = selector => { const s = getComputedStyle(element.querySelector(selector)); return { size: parseFloat(s.fontSize), weight: s.fontWeight, indent: parseFloat(s.paddingLeft) }; };
      return { h1: style('h1'), h2: style('h2'), h3: style('h3'), list: style('ol') };
    });
    assert.ok(typography.h1.size > typography.h2.size && typography.h2.size > typography.h3.size, JSON.stringify(typography));
    assert.equal(typography.h1.weight, '600'); assert.ok(typography.list.indent >= 18 && typography.list.indent <= 24);
    const headingGap = await body.evaluate(element => element.querySelector('h3').getBoundingClientRect().top - element.querySelector('h2').getBoundingClientRect().bottom);
    assert.ok(headingGap >= 12 && headingGap <= 32, `Adjacent source headings have ${headingGap}px between them`);
    await embed.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(output, 'embedded-source-fixed.png'), fullPage: true });
    const actions = doc.getByRole('group', { name: '文档操作' }), save = actions.getByRole('button', { name: '保存', exact: true }), undo = actions.getByRole('button', { name: '撤销', exact: true });
    await expect(save).toBeDisabled(); await expect(undo).toBeDisabled();
    await rich.getByText('可编辑正文。', { exact: true }).click(); await rich.press('End'); await rich.pressSequentially('待撤销');
    await expect(save).toBeEnabled(); await expect(undo).toBeEnabled();
    await expect(doc.getByText('未保存', { exact: true })).toHaveCount(0);
    const barBox = await doc.locator('.nv-markdown-editbar').boundingBox(), actionBox = await actions.boundingBox();
    assert.ok(actionBox.x > barBox.x + barBox.width / 2);
    await undo.click(); await expect(rich).not.toContainText('待撤销'); await expect(save).toBeDisabled();
    assert.equal(await readFile(join(runtime.vault, '预览回归.md'), 'utf8'), main);
    await rich.getByText('可编辑正文。', { exact: true }).click(); await rich.press('End'); await rich.pressSequentially('正文完成');
    await save.click(); await expect(save).toBeDisabled();
    const saved = await readFile(join(runtime.vault, '预览回归.md'), 'utf8'); assert.ok(saved.includes('正文完成'));
    await openDocumentSource(page,doc);
    const code = doc.getByRole('textbox', { name: 'Markdown 正文编辑器' }); await code.fill(saved + '\n源码改动');
    await expect(undo).toBeEnabled(); await undo.click(); await expect(code).not.toContainText('源码改动'); await expect(save).toBeDisabled();
    await doc.getByRole('button', { name: '返回正文', exact: true }).click();
    await rich.getByText('可编辑正文。正文完成', { exact: true }).click(); await rich.press('End'); await rich.pressSequentially('模式切换后撤销');
    await expect(undo).toBeEnabled(); await undo.click(); await expect(rich).not.toContainText('模式切换后撤销'); await expect(save).toBeDisabled();
    assert.equal(await readFile(join(runtime.vault, '来源.md'), 'utf8'), source);
    await page.setViewportSize({ width: 460, height: 746 });
    await doc.locator('.nv-live-preview-block summary').filter({ hasText: '查看原页' }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const narrow = await embed.evaluate(element => {
      const frame = element.parentElement, body = element.querySelector('.nv-file-preview-body'), style = getComputedStyle(element);
      const scroll = selector => { const e = body.querySelector(selector); return { client: e.clientWidth, scroll: e.scrollWidth, overflow: getComputedStyle(e).overflowX }; };
      return { frame: frame.clientWidth, frameScroll: frame.scrollWidth, body: body.clientWidth, inset: parseFloat(style.paddingLeft), formula: scroll('.katex-display'), code: scroll('pre'), table: scroll('table') };
    });
    assert.ok(narrow.frameScroll <= narrow.frame + 1, JSON.stringify(narrow));
    assert.ok(narrow.inset >= 12 && narrow.inset <= 24 && narrow.body >= narrow.frame * .8, JSON.stringify(narrow));
    for (const region of [narrow.formula, narrow.code, narrow.table]) {
      assert.equal(region.overflow, 'auto', JSON.stringify(narrow)); assert.ok(region.scroll > region.client, JSON.stringify(narrow));
    }
    await embed.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(output, 'embedded-source-narrow.png'), fullPage: true });
    assert.deepEqual(errors, []);
  } catch (error) { await page.screenshot({ path: join(output, 'preview-actions-failure.png'), fullPage: true }); console.error(JSON.stringify({ errors })); throw error; }
  finally { await browser.close(); await runtime.stop(); await rm(fixture, { recursive: true, force: true }); }
});
