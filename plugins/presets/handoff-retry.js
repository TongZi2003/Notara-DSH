import {HarnessError} from '@deepseek-ai/dsh-llm';
const IMAGE_FAILURE='[notara-image-handoff]';
const IMAGE_FAILURE_CODE='NOTARA_IMAGE_HANDOFF_NOT_STARTED';

export class HandoffImageError extends HarnessError {
  constructor(message,references=[]){super(message,IMAGE_FAILURE_CODE);this.name='HandoffImageError';this.references=references;}
}

export function assertHandoffPrompt(prompt){
  if(typeof prompt!=='string'||!prompt.trim()||prompt.length>96_000)throw new TypeError('prompt must contain 1–96000 characters');
  if(/^[（(]?\s*(?:占位(?:符)?|placeholder)(?:[，,:：][^\r\n]*)?[）)]?\s*$/iu.test(prompt.trim()))throw new Error('请先提供完整交接，不用占位正文启动会话；修正图片时沿用错误回执中的 retryOf。');
}

/** A retry changes image references, not the task. The native tool log is the
 * source of the original text; no draft store or second task lifecycle. */
export function restoreHandoffRetry(parent,args){
  if(args.retryOf===undefined)return args;
  const events=parent.session.snapshotEvents(),seen=new Set();
  function restore(value){
    if(value.retryOf===undefined)return value;
    if(typeof value.retryOf!=='string'||seen.has(value.retryOf))throw new Error('retryOf 须引用本会话真实失败的图片交接调用');
    seen.add(value.retryOf);
    const seq=/^event:(\d+)$/.exec(value.retryOf)?.[1];
    const calls=events.filter(e=>e.type==='tool/call'&&e.data.name==='subagent'&&(seq===undefined?e.data.callId===value.retryOf:e.seq===Number(seq)));
    if(calls.length!==1)throw new Error('retryOf 未定位唯一调用；调用ID重复时请使用错误回执中的精确 event 引用');
    const call=calls[0],result=events.find(e=>e.type==='tool/result'&&e.sourceEventSeqs?.includes(call.seq)&&e.data.message.toolCallId===call.data.callId)?.data;
    if(result?.message.isError!==true||result.error?.code!==IMAGE_FAILURE_CODE)throw new Error('retryOf 只能引用本会话尚未启动接收者的图片交接失败，不能重放成功调用或其他任务');
    const original=restore(typeof call.data.arguments==='string'?JSON.parse(call.data.arguments):call.data.arguments);
    for(const [key,content] of Object.entries(value)){
      if(['retryOf','parentImages'].includes(key)||content===undefined)continue;
      if(JSON.stringify(content)!==JSON.stringify(original[key]))throw new Error(`图片重试不能改写 ${key}；保留原交接，只更正 parentImages。新任务请另交完整正文。`);
    }
    if(!Array.isArray(value.parentImages)||!value.parentImages.length)throw new Error('图片重试须提供更正后的 parentImages，不能删除必要图片换取成功');
    return {...original,parentImages:value.parentImages};
  }
  return restore(args);
}

export function imageRetryError(error,callId,args,parent){
  if(!(error instanceof HandoffImageError))return error;
  const calls=parent?.session.snapshotEvents().filter(e=>e.type==='tool/call'&&e.data.name==='subagent'&&e.data.callId===callId)??[];
  if(calls.length>1)return new HandoffImageError(`${IMAGE_FAILURE} ${error.message}\n接收会话未启动。当前供应商调用ID重复，不能自动恢复任务；请保留完整交接正文重新提交，不使用占位。当前可选图片引用：${JSON.stringify(error.references)}`,error.references);
  const call=calls[0];
  const correction={preset:args.preset,description:args.description,retryOf:call?`event:${call.seq}`:callId};
  return new HandoffImageError(`${IMAGE_FAILURE} ${error.message}\n接收会话未启动。原交接正文保留在本会话调用记录中；请只修正图片引用，不重写正文或改成占位。\n当前可选图片引用：${JSON.stringify(error.references)}\n重试 subagent 时保留 ${JSON.stringify(correction)}，再填写更正后的 parentImages，只选择本任务必要的图片；省略 prompt 和其他原内容。`,error.references);
}
