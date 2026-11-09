import {useSuccessFeedback} from './success-feedback.jsx';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, useId } from 'react';
import { subscribeVaultChanges } from '@oh-my-student/plugin-vault-sqlite/workspace-client';
import {sourceGroups,sourceStudyGraph,sourceStudyBackbone,sourceExamples,sourceOverviewGraph,knowledgeOverviewGraph,crossSourceEdges,graphEdgeKind,graphRelationVisible,isLearningRelation} from './source-graph.js';
import { projectGraph, graphCatalog, graphTags, graphEdgeKey, nodeAppearance, readGraph, isOriginalSource } from './graph.js';
import { installGraphGestures, zoomAt } from './graph-gestures.js';
import { createGraphRenderer } from './graph-renderer.js';
import { GraphSearchDialog } from './graph-search.jsx';
import { GraphSelectionDialog, GraphContextMenu } from './graph-selection.jsx';
import { graphCandidates, mergeSelection, nodesInBox, createGraphSelectionStore, GRAPH_SELECTION_LIMIT, GRAPH_TYPES } from './graph-selection.js';
import {graphLabelLines} from './graph-layout.js';
import {selectionModifier} from './selection-interaction.js';
import {GraphContentList} from './graph-content-list.jsx';
import {RELATION_LABELS,edgeDescription,readableReferences} from './graph-edge-display.js';

function NodeGlyph({radius,source,focus=false}) {
  const className=focus?'nv-block-node-focus':'nv-block-node-shape';
  return source?<rect className={className} x={-radius} y={-radius} width={radius*2} height={radius*2} rx={focus?5:3} aria-hidden={focus||undefined}/>:<circle className={className} r={radius} aria-hidden={focus||undefined}/>;
}
const emptyFilters = () => ({ centers: [], tags: [], hops: 1, tagMatch:'all', type:'all' });
function GraphRelationLegend({arrowId}){
  return <section className="nv-graph-relation-legend" aria-label="连线图例">
    <div className="nv-graph-relation-kinds">{Object.entries(RELATION_LABELS).map(([kind,label])=><span key={kind}>
      <svg className="nv-graph-legend-swatch" width="32" height="16" viewBox="0 0 32 16" aria-hidden="true">
        {kind==='prerequisite'&&<defs><marker id={arrowId+'-legend'} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 1 L 9 5 L 0 9" fill="none" stroke="var(--nv-g-prerequisite)" strokeWidth="1.5"/></marker></defs>}
        <path d={kind==='association'?'M 2 11 Q 16 1 30 11':'M 2 8 L 30 8'} className={'nv-legend-line nv-legend-'+kind} fill="none" markerEnd={kind==='prerequisite'?`url(#${arrowId}-legend)`:undefined}/>
      </svg>{label}
    </span>)}</div>
    <div className="nv-graph-relation-states" aria-label="知识联系状态"><span>知识联系</span>{[['solid','已建立'],['dashed','待建立']].map(([style,label])=><span key={style}><svg width="32" height="16" aria-hidden="true"><line x1="2" x2="30" y1="8" y2="8" className={'nv-legend-line nv-legend-state nv-legend-'+style}/></svg>{label}</span>)}</div>
  </section>;
}
export function ForceGraphView({ ctx, remote = ctx?.remote?.notaraVault, data, focusPath: initialFocus, onOpenDocument, onBring, revision = 0, viewState, onViewStateChange, allowedPaths, active = true }) {
  const [result, setResult] = useState(data), [status, setStatus] = useState(data ? 'ready' : 'loading');
  const pendingResult = useRef(null);
  const activity = useRef({active,hasSize:true,box:false}); activity.current.active=active;
  const updateActivity = useRef(null), lastRead = useRef(null), lastDrawn = useRef(null);
  const [reload, setReload] = useState(0), [filters, setFilters] = useState(() => viewState?.filters && viewState.focusPath === initialFocus ? viewState.filters : ({ ...emptyFilters(), centers: initialFocus ? [initialFocus] : [] }));
  const [search, setSearch] = useState(viewState?.search || ''), [advanced, setAdvanced] = useState(false), [width, setWidth] = useState(960);
  const [height,setHeight]=useState(580);
  // Visibility is separate from graph geometry: switching evidence must not
  // move nodes, reset the camera, or change source/center membership.
  const [relationFilter,setRelationFilter]=useState(()=>['established','potential'].includes(viewState?.relationFilter)?viewState.relationFilter:'all');
  const [selectedPath, setSelectedPath] = useState(null);
  const [hoveredClusterKey,setHoveredClusterKey]=useState(null),sourceBackRef=useRef(null);
  const previewReturn=useRef(viewState?.previewReturn??null),pendingCamera=useRef(null);
  const [organization,setOrganization]=useState(()=>initialFocus&&viewState?.focusPath!==initialFocus?'all':viewState?.organization??(initialFocus||viewState?.filters?.centers?.length?'all':'sources'));
  const [sourceId,setSourceId]=useState(viewState?.sourceId??null);
  const [centerHistory,setCenterHistory]=useState(()=>viewState?.focusPath===initialFocus?viewState?.centerHistory??[]:[]);
  const [labelMode,setLabelMode]=useState(viewState?.labelMode??'auto');
  const [settings,setSettings]=useState(false),optionsRef=useRef(null),optionsTrigger=useRef(null);
  const optionsId=useId();
  const arrowId=useId().replace(/[^a-zA-Z0-9_-]/g,'');
  const closeSettings=()=>{setSettings(false);requestAnimationFrame(()=>optionsTrigger.current?.focus());};
  const selectionStore=useMemo(()=>viewState?(viewState.selectionStore??=createGraphSelectionStore()):createGraphSelectionStore(),[viewState]);
  const picked=useSyncExternalStore(selectionStore.subscribe,selectionStore.getSnapshot),setPicked=selectionStore.set;
  const [selecting,setSelecting]=useState(false),[selectionDialog,setSelectionDialog]=useState(null);
  useEffect(()=>{
    if(!settings||advanced||selectionDialog)return;
    const outside=event=>{if(!optionsRef.current?.contains(event.target)&&!optionsTrigger.current?.contains(event.target))setSettings(false);};
    const escape=event=>{if(event.key==='Escape'){setSettings(false);optionsTrigger.current?.focus();}};
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
  },[settings,advanced,selectionDialog]);
  const [successToast,showSuccess,clearSuccess]=useSuccessFeedback();
  const [bringing,setBringing]=useState(false),[selectionNotice,setSelectionNotice]=useState('');
  const [box,setBox]=useState(null),[menu,setMenu]=useState(null),selectionActions=useRef({});
  const svg = useRef(null), renderer = useRef(null), positions = useRef(viewState?.positions || new Map()), gestures = useRef(null), lastFocus = useRef(initialFocus);
  const centerOrigins=useRef(viewState?.centerOrigins||new Map());
  const view = useRef(viewState?.view || { x: 0, y: 0, scale: 1 });
  const pendingFit=useRef(!viewState?.view||!viewState?.centerOrigins||viewState.focusPath!==initialFocus);
  useEffect(()=>{
    const escape=event=>{if(event.key==='Escape'&&(selectionActions.current.selecting||svg.current?.dataset.gesturing==='box')){gestures.current?.cancel();setSelecting(false);}};
    document.addEventListener('keydown',escape);return()=>document.removeEventListener('keydown',escape);
  },[]);
  const changed=useRef(onViewStateChange);changed.current=onViewStateChange;
  const setView = value => { view.current = typeof value === 'function' ? value(view.current) : value; if (viewState) {viewState.view = view.current;changed.current?.(viewState,'camera',!!svg.current?.dataset.gesturing);} renderer.current?.setView(view.current); };
  useLayoutEffect(() => {
    const drawing = createGraphRenderer(svg.current, positions.current, view.current,centerOrigins.current,()=>changed.current?.(viewState,'layout',!!svg.current?.dataset.gesturing));
    renderer.current = drawing;
    const updateActive = () => drawing.setActive(activity.current.active && activity.current.hasSize && !activity.current.box && !document.hidden);
    updateActivity.current=updateActive;
    const controller = installGraphGestures(svg.current, { getView: () => view.current, setView, getNode: drawing.getNode, onDrag: drawing.drag,
      isSelecting:event=>selectionActions.current.enabled&&(selectionActions.current.selecting||event.ctrlKey||event.metaKey||event.shiftKey),
      onBoxChange:rect=>{setBox(rect);activity.current.box=!!rect;updateActive();},
      onBoxSelect:(rect,additive)=>selectionActions.current.chooseBox(nodesInBox(drawing.getNodes(),rect,view.current),additive),
      onIdle:()=>{changed.current?.(viewState,'camera');if(pendingResult.current){const value=pendingResult.current;pendingResult.current=null;setResult(value);}},
    });
    gestures.current = controller;
    let visible = true;
    const observer = new ResizeObserver(entries => {
      const rect = entries[0].contentRect; visible = rect.width > 0 && rect.height > 0;
      activity.current.hasSize=visible;
      if (visible) { const next = Math.max(240, Math.round(rect.width)),nextHeight=Math.max(240,Math.round(rect.height)); drawing.setSize(next,nextHeight);setHeight(previous=>previous===nextHeight?previous:nextHeight);setWidth(previous => previous === next ? previous : next);if(pendingFit.current&&drawing.getNodes().length){pendingFit.current=false;setView(drawing.fit());} }
      else { controller.cancel(); setAdvanced(false); setSelectionDialog(null); setMenu(null); }
      updateActive();
    });
    observer.observe(svg.current); document.addEventListener('visibilitychange', updateActive);
    return () => { updateActivity.current=null; pendingResult.current=null; controller.dispose(); drawing.dispose(); observer.disconnect(); document.removeEventListener('visibilitychange', updateActive); renderer.current = null; gestures.current = null; };
  }, []);
  useLayoutEffect(()=>{if(!active)gestures.current?.cancel();updateActivity.current?.();},[active]);
  useEffect(() => { if (lastFocus.current !== initialFocus) { lastFocus.current = initialFocus; setCenterHistory([]); if(initialFocus)setOrganization('all'); setFilters(value => ({ ...value, centers: initialFocus ? [initialFocus] : [] })); } }, [initialFocus]);
  useEffect(() => { if (viewState) {Object.assign(viewState, { filters, search, organization, sourceId, focusPath: initialFocus, positions: positions.current,centerOrigins:centerOrigins.current,relationFilter,centerHistory,labelMode });changed.current?.(viewState);} }, [viewState, filters, search, organization, sourceId, initialFocus,relationFilter,centerHistory,labelMode]);
  useEffect(()=>{renderer.current?.refreshLabels();},[labelMode]);
  useEffect(() => {
    if (!active) return;
    if (data) { lastRead.current=null; setResult(data); setStatus('ready'); return; }
    if (lastRead.current?.remote===remote && lastRead.current.reload===reload && lastRead.current.revision===revision) return;
    let alive = true; setStatus('loading');
    readGraph(remote,{compact:true}).then(value => { if (alive) { lastRead.current={remote,reload,revision}; if(svg.current?.dataset.gesturing)pendingResult.current=value;else setResult(value); setStatus('ready'); } }, () => { if (alive) setStatus('failed'); });
    return () => { alive = false; pendingResult.current=null; };
  }, [remote, data, reload, revision, active]);
  useEffect(() => data ? undefined : subscribeVaultChanges(remote, () => setReload(value => value + 1)), [remote, data]);
  const scopeKey=allowedPaths === undefined ? null : JSON.stringify([...new Set(allowedPaths)].sort());
  const scopedResult=useMemo(()=>{if(scopeKey === null)return result;const paths=new Set(JSON.parse(scopeKey));return {...result,nodes:(result?.nodes||[]).filter(node=>paths.has(node.path)),edges:(result?.edges||[]).filter(edge=>paths.has(edge.source)&&paths.has(edge.target))};},[result,scopeKey]);
  const centerScope=useMemo(()=>JSON.stringify([scopeKey,
    (scopedResult?.nodes??[]).map(node=>[node.path,node.title,node.type,node.isSource,[...new Set(node.sourcePaths??[])].sort()]).sort((a,b)=>a[0].localeCompare(b[0])),
    [...new Set((scopedResult?.edges??[]).map(graphEdgeKey))].sort(),
  ]),[scopeKey,scopedResult]);
  // Aggregation limits the scope, not the meaning of its existing links.
  // Keep overview/backbone quiet; an expanded group can inspect references.
  const relations=organization==='all'||organization==='center'||organization==='sources'&&sourceId?'all':'backbone';
  const filteredGraph = useMemo(() => {
    const projected=projectGraph(scopedResult, filters.centers, filters.tags, filters.hops, filters.tagMatch,relations);
    const nodes=graphCandidates(projected.nodes,filters.type,'',filters.centers),paths=new Set(nodes.map(node=>node.path));
    return {...projected,nodes,edges:projected.edges.filter(edge=>paths.has(edge.source)&&paths.has(edge.target))};
  }, [scopedResult, filters,relations]);
  const groups=useMemo(()=>sourceGroups(scopedResult,filteredGraph.nodes),[scopedResult,filteredGraph]);
  const activeSource=organization==='sources'?groups.find(group=>group.id===sourceId):undefined;
  const overview=organization==='sources'&&!sourceId;
  const completeStudy=useMemo(()=>activeSource?sourceStudyGraph(filteredGraph,activeSource):filteredGraph,[filteredGraph,activeSource]);
  const graph=useMemo(()=>{
    if(overview)return sourceOverviewGraph(filteredGraph);
    if(organization==='knowledge')return knowledgeOverviewGraph(filteredGraph);
    if(organization!=='sources')return {...filteredGraph,layout:filters.centers.length?undefined:'source-clusters'};
    const local=activeSource?sourceStudyBackbone(completeStudy):sourceStudyGraph(filteredGraph,activeSource,{display:'backbone'});
    return {...local,nodes:local.nodes.map(node=>node.path===activeSource?.path?{...node,center:true}:node)};
  },[organization,filteredGraph,activeSource,completeStudy,filters.centers.length,overview]);
  const canvasHeight=height;
  const drawingEdges=useMemo(()=>[...(graph.branches??[]),...graph.edges],[graph]);
  const edgeNodes=useMemo(()=>new Map(graph.nodes.map(node=>[node.path,node])),[graph]);
  const edgeKinds=useMemo(()=>{const nodes=new Map(graph.nodes.map(node=>[node.path,node]));return drawingEdges.map(edge=>edge.organization?'source':graphEdgeKind(edge,nodes));},[graph,drawingEdges]);
  const visibleEdges=useMemo(()=>drawingEdges.map((edge,i)=>graphRelationVisible(edge,edgeKinds[i],relationFilter)),[drawingEdges,edgeKinds,relationFilter]);
  const hoveredCluster=graph.layout==='source-clusters'?groups.find(group=>group.id===hoveredClusterKey):null;
  const clusterPaths=useMemo(()=>hoveredCluster?new Set([hoveredCluster.path,...hoveredCluster.nodes.map(node=>node.path)]):null,[hoveredCluster]);
  const sharedHighlights=useMemo(()=>new Set(hoveredCluster?.nodes.filter(node=>new Set(node.sourcePaths??[]).size>1).map(node=>node.path)??[]),[hoveredCluster]);
  // Restore a preview camera only while its filters and layout inputs still match.
  const returnScope=useMemo(()=>JSON.stringify([scopeKey,filters.type,filters.hops,filters.tagMatch,[...filters.centers].sort(),[...filters.tags].sort(),
    filteredGraph.nodes.map(node=>[node.path,node.title,node.type,node.isSource,[...new Set(node.sourcePaths??[])].sort()]).sort((a,b)=>a[0].localeCompare(b[0])),
    [...new Set((scopedResult?.edges??[]).map(graphEdgeKey))].sort(),
  ]),[scopeKey,filters,filteredGraph,scopedResult]);
  const cameraScope=JSON.stringify([organization,sourceId,filters,scopeKey]),lastCameraScope=useRef(cameraScope);
  const activeSelected=graph.nodes.some(node=>node.path===selectedPath)?selectedPath:null;
  const neighbors=useMemo(()=>{const paths=new Set(activeSelected?[activeSelected]:[]);drawingEdges.forEach((edge,i)=>{if(visibleEdges[i]&&(edge.source===activeSelected||edge.target===activeSelected)){paths.add(edge.source);paths.add(edge.target);}});return paths;},[drawingEdges,visibleEdges,activeSelected]);
  const catalog = useMemo(() => graphCatalog(scopedResult), [scopedResult]);
  useEffect(()=>{if(selectedPath&&!catalog.some(node=>node.path===selectedPath))setSelectedPath(null);},[selectedPath,catalog]);
  const selectionGraph=useMemo(()=>({nodes:catalog,edges:scopedResult?.edges??[]}),[scopedResult,catalog]);
  const crossEdges=useMemo(()=>{const nodes=new Map(catalog.map(node=>[node.path,node]));return new Set(crossSourceEdges(selectionGraph,activeSelected).filter(edge=>graphRelationVisible(edge,graphEdgeKind(edge,nodes),relationFilter)).map(graphEdgeKey));},[selectionGraph,catalog,activeSelected,relationFilter]);
  useEffect(()=>{if(status==='ready')setPicked(previous=>{const paths=new Set(catalog.map(node=>node.path)),next=previous.filter(path=>paths.has(path));return next.length===previous.length?previous:next;});},[catalog,status]);
  const choices = catalog;
  useLayoutEffect(()=>{renderer.current?.setClusterHighlight(hoveredCluster?.id);renderer.current?.refreshLabels();},[selectedPath,search,picked,hoveredCluster]);
  useLayoutEffect(() => {
    if (!active || lastDrawn.current?.graph===graph && lastDrawn.current.cameraScope===cameraScope) return;
    lastDrawn.current={graph,cameraScope};
    gestures.current?.cancel();
    const actual=svg.current?.getBoundingClientRect().width??0,nextWidth=actual>0?Math.max(240,Math.round(actual)):width;
    const nextHeight=Math.max(240,Math.round(svg.current?.getBoundingClientRect().height??580));
    setHeight(previous=>previous===nextHeight?previous:nextHeight);renderer.current?.setSize(nextWidth,nextHeight);if(renderer.current?.setGraph(graph))pendingFit.current=true;
    if(actual>0)setWidth(previous=>previous===nextWidth?previous:nextWidth);
    if(lastCameraScope.current!==cameraScope){lastCameraScope.current=cameraScope;pendingFit.current=true;}
    if(actual>0&&pendingCamera.current){pendingFit.current=false;setView(pendingCamera.current);pendingCamera.current=null;}
    else if(actual>0&&pendingFit.current&&graph.nodes.length){pendingFit.current=false;setView(renderer.current.fit());}
  }, [graph,cameraScope,active]);
  const open = path => onOpenDocument ? onOpenDocument({ path }) : window.dispatchEvent(new CustomEvent('notara:open-document', { detail: { path } }));
  const enterSource=(key,fromGraph=false)=>{
    if(!groups.some(group=>group.id===key))return;
    previewReturn.current=fromGraph?{key,organization,view:{...view.current},scope:returnScope}:null;
    if(viewState)viewState.previewReturn=previewReturn.current;
    setHoveredClusterKey(null);setSelectedPath(null);setSourceId(key);setOrganization('sources');
    requestAnimationFrame(()=>sourceBackRef.current?.focus());
  };
  const leaveSource=()=>{
    const previous=previewReturn.current;previewReturn.current=null;if(viewState)viewState.previewReturn=null;
    if(previous){pendingCamera.current=previous.scope===returnScope?previous.view:null;pendingFit.current=true;setOrganization(previous.organization??'all');}
    setSourceId(null);setSelectedPath(null);setHoveredClusterKey(null);
    if(previous)requestAnimationFrame(()=>[...svg.current.querySelectorAll('[data-cluster-key]')].find(el=>el.dataset.clusterKey===previous.key)?.focus());
    else requestAnimationFrame(()=>optionsTrigger.current?.focus());
  };
  const clusterAttention=event=>{
    const key=event.target.closest('[data-cluster-key]')?.dataset.clusterKey;
    if(key)setHoveredClusterKey(key);
    else setHoveredClusterKey(null);
  };
  const query = search.trim().toLowerCase(), matches = node => !query || (node.title + ' ' + node.path).toLowerCase().includes(query);
  const selected = graph.nodes.find(node=>node.path===selectedPath)??completeStudy.nodes.find(node=>node.path===selectedPath)??catalog.find(node=>node.path===selectedPath);
  const examples=useMemo(()=>sourceExamples(completeStudy,selectedPath),[completeStudy,selectedPath]);
  const searchResults=useMemo(()=>query?graphCandidates(filteredGraph.nodes,filters.type,query,filters.centers):[],[filteredGraph,filters.type,filters.centers,query]);
  const foldedPaths=useMemo(()=>new Set(filteredGraph.nodes.filter(node=>!graph.nodes.some(shown=>shown.path===node.path)).map(node=>node.path)),[graph,filteredGraph]);
  const batchCandidates=query?searchResults:graph.nodes;
  const tagNames=new Map(catalog.flatMap(graphTags).map(tag=>[tag.value,tag.label]));
  const toggleTag = tag => setFilters(value => ({...value,tags:value.tags.includes(tag) ? value.tags.filter(item => item !== tag) : value.tags.length<32 ? [...value.tags,tag] : value.tags}));
  const rememberCenter=centers=>{
    if(organization==='center'&&JSON.stringify([...centers].sort())===JSON.stringify([...filters.centers].sort()))return;
    setCenterHistory(history=>[...history,{organization,sourceId,filters,search,relationFilter,selectedPath,
      view:{...view.current},scope:centerScope,width,height,previewReturn:previewReturn.current}]);
    setHoveredClusterKey(null);
  };
  const leaveCenter=()=>{
    const previous=centerHistory.at(-1);setCenterHistory(history=>history.slice(0,-1));
    setSettings(false);setHoveredClusterKey(null);pendingFit.current=true;
    pendingCamera.current=previous?.scope===centerScope&&previous.width===width&&previous.height===height?previous.view:null;
    previewReturn.current=previous?.previewReturn??null;if(viewState)viewState.previewReturn=previewReturn.current;
    if(previous){
      setOrganization(previous.organization);setSourceId(previous.sourceId);setFilters(previous.filters);
      setSearch(previous.search);setRelationFilter(previous.relationFilter);
      setSelectedPath(catalog.some(node=>node.path===previous.selectedPath)?previous.selectedPath:null);
    }else{setOrganization('sources');setSourceId(null);setFilters(value=>({...value,centers:[]}));setSelectedPath(null);}
    requestAnimationFrame(()=>{const node=[...svg.current.querySelectorAll('[data-graph-node]')].find(el=>el.dataset.graphNode===previous?.selectedPath);(node??optionsTrigger.current)?.focus();});
  };
  const focusNode = path => { rememberCenter([path]);setOrganization('center');setFilters(value => ({...value,centers:[path],hops:value.hops || 1})); setSelectedPath(path); };
  const showRelated=path=>{rememberCenter([path]);setOrganization('center');setFilters({...emptyFilters(),centers:[path],hops:1});setSelectedPath(path);};
  const inspectSearchResult=path=>{
    if(organization==='sources'&&(overview||!completeStudy.nodes.some(node=>node.path===path))){
      const group=groups.find(group=>group.path===path||group.nodes.some(node=>node.path===path));
      if(group)enterSource(group.id);
      else {rememberCenter([path]);setOrganization('center');setFilters({...emptyFilters(),centers:[path],hops:0});}
    }
    setSearch('');setSettings(false);setSelectedPath(path);
  };
  const changePicked = paths => {setPicked(paths);setSelectionNotice('');};
  const addPicked = paths => {try{changePicked(mergeSelection(picked,paths));}catch(error){setSelectionNotice(error.message);}};
  const togglePicked = path => picked.includes(path)?changePicked(picked.filter(value=>value!==path)):addPicked([path]);
  selectionActions.current={enabled:Boolean(onBring),selecting,chooseBox:(paths,additive)=>{try{changePicked(mergeSelection(additive?picked:[],paths));}catch(error){setSelectionNotice(error.message);}}};
  const expandPicked=()=>{rememberCenter(picked);setOrganization('center');setFilters(value=>({...value,centers:picked,type:'all',tags:[],hops:value.hops||1}));setSelectedPath(null);};
  const hiddenPicked=picked.filter(path=>!graph.nodes.some(node=>node.path===path)).length;
  const foldedPicked=picked.filter(path=>foldedPaths.has(path)).length;
  const bring = async()=>{
    const paths=[...picked],byPath=new Map(catalog.map(node=>[node.path,node]));
    setBringing(true);setSelectionNotice('');clearSuccess();
    try{
      const pins=paths.map(path=>{const node=byPath.get(path);if(!node)throw new Error('所选资料已变化，请刷新后重新选择');return {path,title:node.title,revision:node.revision};});
      await onBring(pins);
      // The host may hide/unmount this surface while revealing the composer.
      // Clear the workspace-owned snapshot even when no React effect will run.
      setPicked(previous=>previous.filter(path=>!paths.includes(path)));showSuccess('已放入当前对话草稿，尚未发送。');
    }catch(error){setSelectionNotice(error.message||'暂时无法带入，已保留选择。');}
    finally{setBringing(false);}
  };
  const changeOrganization=value=>{
    if(value==='center'&&!filters.centers.length){setAdvanced('centers');return;}
    setCenterHistory([]);setOrganization(value);setSourceId(null);setSelectedPath(null);
    if(value!=='center')setFilters(previous=>({...previous,centers:[]}));
  };
  return <section className="nv-block-graph nv-graph-canvas-first" aria-label="知识联系图">{successToast}
    <header className="nv-graph-header"><h2>知识图谱</h2><div className="nv-graph-corner-actions">
      {organization==='sources'&&sourceId&&<button ref={sourceBackRef} type="button" aria-label="返回资料概览" title="返回图谱" onClick={leaveSource}>←</button>}
      {organization!=='sources'&&(filters.centers.length>0||centerHistory.length>0)&&<button type="button" aria-label="返回上一级图谱" title="返回上一级图谱" onClick={leaveCenter}>←</button>}
      <button ref={optionsTrigger} type="button" aria-label="图谱选项" title="图谱设置" aria-expanded={settings} aria-controls={optionsId} onClick={()=>setSettings(value=>!value)}><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m9 3-.7 2.4-2 .9-2.3-.7-2 3.4 1.6 1.8v2.4L2 15l2 3.4 2.3-.7 2 .9L9 21h4l.7-2.4 2-.9 2.3.7 2-3.4-1.6-1.8v-2.4L20 9l-2-3.4-2.3.7-2-.9L13 3Z"/><circle cx="11" cy="12" r="3"/></svg></button>
    </div></header>
    <div ref={optionsRef} className="nv-graph-options" id={optionsId} role="region" aria-label="图谱选项" hidden={!settings}>
      <header><strong>图谱</strong><button type="button" aria-label="关闭图谱选项" onClick={closeSettings}>×</button></header>
      <label>视图<select aria-label="图谱视图" value={organization} onChange={event=>changeOrganization(event.target.value)}><option value="sources">按来源聚合</option><option value="knowledge">按知识点聚合</option><option value="center">以资料为中心</option><option value="all">全部联系</option></select></label>
      <div className="nv-graph-search"><input type="search" aria-label="搜索图谱" placeholder="搜索资料…" value={search} onChange={event=>setSearch(event.target.value)} onKeyDown={event=>{if(event.key==='Escape'){setSearch('');event.stopPropagation();}}}/></div>
      {query&&<GraphContentList key={'search:'+query+':'+filters.type} label="图谱搜索结果" nodes={searchResults} picked={picked} onOpen={open} onInspect={inspectSearchResult} onToggle={onBring?togglePicked:undefined}/>}
      <div className="nv-graph-filter-row"><select aria-label="图谱资料类型" value={filters.type||'all'} onChange={event=>setFilters(value=>({...value,type:event.target.value}))}>{GRAPH_TYPES.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><button type="button" onClick={()=>setAdvanced('tags')}>标签筛选</button></div>
      {filters.tags.length>0&&<div className="nv-graph-filter-chips">{filters.tags.map(tag=><button key={tag} aria-label={'移除图谱标签 '+(tagNames.get(tag)||tag)} onClick={()=>toggleTag(tag)}>#{tagNames.get(tag)||tag} ×</button>)}</div>}
      <div className="nv-graph-center-bar" aria-label="节点邻域"><button type="button" onClick={()=>setAdvanced('centers')}>中心节点</button>{filters.centers.length>0&&<><select aria-label="中心联系范围" value={filters.hops} onChange={event=>setFilters(value=>({...value,hops:Number(event.target.value)}))}><option value="0">仅中心节点</option><option value="1">直接相连</option><option value="2">两层联系</option><option value="3">三层联系</option></select><button type="button" onClick={()=>changeOrganization('sources')}>退出中心</button></>}</div>
      {filters.centers.length>0&&<div className="nv-graph-filter-chips">{filters.centers.map(path=><button key={path} aria-label={'移除中心 '+(choices.find(node=>node.path===path)?.title||path)} onClick={()=>setFilters(value=>({...value,centers:value.centers.filter(item=>item!==path)}))}>{choices.find(node=>node.path===path)?.title||path} ×</button>)}</div>}
      <label>联系<select aria-label="知识联系筛选" value={relationFilter} onChange={event=>setRelationFilter(event.target.value)}><option value="all">全部</option><option value="established">已建立</option><option value="potential">潜在／待建立</option></select></label>
      <label>标题<select aria-label="图谱标题显示" value={labelMode} onChange={event=>setLabelMode(event.target.value)}><option value="auto">按需显示</option><option value="all">全部显示</option><option value="none">仅悬停时显示</option></select></label>
      <GraphRelationLegend arrowId={arrowId}/>
      <details><summary>图谱操作</summary><div className="nv-block-toolbar">
        <button type="button" onClick={()=>setAdvanced('all')}>高级搜索</button>
        {onBring&&<><button type="button" aria-pressed={selecting} onClick={()=>{setSelecting(value=>!value);closeSettings();}}>{selecting?'退出框选':'框选资料'}</button><button type="button" disabled={!batchCandidates.length||status!=='ready'} onClick={()=>addPicked(batchCandidates.map(node=>node.path))}>选中{query?'匹配项':'当前结果'}</button></>}
        <button type="button" onClick={()=>{setFilters(emptyFilters());setRelationFilter('all');setSearch('');setSelectedPath(null);}}>清空筛选</button>
        <button type="button" onClick={()=>{renderer.current?.release();changed.current?.(viewState,'layout');}}>释放固定</button>
        <button type="button" aria-label="适应当前范围" onClick={()=>setView(renderer.current?.fit()||{x:0,y:0,scale:1})}>适应画布</button>
        <button type="button" aria-label="放大图谱" onClick={()=>setView(value=>zoomAt(value,{x:width/2,y:canvasHeight/2},value.scale*1.2))}>＋</button><button type="button" aria-label="缩小图谱" onClick={()=>setView(value=>zoomAt(value,{x:width/2,y:canvasHeight/2},value.scale/1.2))}>−</button>
      </div></details>
    </div>
    {advanced&&<GraphSearchDialog mode={advanced} data={scopedResult} nodes={choices} filters={filters} relations={relations} centerRelations="all" onClose={()=>setAdvanced(false)} onApply={value=>{if(value.centers.length){rememberCenter(value.centers);setOrganization('center');}setFilters({...value,type:filters.type});setAdvanced(false);closeSettings();}}/>}
    {selectionDialog&&<GraphSelectionDialog graph={selectionGraph} selected={picked} onApply={changePicked} onClose={()=>setSelectionDialog(null)}/>}
    {menu&&<GraphContextMenu position={menu} count={picked.length} busy={bringing} onClose={()=>setMenu(null)} onBring={bring} onExpand={expandPicked} onClear={()=>changePicked([])}/>}
    {status==='loading'&&<p className="nv-graph-notice" role="status">正在读取…</p>}
    {status==='failed'&&<p className="nv-graph-notice" role="alert">暂时无法读取图谱。<button onClick={()=>setReload(n=>n+1)}>重试</button></p>}
    <div className="nv-graph-canvas-wrap">
    <svg ref={svg} data-presentation={graph.presentation} data-label-mode={labelMode} data-dense={graph.nodes.length>80?'true':undefined} className={'nv-block-graph-canvas'+(selecting?' nv-graph-box-mode':'')} viewBox={'0 0 ' + width + ' ' + canvasHeight} aria-label="单击团簇展开，单击节点查看，Ctrl或Command单击多选；双击节点打开，拖动平移" onPointerOver={clusterAttention} onPointerLeave={()=>setHoveredClusterKey(null)} onFocus={clusterAttention} onBlur={()=>setHoveredClusterKey(null)} onKeyDown={event=>{const key=event.target.closest('[data-cluster-key]')?.dataset.clusterKey;if(key&&['Enter',' '].includes(event.key)){event.preventDefault();if(!selecting&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey)enterSource(key,true);}if(event.key==='Escape'){gestures.current?.cancel();setSelecting(false);setMenu(null);}}} onContextMenu={event=>{if(!onBring)return;event.preventDefault();const path=event.target.closest('[data-graph-node]')?.getAttribute('data-graph-node');if(path&&!picked.includes(path))changePicked([path]);setMenu({x:event.clientX,y:event.clientY});}} onClick={event => { if(!gestures.current?.canOpen())return;const key=event.target.closest('[data-cluster-key]')?.dataset.clusterKey;if(key&&!selecting&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey){enterSource(key,true);return;}if(!event.target.closest('[data-graph-node]'))setSelectedPath(null); }}>
      <defs><marker id={arrowId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9" fill="none" stroke="var(--nv-g-prerequisite)" strokeWidth="1.5"/></marker></defs>
      <g>
        <g className="nv-graph-cluster-backdrops"/>
        <g className="nv-graph-cycle-groups"/>
        {drawingEdges.map((edge,i) => {const Shape=edge.source===edge.target||edge.kind==='association'?'path':'line',description=edgeDescription(edge,edgeKinds[i],edgeNodes);return <g key={edge.organization?`organization:${edge.target}`:graphEdgeKey(edge)} className="nv-graph-edge-group" style={visibleEdges[i]?undefined:{display:'none'}} aria-hidden={visibleEdges[i]?undefined:true}>
          <Shape data-graph-edge="true" data-self-loop={edge.source===edge.target?'true':undefined} fill="none" markerEnd={edge.kind==='prerequisite'?`url(#${arrowId})`:undefined} style={visibleEdges[i]?undefined:{display:'none'}} aria-hidden={visibleEdges[i]?undefined:true} data-relation-id={edge.id} data-relation-context={edge.context} data-relation-kind={edge.organization?'organization':edgeKinds[i]} data-source-branch={edge.organization?'true':undefined} className={(edge.organization?'nv-graph-source-branch':'nv-block-edge')+' nv-block-edge-' + edge.style+' nv-graph-edge-'+edgeKinds[i]+(isLearningRelation(edgeKinds[i])?' nv-graph-edge-knowledge':'') + (clusterPaths?(!clusterPaths.has(edge.source)||!clusterPaths.has(edge.target)?' nv-graph-edge-muted':''):(activeSelected&&edge.source!==activeSelected&&edge.target!==activeSelected?' nv-graph-edge-muted':'')) + (crossEdges.has(graphEdgeKey(edge))?' nv-graph-edge-cross':'')}><title>{description}</title></Shape>
          <Shape className="nv-graph-edge-hit" fill="none" aria-hidden="true"><title>{description}</title></Shape>
        </g>;})}
        {graph.nodes.map(node => { const a = nodeAppearance(node); return <g key={node.path} data-graph-node={node.path} data-source-layer={node.sourceLayer} role="button" tabIndex={0} aria-pressed={onBring?picked.includes(node.path):undefined} aria-label={overview&&isOriginalSource(node)?`展开${node.title}，${groups.find(group=>group.path===node.path)?.nodes.length??0}张卡片`:node.title+'，按回车打开'} className={'nv-block-node nv-block-node-' + a.kind + (isOriginalSource(node) ? ' nv-graph-node-source' : '') + (matches(node) ? (query?' nv-graph-search-match':'') : ' nv-block-dim') + ((clusterPaths&&!clusterPaths.has(node.path)||!clusterPaths&&activeSelected&&!neighbors.has(node.path))?' nv-graph-node-muted':'') + (sharedHighlights.has(node.path)?' nv-graph-shared-highlight':'') + (node.center ? ' nv-block-center' : '') + (node.path === selectedPath ? ' nv-block-selected' : '') + (picked.includes(node.path)?' nv-block-picked':'') + (a.independent ? ' nv-block-independent' : '')} onClick={event => { if(event.shiftKey&&!selectionModifier(event))return; if(gestures.current?.canOpen()){if(onBring&&(selecting||selectionModifier(event))){setSelectedPath(null);togglePicked(node.path);}else if(overview&&isOriginalSource(node))enterSource(JSON.stringify(['source',node.path]),true);else setSelectedPath(node.path);} }} onDoubleClick={event => { if (!selectionModifier(event)&&!event.shiftKey&&gestures.current?.canOpen()) open(node.path); }} onKeyDown={event => { if(event.key === 'Escape')setSelectedPath(null); if (event.key === 'Enter') { event.preventDefault(); if(overview&&isOriginalSource(node))enterSource(JSON.stringify(['source',node.path]),true);else open(node.path); } if (event.key === ' ') { event.preventDefault(); if(onBring&&(selecting||selectionModifier(event)))togglePicked(node.path);else if(graph.presentation==='backbone')setSelectedPath(node.path);else focusNode(node.path); } }}><NodeGlyph radius={a.radius+5} source={isOriginalSource(node)} focus/><NodeGlyph radius={a.radius} source={isOriginalSource(node)}/><text x={a.radius + 6} y="4">{graphLabelLines(node.title).map((line,i)=><tspan key={i} x={a.radius+6} y={4+i*16}>{line}</tspan>)}</text><title>{node.title}</title></g>; })}
      </g>
      {box&&<rect className="nv-graph-marquee" x={box.x} y={box.y} width={box.width} height={box.height}/>}
    </svg>
    {selected && <aside className="nv-graph-node-detail" aria-label="选中节点">
      <header><strong>{selected.title}</strong><button type="button" aria-label="取消节点选择" onClick={()=>setSelectedPath(null)}>×</button></header>
      <div className="nv-graph-node-actions"><button type="button" className="nv-graph-tag-trigger" onClick={()=>organization==='sources'?showRelated(selected.path):focusNode(selected.path)}>{organization==='sources'?(crossEdges.size?'查看跨资料联系':'查看全部关联'):'以此为中心'}</button><button type="button" onClick={()=>open(selected.path)}>打开文档 ↗</button>{onBring&&<button type="button" aria-pressed={picked.includes(selected.path)} onClick={()=>togglePicked(selected.path)}>{picked.includes(selected.path)?'移出候选':'加入候选'}</button>}</div>
      {['concept','method'].includes(selected.type)&&examples.length>0&&<details><summary>具体例子 · {examples.length}</summary><GraphContentList showHeader={false} key={'examples:'+selected.path} label="具体例子" nodes={examples} picked={picked} onOpen={open} onInspect={setSelectedPath} onToggle={onBring?togglePicked:undefined}/></details>}
      {isOriginalSource(selected)&&<GraphContentList key={'source:'+selected.path} label="资料中的卡片" nodes={groups.find(group=>group.path===selected.path)?.nodes??[]} picked={picked} onOpen={open} onInspect={setSelectedPath} onToggle={onBring?togglePicked:undefined}/>}
      {selected.sourcePaths?.some(path=>catalog.some(node=>node.path===path))&&<section className="nv-graph-detail-sources" aria-label="原始来源"><h3>来源</h3>{[...new Set(selected.sourcePaths)].map(path=>{const source=catalog.find(node=>node.path===path);return source&&<button key={path} type="button" onClick={()=>open(path)}>{source.title} ↗</button>;})}</section>}
      {selected.tags?.length>0&&<div className="nv-graph-filter-chips">{graphTags(selected).slice(0,6).map(tag=><span key={tag.value}><button type="button" aria-label={(tag.target?'筛选知识标签 ':'筛选节点标签 ')+tag.label} aria-pressed={filters.tags.includes(tag.value)} disabled={!filters.tags.includes(tag.value)&&filters.tags.length>=32} onClick={()=>toggleTag(tag.value)}>#{tag.label}</button>{tag.target&&<button type="button" aria-label={'打开知识实体 '+tag.label} onClick={()=>open(tag.target)}>↗</button>}</span>)}</div>}
      {selected.dependencyCycle&&<p>这些知识形成局部循环，可打开原文核对，不影响继续学习。</p>}
      {graph.relationsVersion===2&&<ul className="nv-graph-dependencies" aria-label="前序路线">{(scopedResult?.edges??[]).filter(edge=>edge.kind==='prerequisite'&&edge.target===selected.path).map(edge=><li key={graphEdgeKey(edge)}><button type="button" onClick={()=>open(edge.source)}>{catalog.find(node=>node.path===edge.source)?.title}</button> · {edge.context?`可选路线：${edge.context}`:'共同前序'}{edge.description?`：${readableReferences(edge.description)}`:''}</li>)}</ul>}
    </aside>}
    </div>
    {onBring&&picked.length>0&&<div className="nv-graph-bring-bar"><button type="button" disabled={!picked.length} onClick={()=>setSelectionDialog(true)}>已选 {picked.length} / {GRAPH_SELECTION_LIMIT}{foldedPicked?` · ${foldedPicked} 项未展开`:''}{hiddenPicked-foldedPicked?` · ${hiddenPicked-foldedPicked} 项在筛选外`:''}</button>{picked.length>0&&<><button type="button" onClick={()=>changePicked([])}>清空选择</button><button type="button" onClick={expandPicked}>展开关联</button></>}<button type="button" className="nv-graph-bring-primary" disabled={!picked.length||bringing||status!=='ready'} onClick={bring}>{bringing?'正在带入…':'带入当前对话'}</button></div>}
    {selectionNotice&&<p className="nv-graph-notice" role="status">{selectionNotice}</p>}
  </section>;
}
