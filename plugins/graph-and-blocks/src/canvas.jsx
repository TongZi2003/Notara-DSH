import React, { useMemo, useState } from 'react';
import { InteractiveBlocks } from './blocks.jsx';

/** Read standard JSON Canvas 1.0 without adding a second board schema. */
export function parseCanvas(content) {
  if (typeof content !== 'string' || content.length > 1000000) throw new Error('白板内容过大');
  const doc = JSON.parse(content);
  if (!doc || !Array.isArray(doc.nodes) || !Array.isArray(doc.edges) || doc.nodes.length > 500 || doc.edges.length > 1000) throw new Error('白板格式无法读取');
  const ids = new Set();
  for (const n of doc.nodes) {
    if (typeof n.id !== 'string' || ids.has(n.id) || !['x', 'y', 'width', 'height'].every(k => Number.isFinite(n[k]) && Math.abs(n[k]) <= 100000) || n.width <= 0 || n.height <= 0) throw new Error('白板节点无法读取');
    ids.add(n.id);
  }
  return doc;
}

export function CanvasTextNode({ node, scope, store, onSubmit, renderMarkdown }) {
  return <InteractiveBlocks source={node.text ?? ''} nodeId={node.id} {...{ scope, store, onSubmit, renderMarkdown }} />;
}

export function CanvasBlocks({ content, scope, store, onSubmit, onOpenDocument, renderMarkdown }) {
  const [scale, setScale] = useState(.8);
  const parsed = useMemo(() => { try { return { doc: parseCanvas(content) }; } catch { return { error: true }; } }, [content]);
  if (parsed.error) return <p className="nv-block-error" role="status">白板暂时无法显示，请检查文件内容。</p>;
  const { nodes, edges } = parsed.doc;
  if (!nodes.length) return <p className="nv-block-caption">白板还是空的。</p>;
  const left = Math.min(...nodes.map(n => n.x)) - 20, top = Math.min(...nodes.map(n => n.y)) - 20;
  const width = Math.max(...nodes.map(n => n.x + n.width)) - left + 40, height = Math.max(...nodes.map(n => n.y + n.height)) - top + 140;
  const byId = new Map(nodes.map(n => [n.id, n]));
  const open = path => onOpenDocument ? onOpenDocument({ path }) : window.dispatchEvent(new CustomEvent('notara:open-document', { detail: { path } }));
  const anchor = (node, side = 'bottom') => side === 'left' ? [node.x, node.y + node.height / 2] : side === 'right' ? [node.x + node.width, node.y + node.height / 2] : side === 'top' ? [node.x + node.width / 2, node.y] : [node.x + node.width / 2, node.y + node.height];
  return <section className="nv-block-content nv-block-canvas" aria-label="课堂白板">
    <div className="nv-block-toolbar"><button type="button" aria-label="缩小白板" onClick={() => setScale(s => Math.max(.25, s / 1.2))}>−</button><span>{Math.round(scale * 100)}%</span><button type="button" aria-label="放大白板" onClick={() => setScale(s => Math.min(2, s * 1.2))}>＋</button></div>
    <div className="nv-block-canvas-scroll"><div style={{ width: width * scale, height: height * scale }}><div className="nv-block-canvas-sheet" style={{ width, height, transform: `scale(${scale})` }}>
      <svg width={width} height={height} aria-hidden="true" className="nv-block-canvas-links">{edges.map((edge, i) => { const a = byId.get(edge.fromNode), b = byId.get(edge.toNode); if (!a || !b) return null; const p = anchor(a, edge.fromSide), q = anchor(b, edge.toSide); return <g key={edge.id ?? i}><line x1={p[0] - left} y1={p[1] - top} x2={q[0] - left} y2={q[1] - top} /><text x={(p[0] + q[0]) / 2 - left} y={(p[1] + q[1]) / 2 - top}>{edge.label ?? ''}</text></g>; })}</svg>
      {[...nodes].sort((a, b) => (a.type === 'group' ? 0 : 1) - (b.type === 'group' ? 0 : 1)).map(node => <section key={node.id} className={`nv-block-canvas-node${node.type === 'group' ? ' nv-block-canvas-group' : ''}`} style={{ left: node.x - left, top: node.y - top, width: node.width, minHeight: node.height, height: node.type === 'group' ? node.height : 'auto' }}>
        {node.type === 'text' ? <CanvasTextNode {...{ node, scope, store, onSubmit, renderMarkdown }} /> : node.type === 'file' && typeof node.file === 'string' ? <button type="button" onClick={() => open(node.file)}>{node.file.split('/').at(-1)}</button> : node.type === 'group' ? <span>{node.label ?? ''}</span> : <span>此内容暂时无法显示。</span>}
      </section>)}
    </div></div></div>
  </section>;
}
export default CanvasBlocks;
