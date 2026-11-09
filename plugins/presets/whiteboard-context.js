import {fileURLToPath} from 'node:url';
import {resource,skillsDirectoryFor} from './resources.js';

export function whiteboardFileSection(path,revision){
 return {name:`notara-whiteboard-file:${path}`,text:`当前白板文件 ${JSON.stringify(path)} 的版本为 ${JSON.stringify(revision)}。写入前 canvas read 核对当前内容、节点和续写位置；不要覆盖学生的修改。`};
}

export async function readWhiteboardContexts(ctx,agent,kind,signal){
 const vault=ctx.get('notaraVault'),registry=ctx.get('workspaceRegistry');
 if(!vault?.whiteboard||!registry?.resolveByPath||!agent?.session?.header?.cwd)return [];
 try{
  signal?.throwIfAborted();const workspace=await registry.resolveByPath(agent.session.header.cwd);if(!workspace?.id)return [];
  const state=await vault.whiteboard({workspaceId:workspace.id,sessionId:agent.id});signal?.throwIfAborted();
  if(!state.bound)return [];
  const name='notara-whiteboard';
  if(!state.enabled||!state.eligible)return [{name,text:`白板教学已停用，停止自动板书并继续正常对话。保留文件 ${JSON.stringify(state.path)}，不删除内容。`}];
  if(state.missing)return [{name,text:`已绑定白板 ${JSON.stringify(state.path)} 暂时缺失。暂停板书，告知学生恢复或重新选择；不要悄悄另建替代。`}];
  if(state.invalid)return [{name,text:`已绑定白板 ${JSON.stringify(state.path)} 暂时无法读取。暂停板书，保留原文件并先处理文件问题，不覆盖或另建替代。`}];
  const skill=resource('pi-skills-built/notara-whiteboard/SKILL.md').replace(/^---\n[\s\S]*?\n---\n/,'').trim();
  const directory=fileURLToPath(new URL('notara-whiteboard/',skillsDirectoryFor(kind)));
  return [{name,text:`学生已启用白板教学，本会话绑定：${JSON.stringify(state.path)}。以下是已加载的 Skill，无需再次加载；资源目录：${directory}\n\n${skill}`},whiteboardFileSection(state.path,state.revision)];
 }catch(error){signal?.throwIfAborted();return [{name:'notara-whiteboard',text:'本会话白板状态暂不可读；先继续对话，不猜测绑定或声称已启用。'}];}
}
