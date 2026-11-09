import { createSimulation, isOriginalSource } from './graph.js';
import {clampScale} from './graph-gestures.js';
import {labelMetrics,nodeLabelBounds,visibleGraphLabels,graphLabelLines} from './graph-layout.js';
import {SOURCE_CLUSTER_ORIGIN_KEY} from './source-cluster-layout.js';
import {edgeGeometry} from './graph-edge-display.js';

/** Own only geometry attributes. React owns node identity, labels and controls. */
export function createGraphRenderer(svg, positions, initialView, centerOrigins = new Map(), onPositionsChange) {
  const group = svg.querySelector(':scope > g');
  let live = null, nodeElements = new Map(), edgeElements = [], edgeHitElements = [], edgePositions=[], view = initialView;
  const labelMeasurements=new Map(),nodeParts=new Map(),attributes=new WeakMap(),headingBoxes=new WeakMap(),layoutCache=new Map();
  let screenScale=1,screenDirty=true,fontEpoch=0;
  const attr=(element,key,value)=>{if(!element)return;value=String(value);let previous=attributes.get(element);if(!previous){previous=new Map();attributes.set(element,previous);}if(previous.get(key)!==value){element.setAttribute(key,value);previous.set(key,value);}};
  let frame = null, geometryDirty = false, cameraDirty = true, labelsDirty = true, active = true, disposed = false;
  let width = 960, height = 580, dragging = false, settled = false;
  const cycleBounds=members=>({left:Math.min(...members.map(node=>node.x+node.labelBounds.left))-16,right:Math.max(...members.map(node=>node.x+node.labelBounds.right))+16,top:Math.min(...members.map(node=>node.y+node.labelBounds.top))-(members.length===1?80:30),bottom:Math.max(...members.map(node=>node.y+node.labelBounds.bottom))+12});
  const remember = () => {
    // A center's automatic arrangement must not overwrite the full graph.
    let changed=false;
    for (const node of live?.nodes ?? []) if(!(live.centered||live.hierarchical)||node.fx!=null||node.fy!=null){const previous=positions.get(node.path);if(!previous||previous.x!==node.x||previous.y!==node.y||previous.fx!==node.fx||previous.fy!==node.fy){positions.set(node.path, { x: node.x, y: node.y, fx: node.fx, fy: node.fy });changed=true;}}
    if(changed)onPositionsChange?.();
  };
  const placeLabel = (node,element) => {
    const parts=nodeParts.get(node.path),label=parts?.text;if(!label)return;
    const side=node.labelSide??1,x=side*18,spans=parts.spans;
    attr(label,'text-anchor',side<0?'end':side===0?'middle':'start');
    if(!spans.length){attr(label,'x',x);attr(label,'y',4);}
    spans.forEach((span,i)=>{attr(span,'x',x);attr(span,'y',(side===0?26:4-(spans.length-1)*8)+i*16);});
    if(parts.side!==side){parts.side=side;parts.box=null;}
  };
  const updateClusterHeadings = () => {
    const scale=Math.max(1,view.scale*screenScale);
    for(const cluster of live?.clusters??[]){
      const heading=cluster.heading;if(!heading)continue;
      const anchor=cluster.empty?live.nodes.find(node=>node.path===cluster.sourcePath)??cluster:cluster;
      const lines=[...heading.children],lastY=cluster.empty?anchor.y+(24+(lines.length-1)*16)/scale:cluster.y-cluster.radius-31;
      const size=`${13/scale}px`;if(heading.style.fontSize!==size){heading.style.fontSize=size;headingBoxes.delete(heading);}
      lines.forEach((line,i)=>{attr(line,'x',anchor.x);attr(line,'y',lastY-(lines.length-1-i)*16/scale);});
    }
  };
  const headingBox=heading=>{
    const first=heading.firstElementChild??heading,x=Number(first.getAttribute('x')??0),y=Number(first.getAttribute('y')??0);
    let entry=headingBoxes.get(heading);
    if(!entry||entry.epoch!==fontEpoch){const b=heading.getBBox();entry={epoch:fontEpoch,left:b.x-x,right:b.x+b.width-x,top:b.y-y,bottom:b.y+b.height-y};headingBoxes.set(heading,entry);}
    return {left:entry.left+x,right:entry.right+x,top:entry.top+y,bottom:entry.bottom+y};
  };
  const updateLabels = () => {
    if(!live)return;
    const labels=live.nodes.map(node=>{
      const element=nodeElements.get(node.path),parts=nodeParts.get(node.path),text=parts?.text;
      const weight=element?.classList.contains('nv-block-selected')||element?.classList.contains('nv-block-center');
      if(text&&(!parts.box||parts.weight!==weight||parts.epoch!==fontEpoch)){parts.box=text.getBBox();parts.weight=weight;parts.epoch=fontEpoch;}
      const box=parts?.box;
      // Qualify dynamic pseudos: Chromium 153 can return false for bare
      // matches(':hover') even when g:hover and computed hover styles agree.
      const forced=Boolean(element?.matches('g:hover,g:focus,.nv-block-selected,.nv-block-picked,.nv-graph-search-match,.nv-graph-shared-highlight'));
      const mode=svg.dataset.labelMode;
      const overview=svg.dataset.presentation?.endsWith('overview');
      const quiet=mode==='none'||mode==='auto'&&((overview&&view.scale<=1.5)||view.scale<.8);
      return {path:node.path,hidden:live.clusters?.some(cluster=>cluster.empty&&cluster.sourcePath===node.path)||!forced&&(quiet||live.clustered&&isOriginalSource(node)),forced,priority:forced?100:node.center?90:isOriginalSource(node)?80:node.sourceLayer==='knowledge'?75:new Set(Array.isArray(node.sourcePaths)?node.sourcePaths:[]).size>1?70:0,box:box?{left:node.x+box.x,right:node.x+box.x+box.width,top:node.y+box.y,bottom:node.y+box.y+box.height}:{left:node.x,right:node.x,top:node.y,bottom:node.y}};
    });
    const obstacles=live.nodes.map(node=>({path:node.path,box:{left:node.x-12,right:node.x+12,top:node.y-12,bottom:node.y+12}}));
    for(const cluster of live.clusters??[])if(cluster.heading)obstacles.push({path:'cluster-heading',box:headingBox(cluster.heading)});
    for(const cycle of live.cycleGroups??[])obstacles.push({path:'cycle-heading',box:headingBox(cycle.heading)});
    const visible=visibleGraphLabels(labels.filter(label=>!label.hidden),view.scale,obstacles);
    return labels.map(({path})=>[nodeElements.get(path),visible.has(path)?'false':'true']);
  };
  const paint = () => {
    frame = null;
    if (disposed || !active) return;
    // Read stable geometry before writing thousands of node/edge coordinates.
    // The outer SVG scale changes with its viewport, not with the camera <g>.
    if(screenDirty){const screen=svg.getScreenCTM();screenScale=screen?Math.hypot(screen.a,screen.b):1;screenDirty=false;}
    // A zoom also resizes cluster captions. Commit its transform before that
    // occasional text measurement, so SVG does not lay out both camera poses.
    if (cameraDirty) { attr(group,'transform', `translate(${view.x} ${view.y}) scale(${view.scale})`);svg.dataset.labelDensity=view.scale<1.15?'compact':'full'; cameraDirty = false; }
    let visibility;
    if(labelsDirty){
      updateClusterHeadings();
      for(const cycle of live?.cycleGroups??[]){const b=cycleBounds(cycle.members);attr(cycle.heading,'x',b.left+8);attr(cycle.heading,'y',b.top+14);}
      visibility=updateLabels();labelsDirty=false;
    }
    if (geometryDirty && live) {
      for (const node of live.nodes) {
        const element = nodeElements.get(node.path);
        attr(element,'transform', `translate(${node.x} ${node.y})`);
        const title = nodeParts.get(node.path)?.title;
        const text = `${node.title ?? node.path}${node.fx != null ? '（已固定）' : ''}${node.independentReviewCount>0?'（曾有无提示完成记录）':''}`;
        if (title&&title.textContent!==text) title.textContent = text;
      }
      live.links.forEach((edge, index) => {
        const element = edgeElements[index];
        if (!element) return;
        const previous=edgePositions[index],sx=edge.source.x,sy=edge.source.y,tx=edge.target.x,ty=edge.target.y;
        if(previous&&previous[0]===sx&&previous[1]===sy&&previous[2]===tx&&previous[3]===ty)return;
        edgePositions[index]=[sx,sy,tx,ty];
        const geometry=edgeGeometry(edge,live.parallelEdges.get(edge.parallelKey));
        for(const target of [element,edgeHitElements[index]])if(target)for(const [key,value] of Object.entries(geometry))attr(target,key,value);
      });
      for(const cycle of live.cycleGroups??[]){const b=cycleBounds(cycle.members);for(const [key,value] of Object.entries({x:b.left,y:b.top,width:b.right-b.left,height:b.bottom-b.top}))attr(cycle.rect,key,value);}
      geometryDirty = false;
    }
    for(const [element,hidden]of visibility??[])attr(element,'data-label-hidden',hidden);
  };
  const requestPaint = geometry => {
    geometryDirty ||= geometry;
    labelsDirty ||= geometry;
    if (!disposed && active && frame === null) frame = requestAnimationFrame(paint);
  };
  const start = (alpha = .15) => {
    if (!live) return;
    settled = false;
    live.simulation.alpha(Math.max(alpha, live.simulation.alpha()));
    if (active) live.simulation.restart();
  };
  const labelAttention=()=>{labelsDirty=true;requestPaint(false);};
  const fontsChanged=()=>{fontEpoch++;labelMeasurements.clear();labelAttention();};
  const appearance=new MutationObserver(fontsChanged);
  for(const element of [document.documentElement,document.body])if(element)appearance.observe(element,{attributes:true,attributeFilter:['class','style','data-notara-theme']});
  document.fonts?.addEventListener('loadingdone',fontsChanged);
  for(const event of ['pointerover','pointerout','focusin','focusout'])svg.addEventListener(event,labelAttention);
  return {
    setGraph(graph) {
      const wasClustered=Boolean(live?.clustered),wasHierarchical=Boolean(live?.hierarchical),hadNodes=Boolean(live?.nodes.length);
      remember(); live?.simulation.stop();
      nodeElements = new Map([...group.querySelectorAll('[data-graph-node]')].map(element => [element.getAttribute('data-graph-node'), element]));
      for(const [path,element]of nodeElements){const text=element.querySelector('text');nodeParts.set(path,{text,title:element.querySelector('title'),spans:[...(text?.querySelectorAll('tspan')??[])]});}
      for(const path of nodeParts.keys())if(!nodeElements.has(path))nodeParts.delete(path);
      edgeElements = [...group.querySelectorAll('[data-graph-edge]')];
      edgePositions=[];
      edgeHitElements = edgeElements.map(element=>element.parentElement.querySelector('.nv-graph-edge-hit'));
      const measurements=new Map(graph.nodes.map(node=>{
        const text=nodeParts.get(node.path)?.text,font=text?getComputedStyle(text).font:'',previous=labelMeasurements.get(node.path);
        if(previous?.title===node.title&&previous.font===font)return [node.path,previous.metrics];
        const box=text?.getBBox(),metrics=box?.width>0&&box?.height>0?{width:Math.ceil(box.width),height:Math.ceil(box.height)}:labelMetrics(node);
        if(box?.width>0&&box?.height>0)labelMeasurements.set(node.path,{title:node.title,font,metrics});
        return [node.path,metrics];
      }));
      for(const path of labelMeasurements.keys())if(!nodeElements.has(path))labelMeasurements.delete(path);
      const centers=graph.nodes.filter(node=>node.center).map(node=>node.path).sort(),key=centers.length?JSON.stringify(centers):SOURCE_CLUSTER_ORIGIN_KEY;
      let origin;
      if(centers.length||graph.layout==='source-clusters'){
        origin=centerOrigins.get(key)??{x:width/2,y:height/2};
        centerOrigins.delete(key);centerOrigins.set(key,origin);
        if(centerOrigins.size>12)centerOrigins.delete(centerOrigins.keys().next().value);
      }
      live = createSimulation(graph, () => { remember(); requestPaint(true); }, width, height, positions,measurements,origin,layoutCache);
      live.parallelEdges=new Map();
      for(const edge of live.links){edge.parallelKey=JSON.stringify([edge.source.path,edge.target.path].sort());if(!live.parallelEdges.has(edge.parallelKey))live.parallelEdges.set(edge.parallelKey,[]);live.parallelEdges.get(edge.parallelKey).push(edge);}
      svg.dataset.layout=live.hierarchical?'source-hierarchy':live.clustered?'source-clusters':live.centered?'center':'free';
      const backdrops=group.querySelector('.nv-graph-cluster-backdrops');
      if(backdrops){
        // Keep surviving groups mounted: replacing a focused SVG group drops focus.
        const remaining=new Map([...backdrops.children].map(element=>[element.dataset.clusterKey,element]));
        for(const cluster of live.clusters??[]){
          const layer=remaining.get(cluster.key)??document.createElementNS('http://www.w3.org/2000/svg','g');remaining.delete(cluster.key);
          layer.classList.add('nv-graph-cluster-backdrop');layer.dataset.clusterKind=cluster.kind;
          layer.dataset.clusterKey=cluster.key;layer.setAttribute('role','button');layer.setAttribute('tabindex','0');
          const members=graph.sourceGroups?.find(group=>group.id===cluster.key)?.nodes;
          const memberCount=members?.length??cluster.memberPaths.length,sharedCount=members?.filter(node=>new Set(node.sourcePaths??[]).size>1).length??cluster.sharedPaths.length;
          cluster.empty=Boolean(cluster.sourcePath)&&memberCount===0;
          layer.dataset.empty=String(cluster.empty);
          const count=`${memberCount} 张卡片${sharedCount?` · 共享 ${sharedCount}`:''}`;
          layer.setAttribute('aria-label',`展开${cluster.title}，${count}`);
          if(cluster.sourcePath)layer.dataset.sourcePath=cluster.sourcePath;else delete layer.dataset.sourcePath;
          const ellipse=document.createElementNS('http://www.w3.org/2000/svg','ellipse');
          for(const [key,value] of Object.entries({cx:cluster.x,cy:cluster.y,rx:cluster.radius,ry:cluster.radius}))ellipse.setAttribute(key,value);
          const title=document.createElementNS('http://www.w3.org/2000/svg','text');title.setAttribute('class','nv-graph-cluster-heading');
          const lines=graphLabelLines(cluster.title);
          lines.forEach((line,i)=>{const span=document.createElementNS('http://www.w3.org/2000/svg','tspan');span.setAttribute('x',cluster.x);span.setAttribute('y',cluster.y-cluster.radius-31-(lines.length-1-i)*17);span.textContent=line;title.append(span);});
          cluster.heading=title;layer.replaceChildren(...(cluster.empty?[title]:[ellipse,title]));
          if(layer.parentNode!==backdrops)backdrops.append(layer);
        }
        for(const element of remaining.values())element.remove();
      }
      for(const node of live.nodes){
        node.labelBounds??=nodeLabelBounds(node,measurements.get(node.path));
        const element=nodeElements.get(node.path);
        // Compact example fields must hit their painted circle, not the SVG
        // bounding box of a hidden long title covering neighboring examples.
        if(element)element.style.pointerEvents=node.layoutTarget?.compact?'visiblePainted':'';
        placeLabel(node,element);
      }
      const cycleLayer=group.querySelector('.nv-graph-cycle-groups');live.cycleGroups=[];
      if(cycleLayer){cycleLayer.replaceChildren();const groups=new Map();for(const node of live.nodes)if(node.dependencyCycle){if(!groups.has(node.dependencyGroup))groups.set(node.dependencyGroup,[]);groups.get(node.dependencyGroup).push(node);}
        for(const [key,members] of groups){const layer=document.createElementNS('http://www.w3.org/2000/svg','g'),rect=document.createElementNS(layer.namespaceURI,'rect'),heading=document.createElementNS(layer.namespaceURI,'text');layer.dataset.cycleGroup=key;layer.setAttribute('role','group');layer.setAttribute('aria-label',`${members.length===1?'自环声明':'局部循环'}：${members.map(node=>node.title).join('、')}，点击节点查看声明`);rect.setAttribute('class','nv-graph-cycle-frame');rect.setAttribute('rx','8');heading.setAttribute('class','nv-graph-cycle-heading');heading.textContent=members.length===1?'自环声明':`局部循环 · ${members.length} 项`;layer.append(rect,heading);cycleLayer.append(layer);live.cycleGroups.push({members,rect,heading});}
      }
      live.simulation.on('end.renderer', () => { settled = true; });
      settled = false;
      if (!active) live.simulation.stop();
      requestPaint(true);
      return hadNodes&&(wasClustered!==Boolean(live.clustered)||wasHierarchical!==Boolean(live.hierarchical));
    },
    getNode: path => live?.nodes.find(node => node.path === path),
    getNodes: () => live?.nodes ?? [],
    setClusterHighlight(key){for(const element of group.querySelectorAll('[data-cluster-key]'))element.classList.toggle('is-highlighted',element.dataset.clusterKey===key);},
    refreshLabels: labelAttention,
    setView(next) { labelsDirty ||= next.scale!==view.scale;view = next; cameraDirty = true; requestPaint(false); },
    setSize(nextWidth, nextHeight) {
      if(width!==nextWidth||height!==nextHeight){screenDirty=true;labelsDirty=true;}
      width = nextWidth; height = nextHeight;
      // Resizing changes the camera viewport, not the graph's world center.
      // In particular, fitting a formerly hidden graph must not be followed by
      // a second force-center translation when its simulation resumes.
    },
    setActive(next) {
      if (active === next) return;
      active = next;
      if (!active) { live?.simulation.stop(); if (frame !== null) cancelAnimationFrame(frame); frame = null; }
      else {screenDirty=true; if (live && !settled) live.simulation.restart(); requestPaint(true); }
    },
    drag(phase) {
      if (!live) return;
      if (phase === 'start') { dragging = true; live.simulation.alphaTarget(.06); start(); }
      if (phase === 'move') { remember(); requestPaint(true); }
      if (phase === 'end' && dragging) {
        dragging = false; live.simulation.alphaTarget(0);
        if (live.nodes.every(node => node.fx != null && node.fy != null)) { live.simulation.stop(); settled = true; }
        remember(); requestPaint(true);
      }
    },
    release() { for (const node of live?.nodes ?? []) { node.fx = null; node.fy = null;const previous=positions.get(node.path);if(previous)positions.set(node.path,{...previous,fx:null,fy:null}); } remember(); start(.3); requestPaint(true); },
    fit() {
      const nodes = live?.nodes ?? [];
      if (!nodes.length) return { x: 0, y: 0, scale: 1 };
      let left = Math.min(...nodes.map(node => node.x+node.labelBounds.left))-16, right = Math.max(...nodes.map(node => node.x+node.labelBounds.right))+16;
      let top = Math.min(...nodes.map(node => node.y+node.labelBounds.top))-16, bottom = Math.max(...nodes.map(node => node.y+node.labelBounds.bottom))+16;
      for(const cluster of live.clusters??[]){left=Math.min(left,cluster.x-Math.max(cluster.radius,96)-16);right=Math.max(right,cluster.x+Math.max(cluster.radius,96)+16);top=Math.min(top,cluster.y-cluster.radius-70);bottom=Math.max(bottom,cluster.y+cluster.radius+16);}
      for(const cycle of live.cycleGroups??[]){const b=cycleBounds(cycle.members);left=Math.min(left,b.left-12);right=Math.max(right,b.right+12);top=Math.min(top,b.top-12);bottom=Math.max(bottom,b.bottom+12);}
      for(const edge of live.links??[])if(edge.source===edge.target){const radius=40+(live.parallelEdges.get(edge.parallelKey).length-1)*12;left=Math.min(left,edge.source.x-radius);right=Math.max(right,edge.source.x+radius);top=Math.min(top,edge.source.y-radius*2);}
      const centers=nodes.filter(node=>node.center);
      if(!live.hierarchical&&centers.length===1){
        const center=centers[0],dx=Math.max(center.x-left,right-center.x),dy=Math.max(center.y-top,bottom-center.y);
        left=center.x-dx;right=center.x+dx;top=center.y-dy;bottom=center.y+dy;
      }
      // The CSS canvas can be taller than its fixed viewBox. In a center view,
      // use that visible letterbox space instead of shrinking readable titles.
      const viewport=svg.getBoundingClientRect(),screenScale=Math.min(viewport.width/width,viewport.height/height);
      const availableHeight=(live.centered||live.clustered||live.hierarchical)&&screenScale?viewport.height/screenScale:height;
      const availableWidth=(live.centered||live.clustered||live.hierarchical)&&screenScale?viewport.width/screenScale:width;
      const scale = Math.min(1.5, clampScale(Math.min((availableWidth - 24) / (right - left), (availableHeight - 24) / (bottom - top))));
      return { scale, x: width / 2 - (left + right) / 2 * scale, y: height / 2 - (top + bottom) / 2 * scale };
    },
    dispose() { disposed = true; remember(); live?.simulation.stop(); if (frame !== null) cancelAnimationFrame(frame);appearance.disconnect();document.fonts?.removeEventListener('loadingdone',fontsChanged);for(const event of ['pointerover','pointerout','focusin','focusout'])svg.removeEventListener(event,labelAttention); },
  };
}
