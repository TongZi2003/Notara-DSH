import {labelMetrics,nodeLabelBounds} from './graph-layout.js';

const order=(a,b)=>(a.title??a.path).localeCompare(b.title??b.path,'zh-CN',{numeric:true})||a.path.localeCompare(b.path);
const columns=count=>count<=3?1:count<=16?2:3;

/** Left-to-right dependency lanes. Large example collections wrap underneath
 * the backbone, not into a single long column beyond it. Shared content has one
 * position and keeps every parent link; placement never assigns a primary topic. */
export function sourceHierarchyLayout(graph,width,height,measurements=new Map(),positions=new Map(),origin){
  if(graph.layout!=='source-hierarchy')return null;
  const root=graph.nodes.find(node=>node.path===graph.sourcePath)??(graph.presentation==='backbone'?{path:graph.sourcePath}:null);if(!root)return null;
  const topics=graph.nodes.filter(node=>node.sourceLayer==='knowledge').sort(order);
  if(!topics.length)return null;
  const contents=graph.nodes.filter(node=>node.sourceLayer==='content').sort(order),targets=new Map();
  const labelWidth=Math.max(168,...graph.nodes.map(node=>labelMetrics(node,measurements.get(node.path)).width));
  const step=Math.max(52,...graph.nodes.map(node=>labelMetrics(node,measurements.get(node.path)).height+24));
  const layerGap=labelWidth+100,columnGap=labelWidth+52,pin=positions.get(root.path);
  const x=pin?.fx??origin?.x??width/2,y=pin?.fy??origin?.y??height/2,contentX=x+layerGap*2;
  if(graph.presentation==='backbone'){
    // Keep actual dependency order, then wrap it into a readable, bounded
    // field. Folding examples must never unfold dozens of horizontal ranks.
    // The arrows, not grid adjacency, carry the prerequisite declarations.
    const ordered=[...topics].sort((a,b)=>(a.dependencyRank??0)-(b.dependencyRank??0)||(a.dependencyGroup??a.path).localeCompare(b.dependencyGroup??b.path)||order(a,b));
    const gap=labelWidth+54,rowGap=Math.max(60,step+4);
    const bounds=ordered.map(node=>nodeLabelBounds(node,labelMetrics(node,measurements.get(node.path)),1));
    // Optimize the fitted scale, not the unscaled column width. A field that
    // fits horizontally can still be too tall and make every title tiny.
    let cols=1,bestScale=0;
    for(let candidate=1;candidate<=Math.min(6,ordered.length);candidate++){
      const boxes=bounds.map((box,i)=>{const row=Math.floor(i/candidate),column=i%candidate,cx=(row%2?candidate-1-column:column)*gap,cy=row*rowGap;return {left:cx+box.left,right:cx+box.right,top:cy+box.top,bottom:cy+box.bottom};});
      const fittedScale=Math.min((width-24)/(Math.max(...boxes.map(b=>b.right))-Math.min(...boxes.map(b=>b.left))+32),(height-24)/(Math.max(...boxes.map(b=>b.bottom))-Math.min(...boxes.map(b=>b.top))+32));
      if(fittedScale>bestScale){cols=candidate;bestScale=fittedScale;}
    }
    const rows=Math.ceil(ordered.length/cols);
    ordered.forEach((node,i)=>{const row=Math.floor(i/cols),column=i%cols;targets.set(node.path,{x:x+((row%2?cols-1-column:column)-(cols-1)/2)*gap-labelWidth/2,y:y+(row-(rows-1)/2)*rowGap,side:1});});
    return targets;
  }
  if(graph.relationsVersion===2){
    const ranks=new Map();for(const topic of topics){const rank=topic.dependencyRank??0;if(!ranks.has(rank))ranks.set(rank,[]);ranks.get(rank).push(topic);}
    const dense=contents.length>48,rankColumns=dense&&ranks.size>6?5:Math.max(...ranks.keys())+1;
    const rowStep=dense?Math.max(step,60):Math.max(step,92),blockGap=dense?8:24;
    const cyclePadding=members=>members[0].dependencyCycle?(members.length===1?80:40):0;
    const blockHeight=members=>members.length*rowStep+cyclePadding(members)+blockGap;
    const lanes=[...ranks].sort((a,b)=>a[0]-b[0]).map(([rank,items])=>{
      const groups=new Map();for(const node of items){const key=node.dependencyGroup??node.path;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(node);}
      const blocks=[...groups.values()].map(members=>members.sort(order)).sort((a,b)=>order(a[0],b[0]));
      return {rank,blocks,height:blocks.reduce((sum,members)=>sum+blockHeight(members),0)};
    });
    const bands=[];for(const lane of lanes){const band=Math.floor(lane.rank/rankColumns);bands[band]=Math.max(bands[band]??0,lane.height);}
    const totalHeight=bands.reduce((sum,h)=>sum+h,0)+(bands.length-1)*80;
    for(const {rank,blocks,height:laneHeight} of lanes){
      const band=Math.floor(rank/rankColumns),bandY=bands.slice(0,band).reduce((sum,h)=>sum+h+80,0)-totalHeight/2;
      let cursor=bandY+(bands[band]-laneHeight)/2;
      for(const members of blocks){const padding=cyclePadding(members);members.forEach((node,i)=>targets.set(node.path,{x:x+(rank%rankColumns+1)*layerGap,y:y+cursor+padding+(i+.5)*rowStep,side:dense?1:0}));cursor+=blockHeight(members);}
    }
    const lastRank=Math.max(...ranks.keys());
    if(dense){
      // At overview scale example titles are already decluttered by the
      // renderer. Reserve node space, not hundreds of invisible title boxes;
      // hover, selection and zoom still expose each original title.
      const gap=38,cols=Math.min(contents.length,Math.max(Math.ceil(Math.sqrt(contents.length*1.8)),Math.floor(rankColumns*layerGap/gap)));
      const top=Math.max(...[...targets.values()].map(p=>p.y))+step+48;
      const parentPosition=node=>{const parents=(node.sourceParents??[]).map(path=>targets.get(path)).filter(Boolean);return parents.length?parents.reduce((sum,p)=>sum+p.x,0)/parents.length:x;};
      const ordered=[...contents].sort((a,b)=>parentPosition(a)-parentPosition(b)||order(a,b));
      ordered.forEach((node,i)=>targets.set(node.path,{x:x+layerGap+i%cols*gap,y:top+Math.floor(i/cols)*gap,side:1,compact:true}));
      targets.set(root.path,{x,y,side:0});return targets;
    }
    const firstContentX=x+(lastRank+2)*layerGap;
    for(const node of contents){
      const parents=(node.sourceParents??[]).map(path=>targets.get(path)).filter(Boolean),cy=parents.length?parents.reduce((sum,p)=>sum+p.y,0)/parents.length:y;
      let row=0;
      while(true){const offset=row===0?0:Math.ceil(row/2)*(row%2?1:-1)*step;
        if(![...targets.values()].some(p=>p.x===firstContentX&&Math.abs(p.y-cy-offset)<step)){targets.set(node.path,{x:firstContentX,y:cy+offset,side:1});break;}row++;
      }
    }
    targets.set(root.path,{x,y,side:0});return targets;
  }
  let cursor=0,maxColumns=1;
  const place=(items,startX,cy)=>{
    const cols=columns(items.length),rows=Math.ceil(items.length/cols);maxColumns=Math.max(maxColumns,cols);
    items.forEach((node,i)=>targets.set(node.path,{x:startX+Math.floor(i/rows)*columnGap,y:cy+(i%rows-(rows-1)/2)*step,side:1}));
  };
  for(const topic of topics){
    const items=contents.filter(node=>node.sourceParents.length===1&&node.sourceParents[0]===topic.path);
    const block=Math.max(100,Math.ceil(items.length/columns(items.length))*step+40),cy=cursor+block/2;
    targets.set(topic.path,{x:x+layerGap,y:cy,side:0});place(items,contentX,cy);cursor+=block+40;
  }
  const direct=contents.filter(node=>node.sourceParents.length===1&&node.sourceParents[0]===root.path);
  if(direct.length){const block=Math.ceil(direct.length/columns(direct.length))*step+40;place(direct,contentX,cursor+block/2);cursor+=block;}
  const shared=contents.filter(node=>node.sourceParents.length>1);
  const sharedColumns=Math.max(maxColumns,columns(shared.length));
  for(const node of shared){
    const cy=node.sourceParents.reduce((sum,path)=>sum+targets.get(path).y,0)/node.sourceParents.length;
    // Use a free slot between its parents in the same content lanes, not a new
    // layer or a second copy of the shared question.
    let placed=false;
    for(let distance=0;!placed;distance++)for(const sign of distance?[-1,1]:[0]){
      const targetY=cy+distance*step*sign;
      for(let column=0;column<sharedColumns;column++){
        const targetX=contentX+column*columnGap;
        if([...targets.values()].some(point=>point.x===targetX&&Math.abs(point.y-targetY)<step))continue;
        targets.set(node.path,{x:targetX,y:targetY,side:1});placed=true;break;
      }
      if(placed)break;
    }
  }
  const ys=[...targets.values()].map(point=>point.y),offset=y-(Math.min(...ys)+Math.max(...ys))/2;
  for(const point of targets.values())point.y+=offset;
  targets.set(root.path,{x,y,side:0});return targets;
}
