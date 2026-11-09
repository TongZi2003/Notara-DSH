import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { conversationMarkdown } from './conversation-markdown-model.js';
import { ConversationMarkdown } from './conversation-markdown.jsx';
import {userMessageCopyText} from './user-message-text.js';
import { SessionLinkScope } from './session-link-scope.jsx';
export {userMessageCopyText} from './user-message-text.js';

const labels = { code: { copyLabel: '复制', copiedLabel: '已复制' }, footnotes: '注释' };
function UserMarkdownText({text,MarkdownText,ctx,sessionId,primitives}){
  const markup=useMemo(()=>/<details\b|\[\[|<br\b|\||\]\(\s*<?session:/i.test(text)?conversationMarkdown(text):null,[text]);
  const render=value=><MarkdownText text={value} streaming={false} labels={labels}/>;
  const body=markup?.special?<ConversationMarkdown nodes={markup.nodes} renderText={render} renderSummary={render}/>:render(text);
  return markup?.sessionLinks?<SessionLinkScope ctx={ctx} sessionId={sessionId} primitives={primitives}>{body}</SessionLinkScope>:body;
}

/** Display only. The native node keeps its exact text, attachments and identity. */
export function UserMarkdownMessage(props) {
  const { node, Native, MarkdownText, userText, writeClipboard, IconCopyOutlineRegular, FileTypeIcon, renderSlot, renderFactorySlot, loadImage, t } = props;
  useSyncExternalStore(listener=>userText.subscribe(listener), ()=>userText.getSnapshot(), ()=>userText.getSnapshot());
  const evaluate = useMemo(() => userText.createEvaluator(), [userText]);
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 1200); return () => clearTimeout(timer); }, [copied]);
  const data = node.data, parts = data.content ?? [];
  const text = parts.filter(p => p.type === 'text').map(p => p.text).join('');
  if (parts.some(p => !['text', 'image', 'file'].includes(p.type) || p.type !== 'text' && !p.attachment)) return <Native {...props} />;
  const attachments = parts.filter(p => p.type !== 'text');
  const facts = {sessionLabels:data.referenceLabels ?? [],skillNames:data.skillNames ?? []};
  // Evaluate once in original coordinates. Text display replacements are
  // authoritative; business nodes keep native actions at their original place.
  let nodes;
  try{nodes=evaluate({text,facts});}catch{return <Native {...props}/>;}
  const chunks=[];
  for(const node of nodes){
    if(node.id==='text'){
      const value=node.data.display??node.data.text??text.slice(node.start,node.end),last=chunks.at(-1);
      if(last?.kind==='text')last.text+=value;else chunks.push({kind:'text',text:value});
    }else chunks.push({kind:'reference',node});
  }
  const summary=data.referenceLabels?.length?t('message.referenceSummary',{labels:data.referenceLabels.join(t('message.referenceSeparator'))}):'';
  const visibleText=userMessageCopyText(text,nodes)+(summary?'\n'+summary:'');
  const clock = typeof data.time === 'number' ? new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }).format(data.time) : '';
  const copy = async () => { if (writeClipboard && await writeClipboard(visibleText)) setCopied(true); };
  return <div className="nv-user-message" data-user-markdown>
    <div className="nv-user-stack">
      {attachments.length > 0 && <div className="nv-user-attachments" data-message-attachments>{attachments.map((part, i) => part.type === 'image'
        ? <React.Fragment key={i}>{renderFactorySlot('conversation.images.content', { images: [{ attachment: part.attachment }], loadImage, align: 'end', compact: attachments.length > 1 })}</React.Fragment>
        : <span className="nv-user-file" key={i} title={part.attachment.name}>{FileTypeIcon && <FileTypeIcon path={part.attachment.name} />}<span>{part.attachment.name}</span></span>)}</div>}
      {text && <div className="nv-user-markdown">{chunks.map((chunk,i)=>chunk.kind==='text'?<UserMarkdownText key={i} text={chunk.text} MarkdownText={MarkdownText} ctx={props.ctx} sessionId={props.sessionId} primitives={props}/>:<React.Fragment key={i}>{renderFactorySlot('conversation.user.text',{text:text.slice(chunk.node.start,chunk.node.end),facts,interactive:true})}</React.Fragment>)}</div>}
      {summary && <div className="nv-user-reference-summary">{summary}</div>}
    </div>
    <div className="nv-user-message-actions">{clock && <time>{clock}</time>}<button type="button" aria-label={copied ? t('copied') : t('copy')} title={copied ? t('copied') : t('copy')} onClick={copy}>{IconCopyOutlineRegular ? <IconCopyOutlineRegular /> : copied ? '已复制' : '复制'}</button></div>
  </div>;
}

/** Preserve the native slot's injection/locale contract and restore it on unload. */
export function installUserMarkdown(ctx, primitives) {
  const slot = 'conversation.chat.node', installed = new Map();
  let syncing = false, disposed = false;
  const sync = () => {
    if (syncing || disposed) return;
    syncing = true;
    try { for (const key of ['user', 'steering']) {
      const original = ctx.slots.entries(slot).find(e => e.options.key === key && e.options.priority !== -20);
      if (installed.get(key)?.original === original) continue;
      installed.get(key)?.dispose(); installed.delete(key);
      if (!original) continue;
      const Native = original.component;
      const View = props => <UserMarkdownMessage {...props} {...primitives} ctx={ctx} userText={ctx.uiConversation.userText} Native={Native} />;
      installed.set(key, { original, dispose: ctx.slots.register({ name: slot, key, priority: -20, locale: original.locale, inject: original.inject }, View) });
    } } finally { syncing = false; }
  };
  const stop = ctx.slots.subscribe(slot, sync);
  const cleanup=()=>{disposed=true;stop();for(const entry of installed.values())entry.dispose();installed.clear();};
  try{sync();}catch(error){cleanup();throw error;}
  return cleanup;
}
