import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { parseMarkdown } from '../plugins/vault-sqlite/frontmatter.js';
import { startNativeRuntime, workspaceRoot } from '../scripts/native-runtime.mjs';
import { reviewPath, tableSource, displayFormula, afterFormula } from './classroom-rendering-model.mjs';
import { appearanceCss } from '../plugins/vault-views/src/appearance-tokens.js';

test('real chat preserves TeX tables and read-only retired blocks, confirms review exactly once and restores receipts', { timeout: 120000 }, async () => {
  const runtime = await startNativeRuntime({ testModel: true, modelFixture: 'tests/classroom-rendering-model.mjs' });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1414, height: 850 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const output = join(workspaceRoot, 'outputs/classroom-rendering-20261026'); await mkdir(output, { recursive: true });
  const path = join(runtime.vault, reviewPath), content = '---\ntype: method\ntitle: 等和线与三点共线\ncustom: 保留字段\n---\n# 等和线与三点共线\n原有理解保持。\n';
  await writeFile(path, content);
  const history = async () => parseMarkdown(await readFile(path, 'utf8')).fields.review_history ?? [];
  try {
    await page.goto(runtime.authUrl); await page.getByRole('button', { name: /^(Continue|继续)$/ }).click();
    await page.locator('[data-composer-input]:visible').waitFor(); await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: '首页学习助手', exact: true }).click();
    await page.getByRole('menuitem', { name: /^专题课堂老师/ }).click();
    const composer = page.locator('[data-composer-input]');
    await composer.fill('检查我的推导。\n\n' + tableSource);
    await page.getByRole('button', { name: /^(Send message|发送消息)$/ }).click();
    const retired = page.locator('.nv-retired-component'), proposal = page.locator('.nv-review-proposal');
    await expect(retired).toBeVisible(); await expect(proposal).toBeVisible();
    await expect(retired.getByRole('textbox')).toHaveCount(0);
    await expect(page.getByText(afterFormula,{exact:true})).toBeVisible();
    await expect(page.locator('.katex-error')).toHaveCount(0);
    await expect(page.locator('annotation').filter({hasText:'x+y&=1'})).toHaveCount(1);
    assert.ok(displayFormula.startsWith('$$'));

    assert.doesNotMatch(await page.locator('body').innerText(), /暂时无法显示|"targetPath"|notara-review/);
    const tables = page.locator('.nv-chat-table table'); await expect(tables).toHaveCount(2);
    for (const table of await tables.all()) {
      await expect(table.locator('tbody tr').first().locator('td')).toHaveCount(3);
      await expect(table.locator('tbody tr').first().locator('td').nth(2)).toHaveText('一张关系图');
      await expect(table.locator('.katex')).toHaveCount(3);
      assert.equal(await table.locator('.katex-error').count(), 0);
    }
    await composer.fill('下一条问题草稿');
    await expect(composer).toContainText('下一条问题草稿');
    const draft = await composer.innerText();
    await proposal.locator('summary').click();
    await expect(proposal.getByRole('textbox', { name: '实况备注', exact: true })).not.toHaveValue(/support|hint/);
    await expect(proposal.getByRole('button', { name: '确认记录', exact: true })).toBeDisabled();
    await page.addStyleTag({ content: (appearanceCss('obsidian') + appearanceCss('claude')).replaceAll('body[', '.nv-review-proposal[') });
    const checkHover = async disabled => {
      const button = proposal.getByRole('button', { name: '确认记录', exact: true });
      for (const theme of ['claude', 'obsidian']) for (const dark of [false, true]) {
        await proposal.evaluate((element, { theme, dark }) => { element.dataset.notaraTheme = theme; element.toggleAttribute('data-ds-dark-theme', dark); }, { theme, dark });
        await page.mouse.move(1, 1);
        const before = await button.evaluate(e => ({ background: getComputedStyle(e).backgroundColor, color: getComputedStyle(e).color }));
        await button.hover();
        const hovered = await button.evaluate(e => ({ background: getComputedStyle(e).backgroundColor, color: getComputedStyle(e).color }));
        assert.equal(hovered.color, before.color, `${theme}/${dark} label stays visible on hover`);
        if (disabled) assert.deepEqual(hovered, before, `${theme}/${dark} disabled hover is stable`);
        else assert.notEqual(hovered.background, await proposal.evaluate(element => { const probe = document.createElement('span'); probe.style.background = 'var(--dsw-alias-interactive-bg-hover)'; element.append(probe); const value = getComputedStyle(probe).backgroundColor; probe.remove(); return value; }), 'primary hover cannot become the generic background');
      }
      await proposal.evaluate(element => { delete element.dataset.notaraTheme; element.removeAttribute('data-ds-dark-theme'); });
    };
    await checkHover(true);
    assert.equal((await history()).length, 0);
    await proposal.getByRole('button', { name: '看过讲解', exact: true }).click();
    await expect(proposal.getByRole('button', { name: '确认记录', exact: true })).toBeEnabled();
    await checkHover(false);
    await proposal.locator('summary').click(); await proposal.locator('summary').click();
    await expect(proposal.getByRole('button', { name: '看过讲解', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.screenshot({ path: join(output, 'pending-wide.png') });
    await page.setViewportSize({ width: 755, height: 746 });
    await page.evaluate(async () => { await Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))); });
    await proposal.scrollIntoViewIfNeeded(); await page.screenshot({ path: join(output, 'pending-narrow.png') });
    const box = await proposal.boundingBox(); assert.ok(box.width <= 755 && box.x >= -1 && box.x + box.width <= 756, JSON.stringify(box));
    // A concurrent file edit must not be silently overwritten.
    await writeFile(path, content + '\n外部补充。\n');
    await proposal.getByRole('button', { name: '确认记录', exact: true }).click();
    await expect(proposal.getByRole('alert')).toContainText('记录已发生变化');
    assert.equal((await history()).length, 0);
    await proposal.getByRole('button', { name: '刷新记录', exact: true }).click();
    await expect(proposal.getByRole('button', { name: '确认记录', exact: true })).toBeEnabled();
    await expect(proposal.getByRole('button', { name: '看过讲解', exact: true })).toHaveAttribute('aria-pressed', 'true');
    // Simulate a lost acknowledgment after the real host committed the write.
    let interrupted = 0, sourceWorkspace;
    await page.route('**/api/notaraVault/recordReview', async route => {
      const response = await route.fetch(), body = await response.json();
      assert.equal(body.result.ok, true); interrupted++; sourceWorkspace = route.request().postDataJSON().payload.args.input.workspaceId;
      await route.fulfill({ response, json: { ...body, result: { ok: false, error: { message: 'fixture_lost_acknowledgment' } } } });
    });
    await proposal.getByRole('button', { name: '确认记录', exact: true }).click();
    // The watcher may restore the durable receipt before the failed HTTP reply
    // is painted; either a retryable error or the saved receipt is correct.
    await expect.poll(async()=>interrupted).toBe(1);
    assert.equal(interrupted, 1); assert.equal((await history()).length, 1);
    await page.unroute('**/api/notaraVault/recordReview');
    // The file notification can recover the committed record before a manual
    // retry. A recovered proposal correctly has no confirmation button.
    await expect(proposal.getByRole('status')).toHaveText('已记录');
    await expect(proposal.getByRole('button', { name: '确认记录', exact: true })).toHaveCount(0);
    if(await proposal.getByRole('button', { name: '刷新记录', exact: true }).isVisible())await proposal.getByRole('button', { name: '刷新记录', exact: true }).click();
    await expect(proposal.getByRole('button', { name: '撤销这次记录', exact: true })).toBeEnabled();
    let records = await history(); assert.equal(records.length, 1); assert.equal(records[0].support, 'explanation'); assert.ok(records[0].source.messageId); assert.equal(records[0].source.index,1);
    const recordedContent = await readFile(path, 'utf8');
    await writeFile(path, content + '\n外部补充。\n');
    const notifyBase = () => page.evaluate(workspaceId => window.dispatchEvent(new CustomEvent('notara:vault-updated', { detail: { workspaceId, path: '资料库.base' } })), sourceWorkspace);
    await notifyBase(); await expect(proposal.getByRole('status')).toHaveText('待确认');
    await expect(proposal.getByRole('button', { name: '确认记录', exact: true })).toBeEnabled();
    await writeFile(path, recordedContent); await notifyBase(); await expect(proposal.getByRole('status')).toHaveText('已记录');
    await page.reload();
    await expect(proposal.getByRole('status')).toHaveText('已记录');
    await expect(page.getByText(afterFormula,{exact:true})).toBeVisible();
    await expect(page.locator('.katex-error')).toHaveCount(0);
    await expect.poll(async () => (await composer.innerText()).replace(/\s+/g, '')).toBe(draft.replace(/\s+/g, ''));
    assert.equal((await history()).length, 1);
    if (!await proposal.evaluate(e => e.open)) await proposal.locator('summary').click();
    await expect(proposal.getByText('这次走通了 · 看过讲解', { exact: true })).toBeVisible();
    await proposal.getByRole('button', { name: '撤销这次记录', exact: true }).click();
    await expect(proposal.getByRole('status')).toHaveText('已撤销');
    await page.reload(); await expect(proposal.getByRole('status')).toHaveText('已撤销');
    records = await history(); assert.equal(records.length, 1); assert.ok(records[0].revertedAt);
    const after = await readFile(path, 'utf8'); assert.match(after, /custom: 保留字段/); assert.match(after, /原有理解保持/); assert.match(after, /外部补充/);
    await composer.fill('NOTE_ONLY：这次先记笔记。'); await composer.press('Enter');
    await expect(page.locator('.nv-review-proposal')).toHaveCount(2);
    const noteProposal = page.locator('.nv-review-proposal').last(); await noteProposal.locator('summary').click();
    await noteProposal.getByRole('button', { name: '这次走通了', exact: true }).click();
    await noteProposal.getByRole('button', { name: '无提示', exact: true }).click();
    await expect(noteProposal.getByRole('button', { name: '确认记录', exact: true })).toBeDisabled();
    await noteProposal.getByRole('textbox', { name: '本次检验的关键步', exact: true }).fill('独立写出关键等式');
    await expect(noteProposal.getByRole('button', { name: '确认记录', exact: true })).toBeEnabled();
    // Exercise successful write + unavailable readback on a fresh proposal,
    // independently of the recovered lost acknowledgment above.
    await page.evaluate(() => { window.__reviewUpdates = 0; window.addEventListener('notara:vault-updated', () => window.__reviewUpdates++); });
    await page.route('**/api/notaraVault/read', async route => {
      const response = await route.fetch(), body = await response.json();
      await route.fulfill({ response, json: { ...body, result: { ok: false, error: { message: 'fixture_read_unavailable' } } } });
    });
    await noteProposal.getByRole('button', { name: '确认记录', exact: true }).click();
    await expect(noteProposal.getByRole('status')).toHaveText('已记录');
    await expect(noteProposal.getByRole('alert')).toContainText('暂时无法读取最新记录');
    assert.ok(await page.evaluate(() => window.__reviewUpdates > 0), 'write notification does not depend on readback');
    await page.unroute('**/api/notaraVault/read');
    await noteProposal.getByRole('button', { name: '刷新记录', exact: true }).click();
    await expect(noteProposal.getByRole('button', { name: '撤销这次记录', exact: true })).toBeEnabled();
    assert.equal((await history()).length, 2);
    assert.deepEqual(errors, []);
  } catch (error) { await page.screenshot({ path: join(output, 'failure.png') }); throw error; }
  finally { await browser.close(); await runtime.stop(); }
});
