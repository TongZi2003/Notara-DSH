// A read-only projection of the native Chat target. No second message store.
export function projectStudentChat({snapshot, grouped, outline,displayUserText=text=>text,sessions,sessionId,sessionPreset,subagentCatalog}) {
  const incoming = new Set(['agent-message','notara-internal-settled','notara-pending-settled','notara-attachment-import','notara-runtime-context-history','notara-context-update']);
  const handoffs = new Set(['notara-topic-handoff', 'notara-child-handoff','notara-organizer-settled','notara-organizer-handoff','notara-pomodoro']);
  const messageKinds = new Set(['user','steering','context','turn-trigger']);
  const childPresets=new Map(),visited=new Set();
  const collectSubagents=(block,depth=0)=>{
    if(!block||visited.has(block)||depth>32)return;
    visited.add(block);
    if(block.kind==='tool-result'&&!block.isError&&(block.call?.name??block.name)==='subagent'){
      let preset=block.meta?.structured?.preset,childId=block.meta?.structured?.id;
      if(!preset&&typeof block.call?.argsRaw==='string')try{preset=JSON.parse(block.call.argsRaw)?.preset;}catch{}
      if(!childId&&Array.isArray(block.content)){const text=block.content.filter(part=>part?.type==='text'&&typeof part.text==='string').map(part=>part.text).join('\n');childId=text.match(/会话标识：([^\s。]+)/)?.[1];}
      if(childId&&typeof preset==='string')childPresets.set(childId,preset);
    }
    for(const sub of block.subCalls??[])collectSubagents(sub,depth+1);
  };
  for(const node of snapshot.nodes.values())if(node.data?.root)collectSubagents(node.data.root);
  const presetFor=id=>id?(sessions?.projectionsBySession?.[id]?.values?.agentPreset??sessions?.byId?.[id]?.projectionValues?.agentPreset??sessions?.byId?.[id]?.agentPreset??sessions?.[id]?.projectionValues?.agentPreset??sessions?.[id]?.agentPreset??childPresets.get(id)):undefined;
  const catalog=Array.isArray(subagentCatalog)?subagentCatalog:sessions?.projectionsBySession?.[sessionId]?.values?.subagentCatalog;
  const handoffPreset=[...snapshot.nodes.values()].find(node=>messageKinds.has(node.kind)&&node.data?.source?.kind==='notara-topic-handoff'&&typeof node.data.source.targetPreset==='string')?.data.source.targetPreset;
  const currentPreset=typeof sessionPreset==='string'?sessionPreset:(presetFor(sessionId)??handoffPreset);
  const pendingRoleSessionIds=new Set();
  const sourceKind=node=>{
    const kind=node.data.source?.kind;
    if(kind==='schedule'&&node.data.content?.some(block=>block.type==='text'&&block.text.includes('<!-- notara-pomodoro:v1 ')))return 'notara-pomodoro';
    if(kind==='agent-message'&&currentPreset==='notara-material-organizer')return 'notara-organizer-handoff';
    if(kind==='subagent-settled'){
      if(currentPreset==='notara-material-organizer')return 'notara-organizer-settled';
      const senderId=node.data.source?.senderSessionId;
      const preset=presetFor(senderId);
      if(typeof preset==='string')return preset.startsWith('worker-')?'notara-internal-settled':'subagent-settled';
      const catalogMode=senderId&&Array.isArray(catalog)?catalog.find(entry=>entry?.id===senderId)?.mode:undefined;
      if(catalogMode==='one-shot')return 'notara-internal-settled';
      // rc.4 spawn workers are continuable too. Only the actual role proves
      // an audience; request its projection without opening the child Chat.
      if(typeof senderId==='string'&&senderId.length>0)pendingRoleSessionIds.add(senderId);
      return 'notara-pending-settled';
    }
    return kind;
  };
  const turnOf = node => node?.location?.turn?.turn;
  const sources=new Map();
  for(const node of snapshot.nodes.values()) {
    if(!messageKinds.has(node.kind))continue;
    const turn=turnOf(node);if(turn===undefined)continue;
    const kinds=sources.get(turn)??new Set();kinds.add(sourceKind(node));sources.set(turn,kinds);
  }
  const status=turn=>{
    const kinds=sources.get(turn);
    if(kinds?.has('user'))return 'student';
    // Without the opening boundary a preceding student input may be unloaded.
    if(!snapshot.timeline.turns.get(turn)?.start)return 'unknown';
    if(kinds?.has('agent-message'))return 'internal';
    if([...handoffs,'subagent-settled'].some(kind=>kinds?.has(kind)))return 'student';
    if(kinds?.has('notara-internal-settled'))return 'internal';
    // The outline control stream can arrive before the input event stream.
    // A loaded boundary or environment snapshot alone proves no audience.
    return 'unknown';
  };
  const visibleNode=key=>{
    const node=snapshot.nodes.get(key);if(!node)return false;
    // Context remains available in Trajectory, including initial handoffs.
    if(messageKinds.has(node.kind)&&(incoming.has(sourceKind(node))||handoffs.has(sourceKind(node))))return false;
    const turn=turnOf(node),audience=status(turn);
    return turn===undefined||audience==='student'||audience==='unknown'&&['turn-error','model-retry','turn-max-tokens'].includes(node.kind);
  };
  const order=snapshot.order.filter(visibleNode);
  const promptFor=(turn,fallback)=>{
    const user=[...snapshot.nodes.values()].find(node=>node.kind==='user'&&turnOf(node)===turn&&sourceKind(node)==='user');
    if(!user?.data.content)return fallback;
    const raw=user.data.content.filter(part=>part.type==='text').map(part=>part.text).join('');
    const clean=displayUserText(raw,{sessionLabels:user.data.referenceLabels??[],skillNames:user.data.skillNames??[]}).replace(/\s+/g,' ').trim();
    return clean.length>49?clean.slice(0,49).trimEnd()+'…':clean;
  };
  const entries=(grouped?.entries??snapshot.order.map(key=>({kind:'node',key}))).filter(entry=>{
    if(entry.kind==='node')return visibleNode(entry.key);
    const group=grouped?.groupSource(entry.key).getSnapshot();
    return group&&status(group.data.turn)==='student'&&group.members.some(member=>visibleNode(member.key));
  });
  const navigation=snapshot.navigation.items().filter(item=>status(item.turn)==='student').flatMap(item=>{
    const anchorKey=order.includes(item.anchorKey)?item.anchorKey:order.find(key=>turnOf(snapshot.nodes.get(key))===item.turn);
    // Do not reuse the removed handoff/peer prompt as the new rail preview.
    const privateInput=[...handoffs,...incoming].some(kind=>sources.get(item.turn)?.has(kind));
    return anchorKey?[{...item,anchorKey,prompt:!privateInput&&anchorKey===item.anchorKey?promptFor(item.turn,item.prompt):''}]:[];
  });
  // Unloaded turns remain navigable by number, but never borrow an answer
  // preview until the input source has actually been loaded and classified.
  const safeOutline=Array.isArray(outline)?outline.filter(item=>status(item.turn)!=='internal').map(item=>{
    if(status(item.turn)!=='student')return {...item,prompt:'',response:''};
    const kinds=sources.get(item.turn);return {...item,prompt:[...handoffs,...incoming].some(kind=>kinds?.has(kind))?'':promptFor(item.turn,'')};
  }):outline;
  return {order,entries,navigation,outline:safeOutline,pendingRoleSessionIds:[...pendingRoleSessionIds].sort()};
}
