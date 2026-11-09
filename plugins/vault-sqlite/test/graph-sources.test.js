import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVaultStore } from '../vault-indexer.js';

test('only declared sources or direct learning-source evidence admit other files; full catalog and links remain intact', async t => {
  const root = mkdtempSync(join(tmpdir(), 'notara-graph-source-'));
  const content = '---\ntype: concept\n---\n## 内容\n[[讲义.pdf]]\n[[顺带提到.py]]\n[[普通便签.md]]\n## 来源\n[[原始代码.py]]\n![[原图.png]]\n![[摘录原文.md#text=0,3]]\n';
  const files = {
    '卡片/A.md': content,
    '讲义.pdf': '%PDF-1.4\n',
    '原始材料.md': '---\ntype: source\n---\n## 来源\n[[递归引用.py]]',
    '导读.md': '# 导读\n## 来源\n[[导读提到.py]]',
    '日记/今天.md': '# 今天\n## 来源\n[[日记提到.py]]',
    '普通便签.md': '# 普通便签', '摘录原文.md': '原始摘录正文',
    '原图.png': Buffer.from([137, 80, 78, 71]),
    '原始代码.py': 'print(1)', '顺带提到.py': 'print(2)', '递归引用.py': 'print(3)',
    '导读提到.py': 'print(4)', '日记提到.py': 'print(5)', '无关文件.txt': 'unrelated',
  };
  for (const [path, data] of Object.entries(files)) { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), data); }
  const store = createVaultStore({ root });
  t.after(async () => { await store.close(); rmSync(root, { recursive: true, force: true }); });
  const graph = store.graph(), originals = graph.nodes.filter(node => node.isSource).map(node => node.path).sort();
  assert.deepEqual(originals, ['讲义.pdf', '原始材料.md', '原始代码.py', '原图.png', '摘录原文.md'].sort());
  assert.equal(graph.nodes.length, Object.keys(files).length, 'display filtering must not remove indexed files');
  assert.deepEqual(graph.nodes.find(node => node.path === '卡片/A.md').sourcePaths.sort(), ['讲义.pdf', '原始代码.py', '原图.png', '摘录原文.md'].sort());
  assert.ok(graph.edges.some(edge => edge.source === '卡片/A.md' && edge.target === '顺带提到.py' || edge.target === '卡片/A.md' && edge.source === '顺带提到.py'));
  for (const [path, data] of Object.entries(files)) assert.deepEqual(readFileSync(join(root, path)), Buffer.from(data));
  const current = store.read({ path: '卡片/A.md' });
  store.save({ path: current.path, expectedRevision: current.revision, content: content.replace('## 来源', '## 参考理解').replace('![[摘录原文.md#text=0,3]]', '[[摘录原文.md]]') });
  assert.deepEqual(store.graph().nodes.filter(node => node.isSource).map(node => node.path).sort(), ['讲义.pdf', '原始材料.md'].sort(), 'removing provenance must revoke inferred source membership');

  store.save({ path: '路线.md', content: '---\ntype: route\n---\n# 路线\n## 来源\n[[导读提到.py]]\n', expectedRevision: null });
  store.save({ path: '备课.md', content: '---\ntype: lesson\n---\n# 备课\n## 来源\n[[日记提到.py]]\n', expectedRevision: null });
  const updatedGraph = store.graph();
  for (const aux of ['路线.md', '备课.md', '导读提到.py', '日记提到.py']) {
    assert.equal(updatedGraph.nodes.find(n => n.path === aux)?.isSource, false, `${aux} must not masquerade as an original source`);
  }
  assert.equal(store.graph({ focusPath: '路线.md', hops: 1 }).nodes.some(n => n.path === '路线.md'), true);
});
