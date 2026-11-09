import React, { useCallback, useEffect, useRef, useState } from 'react';
import { parseDrawingDocument } from '@oh-my-student/plugin-vault-sqlite/drawing-files';
import { DocumentSaveBar, useDocumentDraft, saveShortcut } from './document-draft.jsx';
import excalidrawStyle from '@excalidraw/excalidraw/index.css';
import {drawingChangedIds,drawingEqual,drawingSelection,mergeDrawingDocuments,sameDrawingElement,applyDrawingNativeDelta,makeDrawingElements,drawingBounds} from '@oh-my-student/plugin-vault-sqlite/drawing-sync';
import {isMathElement,isMathRenderFile,mathSourceElement} from '@oh-my-student/plugin-vault-sqlite/drawing-math';
import {MathDrawingDialog,prepareMathScene} from './math-drawing.jsx';
import {DrawingLibraryDialog} from './drawing-library.jsx';
import {createLibraryDrawing} from '@oh-my-student/plugin-vault-sqlite/drawing-library';
import {mathElementId} from '@oh-my-student/plugin-vault-sqlite/math-reference';
import {createMindmap,editMindmap,mindmapNode,visibleMindmapElements,repairMindmap} from '@oh-my-student/plugin-vault-sqlite/drawing-mindmap';
import {MindmapControls,MindmapOutlineDialog} from './mindmap-controls.jsx';
import {useSuccessFeedback} from '@oh-my-student/plugin-graph-and-blocks/success-feedback';
import {callVault} from './logic.js';

let modulePromise;
export function loadDrawingEngine() {
  window.EXCALIDRAW_ASSET_PATH = `${location.origin}/notara/vault-views/excalidraw/0.18.1/`;
  return modulePromise ??= import('@excalidraw/excalidraw');
}
function useDrawingEngine() {
  const [engine, setEngine] = useState(null), [error, setError] = useState(false);
  useEffect(() => { let live = true; loadDrawingEngine().then(value => { if (live) setEngine(value); }).catch(() => { if (live) setError(true); }); return () => { live = false; }; }, []);
  return { engine, error };
}

export function DrawingPreview({ content }) {
  const { engine, error } = useDrawingEngine(), host = useRef(null);
  useEffect(() => {
    if (!engine) return;
    let live = true;
    try {
      const doc = parseDrawingDocument(content);
      if (!doc.elements.some(element => !element.isDeleted)) { if (host.current) host.current.textContent = '空白手绘'; return; }
      prepareMathScene(doc).then(scene=>engine.exportToSvg({ elements: visibleMindmapElements(scene.elements), appState: { ...doc.appState, exportBackground: true }, files: scene.files ?? {} })).then(svg => { if (live && host.current) { svg.style.width = '100%'; svg.style.height = '100%'; host.current.replaceChildren(svg); } }).catch(() => { if (live && host.current) host.current.textContent = '手绘预览暂不可用'; });
    } catch { if (host.current) host.current.textContent = '手绘文件无法读取'; }
    return () => { live = false; };
  }, [engine, content]);
  return <div ref={host} className="nv-drawing-preview" aria-label="手绘白板预览">{!engine && (error ? '手绘预览加载失败' : '正在准备手绘预览…')}</div>;
}

export function ExcalidrawEditor(props) {
  const [successToast,showSuccess,clearSuccess]=useSuccessFeedback();
  const { draft, state, dirty, save, recover, saveToast } = useDocumentDraft(props), { engine, error } = useDrawingEngine();
  const parse = text => { try { return parseDrawingDocument(text); } catch { return null; } };
  const initial=useRef(parse(state.text)),host=useRef(null),observed=useRef(state.text),lastNative=useRef(null),localHistory=useRef(new Set()),pointer=useRef(false),active=useRef(false),applying=useRef(false),queued=useRef(null),aliases=useRef(new Map()),fileAliases=useRef(new Map()),clientId=useRef(crypto.randomUUID()),publishActivity=useRef(()=>{});
  const [api,setApi]=useState(null),[busy,setBusy]=useState(false),[generation,setGeneration]=useState(0),[selected,setSelected]=useState([]),[notice,setNotice]=useState(''),[syncError,setSyncError]=useState(false),[exporting,setExporting]=useState(false);
  const [initialScene,setInitialScene]=useState(null),[mathEditor,setMathEditor]=useState(null),[sceneError,setSceneError]=useState('');
  const mathEditing=useRef(null);
  const [libraryOpen,setLibraryOpen]=useState(false);
  const [mindmapOpen,setMindmapOpen]=useState(false),[mindmapCreate,setMindmapCreate]=useState(false),mapDragStart=useRef(new Map());
  const fitted=useRef(false);
  const focused=useRef(null);
  useEffect(()=>{if(!api||!engine||!initialScene)return;let id;try{id=mathElementId(props.locator?.subpath);}catch{setNotice('数学图引用无效。');return;}if(!id||focused.current===id)return;const e=api.getSceneElements().find(e=>e.id===id&&isMathElement(e));if(!e){setNotice('引用的数学图已删除或不存在。');return;}focused.current=id;api.updateScene({appState:{selectedElementIds:{[id]:true}},captureUpdate:engine.CaptureUpdateAction.NEVER});api.scrollToContent([e],{fitToContent:true,animate:false});},[api,engine,initialScene,props.locator?.subpath]);
  useEffect(()=>{let live=true;if(initial.current)prepareMathScene(initial.current).then(scene=>{if(live)setInitialScene(scene);}).catch(e=>{if(live)setSceneError(e.message);});return()=>{live=false;};},[]);
  useEffect(()=>{if(!api||fitted.current||props.locator?.subpath?.startsWith('#element=')||!initialScene?.elements.some(isMathElement))return;const frame=requestAnimationFrame(()=>{api.scrollToContent(initialScene.elements,{fitToContent:true,animate:false});fitted.current=true;});return()=>cancelAnimationFrame(frame);},[api,initialScene,props.locator?.subpath]);
  const snapshot=useRef(state);snapshot.current=state;
  const nativeSource=useRef(initial.current);
  const scope=useRef({path:props.record.path,remote:props.remote,workspaceId:props.workspaceId});
  const life=useRef(true);useEffect(()=>{life.current=true;return()=>{life.current=false;};},[]);
  const normalize=useCallback((elements,appState,files)=>{
    const previous=parse(draft.getSnapshot().text)??initial.current;
    const normalizedElements=elements.map(e=>isMathElement(e)?mathSourceElement(e):e.fileId&&aliases.current.has(e.fileId)?{...e,fileId:aliases.current.get(e.fileId)}:e);
    const normalizedFiles={...previous.files};
    for(const e of elements)if(e.fileId&&!isMathRenderFile(e.fileId)&&files[e.fileId]){const id=aliases.current.get(e.fileId)??e.fileId;normalizedFiles[id]={...files[e.fileId],id};}
    const shared=Object.fromEntries(['viewBackgroundColor','gridSize','gridStep','gridModeEnabled'].filter(k=>appState[k]!==undefined).map(k=>[k,appState[k]]));
    // Excalidraw mutates element objects while drawing. Keep a detached
    // snapshot, otherwise comparison can silently miss the completed stroke.
    return structuredClone({...previous,elements:normalizedElements,files:normalizedFiles,appState:{...previous.appState,...shared}});
  },[draft]);
  const activeIds=useCallback(app=>[...new Set([mathEditing.current,app.editingTextElement?.id,app.resizingElement?.id,app.newElement?.id,app.multiElement?.id,app.editingLinearElement?.elementId,app.croppingElementId,...(pointer.current||app.selectedElementsAreBeingDragged?Object.keys(app.selectedElementIds??{}).filter(id=>app.selectedElementIds[id]):[])].filter(Boolean))],[]);
  const changed=useCallback((elements,appState,files)=>{
    const ids=Object.keys(appState.selectedElementIds??{}).filter(id=>appState.selectedElementIds[id]);setSelected(previous=>drawingEqual(previous,ids)?previous:ids);
    active.current=pointer.current||activeIds(appState).length>0;setBusy(active.current);
    if(applying.current)return;
    const rawNext=normalize(elements,appState,files);let next=rawNext;try{next=repairMindmap(rawNext);}catch{/* Keep malformed imported metadata unchanged; commands explain the invalid tree. */}
    if(lastNative.current===null){lastNative.current=next;publishActivity.current();return;}
    if(drawingEqual(lastNative.current,next)){publishActivity.current();return;}
    for(const id of drawingChangedIds(lastNative.current,next))localHistory.current.add(id);
    // A save receipt can add teacher elements while the hand is still drawing.
    // Rebase only the native delta instead of replacing that newer draft.
    const current=draft.getSnapshot(),latest=parse(current.text),conflicts=[];
    const edited=applyDrawingNativeDelta(nativeSource.current,lastNative.current,next);
    const merged=mergeDrawingDocuments(nativeSource.current,edited,latest,conflicts);
    if(!merged){
      lastNative.current=next;observed.current=null;
      draft.edit(current.text,{conflict:{path:props.record.path,content:current.baseContent,revision:current.baseRevision,rejectedNativeContent:current.conflict?.rejectedNativeContent??JSON.stringify(edited,null,2)+'\n'}});
      setNotice('这次修改与最新白板无法合并，两份草稿都已保留。请先保留草稿副本。');return;
    }
    lastNative.current=next;const text=JSON.stringify(merged??next,null,2)+'\n';
    nativeSource.current=structuredClone(merged??next);
    observed.current=drawingEqual(merged??next,next)&&drawingEqual(rawNext,next)?text:null;
    draft.edit(text,{share:true,...(!merged||conflicts.length?{conflict:{path:props.record.path,content:current.baseContent,revision:current.baseRevision}}:{})});publishActivity.current();
  },[draft,normalize,activeIds,props.record.path]);
  useEffect(()=>{
    if(!api||!engine)return;
    const down=api.onPointerDown(()=>{mapDragStart.current=new Map(api.getSceneElements().filter(e=>e.customData?.notaraMindmap).map(e=>[e.id,{x:e.x,y:e.y}]));pointer.current=true;active.current=true;setBusy(true);publishActivity.current();});
    const up=api.onPointerUp(()=>{pointer.current=false;requestAnimationFrame(()=>{if(!life.current)return;let pinned=false;const elements=api.getSceneElementsIncludingDeleted().map(e=>{const old=mapDragStart.current.get(e.id);if(old&&!e.isDeleted&&!e.customData?.notaraMindmapHidden&&!e.customData?.notaraMindmap?.pinned&&(old.x!==e.x||old.y!==e.y)){pinned=true;return engine.newElementWith(e,{customData:{...e.customData,notaraMindmap:{...e.customData.notaraMindmap,pinned:true}}});}return e;});mapDragStart.current.clear();if(pinned)api.updateScene({elements,captureUpdate:engine.CaptureUpdateAction.IMMEDIATELY});changed(api.getSceneElementsIncludingDeleted(),api.getAppState(),api.getFiles());});});
    return()=>{down();up();};
  },[api,engine,changed]);
  useEffect(()=>{
    if(!api||!engine||busy||state.text===observed.current)return;
    const doc=parse(state.text);if(!doc)return;
    let disposed=false;
    void prepareMathScene(doc).then(rendered=>{
    if(disposed||active.current||draft.getSnapshot().text!==state.text)return;
    const old=lastNative.current??initial.current,changedIds=[...drawingChangedIds(old,doc),...doc.elements.filter(e=>e.fileId&&old.files?.[e.fileId]?.dataURL!==doc.files?.[e.fileId]?.dataURL).map(e=>e.id)];
    if(changedIds.some(id=>localHistory.current.has(id))){api.history.clear();localHistory.current.clear();setNotice('老师更新了先前编辑过的图形，旧撤销记录已停用，避免覆盖新内容。');}
    // Images are immutable in Excalidraw's cache. Use render-only aliases for
    // changed data under a legacy fileId, mapping them back at persistence.
    const files=api.getFiles(),added=[],mapping=new Map();
    for(const [id,file] of Object.entries(rendered.files??{})){
      let rendered=fileAliases.current.get(id)??id;
      if(files[rendered]&&files[rendered].dataURL!==file.dataURL)rendered=`${id}-${crypto.randomUUID()}`;
      fileAliases.current.set(id,rendered);mapping.set(id,rendered);if(rendered!==id)aliases.current.set(rendered,id);
      if(!files[rendered])added.push({...file,id:rendered});
    }
    applying.current=true;
    try{
      if(added.length)api.addFiles(added);
      const shared=Object.fromEntries(['viewBackgroundColor','gridSize','gridStep','gridModeEnabled'].filter(k=>doc.appState?.[k]!==undefined).map(k=>[k,doc.appState[k]]));
      api.updateScene({elements:rendered.elements.map(e=>e.fileId&&mapping.has(e.fileId)&&mapping.get(e.fileId)!==e.fileId?engine.newElementWith(e,{fileId:mapping.get(e.fileId)}):e),appState:shared,captureUpdate:engine.CaptureUpdateAction.NEVER});
      lastNative.current=normalize(api.getSceneElementsIncludingDeleted(),api.getAppState(),api.getFiles());nativeSource.current=structuredClone(doc);observed.current=state.text;setGeneration(n=>n+1);
    }finally{applying.current=false;}
    }).catch(e=>{if(!disposed)setNotice('数学图暂时无法显示：'+e.message);});
    return()=>{disposed=true;};
  },[api,engine,state.text,busy,normalize]);
  useEffect(()=>{
    if(busy||!queued.current)return;
    const {record,generation}=queued.current;queued.current=null;draft.receive(record,generation);
  },[busy,draft]);
  useEffect(()=>{
    let disposed=false,timer;
    const poll=async()=>{try{
      if(host.current?.offsetWidth&&document.visibilityState!=='hidden'&&!draft.getSnapshot().saving){
        const generation=draft.getSnapshot().generation,record=await callVault(props.remote,'read',{path:props.record.path});
        if(!disposed){if(active.current)queued.current={record,generation};else draft.receive(record,generation);setSyncError(false);}
      }
    }catch{if(!disposed)setSyncError(true);}finally{if(!disposed)timer=setTimeout(poll,1200);}};
    void poll();return()=>{disposed=true;clearTimeout(timer);};
  },[draft,props.remote,props.record.path]);
  useEffect(()=>{
    if(!api)return;
    let scheduled,disposed=false;
    const publish=()=>{
      const current=draft.getSnapshot(),ids=activeIds(api.getAppState());
      if(current.drawingShared&&current.text!==current.baseContent)try{ids.push(...drawingChangedIds(parse(current.baseContent),parse(current.text)));}catch{/* Invalid draft is not published. */}
      void callVault(props.remote,'drawingActivity',{path:props.record.path,clientId:clientId.current,elementIds:[...new Set(ids)]}).catch(()=>{});
    };
    publishActivity.current=()=>{if(!scheduled&&!disposed)scheduled=setTimeout(()=>{scheduled=null;publish();},80);};
    publish();const timer=setInterval(publish,1800);return()=>{disposed=true;clearInterval(timer);clearTimeout(scheduled);publishActivity.current=()=>{};void callVault(scope.current.remote,'drawingActivity',{path:scope.current.path,clientId:clientId.current,elementIds:[]}).catch(()=>{});};
  },[api,activeIds,draft,props.remote,props.record.path]);
  useEffect(()=>{publishActivity.current();},[state.saving,state.baseRevision]);
  useEffect(()=>{
    if(!state.drawingShared||!dirty||busy||state.saving||state.conflict||state.message?.startsWith('保存失败'))return;
    const timer=setTimeout(()=>{if(!active.current)void save({quiet:true});},400);return()=>clearTimeout(timer);
  },[state.text,state.saving,state.conflict,state.drawingShared,busy,dirty]);
  useEffect(()=>{
    if(!api||!engine||dirty||busy||!state.baseRevision||observed.current!==state.text)return;
    let disposed=false;
    const timer=setTimeout(async()=>{try{
      if(active.current||observed.current!==state.text||draft.getSnapshot().text!==state.text)return;
      const doc={elements:structuredClone(visibleMindmapElements(api.getSceneElements())),appState:{viewBackgroundColor:api.getAppState().viewBackgroundColor},files:structuredClone(api.getFiles())};
      if(!doc.elements.length)return;
      const blob=await engine.exportToBlob({...doc,appState:{...doc.appState,exportBackground:true},mimeType:'image/png',maxWidthOrHeight:1200});
      const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
      if(!disposed&&observed.current===state.text&&draft.getSnapshot().baseRevision===state.baseRevision&&draft.getSnapshot().text===draft.getSnapshot().baseContent)await callVault(props.remote,'drawingPreview',{path:props.record.path,revision:state.baseRevision,png:btoa(binary)});
    }catch{/* The scene remains usable when preview generation fails. */}},500);
    return()=>{disposed=true;clearTimeout(timer);};
  },[api,engine,state.baseRevision,generation,dirty,busy,draft,props.remote,props.record.path]);
  const discuss=async()=>{
    if(!api||!engine||exporting)return;const owner=props.captureOwner?.();setExporting(true);setNotice('');clearSuccess();
    try{
      const current=draft.getSnapshot(),app=api.getAppState(),ids=Object.keys(app.selectedElementIds??{}).filter(id=>app.selectedElementIds[id]);
      const elements=structuredClone(drawingSelection(visibleMindmapElements(api.getSceneElements()),ids));if(!elements.length)throw Error('先在画布上写一些内容。');
      const files=structuredClone(api.getFiles()),exportState={viewBackgroundColor:app.viewBackgroundColor,exportBackground:true,exportWithDarkMode:false};
      const shown=normalize(api.getSceneElementsIncludingDeleted(),app,files),saved=parse(current.baseContent);
      const matches=saved&&shown.elements.length===saved.elements.length&&shown.elements.every((e,i)=>sameDrawingElement(e,saved.elements[i]))&&drawingEqual(shown.files,saved.files)&&shown.appState.viewBackgroundColor===saved.appState.viewBackgroundColor;
      const meta={path:props.record.path,workspaceId:props.workspaceId,revision:current.baseRevision,unsaved:current.text!==current.baseContent||!matches,mode:ids.length?'selection':'whole',elements:elements.map(({id,type,text,x,y,width,height,version,groupIds})=>({id,type,text,x,y,width,height,version,groupIds}))};
      const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({elements,files,appState:exportState})));meta.snapshotHash=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
      const blob=await engine.exportToBlob({elements,files,appState:exportState,mimeType:'image/png',maxWidthOrHeight:1600});
      if(!life.current||owner&&!owner())throw Error('对话已切换，快照没有带入其他会话。');
      if(!props.onSnapshot)throw Error('当前对话暂不可用');await props.onSnapshot({blob,meta},owner);if(life.current)showSuccess('画布快照已带入对话草稿，发送后老师会看到。');
    }catch(e){if(life.current)setNotice(e.message);}finally{if(life.current)setExporting(false);}
  };
  const header={...props.documentHeader,onBring:discuss,bringLabel:exporting?'准备快照…':selected.length?'讨论选区':'请老师看'};
  const openMath=(edit=false)=>{
    const element=edit&&api?.getSceneElements().find(e=>selected.includes(e.id)&&isMathElement(e));
    mathEditing.current=element?.id??null;setMathEditor({element:element?structuredClone(mathSourceElement(element)):null});
    if(element){active.current=true;setBusy(true);}publishActivity.current();
  };
  const insertLibrary=id=>{
    if(!life.current||draft.getSnapshot().conflict)throw Error('白板已关闭或存在冲突，请先处理草稿。');
    const scene=createLibraryDrawing(id),elements=engine.restoreElements(scene.elements,null),app=api.getAppState();
    const center=engine.viewportCoordsToSceneCoords({clientX:app.offsetLeft+app.width/2,clientY:app.offsetTop+app.height/2},app),bounds=drawingBounds(elements);
    for(const element of elements){element.x+=center.x-bounds.x-bounds.width/2;element.y+=center.y-bounds.y-bounds.height/2;}
    api.addFiles(Object.values(scene.files));
    api.updateScene({elements:[...api.getSceneElementsIncludingDeleted(),...elements],appState:{selectedElementIds:Object.fromEntries(elements.map(e=>[e.id,true])),selectedGroupIds:Object.fromEntries(elements.flatMap(e=>e.groupIds).map(id=>[id,true]))},captureUpdate:engine.CaptureUpdateAction.IMMEDIATELY});
    changed(api.getSceneElementsIncludingDeleted(),api.getAppState(),api.getFiles());
  };
  const closeMath=()=>{mathEditing.current=null;setMathEditor(null);if(api)changed(api.getSceneElementsIncludingDeleted(),api.getAppState(),api.getFiles());publishActivity.current();};
  const applyMath=async data=>{
    if(draft.getSnapshot().conflict)throw Error('白板存在冲突，请先保留草稿并处理冲突。');
    const previous=mathEditor.element;
    const current=previous&&api.getSceneElements().find(e=>e.id===previous.id);
    if(previous&&(!current||!sameDrawingElement(previous,mathSourceElement(current))))throw Error('这个数学图已更新，请关闭后重新编辑。');
    const normalized=mathSourceElement(current);
    const bounds=drawingBounds(api.getSceneElements()),source=previous
      ?{...normalized,customData:{...normalized.customData,notaraMath:data},version:current.version+1,versionNonce:Math.floor(Math.random()*2147483647)}
      :makeDrawingElements([{kind:'math',math:data,x:bounds.x,y:bounds.y+bounds.height+(bounds.height?40:0)}],()=>crypto.randomUUID())[0];
    const scene=await prepareMathScene({elements:[source],files:{}});
    if(!life.current||draft.getSnapshot().conflict)throw Error('白板已关闭或发生冲突，未修改原图。');
    const now=api.getSceneElementsIncludingDeleted();
    if(previous&&!sameDrawingElement(previous,mathSourceElement(now.find(e=>e.id===previous.id))))throw Error('这个数学图已更新，请重新编辑。');
    api.addFiles(Object.values(scene.files));
    api.updateScene({elements:previous?now.map(e=>e.id===source.id?scene.elements[0]:e):[...now,scene.elements[0]],appState:{selectedElementIds:{[source.id]:true}},captureUpdate:engine.CaptureUpdateAction.IMMEDIATELY});
    changed(api.getSceneElementsIncludingDeleted(),api.getAppState(),api.getFiles());
    api.scrollToContent(scene.elements,{fitToContent:true,animate:false});
  };
  const mapDocument=parse(state.text),mapNodes=mapDocument?[...new Map(selected.map(id=>mindmapNode(mapDocument,id)).filter(Boolean).map(n=>[n.id,n])).values()]:[],mapNode=mapNodes.length===1?mapNodes[0]:null;
  const selectMapNode=id=>{if(!api)return;const n=api.getSceneElements().find(e=>e.id===id);if(n){api.updateScene({appState:{selectedElementIds:{[id]:true},selectedGroupIds:{}},captureUpdate:engine.CaptureUpdateAction.NEVER});api.scrollToContent([n],{animate:false});}};
  const mapAction=action=>{
    if(!api||!engine||!life.current||draft.getSnapshot().conflict)throw Error('请先处理白板冲突。');
    const raw=api.getSceneElementsIncludingDeleted(),before=normalize(raw,api.getAppState(),api.getFiles()),choices=[...new Map(Object.keys(api.getAppState().selectedElementIds??{}).filter(id=>api.getAppState().selectedElementIds[id]).map(id=>mindmapNode(before,id)).filter(Boolean).map(n=>[n.id,n])).values()],node=choices.length===1?choices[0]:null;
    const bounds=drawingBounds(visibleMindmapElements(raw)),result=action.type==='create'?createMindmap(before,action.outline,{x:bounds.x,y:bounds.y+bounds.height+(bounds.height?80:0)}):editMindmap(before,node?.id,action);
    const normalized=new Map(before.elements.map(e=>[e.id,e])),native=new Map(raw.map(e=>[e.id,e]));
    const elements=engine.restoreElements(result.doc.elements.map(e=>native.has(e.id)&&sameDrawingElement(normalized.get(e.id),e)?native.get(e.id):e),null);
    api.updateScene({elements,appState:{selectedElementIds:result.nodeId?{[result.nodeId]:true}:{},selectedGroupIds:{}},captureUpdate:engine.CaptureUpdateAction.IMMEDIATELY});changed(api.getSceneElementsIncludingDeleted(),api.getAppState(),api.getFiles());
    setNotice('');setMindmapOpen(true);if(result.nodeId)api.scrollToContent(action.type==='create'||action.type==='layout'?visibleMindmapElements(elements).filter(e=>e.customData?.notaraMindmap||e.customData?.notaraMindmapEdge):elements.filter(e=>e.id===result.nodeId),{fitToContent:action.type==='create'||action.type==='layout',animate:false});
  };
  const tryMapAction=action=>{try{mapAction(action);}catch(e){setNotice(e.message);}};
  const keyDown=event=>{saveShortcut(event,save);if(!mapNode||event.defaultPrevented||event.isComposing||event.target.closest('input,textarea,[contenteditable="true"],button,[role="dialog"]'))return;
    if(!mindmapOpen){if(['Delete','Backspace'].includes(event.key)&&!event.metaKey&&!event.ctrlKey&&!event.altKey){event.preventDefault();event.stopPropagation();tryMapAction({type:'remove'});}return;}
    let action;if(!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){if(event.key==='Tab')action={type:'child'};if(event.key==='Enter')action={type:mapNode.customData.notaraMindmap.parent?'sibling':'child'};if(event.key==='Delete'||event.key==='Backspace')action={type:'remove'};if(event.key==='F2'){event.preventDefault();event.stopPropagation();host.current.querySelector('[aria-label="节点名称"]')?.focus();return;}}
    if(event.altKey&&!event.ctrlKey&&!event.metaKey&&event.code==='Digit1')action={type:'fold'};if(action){event.preventDefault();event.stopPropagation();tryMapAction(action);}};
  return <section ref={host} className="nv-drawing-editor" aria-label="手绘白板编辑器" onKeyDownCapture={keyDown}>
    <style data-plugin="@oh-my-student/plugin-vault-views">{excalidrawStyle}</style>
    <DocumentSaveBar {...{ state, dirty, save, recover }} record={props.record} header={header}>
      <button type="button" aria-label="图形库" title="插入现成图形" disabled={!api} onClick={()=>setLibraryOpen(true)}><span aria-hidden="true">◇＋</span><span className="nv-doc-action-label">图形库</span></button>
      <button type="button" aria-label="数学图" title="插入数学图" disabled={!api} onClick={()=>openMath()}><span aria-hidden="true">ƒ＋</span><span className="nv-doc-action-label">数学图</span></button>
      <button type="button" aria-label="思维导图" title="思维导图（实验）" aria-pressed={mindmapOpen} disabled={!api} onClick={()=>{setMindmapOpen(!mindmapOpen);if(!mindmapOpen&&!mapDocument?.elements.some(e=>!e.isDeleted&&e.customData?.notaraMindmap))setMindmapCreate(true);}}><span aria-hidden="true">⑂</span><span className="nv-doc-action-label">思维导图</span></button>
      {api?.getSceneElements().some(e=>selected.includes(e.id)&&isMathElement(e))&&<button type="button" aria-label="编辑数学图" title="编辑选中的数学图" onClick={()=>openMath(true)}><span aria-hidden="true">✎</span><span className="nv-doc-action-label">编辑数学图</span></button>}
    </DocumentSaveBar>
    {mindmapOpen&&mapDocument&&<MindmapControls doc={mapDocument} node={mapNode} onAction={tryMapAction} onSelect={selectMapNode} onNew={()=>setMindmapCreate(true)} onClose={()=>setMindmapOpen(false)} disabled={Boolean(state.conflict)||!api}/>}
    {successToast}{saveToast}{(notice||syncError)&&<p className="nv-drawing-notice" role="status">{notice||'同步暂不可用，笔迹已保留，正在重试。'}</p>}
    {!initial.current||!parse(state.text) ? <p role="alert">手绘文件格式无法读取，原文件未修改。</p> : error||sceneError ? <p role="alert">手绘编辑器加载失败：{sceneError||'请刷新重试'}</p> : !engine||!initialScene ? <p role="status">正在加载手绘编辑器…</p> : <div className="nv-excalidraw-host" data-generation={generation}><engine.Excalidraw excalidrawAPI={setApi} initialData={{ ...initialScene, scrollToContent: true }} onChange={changed} langCode="zh-CN" handleKeyboardGlobally={false} viewModeEnabled={Boolean(state.conflict?.rejectedNativeContent)} UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false } }} /></div>}
    {mathEditor&&<MathDrawingDialog initial={mathEditor.element?.customData.notaraMath} onApply={applyMath} onClose={closeMath}/>}
    {libraryOpen&&<DrawingLibraryDialog engine={engine} onInsert={insertLibrary} onClose={()=>setLibraryOpen(false)}/>}
    {mindmapCreate&&<MindmapOutlineDialog onCreate={outline=>mapAction({type:'create',outline})} onClose={()=>setMindmapCreate(false)}/>}
  </section>;
}
