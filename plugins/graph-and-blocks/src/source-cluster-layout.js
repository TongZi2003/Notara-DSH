import {labelMetrics} from './graph-layout.js';
const order=(a,b)=>(a.title??a.path).localeCompare(b.title??b.path,'zh-CN',{numeric:true})||a.path.localeCompare(b.path);
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
export const SOURCE_CLUSTER_ORIGIN_KEY=JSON.stringify({layout:'source-clusters'});

/** Coordinates only. The caller supplies visible original sources; membership
 * never comes from ordinary graph edges, and no extra nodes/edges are created. */
export function sourceClusterLayout(graph,sources,origin,measurements=new Map()) {
  if(!sources.length)return null;
  const groups=new Map(sources.map(source=>[source.path,{id:source.path,sourcePath:source.path,title:source.title??source.path,kind:'source',nodes:[],memberPaths:[],sharedPaths:[],source}]));
  const shared=[];
  for(const node of graph.nodes){
    if(groups.has(node.path))continue;
    const recorded=Array.isArray(node.sourcePaths)?node.sourcePaths:[],paths=[...new Set(recorded)].filter(path=>groups.has(path)).sort();
    for(const path of paths){const group=groups.get(path);group.memberPaths.push(node.path);if(new Set(recorded).size>1)group.sharedPaths.push(node.path);}
    if(paths.length>1){shared.push({node,sources:paths});continue;}
    if(paths.length===1){groups.get(paths[0]).nodes.push(node);continue;}
    const kind=recorded.length?'outside':'unassigned',id='\0'+kind;
    if(!groups.has(id))groups.set(id,{id,sourcePath:null,title:kind==='outside'?'来源不在当前范围':'未关联原始资料',kind,nodes:[]});
    groups.get(id).nodes.push(node);
  }
  const arranged=[...groups.values()];
  for(const group of arranged){
    group.nodes.sort(order);group.local=new Map();
    if(group.source){
      group.local.set(group.source.path,{x:0,y:0,side:0});
      const caption=labelMetrics(group.source,measurements.get(group.source.path));
      for(let offset=0,ring=0;offset<group.nodes.length;ring++){
        const radius=(group.nodes.length<=3?45+8*(group.nodes.length-1):85)+ring*42,capacity=Math.max(1,Math.floor(2*Math.PI*radius/44)),slots=[];
        for(let i=0;i<capacity;i++){
          const angle=-Math.PI/2+2*Math.PI*(i+.25)/capacity;
          const x=Math.cos(angle)*radius,y=Math.sin(angle)*radius;
          if(Math.abs(x)<caption.width/2+22&&y>-4&&y<18+caption.height+22)continue;
          slots.push({x,y,side:x<0?-1:1});
        }
        const count=Math.min(slots.length,group.nodes.length-offset);
        for(let i=0;i<count;i++)group.local.set(group.nodes[offset+i].path,slots[Math.floor(i*slots.length/count)]);
        offset+=count;
      }
    }else{
      const columns=Math.ceil(Math.sqrt(group.nodes.length));
      const rows=Math.ceil(group.nodes.length/columns);
      group.nodes.forEach((node,i)=>group.local.set(node.path,{x:(i%columns-(columns-1)/2)*42,y:(Math.floor(i/columns)-(rows-1)/2)*42,side:1}));
    }
    group.radius=Math.max(group.source?38:50,...[...group.local.values()].map(point=>Math.hypot(point.x,point.y)+24));
  }
  const weights=new Map();
  for(const item of shared)for(const a of item.sources)for(const b of item.sources)if(a!==b){if(!weights.has(a))weights.set(a,new Map());weights.get(a).set(b,(weights.get(a).get(b)??0)+1);}
  const affinity=(a,b)=>weights.get(a.id)?.get(b.id)??0;
  // Dragging fixes one physical node, never the whole navigation group.
  const placed=[],pending=[...arranged];
  // Bound packing work for large libraries; source groups remain separate even
  // when an exhaustive tangent search would dominate interaction time.
  if(arranged.length>48){
    const radius=Math.max(...arranged.map(group=>group.radius)),step=radius*2+110,columns=Math.ceil(Math.sqrt(pending.length*1.8));
    pending.sort((a,b)=>a.id.localeCompare(b.id)).forEach((group,i)=>{group.x=i%columns*step;group.y=Math.floor(i/columns)*step;placed.push(group);});pending.length=0;
  }
  while(pending.length){
    pending.sort((a,b)=>placed.reduce((sum,g)=>sum+affinity(b,g)-affinity(a,g),0)||b.radius-a.radius||a.id.localeCompare(b.id));
    const group=pending.shift();
    if(!placed.length){group.x=0;group.y=0;placed.push(group);continue;}
    let best=null;
    for(const neighbor of placed)for(let i=0;i<32;i++){
      const angle=i*Math.PI/16,r=neighbor.radius+group.radius+110;
      const candidate={x:neighbor.x+Math.cos(angle)*r,y:neighbor.y+Math.sin(angle)*r};
      if(placed.some(other=>distance(candidate,other)<group.radius+other.radius+90))continue;
      const all=[...placed,{...group,...candidate}];
      const left=Math.min(...all.map(g=>g.x-g.radius)),right=Math.max(...all.map(g=>g.x+g.radius));
      const top=Math.min(...all.map(g=>g.y-g.radius)),bottom=Math.max(...all.map(g=>g.y+g.radius));
      const weights=placed.reduce((sum,g)=>sum+affinity(group,g),0);
      const connected=weights?placed.reduce((sum,g)=>sum+affinity(group,g)*distance(candidate,g)**2,0)/weights:0;
      const score=Math.max((right-left)/1.8,bottom-top)**2+.2*connected+.01*(candidate.x**2+candidate.y**2);
      if(!best||score<best.score)best={...candidate,score};
    }
    // A rightmost tangent is always available.
    Object.assign(group,best??{x:Math.max(...placed.map(g=>g.x+g.radius))+group.radius+110,y:0});placed.push(group);
  }
  const dx=origin.x-(Math.min(...placed.map(g=>g.x-g.radius))+Math.max(...placed.map(g=>g.x+g.radius)))/2;
  const dy=origin.y-(Math.min(...placed.map(g=>g.y-g.radius))+Math.max(...placed.map(g=>g.y+g.radius)))/2;
  const targets=new Map();
  for(const group of placed){
    group.x+=dx;group.y+=dy;
    for(const [path,point] of group.local)targets.set(path,{x:group.x+point.x,y:group.y+point.y,side:point.side});
  }
  // A source pair may share hundreds of cards. Continue a two-dimensional
  // spiral for that membership instead of exhausting a fixed disk and then
  // appending an unbounded horizontal tail. Buckets keep the slot search local.
  const sharedSlots=new Map(),cursors=new Map(),cell=32;
  const bucketKey=(x,y)=>`${x},${y}`;
  const occupied=point=>{
    const x=Math.floor(point.x/cell),y=Math.floor(point.y/cell);
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)if((sharedSlots.get(bucketKey(x+dx,y+dy))??[]).some(other=>distance(point,other)<cell))return true;
    return false;
  };
  for(const item of shared.sort((a,b)=>a.sources.join('\0').localeCompare(b.sources.join('\0'))||order(a.node,b.node))){
    const related=item.sources.map(path=>groups.get(path));
    let target={x:related.reduce((sum,g)=>sum+g.x,0)/related.length,y:related.reduce((sum,g)=>sum+g.y,0)/related.length};
    if(related.length===2){
      const [a,b]=related,d=distance(a,b),t=d?(d+a.radius-b.radius)/(2*d):.5;
      target={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
    }
    const key=JSON.stringify(item.sources);
    for(let attempt=cursors.get(key)??0;;attempt++){
      const radius=attempt?14*Math.sqrt(attempt):0,angle=attempt*Math.PI*(3-Math.sqrt(5));
      const point={x:target.x+Math.cos(angle)*radius,y:target.y+Math.sin(angle)*radius};
      if(placed.some(group=>distance(point,group)<group.radius+18)||occupied(point))continue;
      targets.set(item.node.path,{...point,side:point.x<origin.x?-1:1});
      const bucket=bucketKey(Math.floor(point.x/cell),Math.floor(point.y/cell));
      if(!sharedSlots.has(bucket))sharedSlots.set(bucket,[]);sharedSlots.get(bucket).push(point);
      cursors.set(key,attempt+1);break;
    }
  }
  return {targets,clusters:placed.map(group=>({id:group.id,key:group.sourcePath?JSON.stringify(['source',group.sourcePath]):group.kind,sourcePath:group.sourcePath,title:group.title,kind:group.kind,x:group.x,y:group.y,radius:group.radius,paths:[...group.local.keys()],memberPaths:group.memberPaths??group.nodes.map(node=>node.path),sharedPaths:group.sharedPaths??[]}))};
}
