import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVaultStore } from '../../vault-sqlite/vault-indexer.js';
import { extractLessonSummary, hasSummaryReference } from '../../vault-sqlite/summary-document.js';
import { ensureDeliveryDiary } from '../diary-delivery.js';

const date = '2026-10-31', path = `日记/${date}.md`;
const request = (overrides = {}) => ({ workspaceId: 'workspace-a', deliveryId: 'delivery-a', version: 1, date,
  kind: 'lesson', source: { path: '报告/本节.md', heading: '本节总结与下次续接' }, ...overrides });
const report = '# 本节\n\n## 本节总结与下次续接\n\n经提示完成判号，独立检验尚未观察。\n';
function fixture(t, files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'notara-delivery-diary-'));
  const store = createVaultStore({ root, cachePath: ':memory:' });
  for (const [path, content] of Object.entries({ '报告/本节.md': report, ...files })) store.save({ path, content, expectedRevision: null });
  const reads = [], saves = [];
  const vault = {
    async read(input) { reads.push(input); return store.read(input); },
    async save(input) { saves.push(input); return store.save(input); },
  };
  t.after(async () => { await store.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, store, vault, reads, saves };
}
const markerLines = content => content.split(/\r?\n/).filter(line => /^<!-- \/?notara-delivery:/.test(line));
const replace = (store, transform) => {
  const current = store.read({ path });
  store.save({ path, content: transform(current.content), expectedRevision: current.revision });
};

test('creates a visible, linked delivery entry and returns only a read-back receipt', async t => {
  const { store, vault, reads, saves } = fixture(t);
  const sourceBefore = store.read({ path: request().source.path });
  const result = await ensureDeliveryDiary(vault, request({ summary: '提示后完成判号，待独立检验。' }));
  const diary = store.read({ path });
  assert.equal(result.path, path);
  assert.equal(result.heading, '课后总结 · 本节总结与下次续接');
  assert.doesNotMatch(diary.content.replace(/<!--[\s\S]*?-->/g, ''), /delivery-a|[a-f0-9]{64}/);
  assert.equal(result.revision, diary.revision);
  assert.ok(hasSummaryReference({ ...diary, path }, request().source));
  assert.ok(hasSummaryReference({ path: '索引.md', content: result.locator }, { path, heading: result.heading }));
  assert.match(diary.content, /## 工作交付\n/);
  assert.match(diary.content, /课后总结/);
  assert.match(diary.content, /提示后完成判号，待独立检验/);
  assert.equal(markerLines(diary.content).length, 2);
  assert.equal(saves.length, 1);
  assert.equal(saves[0].expectedRevision, null);
  assert.ok(reads.filter(input => input.path === path).length >= 2);
  assert.ok([...reads, ...saves].every(input => input.workspaceId === 'workspace-a'));
  assert.deepEqual(store.read({ path: request().source.path }), sourceBefore);
});

test('preserves diary text and inserts into the existing delivery area before the next section', async t => {
  const before = '---\ntype: diary\n---\n# 今天\n\n手写正文。\n\n## 工作交付\n\n人工记录原样保留。\n\n';
  const after = '## 晚间\n\n今天的原话。\n';
  const { store, vault } = fixture(t, { [path]: before + after });
  await ensureDeliveryDiary(vault, request());
  const content = store.read({ path }).content;
  assert.ok(content.startsWith(before));
  assert.ok(content.endsWith(after));
  assert.equal(content.split('## 工作交付').length, 2);
  assert.match(content, /课后总结/);
  assert.doesNotMatch(content, /结果：/);
});

test('same-day report and diary coexist and revisions update only the managed entry in place', async t => {
  const source = { path, heading: '本节总结与下次续接' };
  const original = '# 今天\n\n## 本节总结与下次续接\n\n学生原话，不修改。\n';
  const { store, vault } = fixture(t, { [path]: original });
  const first = await ensureDeliveryDiary(vault, request({ source, summary: '第一稿。' }));
  replace(store, text => text + '\n## 手写补充\n\n新的学生原话。\n');
  const second = await ensureDeliveryDiary(vault, request({ source, version: 2, summary: '补充独立检查尚未完成。' }));
  const content = store.read({ path }).content;
  assert.equal(first.heading, second.heading);
  assert.equal(first.locator, second.locator);
  assert.ok(content.startsWith(original));
  assert.ok(content.endsWith('## 手写补充\n\n新的学生原话。\n'));
  assert.equal(markerLines(content).length, 2);
  assert.doesNotMatch(content, /第一稿/);
  assert.match(content, /补充独立检查尚未完成/);
  assert.ok(content.indexOf(`### ${second.heading}`) < content.indexOf('## 手写补充'));
});

test('durable replay across helper instances and later days does not save again', async t => {
  const { store, vault, saves } = fixture(t);
  const first = await ensureDeliveryDiary(vault, request());
  const otherVault = { read: input => vault.read(input), save: input => vault.save(input) };
  const replay = await ensureDeliveryDiary(otherVault, request());
  assert.deepEqual(replay, first);
  assert.equal(saves.length, 1);
  assert.throws(() => store.read({ path: '日记/2026-11-01.md' }), { code: 'ENOENT' });
});

test('same-version content disagreement and stale revisions fail without rewriting', async t => {
  const { store, vault, saves } = fixture(t);
  await ensureDeliveryDiary(vault, request({ version: 2, summary: '真实结果。' }));
  const before = store.read({ path });
  await assert.rejects(ensureDeliveryDiary(vault, request({ version: 2, summary: '另一个结果。' })), /diary_version_conflict/);
  await assert.rejects(ensureDeliveryDiary(vault, request({ version: 1, summary: '真实结果。' })), /diary_version_conflict/);
  assert.equal(saves.length, 1);
  assert.deepEqual(store.read({ path }), before);
});

test('a higher version with identical visible content still persists its version once', async t => {
  const { vault, saves } = fixture(t);
  const first = await ensureDeliveryDiary(vault, request());
  const second = await ensureDeliveryDiary(vault, request({ version: 2 }));
  assert.notEqual(first.revision, second.revision);
  await ensureDeliveryDiary(vault, request({ version: 2 }));
  assert.equal(saves.length, 2);
});

test('interleaved sessions retain both entries using CAS rereads', async t => {
  const { store, vault, saves } = fixture(t);
  let release, arrivals = 0;
  const barrier = new Promise(resolve => { release = resolve; });
  const concurrentVault = () => ({ ...vault, async read(input) {
    let result, error;
    try { result = await vault.read(input); } catch (caught) { error = caught; }
    if (input.path === path && arrivals < 2) { if (++arrivals === 2) release(); await barrier; }
    if (error) throw error;
    return result;
  } });
  const receipts = await Promise.all([
    ensureDeliveryDiary(concurrentVault(), request()),
    ensureDeliveryDiary(concurrentVault(), request({ deliveryId: 'delivery-b', kind: 'materials' })),
  ]);
  const content = store.read({ path }).content;
  for (const receipt of receipts) assert.ok(content.includes(`### ${receipt.heading}`));
  assert.equal(markerLines(content).length, 4);
  assert.match(content, /资料整理/);
  assert.ok(saves.length >= 3, 'one stale create must lose CAS and reread');
});

test('save success followed by a lost response replays without duplicating', async t => {
  const { store, vault, saves } = fixture(t);
  let lose = true;
  const unreliable = { ...vault, async save(input) {
    const result = await vault.save(input);
    if (lose) { lose = false; throw new Error('response_lost'); }
    return result;
  } };
  await assert.rejects(ensureDeliveryDiary(unreliable, request()), /response_lost/);
  const first = store.read({ path });
  const replay = await ensureDeliveryDiary(unreliable, request());
  assert.equal(replay.revision, first.revision);
  assert.equal(saves.length, 1);
  assert.equal(markerLines(first.content).length, 2);
});

test('read-back failure does not acknowledge and replay reconciles the saved entry', async t => {
  const { vault, saves } = fixture(t);
  let written = false, lose = true;
  const unreliable = { async save(input) { const result = await vault.save(input); written = true; return result; },
    async read(input) { if (written && input.path === path && lose) { lose = false; throw new Error('readback_failed'); } return vault.read(input); } };
  await assert.rejects(ensureDeliveryDiary(unreliable, request()), /readback_failed/);
  await ensureDeliveryDiary(unreliable, request());
  assert.equal(saves.length, 1);
});

test('read-back verifies persisted content rather than trusting the save result', async t => {
  const { vault } = fixture(t, { [path]: '# 今天\n' });
  const lying = { ...vault, async save() { return { revision: 'claimed-success' }; } };
  await assert.rejects(ensureDeliveryDiary(lying, request()), /diary_verification_failed/);
});

for (const failure of ['EACCES', 'EIO']) {
  test(`${failure} on diary read is not interpreted as a missing file`, async t => {
    const { vault, saves } = fixture(t);
    const broken = { ...vault, async read(input) {
      if (input.path === path) throw Object.assign(new Error(failure), { code: failure });
      return vault.read(input);
    } };
    await assert.rejects(ensureDeliveryDiary(broken, request()), { code: failure });
    assert.equal(saves.length, 0);
  });
}

test('ordinary save errors propagate and CAS/lock contention has a finite retry bound', async t => {
  const { vault } = fixture(t);
  let attempts = 0;
  await assert.rejects(ensureDeliveryDiary({ ...vault, async save() { attempts++; throw Object.assign(new Error('disk_full'), { code: 'ENOSPC' }); } }, request()), { code: 'ENOSPC' });
  assert.equal(attempts, 1);
  for (const reason of ['vault_revision_conflict', 'vault_locked']) {
    attempts = 0;
    await assert.rejects(ensureDeliveryDiary({ ...vault, async save() { attempts++; throw new Error(reason); } }, request()), /diary_cas_exhausted/);
    assert.equal(attempts, 5);
  }
});

test('CRLF and special source characters round trip through a real report link', async t => {
  const source = { path: "报告/中文 [甲] #50% (a) '! .md", heading: '结果 [甲] | #50% (a)' };
  const original = '# 今天\r\n\r\n保留原话。\r\n';
  const { store, vault } = fixture(t, { [path]: original, [source.path]: `# 结果\n\n## ${source.heading}\n\n实际结果。\n` });
  await ensureDeliveryDiary(vault, request({ source, summary: '行一\n### 伪标题 <details>\n<!-- 伪标记 -->' }));
  let diary = store.read({ path });
  assert.ok(diary.content.startsWith(original));
  assert.doesNotMatch(diary.content, /(?<!\r)\n/);
  assert.ok(hasSummaryReference(diary, source));
  assert.match(diary.content, /%23/);
  assert.match(diary.content, /%25/);
  assert.match(diary.content, /%5B/);
  assert.ok(!diary.content.includes('<details>'));
  await ensureDeliveryDiary(vault, request({ source, version: 2, summary: '新的实际结果。' }));
  diary = store.read({ path });
  assert.doesNotMatch(diary.content, /(?<!\r)\n/);
  assert.ok(diary.content.startsWith(original));
});

for (const wrap of [text => `\`\`\`markdown\n${text}\`\`\`\n`, text => `~~~\n${text}~~~\n`,
  text => text.split('\n').map(line => `    ${line}`).join('\n') + '\n',
  text => text.split('\n').map(line => `> ${line}`).join('\n') + '\n',
  text => `<details><summary>教师参考</summary>\n\n${text}\n</details>\n`,
  text => `<pre>\n${text}</pre>\n`]) {
  test(`pseudo markers in ${wrap.name || wrap('示例').split('\n')[0]} are preserved and ignored`, async t => {
    const { store, vault, saves } = fixture(t);
    const first = await ensureDeliveryDiary(vault, request());
    const managed = store.read({ path }).content;
    replace(store, () => '# 今天\n\n' + wrap(managed) + '\n## 后记\n\n保留。\n');
    const before = store.read({ path }).content;
    const second = await ensureDeliveryDiary(vault, request());
    const after = store.read({ path }).content;
    assert.ok(after.startsWith(before));
    assert.equal(first.heading, second.heading);
    assert.equal(saves.length, 2);
    await ensureDeliveryDiary(vault, request());
    assert.equal(saves.length, 2);
  });
}

test('a duplicate real marker fails closed without touching the diary', async t => {
  const { store, vault, saves } = fixture(t);
  await ensureDeliveryDiary(vault, request());
  replace(store, text => text + '\n' + text.slice(text.indexOf('<!-- notara-delivery:')));
  const before = store.read({ path });
  await assert.rejects(ensureDeliveryDiary(vault, request({ version: 2 })), /diary_marker_duplicate/);
  assert.deepEqual(store.read({ path }), before);
  assert.equal(saves.length, 1);
});

test('unrelated duplicate real markers still block a new write', async t => {
  const { store, vault, saves } = fixture(t);
  await ensureDeliveryDiary(vault, request());
  replace(store, text => text + '\n' + text.slice(text.indexOf('<!-- notara-delivery:')));
  const before = store.read({ path });
  await assert.rejects(ensureDeliveryDiary(vault, request({ deliveryId: 'another-delivery' })), /diary_marker_duplicate/);
  assert.deepEqual(store.read({ path }), before);
  assert.equal(saves.length, 1);
});

test('unrelated old entry edits do not block a new delivery or overwrite that old entry', async t => {
  for (const damage of [text => text.replace('类型：课后总结', '用户手写的未知内容'),
    text => text.replace(/:v1:/, ':vbroken:'),
    text => text.replace(/<!-- \/notara-delivery:[^\n]+\n?/, '')]) {
    const { store, vault, saves } = fixture(t);
    await ensureDeliveryDiary(vault, request());
    replace(store, damage);
    const before = store.read({ path });
    const added = await ensureDeliveryDiary(vault, request({ deliveryId: 'another-delivery' }));
    assert.ok(store.read({ path }).content.startsWith(before.content));
    assert.equal((await ensureDeliveryDiary(vault, request({ deliveryId: 'another-delivery' }))).heading, added.heading);
    const revised = await ensureDeliveryDiary(vault, request({ deliveryId: 'another-delivery', version: 2, summary: '只修订本交付。' }));
    assert.equal(revised.heading, added.heading);
    assert.ok(store.read({ path }).content.startsWith(before.content));
    await assert.rejects(ensureDeliveryDiary(vault, request()), /diary_entry_damaged/);
    assert.equal(saves.length, 3);
  }
});

test('a second visible copy of the managed heading cannot produce an ambiguous locator', async t => {
  const { store, vault, saves } = fixture(t);
  const first = await ensureDeliveryDiary(vault, request());
  replace(store, text => text + `\n### ${first.heading}\n\n手写正文保留。\n`);
  const before = store.read({ path });
  await assert.rejects(ensureDeliveryDiary(vault, request()), /diary_entry_damaged/);
  assert.deepEqual(store.read({ path }), before);
  assert.equal(saves.length, 1);
});

test('an invalid nested HTML comment leaves an orphan real marker and fails closed', async t => {
  const { store, vault, saves } = fixture(t);
  await ensureDeliveryDiary(vault, request());
  replace(store, text => `<!--\n${text}\n-->\n`);
  const before = store.read({ path });
  await assert.rejects(ensureDeliveryDiary(vault, request()), /diary_entry_damaged/);
  assert.deepEqual(store.read({ path }), before);
  assert.equal(saves.length, 1);
});

test('indented but real duplicate marker comments must not evade duplicate detection', async t => {
  const { store, vault, saves } = fixture(t);
  await ensureDeliveryDiary(vault, request());
  replace(store, text => text + '\n' + text.slice(text.indexOf('<!-- notara-delivery:')).replace(/^<!--/gm, '  <!--'));
  const before = store.read({ path });
  await assert.rejects(ensureDeliveryDiary(vault, request()), /diary_marker_duplicate/);
  assert.deepEqual(store.read({ path }), before);
  assert.equal(saves.length, 1);
});

test('CAS retry preserves another session entry and user edits made before an update', async t => {
  const { store, vault } = fixture(t);
  await ensureDeliveryDiary(vault, request({ summary: '第一版。' }));
  let race = true;
  const concurrent = { ...vault, async save(input) {
    if (race) {
      race = false;
      await ensureDeliveryDiary(vault, request({ deliveryId: 'delivery-b', kind: 'materials' }));
      replace(store, text => text + '\n## 另一位用户的补充\n\n保留。\n');
    }
    return vault.save(input);
  } };
  await ensureDeliveryDiary(concurrent, request({ version: 2, summary: '第二版。' }));
  const content = store.read({ path }).content;
  assert.equal(markerLines(content).length, 4);
  assert.match(content, /资料整理/);
  assert.match(content, /第二版/);
  assert.ok(content.endsWith('## 另一位用户的补充\n\n保留。\n'));
});

test('a managed diary entry cannot become its own source and be overwritten', async t => {
  const { store, vault, saves } = fixture(t);
  const first = await ensureDeliveryDiary(vault, request());
  const before = store.read({ path });
  await assert.rejects(ensureDeliveryDiary(vault, request({ version: 2, source: { path, heading: first.heading } })), /diary_source_overlap/);
  assert.deepEqual(store.read({ path }), before);
  assert.equal(saves.length, 1);
});

for (const damage of [text => text.replace('类型：课后总结', '用户改过的未知内容'),
  text => text.replace(/<!-- \/notara-delivery:[^\n]+\n?/, ''),
  text => text.replace(/<!-- notara-delivery:[^\n]+\n?/, ''),
  text => text.replace('### 课后总结 · ', '### 我改了标题 '),
  text => text.replace('## 工作交付', '## 别的区域')]) {
  test(`damaged managed entry ${damage.toString()} fails without overwriting user edits`, async t => {
    const { store, vault, saves } = fixture(t);
    await ensureDeliveryDiary(vault, request());
    replace(store, damage);
    const before = store.read({ path });
    await assert.rejects(ensureDeliveryDiary(vault, request({ version: 2 })), /diary_entry_damaged/);
    assert.deepEqual(store.read({ path }), before);
    assert.equal(saves.length, 1);
  });
}

test('a duplicate visible delivery section and unclosed hidden regions fail before saving', async t => {
  for (const content of ['## 工作交付\n\n甲。\n\n## 工作交付\n\n乙。\n', '# 今天\n\n```\n未闭合代码\n', '# 今天\n\n<details>\n未闭合教师参考\n']) {
    const { vault, saves } = fixture(t, { [path]: content });
    await assert.rejects(ensureDeliveryDiary(vault, request()), /diary_(section_ambiguous|entry_damaged|verification_failed)/);
    assert.equal(saves.length, 0);
  }
});

test('different delivery IDs sharing a long prefix still get independent headings and entries', async t => {
  const { store, vault } = fixture(t);
  const first = await ensureDeliveryDiary(vault, request({ deliveryId: 'same-prefix-'.repeat(10) + 'a' }));
  const second = await ensureDeliveryDiary(vault, request({ deliveryId: 'same-prefix-'.repeat(10) + 'b' }));
  assert.notEqual(first.heading, second.heading);
  assert.equal(markerLines(store.read({ path }).content).length, 4);
});

test('invalid dates, versions, source paths, missing source and hidden source headings do not write', async t => {
  const { vault, saves } = fixture(t, { '报告/隐藏.md': '<details>\n\n## 隐藏报告\n\n参考。\n</details>\n' });
  for (const args of [request({ date: '2026-02-30' }), request({ date: '../bad' }), request({ version: 0 }),
    request({ source: { path: '../外部.md', heading: '报告' } }), request({ source: { path: '报告/隐藏.md', heading: '隐藏报告' } })]) {
    await assert.rejects(ensureDeliveryDiary(vault, args), /(?:diary_input_invalid|vault_path_invalid|diary_source_invalid)/);
  }
  await assert.rejects(ensureDeliveryDiary(vault, request({ source: { path: '不存在.md', heading: '报告' } })), { code: 'ENOENT' });
  assert.equal(saves.length, 0);
});

test('only the four explicit kinds are accepted and rendered with their Chinese event labels', async t => {
  const { store, vault, saves } = fixture(t);
  for (const [kind, label] of Object.entries({ lesson: '课后总结', preparation: '备课交付', question: '轻量讨论', materials: '资料整理' })) {
    const result = await ensureDeliveryDiary(vault, request({ kind, deliveryId: `kind-${kind}` }));
    assert.equal(result.heading, `${label} · 本节总结与下次续接`);
    assert.ok(store.read({ path }).content.includes(`类型：${label}`));
  }
  for (const kind of ['material', '课后总结', '备课交付', '中文自定义', 'unknown', '__proto__']) {
    await assert.rejects(ensureDeliveryDiary(vault, request({ kind, deliveryId: `invalid-${kind}` })), /diary_input_invalid/);
  }
  assert.equal(saves.length, 4);
});

test('same report titles get readable numeric suffixes and durable replay keeps the chosen suffix', async t => {
  const { store, vault, saves } = fixture(t);
  const receipts = [];
  for (const deliveryId of ['first', 'second', 'third']) receipts.push(await ensureDeliveryDiary(vault, request({ deliveryId })));
  assert.deepEqual(receipts.map(item => item.heading), ['课后总结 · 本节总结与下次续接', '课后总结 · 本节总结与下次续接（2）', '课后总结 · 本节总结与下次续接（3）']);
  const before = store.read({ path });
  assert.deepEqual(await ensureDeliveryDiary({ ...vault }, request({ deliveryId: 'second' })), { ...receipts[1], revision: before.revision });
  assert.deepEqual(store.read({ path }), before);
  assert.equal(saves.length, 3);
});

test('ordinary diary headings reserve names and can still be edited freely after delivery', async t => {
  const original = '# 今天\n\n## 课后总结 · 本节总结与下次续接\n\n用户记录可自由编辑。\n';
  const { store, vault, saves } = fixture(t, { [path]: original });
  const first = await ensureDeliveryDiary(vault, request());
  assert.equal(first.heading, '课后总结 · 本节总结与下次续接（2）');
  replace(store, text => text.replace('## 课后总结 · 本节总结与下次续接\n', '## 用户改了普通标题\n').replace('用户记录可自由编辑。', '学生新的原话。'));
  const before = store.read({ path });
  const replay = await ensureDeliveryDiary(vault, request());
  assert.equal(replay.heading, first.heading);
  assert.deepEqual(store.read({ path }), before);
  const second = await ensureDeliveryDiary(vault, request({ version: 2, summary: '新的真实结果。' }));
  assert.equal(second.heading, first.heading);
  assert.ok(store.read({ path }).content.includes('## 用户改了普通标题\n\n学生新的原话。'));
  assert.equal(saves.length, 2);
});

test('a revised source heading and kind update the entry without renaming its first chosen heading', async t => {
  const source = { path: '报告/修订.md', heading: '更正后的报告' };
  const { store, vault } = fixture(t, { [source.path]: '## 更正后的报告\n\n新的报告原文。\n' });
  const first = await ensureDeliveryDiary(vault, request());
  const second = await ensureDeliveryDiary(vault, request({ version: 2, kind: 'question', source }));
  assert.equal(second.heading, first.heading);
  assert.equal(second.locator, first.locator);
  assert.ok(hasSummaryReference(store.read({ path }), source));
  assert.match(store.read({ path }).content, /类型：轻量讨论/);
  assert.deepEqual(await ensureDeliveryDiary(vault, request({ version: 2, kind: 'question', source })), second);
});

test('same-day source headings cannot be confused with the chosen diary-entry heading', async t => {
  const source = { path, heading: '原报告' };
  const original = '# 今天\n\n## 原报告\n\n报告内容保持原样。\n\n## 课后总结 · 原报告\n\n另一个真实报告。\n';
  const { store, vault } = fixture(t, { [path]: original });
  const result = await ensureDeliveryDiary(vault, request({ source }));
  const diary = store.read({ path });
  assert.equal(result.heading, '课后总结 · 原报告（2）');
  assert.notEqual(result.heading, source.heading);
  assert.ok(diary.content.startsWith(original));
  assert.ok(hasSummaryReference(diary, source));
  assert.ok(hasSummaryReference({ path: '索引.md', content: result.locator }, { path, heading: result.heading }));
  await ensureDeliveryDiary(vault, request({ source, version: 2, summary: '只修订交付结果。' }));
  assert.ok(store.read({ path }).content.startsWith(original));
});

test('concurrent same-title deliveries resolve numbering after CAS without losing either entry', async t => {
  const { store, vault } = fixture(t);
  let release, arrivals = 0;
  const barrier = new Promise(resolve => { release = resolve; });
  const concurrentVault = () => ({ ...vault, async read(input) {
    let result, error;
    try { result = await vault.read(input); } catch (caught) { error = caught; }
    if (input.path === path && arrivals < 2) { if (++arrivals === 2) release(); await barrier; }
    if (error) throw error;
    return result;
  } });
  const receipts = await Promise.all(['same-title-a', 'same-title-b'].map(deliveryId => ensureDeliveryDiary(concurrentVault(), request({ deliveryId }))));
  assert.deepEqual(receipts.map(item => item.heading).sort(), ['课后总结 · 本节总结与下次续接', '课后总结 · 本节总结与下次续接（2）'].sort());
  assert.equal(markerLines(store.read({ path }).content).length, 4);
  for (let index = 0; index < receipts.length; index++) {
    const replay = await ensureDeliveryDiary(vault, request({ deliveryId: ['same-title-a', 'same-title-b'][index] }));
    assert.equal(replay.heading, receipts[index].heading);
  }
});

test('summary accepts exactly 1000 characters without truncation and rejects 1001 before any write', async t => {
  const { store, vault, saves } = fixture(t);
  const summary = '真'.repeat(1000);
  await ensureDeliveryDiary(vault, request({ summary }));
  assert.ok(store.read({ path }).content.includes(`结果：${summary}\n`));
  const before = store.read({ path });
  await assert.rejects(ensureDeliveryDiary(vault, request({ version: 2, summary: summary + '多' })), /diary_input_invalid/);
  assert.deepEqual(store.read({ path }), before);
  assert.equal(saves.length, 1);
});

test('special source titles render as readable text and their returned entry locator identifies the exact section', async t => {
  const source = { path, heading: '结果 [甲] | #50% (a) & <span>说明</span>' };
  const original = `# 今天\r\n\r\n## ${source.heading}\r\n\r\n报告正文。\r\n`;
  const { store, vault } = fixture(t, { [path]: original });
  const receipt = await ensureDeliveryDiary(vault, request({ source }));
  const diary = store.read({ path });
  assert.ok(diary.content.startsWith(original));
  assert.doesNotMatch(diary.content.slice(original.length).replace(/<!--[\s\S]*?-->/g, ''), /[a-f0-9]{64}/);
  assert.doesNotMatch(diary.content.slice(original.length), /<span>/);
  assert.ok(hasSummaryReference(diary, source));
  assert.ok(hasSummaryReference({ path: '索引.md', content: receipt.locator }, { path, heading: receipt.heading }));
  assert.match(extractLessonSummary(diary, { heading: receipt.heading }).content, /类型：课后总结/);
  assert.equal(extractLessonSummary(diary, { heading: source.heading }).content, '报告正文。');
  const replay = await ensureDeliveryDiary(vault, request({ source }));
  assert.equal(replay.heading, receipt.heading);
  assert.equal(replay.locator, receipt.locator);
});

for (const eol of ['\n', '\r\n']) for (const order of [['报告甲', '报告乙'], ['报告乙', '报告甲']]) {
  test(`both H3 report hashes stay stable across deliveries ${order.join(' then ')} (${JSON.stringify(eol)})`, async t => {
    const original = '# 今天\n\n手写日记保留。\n\n## 工作交付\n\n人工记录保留。\n\n### 报告甲\n\n甲的真实作答。\n\n#### 甲的续接\n\n甲尚待独立检验。\n\n### 报告乙\n\n乙的真实作答。\n\n#### 乙的续接\n\n乙保留不同方法。\n'.replaceAll('\n', eol);
    const { store, vault, saves } = fixture(t, { [path]: original });
    const reports = () => ['报告甲', '报告乙'].map(heading => extractLessonSummary(store.read({ path }), { heading }));
    const before = reports(), snapshots = [], receipts = [];
    const args = heading => request({ deliveryId: heading, source: { path, heading }, summary: `${heading}的交付。` });
    for (const heading of order) {
      receipts.push(await ensureDeliveryDiary(vault, args(heading)));
      snapshots.push(reports());
    }
    assert.deepEqual(snapshots, order.map(() => before), 'creating either index must preserve both complete reports and content hashes');
    for (let index = 0; index < order.length; index++) {
      const input = { ...args(order[index]), version: 2, summary: '只修订索引结果。' };
      const revised = await ensureDeliveryDiary(vault, input);
      assert.equal(revised.heading, receipts[index].heading);
      assert.deepEqual(reports(), before);
      const diary = store.read({ path }), writes = saves.length;
      assert.deepEqual(await ensureDeliveryDiary(vault, input), revised);
      assert.deepEqual(store.read({ path }), diary);
      assert.equal(saves.length, writes, 'replay must not save again');
      assert.deepEqual(reports(), before);
    }
    const content = store.read({ path }).content;
    assert.ok(content.includes('手写日记保留。' + eol));
    assert.ok(content.includes('人工记录保留。' + eol));
    if (eol === '\r\n') assert.doesNotMatch(content, /(?<!\r)\n/);
    assert.equal(saves.length, 4);
  });
}

for (const [name, original] of [
  ['H1 whole report', '---\ntype: diary\n---\n# 当日报告\n\n真实报告原文。\n\n## 下次续接\n\n独立检验尚未观察。\n'],
  ['last H3 report inside delivery area', '# 今天\n\n## 工作交付\n\n人工记录保留。\n\n### 当日报告\n\n真实报告原文。\n\n#### 下次续接\n\n独立检验尚未观察。\n'],
]) {
  test(`same-day source hash stays unchanged for ${name}, including revision and replay`, async t => {
    const source = { path, heading: '当日报告' };
    for (const eol of ['\n', '\r\n']) {
      const { store, vault, saves } = fixture(t, { [path]: original.replaceAll('\n', eol) });
      const before = extractLessonSummary(store.read({ path }), { heading: source.heading });
      const first = await ensureDeliveryDiary(vault, request({ source, summary: '真实交付结果。' }));
      let diary = store.read({ path });
      assert.deepEqual(extractLessonSummary(diary, { heading: source.heading }), before);
      assert.ok(diary.content.indexOf(`### ${first.heading}`) < diary.content.indexOf(`${name.startsWith('H1') ? '#' : '###'} 当日报告`));
      const second = await ensureDeliveryDiary(vault, request({ source, version: 2, summary: '修订交付结果。' }));
      diary = store.read({ path });
      assert.deepEqual(extractLessonSummary(diary, { heading: source.heading }), before);
      assert.equal(second.heading, first.heading);
      assert.equal((await ensureDeliveryDiary(vault, request({ source, version: 2, summary: '修订交付结果。' }))).revision, diary.revision);
      assert.equal(saves.length, 2);
    }
  });
}

test('unsafe same-day source structures fail before any Vault save', async t => {
  for (const original of ['# 当日报告\n\n报告原文。\n\n## 工作交付\n\n原有记录。\n', '## 工作交付\n\n报告原文。\n']) {
    const source = { path, heading: original.startsWith('# 当日报告') ? '当日报告' : '工作交付' };
    const { store, vault, saves } = fixture(t, { [path]: original });
    const before = store.read({ path });
    const identity = extractLessonSummary(before, { heading: source.heading });
    await assert.rejects(ensureDeliveryDiary(vault, request({ source })), /diary_source_changed/);
    assert.equal(saves.length, 0);
    assert.deepEqual(store.read({ path }), before);
    assert.deepEqual(extractLessonSummary(store.read({ path }), { heading: source.heading }), identity);
  }
});
