import test from 'node:test';
import assert from 'node:assert/strict';
import { documentProperties, propertyTags } from '../src/document-properties.js';

test('document properties parse real YAML values without rewriting source or guessing prose metadata', () => {
  const source = '---\r\ntitle: "含: 冒号" # 保留注释\r\ntags:\r\n  - 线性代数\r\n  - SVD\r\nlearned: false\r\ncustom: {nested: [1, 2]}\r\n---\r\n# 正文\r\n';
  assert.deepEqual(documentProperties(source), { error: false, entries: [['title', '含: 冒号'], ['tags', ['线性代数', 'SVD']], ['learned', false], ['custom', { nested: [1, 2] }]] });
  assert.equal(documentProperties('# 标题\n---\n这不是属性\n'), null);
  assert.equal(documentProperties('---\ntags: [未闭合\n---\n正文').error, true);
  assert.equal(documentProperties('---\n- 非属性映射\n---\n').error, true);
  assert.deepEqual(propertyTags('#线性代数, SVD，几何'), ['线性代数', 'SVD', '几何']);
  assert.deepEqual(propertyTags(['SVD', ' SVD ', '#代数']), ['SVD', '代数']);
  assert.ok(source.includes('# 保留注释\r\n'));
});
