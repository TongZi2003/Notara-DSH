// JSXGraph 1.13.3 constructors. Only the validated figure grammar reaches here.
const triangleKinds=new Set(['circumcenter','circumcircle','incenter','incircle','bisector']);
const circleKinds=new Set(['circle','circumcircle','incircle']);
export function createPlanarConstruction(board,item,elements,checks,pointStyle,lineStyle){
  const get=name=>elements.get(name),parents=(item.points??[]).map(get);
  const validPoint=p=>p&&Number.isFinite(p.X())&&Number.isFinite(p.Y());
  const validLine=l=>l?.stdform?.slice(0,3).every(Number.isFinite)&&Math.hypot(l.stdform[1],l.stdform[2])>1e-10;
  const validCircle=c=>validPoint(c?.center)&&Number.isFinite(c.Radius())&&c.Radius()>1e-10;
  let valid,kind=item.kind,args;
  if(triangleKinds.has(kind)){
    valid=()=>{
      if(!parents.every(validPoint))return false;
      const [a,b,c]=parents,ux=a.X()-b.X(),uy=a.Y()-b.Y(),vx=c.X()-b.X(),vy=c.Y()-b.Y();
      return Math.abs(ux*vy-uy*vx)>1e-10*Math.max(1,Math.hypot(ux,uy)*Math.hypot(vx,vy));
    };args=parents;
  }else if(kind==='parallel'||kind==='perpendicular'){
    valid=()=>validLine(get(item.of))&&validPoint(get(item.through));args=[get(item.of),get(item.through)];
  }else if(kind==='foot'){
    // perpendicularpoint has a legacy on-line branch that is NOT the foot.
    kind='orthogonalprojection';args=[get(item.from),get(item.of)];
    valid=()=>validLine(get(item.of))&&validPoint(get(item.from));
  }else if(kind==='tangent'){
    args=[get(item.at)];valid=()=>validCircle(get(item.of))&&validPoint(get(item.at));
  }else return null;
  checks.set(item.name,valid);
  const isPoint=['circumcenter','incenter','foot'].includes(item.kind);
  const element=board.create(kind,args,{...(isPoint?pointStyle:lineStyle),name:item.name,fixed:true,visible:valid,center:{visible:false,name:''},point:{visible:false,name:''}});
  return element;
}
export function gliderCarrierValid(item,spec,elements,checks){
  if(checks?.has(item.on)&&!checks.get(item.on)())return false;
  const carrier=elements.get(item.on),kind=spec.objects.find(o=>o.name===item.on)?.kind;
  if(circleKinds.has(kind))return carrier?.center&&Number.isFinite(carrier.center.X())&&Number.isFinite(carrier.center.Y())&&Number.isFinite(carrier.Radius())&&carrier.Radius()>1e-10;
  return carrier?.stdform?.slice(0,3).every(Number.isFinite)&&Math.hypot(carrier.stdform[1],carrier.stdform[2])>1e-10;
}
