import React, { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {Menu} from '@deepseek-ai/dsh-client-ui-primitives';
import { ReactFlow, ReactFlowProvider, Background, Controls, Handle, Position, NodeResizer, addEdge, applyNodeChanges, applyEdgeChanges, useReactFlow, useNodesInitialized } from '@xyflow/react';
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { temporal } from 'zundo';
import { parseCanvasDocument } from '@oh-my-student/plugin-vault-sqlite/drawing-files';
import { growCanvasBlock, settleCanvas } from '@oh-my-student/plugin-vault-sqlite/canvas-flow';
import { canvasToFlow, flowToCanvas, duplicateCanvasSelection, canvasColor, checkedCanvasChange } from './canvas-model.js';
import { CodeMirrorEditor } from './markdown-editor.jsx';
import { FilePreview } from './file-preview.jsx';
import { DocumentSaveBar, useDocumentDraft, saveShortcut } from './document-draft.jsx';
import { callVault } from './logic.js';
import {CanvasFilePicker} from './canvas-file-picker.jsx';
import {InteractiveBlocks,createAnswerStore} from '@oh-my-student/plugin-graph-and-blocks/blocks';
import {canvasFigures,canvasFigureState,updateCanvasFigureNode} from '@oh-my-student/plugin-graph-and-blocks/figure-state';
import flowStyles from '@xyflow/react/dist/style.css';

const CanvasContext = createContext(null);
const sides = [['top', Position.Top], ['right', Position.Right], ['bottom', Position.Bottom], ['left', Position.Left]];
function CanvasTextContent({node,host}){
  const store=useMemo(()=>createAnswerStore(),[host.workspaceId,host.path,node.id]);
  if(!canvasFigures(node.text).length)return host.renderContent(node.text||'',node.id);
  return <InteractiveBlocks source={node.text} scope={JSON.stringify([host.workspaceId,host.path,node.id])} store={store} preview figureState={canvasFigureState(node)} onFigureState={(key,patch)=>host.updateFigure(node.id,node.text,key,patch)} renderMarkdown={text=>host.renderContent(text,node.id)}/>;
}
const CanvasNode = memo(function CanvasNode({ id, data, selected }) {
  const host = useContext(CanvasContext), node = data.source;
  const bodyElement=useRef(null);
  useEffect(()=>{
    const element=bodyElement.current;
    if(!element||!node.notaraFlow?.autoHeight||node.notaraFlow.pinned)return;
    const measure=()=>{if(element.offsetWidth)host.measure(id,element.offsetHeight+62);};
    const observer=new ResizeObserver(measure);observer.observe(element);measure();return()=>observer.disconnect();
  },[id,node.text,node.width,node.notaraFlow?.autoHeight,node.notaraFlow?.pinned,host.measure]);
  return <div className={`nv-flow-node nv-flow-${node.type}`} style={{ '--nv-node-color': canvasColor(node.color) }}>
    <NodeResizer isVisible={selected} minWidth={160} minHeight={100} />
    <div className="nv-flow-node-header" onDoubleClick={() => host.edit(node)}><span>{node.type === 'text' ? (node.text?.split('\n')[0]?.replace(/^#+\s*/, '').slice(0, 60) || '文本') : node.file?.split('/').at(-1) || node.label || node.url || '分组'}</span>{selected && <button className="nodrag nopan" onClick={() => host.edit(node)} aria-label="编辑节点">✎</button>}</div>
    {node.type !== 'group' && <div className="nv-flow-node-content nodrag nopan nowheel" onDoubleClick={event => { if (!event.target.closest('input,textarea,button,a')) host.edit(node); }}>
      <div ref={bodyElement} className="nv-flow-node-body">{node.type === 'text' ? <CanvasTextContent node={node} host={host}/> : node.type === 'file' ? <><FilePreview remote={host.remote} locator={{ path: node.file, subpath: node.subpath }} renderContent={host.renderContent} onOpen={host.onOpen} /><button className="nv-flow-open" onClick={() => host.onOpen({ path: node.file, subpath: node.subpath })}>打开原文件 ↗</button></> : node.type === 'link' ? <a href={/^https?:\/\//.test(node.url || '') ? node.url : undefined} target="_blank" rel="noopener noreferrer">{node.url}</a> : <p>此节点类型暂不支持编辑</p>}</div>
    </div>}
    {sides.map(([side, position]) => <Handle key={side} id={side} type="source" position={position} />)}
  </div>;
});
const nodeTypes = { material: CanvasNode };

function CanvasSurface({ content, onChange, remote, onOpen, renderContent, workspaceId, record,onSave,renderWhiteboardStatus }) {
  const initial = useMemo(() => parseCanvasDocument(content), []);
  const history = useMemo(() => createStore(temporal(set => ({ doc: initial, commit: doc => set({ doc }) }), { partialize: state => ({ doc: state.doc }), limit: 60 })), []);
  const doc = useStore(history, state => state.doc), api = useReactFlow();
  const initialized = useNodesInitialized(), hostElement = useRef(null), fitted = useRef(false);
  const [nodes, setNodes] = useState(() => canvasToFlow(initial).nodes), [edges, setEdges] = useState(() => canvasToFlow(initial).edges);
  const [editing, setEditing] = useState(null), [value, setValue] = useState(''), [files, setFiles] = useState(null), [error, setError] = useState('');
  const [toolsMenu,setToolsMenu]=useState(false);
  const [mode,setMode]=useState('pan'),[connectFrom,setConnectFrom]=useState(null);
  const [preview,setPreview]=useState(false),[follow,setFollow]=useState(true),[pending,setPending]=useState(null);
  const editingTouched=useRef(false);
  const layoutChange=useRef(false),measurements=useRef(new Map()),measureFrame=useRef(0);
  const current = useRef({ nodes, edges }), published = useRef(content), initialContent = useRef(content), clipboard = useRef(null), external = useRef(false), groupMembers = useRef(null);
  current.current = { nodes, edges };
  useEffect(() => {
    if (!initialized || fitted.current || !hostElement.current) return;
    let frame;
    const fit = () => {
      if (fitted.current || !hostElement.current?.offsetWidth || !hostElement.current?.offsetHeight) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { if (!hostElement.current?.offsetWidth || !hostElement.current?.offsetHeight) return; fitted.current = true; void api.fitView({ padding: .15, maxZoom: 1 }); });
    };
    const observer = new ResizeObserver(fit); observer.observe(hostElement.current); fit();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [initialized, api]);
  useEffect(() => history.subscribe((state, previous) => {
    if (external.current || state.doc === previous.doc) return;
    const serialized = state.doc === initial ? initialContent.current : JSON.stringify(state.doc, null, 2) + '\n';
    published.current = serialized; onChange(serialized,{layout:layoutChange.current});
  }), [history, onChange]);
  useEffect(() => {
    if (content === published.current) return;
    try { external.current = true; history.temporal.getState().pause();
      const next=parseCanvasDocument(content),before=history.getState().doc;
      const changed=next.nodes.filter(n=>n.notaraFlow&&(!before.nodes.some(b=>b.id===n.id)||before.nodes.find(b=>b.id===n.id)?.text!==n.text));
      if(changed.length)setPending(changed.at(-1).id);
      history.getState().commit(next); published.current = content; history.temporal.getState().clear(); }
    finally { external.current = false; history.temporal.getState().resume(); }
  }, [content]);
  useEffect(() => {
    const next = canvasToFlow(doc), selected = new Set(current.current.nodes.filter(n => n.selected).map(n => n.id));
    setNodes(next.nodes.map(node => ({ ...node, selected: selected.has(node.id) }))); setEdges(next.edges);
  }, [doc]);
  const commitDocument = (next,{layout=false}={}) => { try { layoutChange.current=layout;if(layout)history.temporal.getState().pause();history.getState().commit(checkedCanvasChange(next)); setError(''); } catch (error) { setError(error.message.includes('此次修改未应用') ? error.message : '无法应用这次修改，原白板已保留。'); }finally{layoutChange.current=false;if(layout)history.temporal.getState().resume();} };
  const commitRef=useRef(commitDocument);commitRef.current=commitDocument;
  const updateFigure=(id,source,key,patch)=>{const currentDoc=history.getState().doc,node=currentDoc.nodes.find(n=>n.id===id);if(!node||node.text!==source)return;try{const next=updateCanvasFigureNode(node,key,patch);if(next!==node)commitDocument({...currentDoc,nodes:currentDoc.nodes.map(n=>n.id===id?next:n)});}catch{setError('图形定义已变化，请重新打开该节点。');}};
  const measure=useCallback((id,height)=>{
    measurements.current.set(id,height);if(measureFrame.current)return;
    measureFrame.current=requestAnimationFrame(()=>{measureFrame.current=0;let next=history.getState().doc;for(const [id,height] of measurements.current)next=growCanvasBlock(next,id,height);measurements.current.clear();if(next!==history.getState().doc)commitRef.current(next,{layout:true});});
  },[history]);
  useEffect(()=>()=>cancelAnimationFrame(measureFrame.current),[]);
  useEffect(()=>{
    if(!follow||editing||!pending||!initialized||!nodes.some(n=>n.id===pending)||!hostElement.current?.offsetWidth)return;
    const frame=requestAnimationFrame(()=>{
      const node=api.getNode(pending);if(!node)return;
      const zoom=Math.max(.1,Math.min(1,(hostElement.current.clientWidth-48)/(node.width||480)));
      void api.setViewport({x:24-node.position.x*zoom,y:24-node.position.y*zoom,zoom},{duration:0});setPending(null);
    });return()=>cancelAnimationFrame(frame);
  },[pending,follow,editing,initialized,nodes,api]);
  const commit = (nextNodes = current.current.nodes, nextEdges = current.current.edges) => commitDocument(flowToCanvas(history.getState().doc, nextNodes, nextEdges));
  const add = source => {
    const rect=hostElement.current.getBoundingClientRect(),point = api.screenToFlowPosition({ x: rect.x+rect.width/2, y: rect.y+rect.height/2 }),id=crypto.randomUUID();
    setFollow(false);commitDocument(settleCanvas({ ...doc, nodes: [...doc.nodes, { id, x: Math.round(point.x), y: Math.round(point.y), width: 360, height: 260, ...source }] },[id]));
  };
  const edit = node => { if (node.type === 'file') { onOpen({ path: node.file, subpath: node.subpath }); return; } editingTouched.current=false;setFollow(false);setPreview(false);setEditing(node); setValue(node.text ?? node.label ?? node.url ?? ''); };
  useEffect(()=>{
    if(!editing||editingTouched.current)return;
    const latest=doc.nodes.find(n=>n.id===editing.id);if(!latest){setEditing(null);return;}
    const key=editing.type==='text'?'text':editing.type==='link'?'url':'label';
    if(latest[key]!==editing[key]){setEditing(latest);setValue(latest[key]??'');}
  },[doc,editing]);
  const changeNode = value => { editingTouched.current=true;setValue(value); const currentDoc = history.getState().doc, key = editing.type === 'text' ? 'text' : editing.type === 'link' ? 'url' : 'label'; commitDocument({ ...currentDoc, nodes: currentDoc.nodes.map(n => n.id === editing.id ? { ...n, [key]: value } : n) }); };
  const cancelNode = () => { const currentDoc = history.getState().doc,key=editing.type==='text'?'text':editing.type==='link'?'url':'label'; if(editingTouched.current&&currentDoc.nodes.find(n=>n.id===editing.id)?.[key]===value)commitDocument({ ...currentDoc, nodes: currentDoc.nodes.map(n => n.id === editing.id ? {...n,[key]:editing[key]} : n) }); setEditing(null); };
  const selectedIds = () => current.current.nodes.filter(n => n.selected).map(n => n.id);
  const remove = () => { const ids = new Set(selectedIds()), edgeIds = new Set(current.current.edges.filter(e => e.selected).map(e => e.id)); if (!ids.size && !edgeIds.size) return; commitDocument({ ...doc, nodes: doc.nodes.filter(n => !ids.has(n.id)), edges: doc.edges.filter(e => !ids.has(e.fromNode) && !ids.has(e.toNode) && !edgeIds.has(e.id)) }); };
  const copy = () => { const ids = new Set(selectedIds()); clipboard.current = { nodes: doc.nodes.filter(n => ids.has(n.id)), edges: doc.edges.filter(e => ids.has(e.fromNode) && ids.has(e.toNode)) }; };
  const paste = () => { if (!clipboard.current?.nodes.length) return; const expanded = duplicateCanvasSelection(clipboard.current, clipboard.current.nodes.map(n => n.id));const added=expanded.nodes.slice(clipboard.current.nodes.length).map(n=>({...n,...(n.notaraFlow?{notaraFlow:{...n.notaraFlow,pinned:true,autoHeight:false}}:{})}));setFollow(false);commitDocument(settleCanvas({ ...doc, nodes: [...doc.nodes, ...added], edges: [...doc.edges, ...expanded.edges.slice(clipboard.current.edges.length)] },added.map(n=>n.id))); };
  const group = () => { const chosen = doc.nodes.filter(n => selectedIds().includes(n.id)); if (!chosen.length) return; const x = Math.min(...chosen.map(n => n.x)) - 24, y = Math.min(...chosen.map(n => n.y)) - 44; commitDocument({ ...doc, nodes: [{ id: crypto.randomUUID(), type: 'group', label: '分组', x, y, width: Math.max(...chosen.map(n => n.x + n.width)) - x + 24, height: Math.max(...chosen.map(n => n.y + n.height)) - y + 24 }, ...doc.nodes] }); };
  const keyDown = event => {
    if (event.target.closest('input,textarea,[contenteditable="true"]')) return;
    if(event.key==='Escape'){setMode('pan');setConnectFrom(null);return;}
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); remove(); return; }
    const mod = event.ctrlKey || event.metaKey;
    if (mod && ['z', 'y', 'c', 'v'].includes(event.key.toLowerCase())) { event.preventDefault(); event.stopPropagation(); const key = event.key.toLowerCase(); if (key === 'z') history.temporal.getState()[event.shiftKey ? 'redo' : 'undo'](); else if (key === 'y') history.temporal.getState().redo(); else if (key === 'c') copy(); else paste(); }
  };
  const drop = event => { event.preventDefault(); try { const file = JSON.parse(event.dataTransfer.getData('application/x-notara-file')); if (file.workspaceId !== workspaceId) { setError('请拖入当前工作区的文件'); return; } const pos = api.screenToFlowPosition({ x: event.clientX, y: event.clientY }); add({ type: 'file', file: file.path, ...pos }); } catch { /* Ignore unrelated drops. */ } };
  const changeNodes = changes => {
    const previous = current.current.nodes;
    let next = applyNodeChanges(changes, previous);
    const manualIds=new Set(changes.filter(c=>c.type==='position'&&c.dragging!==undefined||c.type==='dimensions'&&c.resizing!==undefined).map(c=>c.id));
    if(manualIds.size){setFollow(false);next=next.map(n=>manualIds.has(n.id)&&n.data.source.notaraFlow?{...n,data:{...n.data,source:{...n.data.source,notaraFlow:{...n.data.source.notaraFlow,pinned:true,autoHeight:false}}}}:n);}
    const group = groupMembers.current;
    if (group) {
      const move = changes.find(c => c.type === 'position' && c.id === group.id && c.position);
      const before = previous.find(n => n.id === group.id);
      if (move && before) { const dx = move.position.x - before.position.x, dy = move.position.y - before.position.y; next = next.map(n => group.ids.has(n.id) && !changes.some(c => c.type === 'position' && c.id === n.id) ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy },data:{...n.data,source:{...n.data.source,...(n.data.source.notaraFlow?{notaraFlow:{...n.data.source.notaraFlow,pinned:true,autoHeight:false}}:{})}} } : n); }
    }
    current.current.nodes = next; setNodes(next);
    if (changes.some(c => c.type === 'remove' || c.type === 'dimensions' && c.resizing === false || c.type === 'position' && c.dragging === false)) commit(next);
  };
  return <CanvasContext.Provider value={{ edit, remote, onOpen, renderContent,measure,workspaceId,path:record.path,updateFigure,zoom:()=>api.getZoom() }}><div className="nv-flow-editor" onKeyDown={keyDown}>
    <div className="nv-canvas-tools" role="toolbar" aria-label="白板工具">
      <button aria-label="框选" title="框选：在空白处拖动；按 Shift 可临时框选" aria-pressed={mode==='select'} onClick={()=>{setMode(mode==='select'?'pan':'select');setConnectFrom(null);setFollow(false);}}>□<span className="nv-canvas-tool-label">框选</span></button>
      <button aria-label="连线" title="连线：依次点击两个块，或拖动连接点" aria-pressed={mode==='connect'} onClick={()=>{setMode(mode==='connect'?'pan':'connect');setConnectFrom(null);setFollow(false);setNodes(previous=>previous.map(n=>({...n,selected:false})));setEdges(previous=>previous.map(e=>({...e,selected:false})));}}>↗<span className="nv-canvas-tool-label">连线</span></button>
      <button aria-label="添加文本" title="添加文本" onClick={()=>add({type:'text',text:'新文本'})}><span aria-hidden="true">T</span><span className="nv-canvas-tool-label">添加文本</span></button>
      <button aria-label="添加文件" title="添加文件" onClick={async()=>{try{const result=await callVault(remote,'query',{view:'table',limit:10000});setFiles(result.documents);}catch{setError('无法读取文件列表');}}}><span aria-hidden="true">＋</span><span className="nv-canvas-tool-label">添加文件</span></button>
      <button aria-label="撤销" title="撤销" onClick={()=>history.temporal.getState().undo()}><span aria-hidden="true">↶</span><span className="nv-canvas-tool-label">撤销</span></button>
      <button aria-label="重做" title="重做" onClick={()=>history.temporal.getState().redo()}><span aria-hidden="true">↷</span><span className="nv-canvas-tool-label">重做</span></button>
      <button aria-label="适应画布" title="适应画布" onClick={()=>{setFollow(false);void api.fitView({padding:.15,duration:0});}}><svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M3 7V3h4m6 0h4v4m0 6v4h-4M7 17H3v-4"/></svg><span className="nv-canvas-tool-label">适应画布</span></button>
      <button className="nv-canvas-follow" aria-label="跟随讲解" title="跟随讲解" aria-pressed={follow} onClick={()=>setFollow(value=>!value)}>◎<span className="nv-canvas-tool-label">跟随讲解</span></button>
      {pending&&!follow&&<button aria-label="查看新板书" title="查看新板书" onClick={()=>setFollow(true)}>↓<span className="nv-canvas-tool-label">新板书</span></button>}
      <Menu portal compact align="end" open={toolsMenu} onClose={()=>setToolsMenu(false)} items={[
        ...(renderWhiteboardStatus?[{id:'teaching-state',disabled:true,label:toolsMenu&&renderWhiteboardStatus({workspaceId,path:record.path})},{id:'teaching-separator',type:'separator'}]:[]),
        {id:'group',label:'分组'},{id:'copy',label:'复制'},{id:'paste',label:'粘贴'},{id:'delete',label:'删除所选'},{id:'follow',label:follow?'暂停跟随讲解':'跟随讲解'}
      ]} onSelect={id=>{setToolsMenu(false);({group,copy,paste,delete:remove,follow:()=>setFollow(v=>!v)})[id]?.();}} anchor={<button aria-label="更多白板工具" title="更多白板工具" aria-haspopup="menu" aria-expanded={toolsMenu} onClick={()=>setToolsMenu(value=>!value)}>⋯</button>}/>
    </div>
    {error && <p role="status">{error}</p>}
    <div ref={hostElement} className={`nv-flow-host nv-flow-mode-${mode}`} onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }} onDrop={drop}>
      {mode!=='pan'&&<span className="nv-flow-mode-hint">{mode==='select'?'拖动空白处框选；Esc 返回移动':connectFrom?'点击终点块；Esc 取消':'依次点击起点和终点，或拖动连接点'}</span>}
      <ReactFlow nodes={nodes.map(n=>({...n,className:n.id===connectFrom?'nv-flow-connection-source':undefined}))} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ maxZoom: 1, padding: .15 }} minZoom={.1} maxZoom={2.5} panOnScroll zoomOnScroll={false} zoomOnPinch panOnDrag={mode==='select'?[1,2]:mode==='pan'} selectionOnDrag={mode==='select'} nodesDraggable={mode!=='connect'} selectionMode="partial" selectionKeyCode="Shift" multiSelectionKeyCode={['Shift','Meta','Control']} connectionMode="loose" nodeDragThreshold={4} deleteKeyCode={null}
        onNodesChange={changeNodes} onMoveStart={event=>{if(event)setFollow(false);}}
        onNodeClick={(event,node)=>{if(mode!=='connect'||event.target.closest('button,input,textarea,a,[contenteditable],.react-flow__handle'))return;if(!connectFrom){setConnectFrom(node.id);return;}if(connectFrom===node.id){setConnectFrom(null);return;}const source=current.current.nodes.find(n=>n.id===connectFrom);if(!source){setConnectFrom(null);return;}const horizontal=Math.abs(node.position.x-source.position.x)>Math.abs(node.position.y-source.position.y),positive=horizontal?node.position.x>source.position.x:node.position.y>source.position.y;const sourceHandle=horizontal?(positive?'right':'left'):(positive?'bottom':'top'),targetHandle=horizontal?(positive?'left':'right'):(positive?'top':'bottom');commit(undefined,addEdge({id:crypto.randomUUID(),source:connectFrom,target:node.id,sourceHandle,targetHandle,type:'smoothstep'},current.current.edges));setConnectFrom(null);}}
        onNodeDragStart={(_, node) => { if (node.data.source.type !== 'group') return; const p = node.position; groupMembers.current = { id: node.id, ids: new Set(current.current.nodes.filter(n => n.id !== node.id && n.position.x >= p.x && n.position.y >= p.y && n.position.x + n.width <= p.x + node.width && n.position.y + n.height <= p.y + node.height).map(n => n.id)) }; }}
        onNodeDragStop={() => { groupMembers.current = null; }}
        onEdgesChange={changes => { const next = applyEdgeChanges(changes, current.current.edges); current.current.edges = next; setEdges(next); if (changes.some(c => c.type === 'remove')) commit(undefined, next); }}
        onConnect={connection => { const next = addEdge({ ...connection, id: crypto.randomUUID(), type: 'smoothstep' }, current.current.edges); commit(undefined, next); }}
        onNodeDoubleClick={(_, node) => edit(node.data.source)}
        onEdgeDoubleClick={(_, edge) => { const label = prompt('连线文字', edge.label || ''); if (label !== null) commit(undefined, current.current.edges.map(e => e.id === edge.id ? { ...e, label, data: { source: { ...e.data?.source, label } } } : e)); }}>
        <Background gap={24} size={1} /><Controls showInteractive={false} />
      </ReactFlow>
    </div>
    {editing && <div className="nv-node-editor" role="dialog" aria-label="编辑白板节点"><header><strong>编辑{editing.type === 'text' ? '文本' : '节点'}</strong><button aria-label={preview?'切换源码':'切换预览'} title={preview?'切换源码':'切换预览'} onClick={()=>setPreview(value=>!value)}>{preview?'源码':'预览'}</button><button onClick={() => setEditing(null)}>完成</button><button onClick={cancelNode}>取消修改</button></header><div className="nv-node-editor-body nv-node-editor-single"><div hidden={preview}><CodeMirrorEditor value={value} onChange={changeNode} onSave={onSave} /></div>{preview&&<div className="nv-node-preview" aria-label="节点内容预览">{renderContent(value, `editing:${editing.id}`)}</div>}</div></div>}
    {files&&<CanvasFilePicker files={files} remote={remote} workspaceId={workspaceId} onClose={()=>setFiles(null)} onPick={file=>add({type:'file',file:file.path,...(file.subpath?{subpath:file.subpath,width:480,height:420}:{})})}/>}
  </div></CanvasContext.Provider>;
}

export function CanvasEditor(props) {
  const { state, draft, dirty, save, recover, saveToast } = useDocumentDraft(props);
  const element=useRef(null),[syncError,setSyncError]=useState(false);
  const change=useCallback((text,{layout=false}={})=>{
    draft.edit(text,{layout});
  },[draft]);
  useEffect(()=>{if(state.layoutOnly&&dirty&&!state.saving&&!state.conflict&&!state.message?.startsWith('保存失败'))void save({quiet:true});},[state.text,state.saving,state.baseRevision,state.conflict,state.layoutOnly]);
  useEffect(()=>{
    let stopped=false,timer;
    const poll=async()=>{
      try{if(element.current?.offsetWidth&&document.visibilityState!=='hidden'&&!draft.getSnapshot().saving){const generation=draft.getSnapshot().generation;const record=await callVault(props.remote,'read',{path:props.record.path});if(!stopped){draft.receive(record,generation);setSyncError(false);}}}
      catch{if(!stopped)setSyncError(true);}
      finally{if(!stopped)timer=setTimeout(poll,1500);}
    };
    void poll();return()=>{stopped=true;clearTimeout(timer);};
  },[draft,props.remote,props.record.path,props.workspaceId]);
  let valid = true; try { parseCanvasDocument(state.text); } catch { valid = false; }
  return <section ref={element} className="nv-canvas-editor" aria-label="白板编辑器" onKeyDown={event => saveShortcut(event, save)}><style data-plugin="@oh-my-student/plugin-vault-views">{flowStyles}</style><DocumentSaveBar {...{ state, dirty, save, recover }} record={props.record} header={props.documentHeader}/>{saveToast}{syncError&&<p role="status">板书同步暂时不可用，当前内容已保留，正在重试。</p>}{valid ? <ReactFlowProvider><CanvasSurface {...props} content={state.text} onChange={change} onSave={save} /></ReactFlowProvider> : <p role="alert">白板格式无法读取，原文件未修改。</p>}</section>;
}
