import { parseCanvasDocument } from '@oh-my-student/plugin-vault-sqlite/drawing-files';
export const canvasColor = value => ({ 1: '#cf6663', 2: '#d28e54', 3: '#c3aa4a', 4: '#6b9a6b', 5: '#6394b3', 6: '#9d7cb7' })[value] || (/^#[a-f\d]{6}$/i.test(value || '') ? value : undefined);

export function checkedCanvasChange(doc) {
  if (doc.nodes.length > 2000 || doc.edges.length > 5000) throw new Error('白板最多容纳 2000 个节点和 5000 条连线，此次修改未应用。');
  const text = JSON.stringify(doc);
  if (new TextEncoder().encode(text).length > 8 * 1024 * 1024) throw new Error('白板内容已达到文件大小上限，此次修改未应用。');
  parseCanvasDocument(text);
  return doc;
}

export function canvasToFlow(content) {
  const doc = typeof content === 'string' ? parseCanvasDocument(content) : content;
  return {
    nodes: doc.nodes.map(node => ({ id: node.id, type: 'material', position: { x: node.x, y: node.y }, width: node.width, height: node.height, style: { width: node.width, height: node.height }, zIndex: node.type === 'group' ? 0 : 1, data: { source: node } })),
    edges: doc.edges.map(edge => ({ id: edge.id, source: edge.fromNode, target: edge.toNode, sourceHandle: edge.fromSide || 'bottom', targetHandle: edge.toSide || 'top', label: edge.label, type: 'smoothstep', data: { source: edge }, style: { stroke: canvasColor(edge.color) }, markerStart: edge.fromEnd === 'arrow' ? { type: 'arrowclosed', color: canvasColor(edge.color) } : undefined, markerEnd: edge.toEnd === 'none' ? undefined : { type: 'arrowclosed', color: canvasColor(edge.color) } })),
  };
}

export function flowToCanvas(original, nodes, edges) {
  return {
    ...original,
    nodes: nodes.map(node => ({ ...node.data.source, id: node.id, x: Math.round(node.position.x), y: Math.round(node.position.y), width: Math.round(node.width || node.style.width), height: Math.round(node.height || node.style.height) })),
    edges: edges.map(edge => ({ ...edge.data?.source, id: edge.id, fromNode: edge.source, toNode: edge.target, fromSide: edge.sourceHandle || 'bottom', toSide: edge.targetHandle || 'top', ...(edge.label ? { label: edge.label } : {}) })),
  };
}

export function duplicateCanvasSelection(doc, ids, offset = 36) {
  const mapping = new Map(ids.filter(id => doc.nodes.some(n => n.id === id)).map(id => [id, crypto.randomUUID()]));
  return { ...doc, nodes: [...doc.nodes, ...doc.nodes.filter(n => mapping.has(n.id)).map(n => ({ ...n, id: mapping.get(n.id), x: n.x + offset, y: n.y + offset }))], edges: [...doc.edges, ...doc.edges.filter(e => mapping.has(e.fromNode) && mapping.has(e.toNode)).map(e => ({ ...e, id: crypto.randomUUID(), fromNode: mapping.get(e.fromNode), toNode: mapping.get(e.toNode) }))] };
}
