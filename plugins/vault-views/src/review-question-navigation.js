import {bindVaultRemote,workspaceForSession} from '@oh-my-student/plugin-vault-sqlite/workspace-client';
import {parseMarkdown} from '@oh-my-student/plugin-vault-sqlite/frontmatter';
import {reviewPlans} from '@oh-my-student/plugin-vault-sqlite/review-schedule';
import {callVault} from './logic.js';
import {bringReferences,currentSessionId} from './composer.js';
import {questionDraft} from './review-questions.js';

/** Reuse the bound teacher and append to its native draft. No creation/send. */
export async function continueReviewQuestion(ctx,workspaceId,document,plan){
 if(typeof workspaceId!=='string'||!workspaceId)throw Error('请先选择学习集');
 const ui=ctx.get?.('uiWorkspace');if(!ui?.openSession)throw Error('长期教师暂时无法打开');
 const signal=ctx.layout?.beginNavigation?.(),origin=currentSessionId(ctx),originWorkspace=workspaceForSession(ctx,origin);
 const current=()=>!signal?.aborted&&currentSessionId(ctx)===origin&&workspaceForSession(ctx,origin)===originWorkspace;
 const remote=bindVaultRemote(ctx.remote.notaraVault,workspaceId),saved=await callVault(remote,'read',{path:document.path});
 if(!current())return false;
 const actual=reviewPlans(parseMarkdown(saved.content).fields).find(p=>p.heading===plan.heading&&p.question===plan.question&&p.nextReview===plan.nextReview);
 if(saved.revision!==document.revision||!actual)throw Error('问题已有更新，请核对刷新后的列表再试');
 const home=await callVault(remote,'homeSession',{});if(!current())return false;
 if(!home.sessionId)throw Error('这个学习集还没有长期教师对话，请先开始一次对话');
 ui.openSession(home.sessionId);
 // Native openSession completes its own navigation and aborts the lookup
 // signal. Track subsequent user navigation with a fresh draft-phase signal.
 const draftSignal=ctx.layout?.beginNavigation?.();
 const owner={sessionId:home.sessionId,isCurrent:()=>!draftSignal?.aborted&&currentSessionId(ctx)===home.sessionId&&workspaceForSession(ctx,home.sessionId)===workspaceId};
 const draft=questionDraft(document,actual);
 await bringReferences(ctx,[{...draft.reference,workspaceId}],draft.text,owner);
 if(owner.isCurrent()){ctx.layout?.selectPanel?.(null);if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('notara:exit-fullscreen'));}
 return true;
}
