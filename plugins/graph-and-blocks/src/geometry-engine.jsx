// Geometry renderers adapted from Notara/DSH board-visual-client source, 2026-10-24.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { compileExpression } from './domain/math-expression.js';
import { figureBounds, figureView } from './domain/board-figure.js';
import {createPlanarConstruction,gliderCarrierValid} from './planar-constructions.js';
const h = React.createElement;
const figureSnapshots = new Map();
const cleanSvg = svg => svg;
const COLOR = { line: 'var(--dsw-alias-brand-primary,#426ad2)', point: 'var(--dsw-alias-label-primary,#25262a)', accent: 'var(--dsw-alias-brand-primary,#426ad2)', soft: 'var(--dsw-alias-label-secondary,#707782)', fill: 'var(--dsw-alias-bg-layer-2,#edf2ff)' };
const loadFigureEngine = () => import('jsxgraph').then(module => {
 const JXG = module.default ?? module;
 for (const key of ['text','label']) if (JXG.Options[key]) Object.assign(JXG.Options[key], { display:'internal', parse:false, useMathJax:false, useKatex:false });
 return JXG;
});
export function FigureCanvas({ spec, specKey, values, answer, disabled, snapshotKey, onDrags, onDragState, dragPositions, onReady }) {
    const host = useRef(null), engine = useRef(null), board = useRef(null), marker = useRef(null), scope = useRef({});
    const liveAnswer = useRef(null);
    const restoredDrags=useRef({key:specKey,names:[]});
    const latest = useRef({ answer, disabled, onDrags, onDragState, dragPositions });
    latest.current = { answer, disabled, onDrags, onDragState, dragPositions };
    Object.assign(scope.current, values);
    const [status, setStatus] = useState('loading');
    const [invalid,setInvalid]=useState('');
    useEffect(() => {
      let alive = true;
      let resizeObserver;
      // An answered figure is redrawn read-only under the same key; each canvas removes only its own reader.
      const snapshot = () => { const svg = host.current?.querySelector('svg'); return svg ? cleanSvg(svg.outerHTML) : ''; };
      loadFigureEngine().then(JXG => {
        if (!alive || !host.current) return;
        engine.current = JXG;
        host.current.id ||= 'nv-block-figure-' + Math.random().toString(36).slice(2);
        const bounds = figureView(spec), frame = figureBounds(spec);
        const created = JXG.JSXGraph.initBoard(host.current.id, { boundingbox: [bounds.xmin, bounds.ymax, bounds.xmax, bounds.ymin], axis: spec.axes, keepAspectRatio: !spec.axes, showNavigation: false, showCopyright: false, showFullscreen: false, showScreenshot: false, pan: { enabled: false }, zoom: { enabled: false, wheel: false }, resize: { enabled: false } });
        board.current = created;
        if (typeof ResizeObserver !== 'undefined') { resizeObserver = new ResizeObserver(() => { if (alive && host.current) { created.resizeContainer(host.current.clientWidth, host.current.clientHeight, true); created.setBoundingBox([bounds.xmin, bounds.ymax, bounds.xmax, bounds.ymin], !spec.axes); created.fullUpdate(); } }); resizeObserver.observe(host.current); }
        const S = scope.current, names = spec.params.map(param => param.name);
        const compiled = (source, variables) => compileExpression(source, [...variables, ...names]).evaluate;
        const elements = new Map(), drags = new Map(), dragOrigins = new Map(),checks=new Map(),gliders=new Map(),gliderState=new Map(),invalidGliders=new Set();
        const restoreDrag=(name,p)=>{const point=drags.get(name);if(!point)return;if(gliders.has(name)){gliderState.set(name,p);if(!gliderCarrierValid(gliders.get(name),spec,elements,checks))return;if(Number.isFinite(p.position))point.setGliderPosition(p.position);else point.setPositionDirectly(JXG.COORDS_BY_USER,[p.x,p.y]);}else point.moveTo([p.x,p.y]);};
        const reportDrag=(name,point,initial=false)=>{if(latest.current.disabled||!Number.isFinite(point.X())||!Number.isFinite(point.Y())||checks.has(name)&&!checks.get(name)())return;const value={x:point.X(),y:point.Y(),...(point.type===JXG.OBJECT_TYPE_GLIDER&&Number.isFinite(point.position)?{position:point.position}:{})};if(gliders.has(name))gliderState.set(name,value);(initial?latest.current.onDragState:latest.current.onDrags)?.(name,value);};
        const pointStyle = drag => ({ size: drag ? 4 : 3, fillColor: drag ? COLOR.accent : COLOR.point, strokeColor: drag ? COLOR.accent : COLOR.point, label: { offset: [6, 6], fontSize: 13 } });
        for (const item of spec.objects) {
          const construction=createPlanarConstruction(created,item,elements,checks,pointStyle(false),{strokeColor:COLOR.soft,strokeWidth:1.6});
          if(construction){elements.set(item.name,construction);continue;}
          if (item.kind === 'function') { const f = compiled(item.expr, ['x']); elements.set(item.name, created.create('functiongraph', [x => { S.x = x; return f(S); }], { strokeColor: COLOR.line, strokeWidth: 2 })); }
          else if (item.kind === 'curve') { const l = compiled(item.lhs, ['x', 'y']), r = compiled(item.rhs, ['x', 'y']); elements.set(item.name, created.create('implicitcurve', [(x, y) => { S.x = x; S.y = y; return l(S) - r(S); }], { strokeColor: COLOR.line, strokeWidth: 2 })); }
          else if (item.kind === 'parametric') { const X = compiled(item.x, ['t']), Y = compiled(item.y, ['t']); elements.set(item.name, created.create('curve', [t => { S.t = t; return X(S); }, t => { S.t = t; return Y(S); }, item.t[0], item.t[1]], { strokeColor: COLOR.line, strokeWidth: 2 })); }
          else if (item.kind === 'point') {
            const X = compiled(item.x, []), Y = compiled(item.y, []);
            const saved=latest.current.dragPositions?.[item.name];
            const point = created.create('point', item.drag ? saved?[saved.x,saved.y]:[X(S), Y(S)] : [() => X(S), () => Y(S)], { name: item.name, fixed: !item.drag, ...pointStyle(item.drag) });
            if (item.drag) { drags.set(item.name, point); dragOrigins.set(item.name, () => [X(S), Y(S)]); point.on('drag', () => reportDrag(item.name,point)); }
            elements.set(item.name, point);
          }
          else if(item.kind==='glider'){
            const X=compiled(item.x,[]),Y=compiled(item.y,[]),saved=latest.current.dragPositions?.[item.name];
            const valid=()=>gliderCarrierValid(item,spec,elements);checks.set(item.name,valid);
            const point=created.create('glider',[saved?.x??X(S),saved?.y??Y(S),elements.get(item.on)],{name:item.name,fixed:Boolean(disabled),visible:valid,...pointStyle(true)});
            elements.set(item.name,point);drags.set(item.name,point);gliders.set(item.name,item);dragOrigins.set(item.name,()=>[X(S),Y(S)]);
            gliderState.set(item.name,saved??{x:X(S),y:Y(S),...(valid()&&Number.isFinite(point.position)?{position:point.position}:{})});
            if(saved)restoreDrag(item.name,saved);
            point.on('drag',()=>reportDrag(item.name,point));
          }
          else if (item.kind === 'segment' || item.kind === 'line') elements.set(item.name, created.create(item.kind, item.points.map(name => elements.get(name)), { name:item.name,strokeColor: COLOR.soft, strokeWidth: 1.6 }));
          else if (item.kind === 'circle') { const center = elements.get(item.center), R = item.radius ? compiled(item.radius, []) : null; elements.set(item.name, created.create('circle', item.through ? [center, elements.get(item.through)] : [center, () => R(S)], { name:item.name,strokeColor: COLOR.soft, strokeWidth: 1.6 })); }
          else if (item.kind === 'midpoint') elements.set(item.name, created.create('midpoint', item.points.map(name => elements.get(name)), { name: item.name, ...pointStyle(false) }));
          else if (item.kind === 'intersection') elements.set(item.name, created.create('intersection', [elements.get(item.of[0]), elements.get(item.of[1]), item.index - 1], { name: item.name, ...pointStyle(false) }));
          else if (item.kind === 'polygon') elements.set(item.name, created.create('polygon', item.points.map(name => elements.get(name)), { fillColor: COLOR.fill, fillOpacity: .35, borders: { strokeColor: COLOR.soft } }));
          else if (item.kind === 'angle') elements.set(item.name, created.create('angle', item.points.map(name => elements.get(name)), { radius: .5, name: '', fillColor: '#f0d9b5', strokeColor: COLOR.accent }));
          else if (item.kind === 'arrow') { const from = elements.get(item.from), DX = compiled(item.dx, []), DY = compiled(item.dy, []); elements.set(item.name, created.create('arrow', [from, [() => from.X() + DX(S), () => from.Y() + DY(S)]], { strokeColor: COLOR.accent, strokeWidth: 2, name: item.label, withLabel: true })); }
          else if (item.kind === 'text') { const X = compiled(item.x, []), Y = compiled(item.y, []); created.create('text', [() => X(S), () => Y(S), item.content], { fontSize: 14, color: '#3b4652' }); }
        }
        // Carry invalid constructions through downstream objects as well.
        const ownChecks=new Map(checks),localChecks=new Map(),ancestors=new Map();
        for(const item of spec.objects){
          const element=elements.get(item.name);if(!element)continue;
          const refs=[...(item.points??[]),...(Array.isArray(item.of)?item.of:[item.of]),item.center,item.through,item.from,item.on,item.at].filter(Boolean);
          ancestors.set(item.name,new Set(refs.flatMap(name=>[name,...(ancestors.get(name)??[])])));
          localChecks.set(item.name,()=>{
            if(ownChecks.has(item.name)&&!ownChecks.get(item.name)())return false;
            if(element.elementClass===JXG.OBJECT_CLASS_POINT)return Number.isFinite(element.X())&&Number.isFinite(element.Y());
            if(typeof element.Radius==='function')return Number.isFinite(element.Radius())&&element.Radius()>1e-10;
            if(['line','segment','parallel','perpendicular','bisector','tangent'].includes(item.kind))return element.stdform?.slice(0,3).every(Number.isFinite)&&Math.hypot(element.stdform[1],element.stdform[2])>1e-10;
            return true;
          });
          // Precomputed ancestor sets avoid exponential recursion on shared
          // dependency chains. Every numeric predicate is local and current.
          checks.set(item.name,()=>[item.name,...ancestors.get(item.name)].every(name=>!localChecks.has(name)||localChecks.get(name)()));
          if(element.elementClass===JXG.OBJECT_CLASS_POINT)element.rendNode?.setAttribute('aria-label',`${item.drag?'动点':'点'} ${item.name}`);
        }
        for(const [name,valid] of checks)elements.get(name)?.setAttribute({visible:valid});
        // 在图上作答: a click places the answer marker; a dragged point reports where it went.
        const place = point => {
          if (marker.current) marker.current.moveTo([point.x, point.y]);
          else marker.current = created.create('point', [point.x, point.y], { name: '？', fixed: true, size: 5, fillColor: COLOR.accent, strokeColor: '#fff', label: { offset: [8, 8] } });
        };
        liveAnswer.current = { place, drags, restoreDrag, resetDrag: name => { const origin = dragOrigins.get(name); if (origin){const [x,y]=origin();restoreDrag(name,{x,y});} } };
        const current = latest.current.answer;
        if (current?.mode === 'point' && current.point) place(current.point);
        if (current?.mode === 'drag' && current.point) drags.get(spec.ask.target)?.moveTo([current.point.x, current.point.y]);
        created.on('down', event => {
          const now = latest.current;
          if (now.disabled || now.answer?.mode !== 'point') return;
          // getMousePosition applies the canvas zoom (a CSS transform); getUsrCoordsOfMouse would not.
          const screen = created.getMousePosition(event), usr = new JXG.Coords(JXG.COORDS_BY_SCREEN, screen, created).usrCoords, x = usr[1], y = usr[2];
          if (!Number.isFinite(x) || !Number.isFinite(y)) return;
          // A click in the axis margin counts as the nearest point of the declared frame.
          const point = { x: Math.min(frame.xmax, Math.max(frame.xmin, x)), y: Math.min(frame.ymax, Math.max(frame.ymin, y)) };
          place(point); now.answer.onPoint(point);
        });
        if (snapshotKey) figureSnapshots.set(snapshotKey, snapshot);
        const check=()=>{if(!alive)return;for(const [name,item] of gliders){if(!gliderCarrierValid(item,spec,elements,checks))invalidGliders.add(name);else if(invalidGliders.delete(name))queueMicrotask(()=>{if(alive){restoreDrag(name,gliderState.get(name));created.fullUpdate();reportDrag(name,elements.get(name),true);}});}setInvalid([...checks].filter(([,valid])=>!valid()).map(([name])=>name).join('、'));};
        created.on('update',check);check();
        // Persist native carrier parameters even before the first drag, so a
        // later parent-point edit does not reproject stale Cartesian positions.
        for(const item of spec.objects)if(item.kind==='glider'&&latest.current.dragPositions?.[item.name]?.position===undefined)reportDrag(item.name,elements.get(item.name),true);
        setStatus('ready');
        // SVG construction is synchronous; background tabs may pause rAF.
        queueMicrotask(()=>{if(alive)onReady?.();});
      }).catch(error => { if (alive) {setStatus('failed');onReady?.(error);} });
      return () => {
        alive = false; marker.current = null;
        liveAnswer.current = null;
        resizeObserver?.disconnect();
        if (snapshotKey && figureSnapshots.get(snapshotKey) === snapshot) figureSnapshots.delete(snapshotKey);
        if (board.current && engine.current) { try { engine.current.JSXGraph.freeBoard(board.current); } catch { /* already gone */ } }
        board.current = null;
      };
    }, [specKey]);
    useEffect(() => { board.current?.fullUpdate?.(); }, [JSON.stringify(values)]);
    useEffect(()=>{if(restoredDrags.current.key!==specKey)restoredDrags.current={key:specKey,names:[]};for(const name of restoredDrags.current.names)if(!dragPositions?.[name])liveAnswer.current?.resetDrag(name);for(const item of spec.objects){const p=dragPositions?.[item.name];if(p)liveAnswer.current?.restoreDrag(item.name,p);}restoredDrags.current.names=Object.keys(dragPositions??{});board.current?.fullUpdate?.();},[status,specKey,JSON.stringify(dragPositions)]);
    useEffect(() => {
      if (status !== 'ready' || !liveAnswer.current) return;
      const point = answer?.point;
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        if (marker.current) { board.current?.removeObject(marker.current); marker.current = null; }
        if (answer?.mode === 'drag') liveAnswer.current.resetDrag(spec.ask?.target);
        board.current?.fullUpdate?.();
        return;
      }
      if (answer.mode === 'point') liveAnswer.current.place(point);
      else if (answer.mode === 'drag') liveAnswer.current.drags.get(spec.ask?.target)?.moveTo([point.x, point.y]);
      board.current?.fullUpdate?.();
    }, [status, answer?.mode, answer?.point?.x, answer?.point?.y, specKey]);
    return h('div', { className: 'nv-block-figure', 'data-status': status },
      h('div', { ref: host, className: 'nv-block-figure-board', role: 'img', 'aria-label': spec.ask?.prompt ?? '图' }),
      invalid&&h('div',{className:'nv-block-figure-note',role:'status'},`当前构形无法确定 ${invalid}，请调整点的位置。`),
      status === 'loading' && h('div', { className: 'nv-block-figure-note' }, '正在准备作图…'),
      status === 'failed' && h('div', { className: 'nv-block-figure-note', role: 'status' }, '作图工具暂时没有加载出来，请刷新页面再试。'));
  }

export function SpaceFigureCanvas({ spec, values, snapshotKey,navigationActive=false,camera:initialCamera,onCamera,onReady }) {
    const host = useRef(null), gesture = useRef(null);
    const [camera, setCamera] = useState(initialCamera??{ yaw: -.72, pitch: .52, zoom: 1 });
    const cameraRef=useRef(camera),cameraCallback=useRef(onCamera);cameraCallback.current=onCamera;
    const commitCamera=value=>{const next=typeof value==='function'?value(cameraRef.current):value;cameraRef.current=next;setCamera(next);cameraCallback.current?.(next,{initial:false});};
    useEffect(()=>{const next=initialCamera??{yaw:-.72,pitch:.52,zoom:1};if(JSON.stringify(next)!==JSON.stringify(cameraRef.current)){cameraRef.current=next;setCamera(next);}},[JSON.stringify(initialCamera)]);
    useEffect(()=>{onReady?.();},[]);
    const scene = useMemo(() => {
      const scope = { ...values }, names = Object.keys(scope);
      const numberValue = source => Number(compileExpression(String(source), names).evaluate(scope));
      const pointValue = item => [numberValue(item.x), numberValue(item.y), numberValue(item.z)];
      const points = new Map(spec.objects.filter(item => item.kind === 'point').map(item => [item.name, pointValue(item)]));
      for (const item of spec.objects) if (item.kind === 'midpoint') {
        const a = points.get(item.points[0]), b = points.get(item.points[1]);
        if (a && b) points.set(item.name, a.map((value, index) => (value + b[index]) / 2));
      }
      return { box: figureBounds(spec), points, numberValue, objects: spec.objects };
    }, [spec, JSON.stringify(values)]);
    const box = scene.box, extent = Math.max(box.xmax - box.xmin, box.ymax - box.ymin, box.zmax - box.zmin, 1), baseScale = 260 / extent;
    const project = point => {
      const center = [(box.xmin + box.xmax) / 2, (box.ymin + box.ymax) / 2, (box.zmin + box.zmax) / 2];
      const [x, y, z] = point.map((value, index) => value - center[index]), cy = Math.cos(camera.yaw), sy = Math.sin(camera.yaw), cp = Math.cos(camera.pitch), sp = Math.sin(camera.pitch);
      const rx = x * cy - y * sy, ry0 = x * sy + y * cy, ry = ry0 * cp - z * sp, depth = ry0 * sp + z * cp, scale = baseScale * camera.zoom;
      return [380 + rx * scale, 260 - ry * scale, depth];
    };
    const coord = point => project(point).slice(0, 2).map(value => value.toFixed(1)).join(',');
    const edge = (a, b, key, extra = {}) => a && b && h('line', { key, x1: project(a)[0], y1: project(a)[1], x2: project(b)[0], y2: project(b)[1], className: 'nv-block-space-edge', ...extra });
    const polygon = (items, key, extra = {}) => items.length >= 3 && h('polygon', { key, points: items.map(coord).join(' '), className: 'nv-block-space-face', ...extra });
    const label = (text, point, key) => { if (!point) return null; const [x, y] = project(point); return h('text', { key, x: x + 7, y: y - 7, className: 'nv-block-space-label' }, text); };
    const add = (a, b) => a.map((value, index) => value + b[index]);
    const scale = (a, value) => a.map(item => item * value);
    const sub = (a, b) => a.map((value, index) => value - b[index]);
    const norm = a => Math.hypot(...a) || 1;
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const ring = (center, axis, radius, distance) => {
      const unit = scale(axis, 1 / norm(axis)), reference = Math.abs(unit[2]) > .9 ? [1, 0, 0] : [0, 0, 1], u = scale(cross(unit, reference), 1 / norm(cross(unit, reference))), v = cross(unit, u);
      return Array.from({ length: 12 }, (_, index) => {
        const theta = index * Math.PI / 6;
        return add(add(center, scale(unit, distance)), scale(add(scale(u, Math.cos(theta)), scale(v, Math.sin(theta))), radius));
      });
    };
    const objectNodes = scene.objects.map((item, index) => {
      const key = `${item.kind}-${item.name ?? index}`;
      if (item.kind === 'point') { const point = scene.points.get(item.name), [x, y] = point ? project(point) : []; return point ? h(React.Fragment, { key }, h('circle', { cx: x, cy: y, r: 4, className: 'nv-block-space-point' }), label(item.name, point, `${key}-label`)) : null; }
      if (item.kind === 'text') return label(item.content, [scene.numberValue(item.x), scene.numberValue(item.y), scene.numberValue(item.z)], key);
      if (item.kind === 'vector' || item.kind === 'arrow') { const from = scene.points.get(item.from), delta = [scene.numberValue(item.dx), scene.numberValue(item.dy), scene.numberValue(item.dz)], to = from && add(from, delta); return from && to ? h(React.Fragment, { key }, edge(from, to, `${key}-edge`, { className: 'nv-block-space-vector' }), label(item.label, to, `${key}-label`)) : null; }
      if (item.kind === 'segment' || item.kind === 'line') { const [a, b] = item.points.map(name => scene.points.get(name)); if (!a || !b) return null; const vector = sub(b, a), from = item.kind === 'line' ? sub(a, scale(vector, 1.5)) : a, to = item.kind === 'line' ? add(b, scale(vector, 1.5)) : b; return edge(from, to, key); }
      if (item.kind === 'plane' || item.kind === 'polygon') return polygon(item.points.map(name => scene.points.get(name)).filter(Boolean), key);
      if (item.kind === 'cuboid') {
        const p = item.points.map(name => scene.points.get(name)), faces = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]], edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
        return h(React.Fragment, { key }, faces.map((face, n) => polygon(face.map(i => p[i]).filter(Boolean), `${key}-face-${n}`)), edges.map(([a, b], n) => edge(p[a], p[b], `${key}-edge-${n}`)), label(item.name, p[6], `${key}-label`));
      }
      if (item.kind === 'tetrahedron') { const p = item.points.map(name => scene.points.get(name)), edges = []; for (let a = 0; a < p.length; a++) for (let b = a + 1; b < p.length; b++) edges.push(edge(p[a], p[b], `${key}-${a}-${b}`)); return h(React.Fragment, { key }, edges, label(item.name, p[3], `${key}-label`)); }
      if (item.kind === 'prism') { const base = item.points.map(name => scene.points.get(name)), delta = [scene.numberValue(item.dx), scene.numberValue(item.dy), scene.numberValue(item.dz)], top = base.map(point => add(point, delta)); return h(React.Fragment, { key }, polygon(base, `${key}-base`), polygon(top, `${key}-top`), base.map((point, n) => edge(point, top[n], `${key}-vertical-${n}`)), base.map((point, n) => edge(point, base[(n + 1) % base.length], `${key}-base-${n}`)), top.map((point, n) => edge(point, top[(n + 1) % top.length], `${key}-top-${n}`)), label(item.name, top[0], `${key}-label`)); }
      if (item.kind === 'pyramid') { const base = item.points.map(name => scene.points.get(name)), apex = scene.points.get(item.apex); return h(React.Fragment, { key }, polygon(base, `${key}-base`), base.map((point, n) => edge(point, apex, `${key}-side-${n}`)), base.map((point, n) => edge(point, base[(n + 1) % base.length], `${key}-base-${n}`)), label(item.name, apex, `${key}-label`)); }
      if (['sphere', 'cylinder', 'cone', 'frustum'].includes(item.kind)) {
        const center = scene.points.get(item.center), radius = scene.numberValue(item.radius); if (!center || !Number.isFinite(radius)) return null;
        if (item.kind === 'sphere') { const [x, y] = project(center), r = Math.abs(radius * baseScale * camera.zoom); return h(React.Fragment, { key }, h('ellipse', { cx: x, cy: y, rx: r, ry: r * .58, className: 'nv-block-space-surface' }), h('ellipse', { cx: x, cy: y, rx: r * .58, ry: r, className: 'nv-block-space-surface nv-block-space-dashed' }), label(item.name, center, `${key}-label`)); }
        const axis = [scene.numberValue(item.dx), scene.numberValue(item.dy), scene.numberValue(item.dz)], height = scene.numberValue(item.height), bottom = ring(center, axis, radius, item.kind === 'cone' ? height : 0), topRadius = item.kind === 'frustum' ? scene.numberValue(item.top) : item.kind === 'cone' ? 0 : radius, top = ring(center, axis, topRadius, height), parts = [polygon(bottom, `${key}-bottom`), polygon(top, `${key}-top`)]; for (let n = 0; n < bottom.length; n++) parts.push(edge(bottom[n], top[n], `${key}-side-${n}`)); parts.push(label(item.name, item.kind === 'cone' ? center : top[0], `${key}-label`)); return h(React.Fragment, { key }, parts);
      }
      return null;
    });
    const grid = [];
    const ticks = (from, to) => { const start = Math.ceil(from), end = Math.floor(to), step = Math.max(1, Math.ceil((end - start + 1) / 16)); return Array.from({ length: Math.max(0, Math.floor((end - start) / step) + 1) }, (_, n) => start + n * step); };
    for (const x of ticks(box.xmin, box.xmax)) grid.push(edge([x, box.ymin, 0], [x, box.ymax, 0], `grid-x-${x}`, { className: 'nv-block-space-grid' }));
    for (const y of ticks(box.ymin, box.ymax)) grid.push(edge([box.xmin, y, 0], [box.xmax, y, 0], `grid-y-${y}`, { className: 'nv-block-space-grid' }));
    grid.push(edge([box.xmin, 0, 0], [box.xmax, 0, 0], 'axis-x', { className: 'nv-block-space-axis' }), edge([0, box.ymin, 0], [0, box.ymax, 0], 'axis-y', { className: 'nv-block-space-axis' }), edge([0, 0, box.zmin], [0, 0, box.zmax], 'axis-z', { className: 'nv-block-space-axis' }));
    const pointerUp = event => {const g=gesture.current;if(!g||event?.pointerId!=null&&event.pointerId!==g.pointerId)return;gesture.current=null;if(host.current?.hasPointerCapture(g.pointerId))host.current.releasePointerCapture(g.pointerId);};
    const pointerDown = event => {if(!navigationActive||event.button!==0)return;event.preventDefault();event.stopPropagation();event.currentTarget.setPointerCapture?.(event.pointerId); gesture.current = {pointerId:event.pointerId,x: event.clientX, y: event.clientY, yaw: camera.yaw, pitch: camera.pitch }; };
    const pointerMove = event => {const g=gesture.current;if(!g||event.pointerId!==g.pointerId)return;if(!(event.buttons&1)){pointerUp(event);return;}event.stopPropagation();commitCamera(previous=>({ ...previous, yaw:g.yaw + (event.clientX - g.x) * .01, pitch: Math.max(-1.35, Math.min(1.35,g.pitch + (event.clientY - g.y) * .01)) })); };
    useEffect(()=>{
      const element=host.current;if(!navigationActive)return;
      const wheel=event=>{event.preventDefault();event.stopPropagation();commitCamera(previous=>{return {...previous,zoom:Math.min(3,Math.max(.35,previous.zoom*Math.exp(-event.deltaY*.002)))};});};
      const blur=()=>pointerUp();
      // Pointer capture does not move keyboard focus into the SVG. Cancel the
      // active drag before Escape can exit an editor or act on a focused tool.
      const keydown=event=>{if(event.key==='Escape'&&gesture.current){event.preventDefault();event.stopPropagation();pointerUp();}};
      element.addEventListener('wheel',wheel,{passive:false});window.addEventListener('blur',blur);window.addEventListener('keydown',keydown,true);
      return()=>{pointerUp();element.removeEventListener('wheel',wheel);window.removeEventListener('blur',blur);window.removeEventListener('keydown',keydown,true);};
    },[navigationActive]);
    useEffect(() => { if (!snapshotKey) return undefined; const snapshot = () => { const svg = host.current?.querySelector('svg'); return svg ? cleanSvg(svg.outerHTML) : ''; }; figureSnapshots.set(snapshotKey, snapshot); return () => { if (figureSnapshots.get(snapshotKey) === snapshot) figureSnapshots.delete(snapshotKey); }; }, [snapshotKey]);
    return h('div', { className: 'nv-block-space-figure' }, h('svg', { ref: host, className: 'nv-block-space-svg', viewBox: '0 0 760 520', role: 'img', 'aria-label': '空间直角坐标系',onPointerDown: pointerDown, onPointerMove: pointerMove, onPointerUp: pointerUp, onPointerCancel: pointerUp,onLostPointerCapture:pointerUp,onKeyDown:event=>{if(event.key==='Escape'&&gesture.current){event.preventDefault();event.stopPropagation();pointerUp();}} }, grid, objectNodes), h('div', { className: 'nv-block-space-controls' },navigationActive?h('button', { type: 'button', onClick: () => commitCamera({ yaw: -.72, pitch: .52, zoom: 1 }) }, '重置视角'):null, h('span', null,navigationActive?'拖动旋转 · 滚轮缩放':'进入编辑后可旋转与缩放')));
  }
