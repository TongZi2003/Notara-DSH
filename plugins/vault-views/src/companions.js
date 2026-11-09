import {currentSessionId,draftEnd} from './composer.js';
import {serializeReference,referenceEnvelopes,referenceMarkdownRanges} from './reference-facts.js';
export const COMPANIONS=Object.freeze([
  {id:'companion-deepseek',name:'大肥鱼',avatar:'deepseek',description:'认真听你讲，追问没说清的地方'},
  {id:'companion-claude',name:'大小姐',avatar:'claude',description:'梳理结构，寻找简洁路径'},
  {id:'companion-gemini',name:'多动鬼',avatar:'gemini',description:'换个角度，用图像和类比理解'},
  {id:'companion-gpt',name:'后桌',avatar:'gpt',description:'检查前提、边界和反例'},
]);
export const INVITATION_SOURCE='notara-companion-invitation';
export const INVITATION_MODES={answer:'请同学回答',discuss:'一起讨论',teach:'讲给同学听（不看解析）'};
export function sessionPreset(snapshot,sessionId){
  return snapshot?.projectionsBySession?.[sessionId]?.values?.agentPreset??snapshot?.byId?.[sessionId]?.projectionValues?.agentPreset??snapshot?.byId?.[sessionId]?.agentPreset;
}
function validate(value){
  const partner=COMPANIONS.find(row=>row.id===value?.preset);
  if(!partner||!Object.hasOwn(INVITATION_MODES,value.mode)||value.mode==='teach'&&partner.id!=='companion-deepseek')throw new Error('同学邀请无效，请重新选择');
  return partner;
}
function invitationInstruction(value){
  const partner=validate(value);
  const target=value.mode==='teach'?'companion-deepseek-blind':partner.id;
  const task=value.mode==='answer'?'请同学尝试回答我的问题，给出自己的思路。':value.mode==='discuss'?'请同学和我一起讨论当前问题，检查不同思路。':'我想把题目讲给同学听。只交付原始题面和我本次的讲解，不交付答案、解析、教师提示、参考资料或课堂历史；使用 problem、studentExplanation 字段。缺少题面或我的讲解时先向我询问，不得替我编写。';
  return `\n【用户邀请：${partner.name} · ${INVITATION_MODES[value.mode]}】\n${task}\n请实际调用 subagent，preset=${target}，不要只在文字中 @ 同学或由老师冒充回复。普通同学只需要与当前问题相关的必要材料，不复制整段课堂。创建成功后提供原生同学会话入口；创建失败据实说明。伙伴的回答不是学生的作答或掌握证据。\n`;
}
export function invitationText(value){
  const partner=validate(value);
  return serializeReference({kind:'companion',invitation:{preset:value.preset,mode:value.mode},label:`${partner.name} · ${INVITATION_MODES[value.mode]}`,instruction:invitationInstruction(value)});
}
export const companionTextRule={id:INVITATION_SOURCE,order:-30,match(text,from){
  const candidates=[];
  for(const row of referenceEnvelopes(text)){
    if(row.start<from||row.value?.kind!=='companion')continue;
    try{const value=row.value.invitation,partner=validate(value);if(row.value.instruction!==invitationInstruction(value))continue;
      candidates.push({...row,label:`${partner.name} · ${INVITATION_MODES[value.mode]}`});}catch{/* Unknown envelopes stay visible. */}
  }
  const ranges=referenceMarkdownRanges(text);
  // Match only a complete byte-for-byte historical template, never arbitrary
  // text following "用户邀请". Suffixes and code examples remain untouched.
  for(const partner of COMPANIONS)for(const mode of Object.keys(INVITATION_MODES)){
    if(mode==='teach'&&partner.id!=='companion-deepseek')continue;
    const wire=invitationInstruction({preset:partner.id,mode});
    // Native trims the very first/last newline of a whole submission.
    const body=wire.slice(1,-1);
    for(let start=text.indexOf(body,from);start!==-1;start=text.indexOf(body,start+body.length)){
      if(start>0&&text[start-1]!=='\n'||ranges.some(([a,b])=>start>=a&&start<b))continue;
      const end=start+body.length;if(end<text.length&&text[end]!=='\n')continue;
      candidates.push({start,end,label:`${partner.name} · ${INVITATION_MODES[mode]}`});
    }
  }
  const row=candidates.sort((a,b)=>a.start-b.start)[0];
  if(row)return {id:'text',start:row.start,end:row.end,data:{text:text.slice(row.start,row.end),display:`【${row.label}】`}};
}};
export function insertCompanionInvitation(ctx,sessionId,value){
  const partner=validate(value);
  if(currentSessionId(ctx)!==sessionId)throw new Error('对话已切换，请在当前课堂重新邀请');
  const scope=ctx.sessions.scope(sessionId);
  if(!scope||ctx.conversation.blocks.storeFor(sessionId).getSnapshot())throw new Error('请在可编辑的课堂中邀请同学');
  const input=ctx.conversation.input.for(scope),state=input.state.getSnapshot();
  if(state.phase!=='plain')throw new Error('请先结束当前输入操作');
  const ref=JSON.stringify({preset:value.preset,mode:value.mode});
  if(state.occurrences.some(item=>item.source===INVITATION_SOURCE&&item.ref===ref))return;
  if(state.occurrences.some(item=>{try{return item.source===INVITATION_SOURCE&&JSON.parse(item.ref).preset===value.preset;}catch{return false;}}))throw new Error('草稿中已有这位同学，请先移除原邀请再更换方式');
  if(state.occurrences.length>=12)throw new Error('草稿引用已满，请先移除一些引用');
  const end=draftEnd(state),label=`${partner.name} · ${INVITATION_MODES[value.mode]}`;
  if(!input.insertReference({source:INVITATION_SOURCE,ref,label,appearance:'file',clipboardText:`【${label}】`},{start:end,end,draftRev:state.draftRev}))throw new Error('邀请未放入草稿，请重试');
}
export function registerCompanionInvitations(ctx){
  const stopRule=ctx.uiConversation?.userText?.register(companionTextRule);
  let stopSource;
  try{stopSource=ctx.inputTriggers.registerSource({trigger:'@',name:INVITATION_SOURCE,order:20,showGroupTitle:false,async candidates(){return [];},onPick(){},codec:{
    clipboardText(ref){try{const value=JSON.parse(ref),partner=validate(value);return `【${partner.name} · ${INVITATION_MODES[value.mode]}】`;}catch{return '【同学邀请】';}},
    async serialize(ref,signal){signal?.throwIfAborted();return invitationText(JSON.parse(ref));},
  }});}catch(error){stopRule?.();throw error;}
  return ()=>{stopSource();stopRule?.();};
}
export function companionCall({phase,block}){
  try{
    const args=JSON.parse(phase==='result'?block.call?.argsRaw:block.argsRaw);
    const blind=args.preset==='companion-deepseek-blind',partner=COMPANIONS.find(row=>row.id===(blind?'companion-deepseek':args.preset));
    if(!partner)return null;
    return {...partner,blind,status:phase==='result'?(block.isError?'failed':'invited'):'running'};
  }catch{return null;}
}
export function subagentCallReceipt(props, callerPreset){
  const partner=companionCall(props);
  const failed=props.phase==='result'&&props.block.isError;
  if(partner)return {partner,name:partner.name,status:props.phase!=='result'?'正在安排…':failed?'未完成':'已邀请',blind:partner.blind,topicId:null,organizer:false,isTopic:false};
  try{
    const args=JSON.parse(props.phase==='result'?props.block.call?.argsRaw:props.block.argsRaw);
    const organizer=args?.preset==='notara-material-organizer';
    const homeTopic=callerPreset==='notara-coordinator'&&args?.preset==='notara-teacher';
    const text=props.phase==='result'&&!failed?(props.block.content??[]).filter(item=>item?.type==='text'&&typeof item.text==='string').map(item=>item.text).join('\n'):'';
    const topicMatch=text.match(/会话标识：(notara-topic-[0-9a-f]{32})/);
    const topicId=topicMatch?topicMatch[1]:null;
    const title=typeof args?.description==='string'&&args.description.trim()?args.description.trim():'';
    if(organizer||homeTopic||topicId){
      const kindName=organizer?'资料整理':'专题课堂';
      return {partner:null,name:title?`${kindName} · ${title}`:kindName,status:props.phase!=='result'?'正在安排…':failed?'未完成':organizer?'已转交独立整理':'已创建专题对话',blind:false,topicId,organizer,isTopic:true};
    }
  }catch{/* Partial or worker calls fall back to generic subagent receipt. */}
  return {partner:null,name:'子任务',status:props.phase!=='result'?'正在安排…':failed?'未完成':'已创建记录',blind:false,topicId:null,organizer:false,isTopic:false};
}
