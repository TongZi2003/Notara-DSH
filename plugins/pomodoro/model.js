export const PREFIX='【Notara课堂番茄钟】';
export function validate(input){
  const {sessionId,durationMinutes=45,intervalMinutes=10,timeZone='Asia/Shanghai'}=input??{};
  if(typeof sessionId!=='string'||!sessionId.trim())throw new Error('请先打开课堂');
  if(!Number.isInteger(durationMinutes)||durationMinutes<5||durationMinutes>120||!Number.isInteger(intervalMinutes)||intervalMinutes<5||intervalMinutes>durationMinutes||Math.ceil(durationMinutes/intervalMinutes)>12)throw new Error('时长应为5–120分钟，提醒间隔至少5分钟，每次最多12次提醒');
  try{new Intl.DateTimeFormat('zh-CN',{timeZone}).format();}catch{throw new Error('时区无效');}
  return {sessionId,durationMinutes,intervalMinutes,timeZone};
}
export function milestones(duration,interval){const result=[];for(let minute=interval;minute<duration;minute+=interval)result.push(minute);return [...result,duration];}
export function reminder({startedAt,durationMinutes,intervalMinutes,timeZone,minute}){
  const time=new Intl.DateTimeFormat('zh-CN',{timeZone,dateStyle:'short',timeStyle:'medium'}).format(new Date(Date.parse(startedAt)+minute*60000));
  const identity=`<!-- notara-pomodoro:v1 ${JSON.stringify({startedAt,durationMinutes,intervalMinutes,timeZone,minute})} -->`;
  return `${identity}\n${PREFIX}\n开始：${startedAt}\n时长：${durationMinutes}分钟；间隔：${intervalMinutes}分钟；时区：${timeZone}\n节点：第${minute}分钟\n计划提醒时间：${time}（${timeZone}）。本节已到第${minute}分钟，计划剩余${Math.max(0,durationMinutes-minute)}分钟。\n这是给老师的课堂节奏提醒，不是学生作答，也不代表学生已掌握。请以本条消息的实际送达时间校正剩余时间；若提醒延迟，只处理最新的课堂进度，不补发过期提醒、不打断学生正在写的推导、不要求学生回复时钟。${minute===durationMinutes?'本节计划时间已到，请在自然停顿处收尾或询问是否延长；不要自动再开计时。':'结合学生实际进度调整讲解和练习节奏。'}`;
}
export function decode(row){
  const match=/^<!-- notara-pomodoro:v1 (\{[^\n]+\}) -->\n/.exec(row.prompt??'');
  if(!match)return null;
  try{
    const {startedAt,durationMinutes,intervalMinutes,timeZone,minute}=JSON.parse(match[1]);
    const config=validate({sessionId:row.sessionId,durationMinutes,intervalMinutes,timeZone});
    if(new Date(startedAt).toISOString()!==startedAt||!milestones(config.durationMinutes,config.intervalMinutes).includes(minute))return null;
    return {...config,startedAt,minute};
  }catch{return null;}
}
/** Native schedule rows are the only durable timer records. No second clock or inbox. */
export class ClassroomTimer {
  constructor(schedule,{now=()=>Date.now()}={}){this.schedule=schedule;this.now=now;this.chain=Promise.resolve();}
  serial(run){const result=this.chain.then(run);this.chain=result.catch(()=>{});return result;}
  async rows(sessionId){return (await this.schedule.catalog()).flatMap(row=>{const config=decode(row);return config&&row.sessionId===sessionId?[{row,config}]:[];});}
  async status({sessionId}){
    if(typeof sessionId!=='string'||!sessionId)throw new Error('请先打开课堂');
    const rows=await this.rows(sessionId),active=rows.filter(({row})=>row.status==='active');
    const group=active.map(({config})=>config.startedAt).sort().at(-1);
    if(!group)return {state:'idle',sessionId};
    const selected=rows.filter(({config})=>config.startedAt===group),config=selected[0].config;
    const pending=selected.filter(({row})=>row.status==='active'),delivered=selected.filter(({row})=>row.lastDelivery);
    return {...config,minute:undefined,state:pending.length?'running':delivered.length===milestones(config.durationMinutes,config.intervalMinutes).length?'delivered':'stopped',endsAt:new Date(Date.parse(group)+config.durationMinutes*60000).toISOString(),pending:pending.length,delivered:delivered.length,partial:selected.length!==milestones(config.durationMinutes,config.intervalMinutes).length};
  }
  start(input){return this.serial(async()=>{
    const config=validate(input),existing=await this.status(config);
    if(existing.state==='running')return existing;
    const previous=(await this.rows(config.sessionId)).map(({config})=>Date.parse(config.startedAt));
    const startedAt=new Date(Math.max(this.now(),...previous.map(time=>time+1))).toISOString(),created=[];
    try{for(const minute of milestones(config.durationMinutes,config.intervalMinutes)){
      const row=await this.schedule.create(config.sessionId,{title:`课堂番茄钟 · 第${minute}分钟`,at:new Date(Date.parse(startedAt)+minute*60000).toISOString(),prompt:reminder({...config,startedAt,minute})});created.push(row.id);
    }}catch(error){
      const cleanup=await Promise.allSettled(created.map(id=>this.schedule.delete({sessionId:config.sessionId,id})));
      if(cleanup.some(result=>result.status==='rejected'))throw new Error('部分提醒未能撤销，请重新打开番茄钟并停止');
      throw error;
    }
    return this.status(config);
  });}
  stop({sessionId,startedAt}){return this.serial(async()=>{
    const state=await this.status({sessionId});
    if(state.state!=='running')return state;
    if(state.startedAt!==startedAt)throw new Error('计时已变化，请重新打开后操作');
    for(const {row,config} of await this.rows(sessionId))if(row.status==='active'&&config.startedAt===startedAt)await this.schedule.delete({sessionId,id:row.id});
    return {state:'stopped',sessionId,startedAt};
  });}
}
