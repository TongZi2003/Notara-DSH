import React, {useState} from 'react';
import {QUICK_REQUESTS,isRecommendationHero} from './model.js';
import {draftEnd} from './composer.js';

/** Native blank session only; a click edits this session's draft, never sends it. */
export function SkillEntrances({useSession,useConversation,useInput,useProjection,inputActions}) {
  const session=useSession(value=>value),active=useConversation(value=>value.activeTargets.size>0);
  const input=useInput(value=>value),preset=useProjection('agentPreset');
  const [error,setError]=useState('');
  if(!isRecommendationHero(session,active)||!['notara-coordinator','notara-teacher'].includes(preset)||input.phase!=='plain')return null;
  const choose=request=>{
    const command='/notara-'+request.id;
    if(input.draft.split(/\s+/).includes(command))return;
    const end=draftEnd(input);
    const ok=inputActions.insertText(`${input.draft.trim()?'\n\n':''}${command} ${request.label}`,{start:end,end,draftRev:input.draftRev});
    setError(ok?'':'输入内容已变化，请再点一次。');
  };
  return <div className="nr-skill-entrances" aria-label="学习技能">
    {QUICK_REQUESTS.map(request=><button key={request.id} type="button" onClick={()=>choose(request)}>{request.label}</button>)}
    {error&&<span role="status">{error}</span>}
  </div>;
}
