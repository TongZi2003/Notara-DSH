import React, { useMemo } from 'react';
import { InteractiveBlocks, studentMarkdown } from './blocks.jsx';
import { hasInteractiveBlocks,splitBoardBody } from './domain/board-components.js';
import { appendAnswer } from './composer.js';
import { installUserMarkdown } from './user-markdown.jsx';
import { conversationMarkdown } from './conversation-markdown-model.js';
import { ConversationMarkdown } from './conversation-markdown.jsx';
import {splitDrawingBlocks} from './drawing-blocks.js';
import { SessionLinkScope } from './session-link-scope.jsx';

/** Real rc.1 extension seam: a scoped assistant-step renderer, with native fallback. */
export function installMarkdownBlocks(ctx, primitives) {
  const { MarkdownText } = primitives;
  const stopUsers = installUserMarkdown(ctx, primitives);
  const slot = 'conversation.chat.node';
  let native = null, disposeEntry = null, syncing = false, disposed = false;
  const sync = () => {
    if (syncing || disposed) return;
    const original = ctx.slots.entries(slot).find(entry => entry.options.key === 'assistant-step' && entry.options.priority !== -20);
    if (original === native) return;
    syncing = true;
    try {
      disposeEntry?.(); disposeEntry = null; native = null;
      if (!original) return;
      const Original = original.component;
      // Native entries exclusively own their child Slots. Shadows must reuse
      // the published content factories, not redeclare those child Slots.
      const Native = props => <Original {...props} renderSlot={(name, input) => {
        if(name==='conversation.chat.reasoning.body') return props.renderFactorySlot('conversation.chat.reasoning.content',input);
        if(name==='conversation.chat.message.images') return props.renderFactorySlot('conversation.images.content',input);
        throw new Error(`Unsupported assistant content slot: ${name}`);
      }} />;
      function ExtendedAssistant(props) {
        const blocks = props.node.data.blocks;
        const source = blocks.filter(b => b.kind === 'text').map(b => b.text).join('');
        const safeSource = studentMarkdown(source);
        const markup = useMemo(() => /<details\b|\[\[|<br\b|\||\]\(\s*<?session:/i.test(source) ? conversationMarkdown(safeSource) : null, [safeSource]);
        const extended = hasInteractiveBlocks(source);
        const drawingParts=useMemo(()=>splitDrawingBlocks(safeSource),[safeSource]),hasDrawing=drawingParts.some(p=>p.type==='drawing');
        if ((!extended && !markup?.special&&!hasDrawing) || props.groupPart === 'reasoning') return <Native {...props} />;
        const labels = { code: { copyLabel: '复制', copiedLabel: '已复制' }, footnotes: '注释' };
        const renderMarkdown = text => <MarkdownText text={text} streaming={props.node.data.status === 'running'} labels={labels} />;
        const reviewContext = { ctx, sessionId: props.sessionId, messageId: props.node.data.finalNode?.messageId, settled: props.node.data.status !== 'running' && Boolean(props.node.data.finalNode?.messageId) };
        const renderText = (text, componentOffset = 0) => <InteractiveBlocks source={text} componentOffset={componentOffset} scope={props.sessionId} nodeId={props.node.key} renderMarkdown={renderMarkdown} reviewContext={reviewContext} onSubmit={({ text }) => appendAnswer(ctx, props.sessionId, text)} />;
        const body=hasDrawing?drawingParts.map((part,i)=>part.type==='drawing'
          ?<React.Fragment key={i}>{part.callId?props.renderFactorySlot('notara.drawing.content',{ownerSessionId:props.sessionId,occurrenceKey:JSON.stringify([props.node.key,i]),callId:part.callId,beforeSeq:props.node.data.finalNode?.seq,openFile:props.openFile}):<p role="status">正在准备白板…</p>}</React.Fragment>
          :<React.Fragment key={i}>{(()=>{const nodes=conversationMarkdown(part.text);const offset=drawingParts.slice(0,i).filter(p=>p.type==='text').reduce((n,p)=>n+splitBoardBody(p.text).segments.filter(s=>(s.kind==='component'||s.kind==='retired')).length,0);return nodes.special?<ConversationMarkdown nodes={nodes.nodes} renderText={(text,index)=>renderText(text,offset+(index??0))} renderSummary={renderMarkdown}/>:renderText(part.text,offset);})()}</React.Fragment>)
          :markup?.special?<ConversationMarkdown nodes={markup.nodes} renderText={renderText} renderSummary={renderMarkdown}/>:renderText(safeSource);
        return <><Native {...props} node={{ ...props.node, data: { ...props.node.data, blocks: blocks.filter(b => b.kind !== 'text') } }} />{markup?.sessionLinks ? <SessionLinkScope ctx={ctx} sessionId={props.sessionId} primitives={primitives}>{body}</SessionLinkScope> : body}</>;
      }
      disposeEntry = ctx.slots.register({ name: slot, key: 'assistant-step', priority: -20, locale: original.locale, inject: original.inject }, ExtendedAssistant);
      native=original;
    } finally { syncing = false; }
  };
  const stop = ctx.slots.subscribe(slot, sync);
  const cleanup=() => { disposed=true;stop();stopUsers();disposeEntry?.();native=null; };
  try{sync();}catch(error){cleanup();throw error;}
  return cleanup;
}
