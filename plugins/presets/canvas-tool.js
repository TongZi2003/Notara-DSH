import { createHash } from 'node:crypto';
import { defineTool } from '@deepseek-ai/dsh-tools';
import {drawingMathElement} from '@oh-my-student/plugin-vault-sqlite/math-reference';
import {parseDrawingDocument} from '@oh-my-student/plugin-vault-sqlite/drawing-files';
import {whiteboardFileSection} from './whiteboard-context.js';

const hash=value=>createHash('sha256').update(value).digest('hex');
export async function executeCanvas(ctx,preset,args,exec){
  const [{parseCanvasDocument},{appendCanvasBlock,updateCanvasBlock}]=await Promise.all([import('@oh-my-student/plugin-vault-sqlite/drawing-files'),import('@oh-my-student/plugin-vault-sqlite/canvas-flow')]);
  const agent=exec.agent;
  if(!agent||ctx.agentPresets.composedPreset(agent.ctx)!==preset)throw Error('需要当前课堂身份');
  const workspace=await ctx.workspaceRegistry.resolveByPath(agent.session.header.cwd);
  if(!workspace)throw Error('当前课堂未绑定工作区');
  if(typeof args.path!=='string'||!args.path.endsWith('.canvas'))throw Error('请选择当前工作区内的 .canvas 文件');
  if(!['read','append','update'].includes(args.action))throw Error('canvas_action_invalid');
  exec.signal.throwIfAborted();
  let record;
  try{record=await ctx.notaraVault.read({workspaceId:workspace.id,path:args.path});}
  catch(error){if(error.code!=='ENOENT'&&!String(error.message).includes('ENOENT'))throw error;record={content:'{"nodes":[],"edges":[]}',revision:null};}
  let doc=parseCanvasDocument(record.content);
  const summary=()=>({path:args.path,revision:record.revision,continuationAnchor:doc.nodes.some(n=>n.id===doc.notaraCanvas?.lastNodeId)?doc.notaraCanvas.lastNodeId:null,nodes:doc.nodes.map(n=>({id:n.id,title:(n.text?.split('\n')[0]??n.label??n.file??n.id).replace(/^#+\s*/,''),type:n.type,file:n.file,subpath:n.subpath,x:n.x,y:n.y,width:n.width,height:n.height,pinned:!n.notaraFlow||!!n.notaraFlow.pinned})),...(args.action==='read'?{}:{nodeId:args.action==='append'?id:args.nodeId})});
  const id='board-'+hash(`${agent.id}:${exec.callId}`).slice(0,24),requestHash=hash(JSON.stringify(args));
  if(args.action==='read')return summary();
  const prior=args.action==='append'&&doc.nodes.find(n=>n.id===id);
  if(prior){if(prior.notaraFlow?.requestHash!==requestHash)throw Error('canvas_request_conflict');return {...summary(),alreadyApplied:true};}
  if(args.expectedRevision!==record.revision)throw Error('板书已更新或缺少版本；请先 canvas read，再基于最新锚点和 revision 操作。');
  if(args.action==='append'){
    if(doc.nodes.length&&!args.after)throw Error('已有板书必须指定 after：从 canvas read 的结果选择目标块或分组 ID。');
    if(args.file!==undefined){const source=await ctx.notaraVault.read({workspaceId:workspace.id,path:args.file});if(args.mathElementId!==undefined)drawingMathElement(parseDrawingDocument(source.content),args.mathElementId);}
    doc=appendCanvasBlock(doc,{id,title:args.title,body:args.body,file:args.file,mathElementId:args.mathElementId,after:args.after,placement:args.placement,size:args.size,operationId:exec.callId});
    doc.nodes.find(n=>n.id===id).notaraFlow.requestHash=requestHash;
  }else doc=updateCanvasBlock(doc,args);
  exec.signal.throwIfAborted();
  const request={workspaceId:workspace.id,path:args.path,content:JSON.stringify(doc,null,2)+'\n',expectedRevision:record.revision};
  const result=ctx.notaraVault.whiteboards&&ctx.get?.('storageDomain')
    ?await ctx.notaraVault.whiteboards.saveCanvas({...request,sessionId:agent.id,signal:exec.signal})
    :await ctx.notaraVault.save(request);
  record={...record,revision:result.revision};
  const node=doc.nodes.find(n=>n.id===(args.action==='append'?id:args.nodeId));
  const anchor=doc.nodes.find(n=>n.id===args.after);
  return {...summary(),position:{x:node.x,y:node.y,width:node.width,height:node.height},...(anchor?{anchorId:anchor.id,placement:args.placement??'below',avoidedObstacles:node.y!==(anchor.y+(args.placement==='beside'?0:anchor.height+28))}:{}),note:'已保存；页面会同步。学生翻看旧内容时不会强制跳转。'};
}

export function registerCanvasTool(ctx,preset){
  ctx.tools.register(defineTool({
    name:'canvas',description:'连续课堂板书：先 read 查看稳定节点 ID 与版本，再 append 新块或 update 原块。已有板书追加必须以 after 指定目标块/分组；below 接其底边，beside 接其右边。系统避让已有容器，保留学生位置。纠错用 update，禁止整文件重写。只负责板书，不代表学生掌握。',
    parameters:{
      action:{type:'string',enum:['read','append','update'],required:true},path:{type:'string',required:true,description:'当前工作区内的 .canvas 路径。'},
      expectedRevision:{oneOf:[{type:'string'},{type:'null'}],description:'上次 read 返回的 revision；新建为 null。写入时必须提供。'},
      title:{type:'string',description:'文本 append 与 update 必填：单行非空标题；文件 append 可省略，默认文件名。'},body:{type:'string',description:'文本 append 与 update 必填：Markdown 正文，可含 figure 和现有互动组件。update 完整替换该文本块，须同时给 title/body；文件节点不能用 update 修改，file 与 body 互斥。'},
      file:{type:'string',description:'append 可引用已存在的工作区资料文件，例如 .excalidraw；与 body 二选一，生成真实 file 节点。'},
      mathElementId:{type:'string',description:'append引用数学对象时可用：先excalidraw read，选择具有math字段的真实元素ID，配合file引用该.excalidraw中的单张可交互数学图。共享同一源对象，不能编造ID。省略则展示整个文件。'},
      after:{type:'string',description:'append 的锚点 ID，必须来自 read 结果；空画布首块省略。'},
      placement:{type:'string',enum:['below','beside'],description:'相对 after 的方位，默认 below。'},size:{type:'string',enum:['normal','wide']},
      nodeId:{type:'string',description:'update 的目标 ID，来自 read；保留该块身份、位置和其他字段。'},
    },
    output:{schema:{type:'object',additionalProperties:false,properties:{result:{type:'string',required:true}}},render:(_args,value)=>[{type:'text',text:value.result}],presentationMeta(_args,value){const result=JSON.parse(value.result);return {notaraCanvasContext:whiteboardFileSection(result.path,result.revision)};}},
    async execute(args,exec){return {result:JSON.stringify(await executeCanvas(ctx,preset,args,exec))};},
  }));
}
