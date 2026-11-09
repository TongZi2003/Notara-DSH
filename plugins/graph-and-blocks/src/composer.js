/** Append to the real resident composer, preserving draft text and structured chips. */
export function appendAnswer(ctx, sessionId, text) {
  if (!sessionId || typeof text !== 'string' || !text.trim()) throw new Error('课堂不可用');
  const rows=ctx.sessions.list.getSnapshot().byId ?? {},selected=ctx.get?.('uiSession')?.adapter.current.getSnapshot()?.key;
  const currentRow = selected?rows[selected]:Object.values(rows).find(row => row.retainedBy?.mainView > 0);
  const current = currentRow?.id;
  const targetRow=rows[sessionId],address=ctx.sessions.subagentAddress?.(sessionId)??targetRow?.subagent?.address;
  const visited=new Set();let ancestor=sessionId;
  while(ancestor&&ancestor!==current&&!visited.has(ancestor)){
    visited.add(ancestor);
    const link=ctx.sessions.subagentAddress?.(ancestor)??rows[ancestor]?.subagent?.address;
    ancestor=link?.parentSessionId;
  }
  const embedded=Boolean(current&&targetRow?.retainedBy?.sidebarChat>0&&ancestor===current);
  if (current !== sessionId&&!embedded) throw new Error('课堂已切换');
  if (address?.mode === 'one-shot' || targetRow?.subagent?.parentAvailable === false) throw new Error('这份子任务记录不支持继续作答，请打开可继续的专题课堂');
  const scope = ctx.sessions.scope(sessionId);
  if (!scope || ctx.conversation.blocks.storeFor(sessionId).getSnapshot()) throw new Error('课堂暂时不可输入');
  const input = ctx.conversation.input.for(scope), state = input.state.getSnapshot();
  if (state.phase !== 'plain') throw new Error('课堂暂时不可输入');
  const end = state.draft.length - (state.occurrences ?? []).reduce((sum, item) => sum + item.length - 1, 0);
  const accepted = scope.bail(scope, 'slash/input-insert-text', { text: (state.draft ? '\n\n' : '') + text.trim(), span: { start: end, end, draftRev: state.draftRev } });
  if (accepted !== true) throw new Error('草稿已变化');
  ctx.layout.selectPanel(null);
}
