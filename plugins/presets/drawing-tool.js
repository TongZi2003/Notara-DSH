import {createHash} from 'node:crypto';
import {defineTool} from '@deepseek-ai/dsh-tools';
import {createLibraryDrawing,searchDrawingLibrary} from '@oh-my-student/plugin-vault-sqlite/drawing-library';
import {PLANAR_CONSTRUCTION_SYNTAX} from '@oh-my-student/plugin-graph-and-blocks/drawing-math';
const hash=text=>createHash('sha256').update(text).digest('hex');
export async function executeDrawing(ctx,preset,args,exec){
  const [{parseDrawingDocument,EMPTY_DRAWING},{makeDrawingElements,drawingBounds,validateDrawing}]=await Promise.all([import('@oh-my-student/plugin-vault-sqlite/drawing-files'),import('@oh-my-student/plugin-vault-sqlite/drawing-sync')]);
  const agent=exec.agent;if(!agent||ctx.agentPresets.composedPreset(agent.ctx)!==preset)throw Error('需要当前课堂身份');
  const workspace=await ctx.workspaceRegistry.resolveByPath(agent.session.header.cwd);if(!workspace)throw Error('当前课堂未绑定工作区');
  if(args.action==='library')return {result:JSON.stringify({source:'ExcaliMath',items:searchDrawingLibrary(args.query).map(({id,name,english,category})=>({id,name,english,category})),note:'现成示意素材；draw 使用 kind=library、libraryId 和局部 x/y。不是约束几何或三维构造。'})};
  if(typeof args.path!=='string'||!args.path.endsWith('.excalidraw'))throw Error('drawing_path_invalid: 请指定 .excalidraw 文件');
  if(!['read','draw','update','delete','show'].includes(args.action))throw Error('drawing_action_invalid');
  exec.signal.throwIfAborted();let record;
  try{record=await ctx.notaraVault.read({workspaceId:workspace.id,path:args.path});}catch(e){if(e.code!=='ENOENT'&&!String(e.message).includes('ENOENT'))throw e;record={content:EMPTY_DRAWING,revision:null};}
  let doc=parseDrawingDocument(record.content),elements=doc.elements.filter(e=>!e.isDeleted);
  const presentation=(content,revision)=>{
    const scene=parseDrawingDocument(content);delete scene.notaraDrawing;
    const snapshot=JSON.stringify(scene);if(snapshot.length>4*1024*1024)return {};
    return {snapshot:{version:1,sourceSessionId:agent.id,workspaceId:workspace.id,path:args.path,revision,content:snapshot}};
  };
  const embed=()=>`\`\`\`drawing\n${exec.callId}\n\`\`\``;
  if(args.action==='show'){
    const shown=presentation(record.content,record.revision);if(!shown.snapshot)throw Error('drawing_snapshot_too_large: 请拆分白板后展示');
    return {result:JSON.stringify({path:args.path,revision:record.revision,embed:embed(),note:'在回复正文中原样放入 embed，即展示这一版本的白板。'}),...shown};
  }
  const groups=[...new Set(elements.flatMap(e=>e.groupIds??[]))].map(id=>({id,title:elements.find(e=>e.groupIds?.includes(id))?.customData?.notaraTitle??'图形组',...drawingBounds(elements.filter(e=>e.groupIds?.includes(id)))}));
  if(args.action==='read'){
    const preview=await ctx.notaraVault.drawingPreview({workspaceId:workspace.id,path:args.path});
    const selected=args.elementIds?.length?elements.filter(e=>args.elementIds.includes(e.id)||e.groupIds?.some(id=>args.elementIds.includes(id))):elements;
    const result={path:args.path,revision:record.revision,groups,busyIds:preview.busyIds,elements:selected.slice(0,300).map(e=>({id:e.id,type:e.type,text:e.text,x:e.x,y:e.y,width:e.width,height:e.height,angle:e.angle,groupIds:e.groupIds,version:e.version,...(e.customData?.notaraMath?{math:e.customData.notaraMath}:{})})),truncated:selected.length>300};
    let image;
    if(preview.png&&preview.revision===record.revision&&ctx.get('attachments')){
      const routed=agent.session.requestHeader?.()?.config??agent.options;
      const model=routed?.provider&&routed?.model&&await ctx.get('llm')?.resolveModelInfo(routed.provider,routed.model,exec.signal);
      if(model?.inputModalities?.includes('image'))image=await ctx.get('attachments').saveImage({data:Buffer.from(preview.png,'base64'),mediaType:'image/png',name:'当前画布.png'});
      else result.preview='当前模型不支持图片；手写内容不能只凭元素坐标推断，请切换支持图片的模型。';
    }else result.preview='当前版本的图片预览尚未就绪；打开画布后会生成。不能声称看过手写内容。';
    return {result:JSON.stringify(result),...(image?{image}: {})};
  }
  const operationId=hash(`${agent.id}:${exec.callId}`),requestHash=hash(JSON.stringify(args));
  if(doc.notaraDrawing?.receipts?.[operationId]){if(doc.notaraDrawing.receipts[operationId]!==requestHash)throw Error('drawing_request_conflict');return {result:JSON.stringify({path:args.path,revision:record.revision,alreadyApplied:true})};}
  if(args.expectedRevision!==record.revision)throw Error('drawing_revision_conflict: 请先 read，使用最新 revision 和目标 ID。');
  const before=record.content;doc=structuredClone(doc);let affected=[];
  if(args.action==='draw'){
    if(!Array.isArray(args.shapes)||!args.shapes.length||args.shapes.length>100)throw Error('drawing_shapes_invalid: 需要1–100个图形');
    const expanded=[];
    for(const shape of args.shapes){
      if(shape.kind==='math'){const {mathDefinition}=await import('@oh-my-student/plugin-graph-and-blocks/drawing-math');expanded.push({...shape,math:mathDefinition(shape.source).data});continue;}
      if(shape.kind!=='function'){expanded.push(shape);continue;}
      const {compileExpression}=await import('@oh-my-student/plugin-graph-and-blocks/math-expression');
      const [xmin,xmax]=shape.xRange??[],[ymin,ymax]=shape.yRange??[];
      if(![xmin,xmax,ymin,ymax,shape.x,shape.y,shape.width,shape.height].every(Number.isFinite)||xmin>=xmax||ymin>=ymax||shape.width<=0||shape.height<=0)throw Error('drawing_function_range_invalid');
      const f=compileExpression(shape.expression,['x']);let points=[];
      const flush=()=>{if(points.length>=2)expanded.push({kind:'line',x:shape.x,y:shape.y,points,color:shape.color});points=[];};
      for(let i=0;i<=160;i++){const x=xmin+(xmax-xmin)*i/160;let y;try{y=f.evaluate({x});}catch{y=NaN;}
        if(!Number.isFinite(y)||y<ymin||y>ymax){flush();continue;}
        const point=[(x-xmin)/(xmax-xmin)*shape.width,(ymax-y)/(ymax-ymin)*shape.height];
        if(points.length&&Math.abs(point[1]-points.at(-1)[1])>shape.height/2)flush();points.push(point);
      }flush();
    }
    let serial=0;const nextId=()=>`${operationId.slice(0,22)}-${serial++}`;
    const created=expanded.flatMap(shape=>{
      if(shape.kind!=='library')return makeDrawingElements([shape],nextId);
      if(!Number.isFinite(shape.x)||!Number.isFinite(shape.y))throw Error('drawing_position_invalid');
      const inserted=createLibraryDrawing(shape.libraryId,nextId);Object.assign(doc.files??={},inserted.files);
      return inserted.elements.map(e=>({...e,x:e.x+shape.x,y:e.y+shape.y}));
    }),groupId=`group-${operationId.slice(0,22)}`;
    const placement=args.placement??'below';if(!['below','beside','overlay'].includes(placement))throw Error('drawing_placement_invalid');
    const target=elements.find(e=>e.id===args.after),anchor=target?drawingBounds([target]):groups.find(g=>g.id===args.after);
    if(elements.length&&!anchor)throw Error('drawing_anchor_missing: 非空画布需要 after 指定 read 返回的元素或组 ID');
    const bounds=drawingBounds(created);let x=anchor?anchor.x+(placement==='beside'?anchor.width+32:0):0,y=anchor?anchor.y+(placement==='below'?anchor.height+32:0):0;
    if(placement!=='overlay'){
      const obstacles=[...groups,...elements.filter(e=>!e.groupIds?.length)].map(e=>drawingBounds(e.type?[e]:[{...e,angle:0}]));let obstacle;
      while((obstacle=obstacles.find(o=>x<o.x+o.width+32&&x+bounds.width+32>o.x&&y<o.y+o.height+32&&y+bounds.height+32>o.y)))y=obstacle.y+obstacle.height+32;
    }
    for(const e of created){e.x+=x-bounds.x;e.y+=y-bounds.y;e.groupIds=[groupId];e.customData={...e.customData,notaraAuthor:'teacher',notaraTitle:String(args.title??'板书').slice(0,160)};}
    doc.elements.push(...created);affected=created.map(e=>e.id);
  }else{
    const updates=args.action==='delete'?(args.elementIds??[]).map(id=>({id,isDeleted:true})):args.updates;
    if(!Array.isArray(updates)||!updates.length||updates.length>100)throw Error('drawing_updates_invalid');
    for(const patch of updates){
      const e=doc.elements.find(e=>e.id===patch.id&&!e.isDeleted);if(!e)throw Error('drawing_element_missing: 目标已删除或不存在，请重新读取');
      const allowed=['id','x','y','width','height','text','color','source',...(args.action==='delete'?['isDeleted']:[])];if(Object.keys(patch).some(k=>!allowed.includes(k)))throw Error('drawing_patch_invalid');
      const {id,color,source,...changes}=patch;if(changes.text!==undefined){if(e.type!=='text'||typeof changes.text!=='string'||changes.text.length>8000)throw Error('drawing_text_invalid');changes.originalText=changes.text;changes.height=changes.text.split('\n').length*e.fontSize*e.lineHeight;}
      if(source!==undefined){if(!e.customData?.notaraMath)throw Error('drawing_math_target_invalid');const {mathDefinition}=await import('@oh-my-student/plugin-graph-and-blocks/drawing-math');changes.customData={...e.customData,notaraMath:mathDefinition(source).data};}
      if(color!==undefined){if(!/^#[\da-f]{6}$/i.test(color))throw Error('drawing_color_invalid');changes.strokeColor=color;}
      Object.assign(e,changes,{version:(e.version??1)+1,versionNonce:Math.floor(Math.random()*2147483647),updated:Date.now()});affected.push(id);
    }
    if(args.action==='delete')for(const e of doc.elements){
      if(e.isDeleted)continue;let changed=false;
      for(const key of ['startBinding','endBinding'])if(affected.includes(e[key]?.elementId)){e[key]=null;changed=true;}
      for(const key of ['containerId','frameId'])if(affected.includes(e[key])){e[key]=null;changed=true;}
      if(e.boundElements?.some(b=>affected.includes(b.id))){e.boundElements=e.boundElements.filter(b=>!affected.includes(b.id));changed=true;}
      if(changed){e.version=(e.version??1)+1;e.versionNonce=Math.floor(Math.random()*2147483647);e.updated=Date.now();}
    }
  }
  validateDrawing(doc);exec.signal.throwIfAborted();
  const result=await ctx.notaraVault.drawingCommit({workspaceId:workspace.id,path:args.path,base:before,content:JSON.stringify(doc),respectActivity:true,operationId,requestHash});
  const shown=presentation(result.content,result.revision);
  return {result:JSON.stringify({path:args.path,revision:result.revision,elementIds:affected,...(shown.snapshot?{embed:embed()}:{}),note:'图形已保存。需要在回复中展示这一版本时，原样放入 embed；不会自动向学生发送消息。'}),...shown};
}

export function registerDrawingTool(ctx,preset){ctx.tools.register(defineTool({
  name:'excalidraw',description:'在当前课堂共绘画布读取、追加、修改或删除图形。现成图形先用library按query搜索，再以kind=library和libraryId插入。先read取得revision和目标元素/组ID。draw提交局部坐标图形组，已有画布必须指定after；below/beside避让，overlay用于在目标上批注。update/delete遇到学生正在编辑或版本变化会拒绝，需等待后重读。禁止整文件重写；新增批注保留学生原笔迹。图片预览仅在当前模型支持图片时提供。',
  parameters:{action:{type:'string',enum:['read','draw','update','delete','show','library'],required:true,description:'show只冻结当前白板并返回可放入回复的embed，不修改图形。'},query:{type:'string',description:'library的中英文搜索词，空值返回全部素材。'},path:{type:'string',description:'除library外必填：当前工作区内的 .excalidraw 相对路径。'},expectedRevision:{oneOf:[{type:'string'},{type:'null'}],description:'写操作必须提供read返回的revision；空白新文件为null。'},after:{type:'string',description:'read返回的元素或组ID；非空画布draw必须提供。'},placement:{type:'string',enum:['below','beside','overlay']},title:{type:'string',description:'本次图形组的简短标题。'},elementIds:{type:'array',items:{type:'string'},description:'read筛选或delete指定的真实元素ID。'},
    shapes:{type:'array',description:'draw的图形。坐标是本组内部坐标，由系统整体放到锚点旁。数学图优先使用math和source，保留定义与交互；function仅生成静态曲线。function按数学表达式采样，必须给xRange/yRange和显示宽高；text使用普通文字或Unicode数学符号。',items:{type:'object',additionalProperties:false,properties:{kind:{type:'string',enum:['rectangle','ellipse','diamond','text','line','arrow','function','math','library'],required:true},libraryId:{type:'string',description:'kind=library必填：library查询返回的素材ID。'},x:{type:'number',required:true},y:{type:'number',required:true},width:{type:'number'},height:{type:'number'},text:{type:'string'},fontSize:{type:'number'},color:{type:'string',description:'#RRGGBB'},points:{type:'array',items:{type:'array',items:{type:'number'}},description:'line/arrow的局部点坐标，例如[[0,0],[100,50]]。'},source:{type:'string',description:'math图的figure定义（不含围栏），一行一个声明。最小例：axes x -2..2 y -1..5\nparam a = 1 in 0.5..2 step 0.1\nfunction f(x) = a*x^2。支持现有figure的平面和基础空间语法，不允许ask或JavaScript。\n'+PLANAR_CONSTRUCTION_SYNTAX},expression:{type:'string',description:'function使用现有数学语法，如x^2、sin(x)、ln(x)，只允许变量x。'},xRange:{type:'array',items:{type:'number'}},yRange:{type:'array',items:{type:'number'}}}}},
    updates:{type:'array',description:'update按id修改指定字段，未给字段保留。',items:{type:'object',additionalProperties:false,properties:{id:{type:'string',required:true},x:{type:'number'},y:{type:'number'},width:{type:'number'},height:{type:'number'},text:{type:'string'},color:{type:'string'},source:{type:'string',description:'仅用于数学图：替换完整figure定义，并重置该图的参数、自由点和视角。'}}}},
  },output:{schema:{type:'object',additionalProperties:false,properties:{result:{type:'string',required:true},image:{type:'json'},snapshot:{type:'json'}}},presentationMeta:(_args,value)=>value.snapshot?{notaraDrawing:value.snapshot}:{},render:(_args,value)=>[{type:'text',text:value.result},...(value.image?[{type:'image',attachment:value.image}]:[])]},execute:(args,exec)=>executeDrawing(ctx,preset,args,exec),
}));}
