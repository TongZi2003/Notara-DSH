// A read-only projection of the native Chat target. No second message store.
function notaraProjectStudentChat({snapshot, grouped, outline}) {
  const incoming = new Set(['agent-message']);
  const handoffs = new Set(['notara-topic-handoff', 'notara-child-handoff','notara-pomodoro']);
  const sourceKind=node=>node.data.source?.kind==='schedule'&&node.data.content?.some(block=>block.type==='text'&&block.text.includes('<!-- notara-pomodoro:v1 '))?'notara-pomodoro':node.data.source?.kind;
  const messageKinds = new Set(['user','steering','context','turn-trigger']);
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
    if([...incoming].some(kind=>kinds?.has(kind)))return 'internal';
    if([...handoffs,'subagent-settled'].some(kind=>kinds?.has(kind)))return 'student';
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
  const entries=(grouped?.entries??snapshot.order.map(key=>({kind:'node',key}))).filter(entry=>{
    if(entry.kind==='node')return visibleNode(entry.key);
    const group=grouped?.groupSource(entry.key).getSnapshot();
    return group&&status(group.data.turn)==='student'&&group.members.some(member=>visibleNode(member.key));
  });
  const navigation=snapshot.navigation.items().filter(item=>status(item.turn)==='student').flatMap(item=>{
    const anchorKey=order.includes(item.anchorKey)?item.anchorKey:order.find(key=>turnOf(snapshot.nodes.get(key))===item.turn);
    // Do not reuse the removed handoff/peer prompt as the new rail preview.
    const privateInput=[...handoffs,...incoming].some(kind=>sources.get(item.turn)?.has(kind));
    return anchorKey?[{...item,anchorKey,prompt:!privateInput&&anchorKey===item.anchorKey?item.prompt:''}]:[];
  });
  // Unloaded turns remain navigable by number, but never borrow an answer
  // preview until the input source has actually been loaded and classified.
  const safeOutline=Array.isArray(outline)?outline.filter(item=>status(item.turn)!=='internal').map(item=>{
    if(status(item.turn)!=='student')return {...item,prompt:'',response:''};
    const kinds=sources.get(item.turn);return [...handoffs,...incoming].some(kind=>kinds?.has(kind))?{...item,prompt:''}:item;
  }):outline;
  return {order,entries,navigation,outline:safeOutline};
}
