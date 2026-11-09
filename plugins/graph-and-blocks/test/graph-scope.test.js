import test from 'node:test';
import assert from 'node:assert/strict';
import { projectGraph } from '../src/graph.js';
import { graphCandidates } from '../src/graph-selection.js';
import { sourceGroups, graphForSource } from '../src/source-graph.js';

const nodes = [
  { path: '题目.md', type: 'exercise', tags: ['数学'] },
  { path: '概念.md', type: 'concept', tags: ['数学'] },
  { path: '方法.md', type: 'method', tags: [] },
  { path: '知识卡.md', type: 'card', tags: [] },
  { path: '讲义.pdf', type: 'source', isSource: true, tags: [] },
  { path: '原图.png', type: 'image', isSource: true, tags: [] },
  { path: '今日.md', type: 'diary', tags: [] },
  { path: '导读.md', type: 'source', isSource: false, tags: [] },
  { path: '便签.md', type: 'note', tags: [] },
  { path: '工具.py', type: 'file', isSource: false, tags: [] },
  { path: '装饰.png', type: 'image', isSource: false, tags: [] },
].map(node => ({ title: node.path, ...node }));
const paths = graph => graph.nodes.map(node => node.path);
const edge = (source, target, style = 'dashed') => ({ source, target, style });
const graph = { nodes, edges: [edge('今日.md', '题目.md'), edge('今日.md', '讲义.pdf'), edge('今日.md', '导读.md'), edge('导读.md', '方法.md'), edge('题目.md', '概念.md', 'solid')] };

test('default graph contains learning types and actual original sources, with no auxiliary or synthetic edges', () => {
  const result = projectGraph(graph);
  assert.deepEqual(paths(result), ['题目.md', '概念.md', '方法.md', '知识卡.md', '讲义.pdf', '原图.png']);
  assert.deepEqual(result.edges, [edge('题目.md', '概念.md', 'solid')]);
  assert.equal(nodes.length, 11, 'the source catalog is unchanged');
});
test('an explicit auxiliary center stays visible while other auxiliaries cannot extend its neighborhood', () => {
  assert.deepEqual(paths(projectGraph(graph, ['今日.md'], [], 1)), ['题目.md', '讲义.pdf', '今日.md']);
  assert.deepEqual(paths(projectGraph(graph, ['今日.md'], [], 3)), ['题目.md', '概念.md', '讲义.pdf', '今日.md']);
  assert.deepEqual(paths(projectGraph(graph, ['今日.md'], ['数学'], 1)), ['题目.md', '今日.md']);
  assert.deepEqual(graphCandidates(projectGraph(graph, ['今日.md']).nodes, 'cards', '', ['今日.md']).map(node => node.path), ['题目.md', '今日.md']);
  assert.deepEqual(paths(projectGraph(graph, ['不在当前范围.md'])), []);
  assert.equal(paths(projectGraph(graph, [])).includes('今日.md'), false);
});
test('source grouping excludes auxiliaries and a source-local graph keeps the source node and its real edges', () => {
  const source = nodes.find(node => node.path === '讲义.pdf'), card = { ...nodes[0], sourcePaths: [source.path] };
  const data = { nodes: [source, card, nodes.find(node => node.path === '便签.md')], edges: [edge(card.path, source.path)] };
  const groups = sourceGroups(data);
  assert.equal(groups.length, 1);
  assert.deepEqual(graphForSource(data, groups[0]), { nodes: [source, card], edges: data.edges });
  assert.deepEqual(graphCandidates([nodes[5]], 'source'), [nodes[5]], 'a proven image source belongs to the source filter');
});
test('route and lesson auxiliaries stay out of default graph even if marked isSource, yet expand when focused as center', () => {
  const auxNodes = [
    ...nodes,
    { path: '路线.md', title: '路线.md', type: 'route', isSource: true, tags: [] },
    { path: '备课.md', title: '备课.md', type: 'lesson', isSource: true, tags: [] },
  ];
  const auxGraph = {
    nodes: auxNodes,
    edges: [...graph.edges, edge('路线.md', '备课.md'), edge('路线.md', '题目.md'), edge('备课.md', '方法.md')],
  };
  assert.deepEqual(paths(projectGraph(auxGraph)), ['题目.md', '概念.md', '方法.md', '知识卡.md', '讲义.pdf', '原图.png']);
  assert.deepEqual(paths(projectGraph(auxGraph, ['路线.md'], [], 1)), ['题目.md', '路线.md']);
  assert.deepEqual(paths(projectGraph(auxGraph, ['备课.md'], [], 1)), ['方法.md', '备课.md']);
});
