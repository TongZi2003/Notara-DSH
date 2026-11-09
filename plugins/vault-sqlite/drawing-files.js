/** Standard file formats. Unknown fields survive editor round trips. */
export function parseCanvasDocument(content) {
  const doc = JSON.parse(content);
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('canvas_invalid');
  const nodes = doc.nodes ?? [], edges = doc.edges ?? [];
  if (!Array.isArray(nodes) || !Array.isArray(edges) || nodes.length > 2000 || edges.length > 5000) throw new Error('canvas_invalid');
  const ids = new Set();
  for (const node of nodes) {
    if (!node || typeof node.id !== 'string' || !node.id || ids.has(node.id) || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(node[key]) && Math.abs(node[key]) <= 1e7) || node.width <= 0 || node.height <= 0) throw new Error('canvas_node_invalid');
    ids.add(node.id);
  }
  const edgeIds = new Set();
  for (const edge of edges) {
    if (!edge || typeof edge.id !== 'string' || edgeIds.has(edge.id) || typeof edge.fromNode !== 'string' || typeof edge.toNode !== 'string') throw new Error('canvas_edge_invalid');
    edgeIds.add(edge.id);
  }
  return { ...doc, nodes, edges };
}

export function parseDrawingDocument(content) {
  const doc = JSON.parse(content);
  if (!doc || doc.type !== 'excalidraw' || !Array.isArray(doc.elements) || doc.elements.length > 20000 || (doc.files != null && (typeof doc.files !== 'object' || Array.isArray(doc.files)))) throw new Error('excalidraw_invalid');
  if (doc.elements.some(element => !element || typeof element.id !== 'string' || typeof element.type !== 'string')) throw new Error('excalidraw_element_invalid');
  return doc;
}

export const EMPTY_CANVAS = JSON.stringify({ nodes: [], edges: [] }, null, 2);
export const EMPTY_DRAWING = JSON.stringify({ type: 'excalidraw', version: 2, source: 'notara', elements: [], appState: { viewBackgroundColor: '#ffffff' }, files: {} }, null, 2);
