import {builtInPacks,shapeToExcalidrawElements} from './vendor/excalimath/library.js';

const names=[
  ['几何','直角三角形|等边三角形|等腰三角形|圆|圆与半径|正方形|矩形|五边形|六边形|平行四边形|梯形|30°角示意|直角|坐标系|数轴|量角器示意'],
  ['代数','分数条|代数方块 x|单位方块|代数方块 x²|天平|韦恩图 两集合|韦恩图 三集合|函数机器|数字卡片'],
  ['统计','条形图框架|四分饼图|直方图框架|散点图坐标|箱线图框架'],
  ['物理与电路','导线|电池单节|电池组|开关 断开|开关 闭合|接地|电阻|矩形电阻|可变电阻|热敏电阻|保险丝|光敏电阻|电容|电感|二极管|发光二极管|NPN 三极管|PNP 三极管|电流表|电压表|电动机|灯泡|蜂鸣器|与门|或门|非门|与非门|或非门|异或门|同或门|缓冲器|力的箭头|平衡力'],
  ['生物','动物细胞|植物细胞|DNA 片段|食物网箭头|生态系统|有丝分裂'],
  ['化学','玻尔原子模型|元素周期表方块|单键|双键|三键|烧杯|锥形瓶|试管'],
];
const slug=text=>text.toLowerCase().replace(/²/g,'2').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
export const drawingLibrary=builtInPacks.flatMap((pack,i)=>pack.shapes.map((shape,j)=>({
  id:`${slug(pack.name)}/${slug(shape.name)}`,name:names[i][1].split('|')[j],english:shape.name,category:names[i][0],shape,
})));
export const drawingLibraryCategories=names.map(([name])=>name);
export function searchDrawingLibrary(query='',category=''){
  const words=String(query).trim().toLowerCase().split(/\s+/).filter(Boolean);
  return drawingLibrary.filter(item=>(!category||item.category===category)&&words.every(word=>`${item.name} ${item.english} ${item.category} ${item.id}`.toLowerCase().includes(word)));
}
/** Curated upstream shapes only. Importing arbitrary libraries remains Excalidraw's job. */
export function createLibraryDrawing(id,createId=()=>crypto.randomUUID()){
  const item=drawingLibrary.find(item=>item.id===id);if(!item)throw Error('drawing_library_unknown: 请先查询图形库，使用返回的素材 ID。');
  const result=shapeToExcalidrawElements(item.shape,0,0),groupId=createId(),files={};
  for(const file of result.files){const next=createId();for(const e of result.elements)if(e.fileId===file.id)e.fileId=next;files[next]={...file,id:next};}
  const elements=result.elements.map((e,i)=>{
    const next={...e,id:createId(),groupIds:[groupId],strokeStyle:e.strokeStyle??'solid',customData:{notaraLibrary:{id:item.id,name:item.name,source:'ExcaliMath'}}};
    if(item.shape.elements[i]?.endArrowhead===null)next.endArrowhead=null;
    // Excalidraw requires local linear points to start at the origin.
    if(next.points?.length){const [x,y]=next.points[0];next.x+=x;next.y+=y;next.points=next.points.map(([px,py])=>[px-x,py-y]);const xs=next.points.map(p=>p[0]),ys=next.points.map(p=>p[1]);next.width=Math.max(...xs)-Math.min(...xs);next.height=Math.max(...ys)-Math.min(...ys);}
    return next;
  });
  return {elements,files};
}
