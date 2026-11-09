export const clampScale = scale => Math.max(.03, Math.min(3, scale));
export function zoomAt(view, point, scale) {
  const next = clampScale(scale);
  return { x: point.x - (point.x - view.x) * next / view.scale, y: point.y - (point.y - view.y) * next / view.scale, scale: next };
}

/** SVG-space gestures: native non-passive wheel and pointer capture, one owner. */
export function installGraphGestures(svg, { getView, setView, getNode, onDrag = () => {}, isSelecting = () => false, onBoxChange = () => {}, onBoxSelect = () => {}, onIdle = () => {} }) {
  const pointers = new Map();
  const captures = new Map();
  let gesture = null, suppressUntil = 0, suppressClick = false, matrix = null, matrixFrame = null;
  const point = (x, y) => {
    if (!matrix) {
      matrix = svg.getScreenCTM()?.inverse();
      if (matrixFrame === null) matrixFrame = requestAnimationFrame(() => { matrix = null; matrixFrame = null; });
    }
    return matrix ? new DOMPoint(x, y).matrixTransform(matrix) : null;
  };
  const pair = () => {
    const [a, b] = [...pointers.values()];
    return { center: { x: (a.p.x + b.p.x) / 2, y: (a.p.y + b.p.y) / 2 }, distance: Math.hypot(a.p.x - b.p.x, a.p.y - b.p.y) };
  };
  const pan = pointer => ({ type: 'pan', start: pointer.p, view: { ...getView() } });
  const down = event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    suppressClick = false;
    const p = point(event.clientX, event.clientY);
    if (!p) return;
    if (event.pointerType !== 'mouse') event.preventDefault();
    const pointer = { p, x: event.clientX, y: event.clientY };
    pointers.set(event.pointerId, pointer);
    const target = event.target.closest?.('[data-graph-node],[data-cluster-key]') ?? svg;
    captures.set(event.pointerId, target);
    try { target.setPointerCapture(event.pointerId); } catch { /* Already cancelled by the host. */ }
    if (pointers.size >= 2) {
      if (gesture?.type === 'node') onDrag('end');
      if (gesture?.type === 'box') onBoxChange(null);
      gesture = { type: 'pinch', ...pair(), view: { ...getView() } };
      suppressUntil = Date.now() + 500;
      svg.dataset.gesturing = 'pinch';
      return;
    }
    const node = getNode(event.target.closest?.('[data-graph-node]')?.getAttribute('data-graph-node'));
    const v = getView();
    gesture = node ? { type: 'node', node, start: pointer, moved: false, dx: (p.x - v.x) / v.scale - node.x, dy: (p.y - v.y) / v.scale - node.y } : isSelecting(event) ? {type:'box',start:p,additive:event.ctrlKey||event.metaKey||event.shiftKey,box:null} : pan(pointer);
    svg.dataset.gesturing = gesture.type;
    if(gesture.type==='box')onBoxChange({x:p.x,y:p.y,width:0,height:0});
  };
  const move = event => {
    if (!pointers.has(event.pointerId) || !gesture) return;
    const p = point(event.clientX, event.clientY);
    if (!p) return;
    event.preventDefault();
    pointers.set(event.pointerId, { p, x: event.clientX, y: event.clientY });
    if (gesture.type === 'pinch' && pointers.size >= 2) {
      const next = pair(), { center, distance, view } = gesture;
      const scale = clampScale(view.scale * next.distance / Math.max(distance, 1));
      setView({ scale, x: next.center.x - (center.x - view.x) * scale / view.scale, y: next.center.y - (center.y - view.y) * scale / view.scale });
      suppressUntil = Date.now() + 500;
    } else if(gesture.type==='box') {
      const start=gesture.start;
      gesture.box={x:Math.min(start.x,p.x),y:Math.min(start.y,p.y),width:Math.abs(start.x-p.x),height:Math.abs(start.y-p.y)};
      onBoxChange(gesture.box);suppressUntil=Date.now()+500;
    } else if (gesture.type === 'pan') {
      if(!gesture.moved&&Math.hypot(p.x-gesture.start.x,p.y-gesture.start.y)<4)return;
      gesture.moved = true;
      setView({ ...gesture.view, x: gesture.view.x + p.x - gesture.start.x, y: gesture.view.y + p.y - gesture.start.y });
      suppressUntil = Date.now() + 500;
    } else if (gesture.type === 'node') {
      if (!gesture.moved && Math.hypot(event.clientX - gesture.start.x, event.clientY - gesture.start.y) < 4) return;
      if (!gesture.moved) onDrag('start');
      gesture.moved = true;
      const v = getView();
      Object.assign(gesture.node, { fx: (p.x - v.x) / v.scale - gesture.dx, fy: (p.y - v.y) / v.scale - gesture.dy });
      gesture.node.x = gesture.node.fx; gesture.node.y = gesture.node.fy;
      onDrag('move'); suppressUntil = Date.now() + 500;
    }
  };
  const finish = event => {
    if (!pointers.delete(event.pointerId)) return;
    if(gesture?.moved||gesture?.type==='pinch'||gesture?.box){suppressClick=true;suppressUntil=Date.now()+500;}
    if (gesture?.type === 'node') onDrag('end');
    if(gesture?.type==='box'){
      if(event.type==='pointerup'&&gesture.box&&(gesture.box.width>3||gesture.box.height>3))onBoxSelect(gesture.box,gesture.additive);
      onBoxChange(null);
    }
    const target = captures.get(event.pointerId); captures.delete(event.pointerId);
    if (target?.hasPointerCapture?.(event.pointerId)) target.releasePointerCapture(event.pointerId);
    if (pointers.size >= 2) gesture = { type: 'pinch', ...pair(), view: { ...getView() } };
    else if (pointers.size === 1) gesture = pan([...pointers.values()][0]);
    else { gesture = null; delete svg.dataset.gesturing; onIdle(); }
  };
  const wheel = event => {
    if(gesture?.type==='box'){event.preventDefault();return;}
    const p = point(event.clientX, event.clientY);
    if (!p) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? svg.clientHeight : 1;
    const dx = event.deltaX * unit, dy = event.deltaY * unit;
    const v = getView();
    if (event.ctrlKey || event.metaKey) setView(zoomAt(v, p, v.scale * Math.exp(-dy * .01)));
    else {
      const next = point(event.clientX - dx, event.clientY - dy);
      setView({ ...v, x: v.x + next.x - p.x, y: v.y + next.y - p.y });
    }
    // Keep an in-progress pointer gesture based on the newly transformed view.
    if (pointers.size >= 2) gesture = { type: 'pinch', ...pair(), view: { ...getView() } };
    else if (gesture?.type === 'pan') gesture = pan([...pointers.values()][0]);
  };
  const cancel = () => {
    if(gesture?.moved||gesture?.type==='pinch'||gesture?.box){suppressClick=true;suppressUntil=Date.now()+500;}
    if (gesture?.type === 'node') onDrag('end');
    if (gesture?.type === 'box') onBoxChange(null);
    const ids = [...pointers.keys()]; pointers.clear(); gesture = null;
    for (const id of ids) { const target = captures.get(id); if (target?.hasPointerCapture?.(id)) target.releasePointerCapture(id); }
    captures.clear();
    delete svg.dataset.gesturing;
    onIdle();
  };
  const events = { pointerdown: down, pointermove: move, pointerup: finish, pointercancel: finish, lostpointercapture: finish, wheel };
  const click=event=>{if(suppressClick){suppressClick=false;event.preventDefault();event.stopPropagation();}};
  svg.addEventListener('click',click,true);
  for (const [name, handler] of Object.entries(events)) svg.addEventListener(name, handler, { passive: false });
  return {
    cancel,
    canOpen: () => Date.now() >= suppressUntil,
    dispose() { cancel(); svg.removeEventListener('click',click,true); if (matrixFrame !== null) cancelAnimationFrame(matrixFrame); for (const [name, handler] of Object.entries(events)) svg.removeEventListener(name, handler); },
  };
}
