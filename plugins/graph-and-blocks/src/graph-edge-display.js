export const RELATION_LABELS=Object.freeze({prerequisite:'前序依赖',example:'具体例子',association:'横向联系',source:'来源联系',reference:'资料引用'});
export const readableReferences=value=>String(value??'').replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,(_,path,label)=>label||path.split('/').at(-1).replace(/\.md$/i,''));

export function edgeDescription(edge,kind,nodes){
  if(edge.organization)return '组织关系 · 资料中涉及的知识与具体例子';
  const name=path=>readableReferences(nodes.get(path)?.title||path?.split('/').at(-1).replace(/\.md$/i,'')||'');
  const from=name(edge.source),to=name(edge.target);
  const endpoints=from&&to?kind==='prerequisite'?` · 先学 ${from} → 再学 ${to}`:` · ${from} — ${to}`:'';
  const learning=['prerequisite','example','association','knowledge'].includes(kind);
  const state=learning?edge.style==='solid'?' · 已建立':edge.style==='dashed'?' · 潜在／待建立':'':'';
  return `${RELATION_LABELS[kind]||'知识联系'}${endpoints}${state}${edge.context?` · ${kind==='prerequisite'?'路线':'主题'}：${readableReferences(edge.context)}`:''}${edge.description?`：${readableReferences(edge.description)}`:''}`;
}

/** Painting only: positions, parallel-route offsets and arrow padding retain
 * their existing meanings. Curvature never feeds back into the simulation. */
export function edgeGeometry(edge,peers){
  const index=peers.indexOf(edge),offset=peers.length>1?(index-(peers.length-1)/2)*8:0;
  if(edge.source===edge.target){const {x,y}=edge.source,radius=40+index*12;return {d:`M ${x+9} ${y-8} C ${x+radius} ${y-radius*2} ${x-radius} ${y-radius*2} ${x-9} ${y-8}`};}
  const direction=edge.source.path.localeCompare(edge.target.path)<=0?1:-1,dx=edge.target.x-edge.source.x,dy=edge.target.y-edge.source.y,length=Math.hypot(dx,dy)||1;
  const nx=-dy/length*direction,ny=dx/length*direction,ox=nx*offset,oy=ny*offset,padding=edge.kind==='prerequisite'?14:0;
  const x1=edge.source.x+ox,y1=edge.source.y+oy,x2=edge.target.x+ox-dx/length*padding,y2=edge.target.y+oy-dy/length*padding;
  if(edge.kind==='association'){const bend=Math.min(36,length*.12);return {d:`M ${x1} ${y1} Q ${(x1+x2)/2+nx*bend} ${(y1+y2)/2+ny*bend} ${x2} ${y2}`};}
  return {x1,y1,x2,y2};
}
