import {workspaceForSession} from '@oh-my-student/plugin-vault-sqlite/workspace-client';
import {currentSessionId} from './composer.js';
import {sessionPreset} from './companions.js';

const feedback={whiteboard_missing:'原来的白板文件已缺失，请恢复文件后再启用。',vault_session_archived:'这段会话已归档，不能更改白板。',vault_session_role_forbidden:'请在老师会话中使用白板教学。',whiteboard_storage_unavailable:'白板绑定暂时无法保存，请稍后重试。'};

export async function runWhiteboardCommand(ctx,openDocument,sessionId,enabled,onSuccess=()=>{}){
 const scope=ctx.sessions.scope(sessionId),workspaceId=workspaceForSession(ctx,sessionId);
 const notice=(level,text)=>{if(ctx.sessions.scope(sessionId)===scope)(scope?.get?.('conversation')??ctx.get('conversation'))?.input.for(scope).notify(level,text);};
 try{
  if(!scope||workspaceId===null)throw Error('请先打开学习集中的老师会话。');
  const response=await ctx.remote.notaraVault.setWhiteboard({workspaceId,sessionId,enabled});
  if(!response?.ok)throw Error(response?.error?.message??'白板状态更新失败，请重试。');
  const state=response.value;
  if(enabled&&(!state.enabled||!state.path))throw Error('白板尚未启用，请重试。');
  if(currentSessionId(ctx)===sessionId&&ctx.sessions.scope(sessionId)===scope&&workspaceForSession(ctx,sessionId)===workspaceId){
   if(enabled)openDocument({path:state.path,workspaceId});
   onSuccess({sessionId,workspaceId,text:enabled?'已启用白板教学':'已停用白板教学，内容已保留'});
  }
 }catch(error){notice('error',feedback[error.message]??'暂时无法更新白板，请稍后重试。');}
}

export function installWhiteboardCommands(ctx,openDocument,onSuccess){
 ctx.inject(['commandUi'],scope=>{
  for(const enabled of [true,false])scope.effect(()=>scope.commandUi.register({
   name:enabled?'whiteboard-on':'whiteboard-off',label:()=>enabled?'启用白板教学':'停用白板教学',
   available:({sessionId})=>{const preset=sessionPreset(scope.sessions.list.getSnapshot(),sessionId);return preset===undefined||['notara-teacher','notara-coordinator'].includes(preset);},
   ui:{kind:'action',run:({sessionId})=>{void runWhiteboardCommand(scope,openDocument,sessionId,enabled,onSuccess);}},
  }));
 });
}
