const estimatedWidth = value => [...value].reduce((width,char) => width + (/[^\x00-\xff]/u.test(char) ? 13 : 7),0);
export function graphLabelLines(title, measure = estimatedWidth, maxWidth = 168) {
  const chars=[...String(title??'')],lines=[];let line='';
  for(let i=0;i<chars.length;i++){
    const next=line+chars[i];
    if(line&&measure(next)>maxWidth){
      lines.push(line);line='';
      if(lines.length===2){
        let last=lines[1];while(last&&measure(last+'…')>maxWidth)last=[...last].slice(0,-1).join('');
        lines[1]=last+'…';return lines;
      }
    }
    line+=chars[i];
  }
  if(line||!lines.length)lines.push(line);
  return lines;
}
export function labelMetrics(node, measured) {
  const lines=graphLabelLines(node.title??node.path);
  return measured??{width:Math.max(...lines.map(estimatedWidth),1),height:lines.length*16};
}

/** Presentation-only anchors. No new edges, parentage or learning facts. */
export function centerLayout(graph,width,height,measurements=new Map(),positions=new Map(),origin) {
  const centers=graph.nodes.filter(node=>node.center);
  if(!centers.length)return null;
  const pinnedCenter=centers.length===1?positions.get(centers[0].path):null;
  const targets=new Map(),cx=pinnedCenter?.fx??origin?.x??width/2,cy=pinnedCenter?.fy??origin?.y??height/2;
  const innerRadius=centers.length===1?0:Math.max(120,centers.length*45);
  centers.forEach((node,i)=>{
    const angle=2*Math.PI*i/centers.length;
    targets.set(node.path,{x:cx+Math.cos(angle)*innerRadius,y:cy+Math.sin(angle)*innerRadius,side:0});
  });
  const distance=new Map(centers.map(node=>[node.path,0])),adjacent=new Map(graph.nodes.map(node=>[node.path,[]]));
  for(const {source,target} of graph.edges){adjacent.get(source)?.push(target);adjacent.get(target)?.push(source);}
  const queue=centers.map(node=>node.path);
  for(let i=0;i<queue.length;i++)for(const path of adjacent.get(queue[i])??[])if(!distance.has(path)){distance.set(path,distance.get(queue[i])+1);queue.push(path);}
  const levels=new Map();
  for(const node of graph.nodes)if(!node.center){const depth=distance.get(node.path)??1;if(!levels.has(depth))levels.set(depth,[]);levels.get(depth).push(node);}
  let band=0;
  const labelWidth=Math.max(168,...graph.nodes.map(node=>labelMetrics(node,measurements.get(node.path)).width));
  for(const [,nodes] of [...levels].sort((a,b)=>a[0]-b[0])){
    // Stable natural title order keeps numbered exercises together; it is not
    // persisted as a teaching sequence or an inferred knowledge hierarchy.
    nodes.sort((a,b)=>(a.title??a.path).localeCompare(b.title??b.path,'zh-CN',{numeric:true})||a.path.localeCompare(b.path));
    for(let offset=0;offset<nodes.length;offset+=28,band++){
      const ring=nodes.slice(offset,offset+28),half=Math.ceil(ring.length/2);
      const labelHeight=Math.max(...ring.map(node=>labelMetrics(node,measurements.get(node.path)).height));
      const step=Math.max(40,labelHeight+14),radius=innerRadius+220+band*(labelWidth+100);
      ring.forEach((node,i)=>{
        const side=i<half?1:-1,count=side===1?half:ring.length-half,index=side===1?i:ring.length-1-i;
        const y=(index-(count-1)/2)*step,u=count>1?2*index/(count-1)-1:0;
        targets.set(node.path,{x:cx+side*(radius+65*Math.sqrt(Math.max(0,1-u*u))),y:cy+y,side});
      });
    }
  }
  return targets;
}

export function nodeLabelBounds(node,metrics,side=1) {
  const gap=18,left=side<0?-gap-metrics.width:side===0?-metrics.width/2:gap;
  const top=side===0?18:-metrics.height/2;
  return {left:Math.min(-12,left)-5,right:Math.max(12,left+metrics.width)+5,top:Math.min(-12,top)-5,bottom:Math.max(12,top+metrics.height)+5};
}

/** Rectangular collision includes the title, and never moves manual pins. */
export function labelCollision() {
  let nodes=[];
  const force=()=>{
    const boxes=nodes.map(node=>({node,left:node.x+node.vx+node.labelBounds.left,right:node.x+node.vx+node.labelBounds.right,top:node.y+node.vy+node.labelBounds.top,bottom:node.y+node.vy+node.labelBounds.bottom})).sort((a,b)=>a.left-b.left);
    for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length&&boxes[j].left<boxes[i].right;j++){
      const a=boxes[i],b=boxes[j],overlapY=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);
      if(overlapY<=0)continue;
      const overlapX=Math.min(a.right,b.right)-Math.max(a.left,b.left);
      const free=node=>!node.center&&node.fx==null&&node.fy==null;
      const am=free(a.node),bm=free(b.node),total=Number(am)+Number(bm);if(!total)continue;
      const axis=overlapX<overlapY?'vx':'vy',direction=axis==='vx'?(a.left<b.left?-1:1):(a.top<b.top?-1:1);
      const delta=(Math.min(overlapX,overlapY)+1)/total;
      if(am)a.node[axis]+=direction*delta;if(bm)b.node[axis]-=direction*delta;
    }
  };
  force.initialize=value=>{nodes=value;};return force;
}

export function visibleGraphLabels(items,scale,obstacles=[]) {
  const visible=new Set();
  const overlaps=(a,b)=>a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom;
  const index=()=>{
    const cells=new Map();
    const visit=(box,fn)=>{for(let x=Math.floor(box.left/128);x<=Math.floor(box.right/128);x++)for(let y=Math.floor(box.top/128);y<=Math.floor(box.bottom/128);y++)if(fn(`${x},${y}`))return true;return false;};
    return {add:item=>visit(item.box,key=>{if(!cells.has(key))cells.set(key,[]);cells.get(key).push(item);return false;}),hits:(box,path)=>visit(box,key=>(cells.get(key)??[]).some(item=>item.path!==path&&overlaps(box,item.box)))};
  };
  const occupied=index(),blocked=index();for(const obstacle of obstacles)blocked.add(obstacle);
  for(const item of [...items].sort((a,b)=>b.priority-a.priority||a.path.localeCompare(b.path))){
    const pad=4/Math.max(scale,.03),box={left:item.box.left-pad,right:item.box.right+pad,top:item.box.top-pad,bottom:item.box.bottom+pad};
    if(!item.forced&&(scale<.6&&item.priority<60||occupied.hits(box,null)||blocked.hits(box,item.path)))continue;
    visible.add(item.path);occupied.add({box});
  }
  return visible;
}
