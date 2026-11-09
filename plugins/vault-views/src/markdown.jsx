import React, {useState} from 'react';
import { markdownSections, parseReference, parseSessionReference } from './logic.js';
import { PdfRegionPreview } from './pdf-reader.jsx';
import { protectedMarkdownRanges, parseStructure, walkStructure } from './markdown-structure.js';
import { FilePreview } from './file-preview.jsx';


function DeferredDetails({children}) {
  const [activated,setActivated]=useState(false);
  const [summary,...body]=React.Children.toArray(children);
  return <details onToggle={event=>{if(event.target===event.currentTarget&&event.currentTarget.open)setActivated(true);}}>{summary}{activated?body:null}</details>;
}

function FoldSummary({text, onOpen, renderMarkdown, remote, loadPdf}) {
  return <summary><span className="nv-inline-markdown">{renderMarkdown
    ? renderMarkdown(text, onOpen)
    : <Inline text={text} onOpen={onOpen} remote={remote} loadPdf={loadPdf} />}</span></summary>;
}

// Only source folds and PDF crops are custom. Preserve full Markdown between
// them for the native GFM/KaTeX engine, including blank lines inside $$ blocks.
function RichMarkdownBody({ content, onOpen, renderMarkdown, remote, loadPdf, depth = 0 }) {
  const source = String(content), protectedRanges = protectedMarkdownRanges(source);
  const events = [...source.matchAll(/<\/?details\b[^>]*>|!\[\[[^\]]+\]\]/gi)].filter(match => !protectedRanges.some(([start, end]) => match.index >= start && match.index < end));
  walkStructure(parseStructure(source), node => {
    if (node.type === 'image' && /^data:image\/(png|jpeg|webp|gif);base64,[a-z\d+/=\s]+$/i.test(node.url)) events.push({ 0: source.slice(node.position.start.offset, node.position.end.offset), index: node.position.start.offset, image: node });
  });
  events.sort((a, b) => a.index - b.index);
  const blocks = []; let cursor = 0;
  const append = end => { const text = source.slice(cursor, end); if (text.trim()) blocks.push(<React.Fragment key={`md-${cursor}`}>{renderMarkdown(text, onOpen)}</React.Fragment>); };
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (event.index < cursor || /^\s*<\/details/i.test(event[0])) continue;
    append(event.index);
    if (event.image) { blocks.push(<img key={`image-${event.index}`} className="nv-file-image" src={event.image.url} alt={event.image.alt || ''} />); cursor = event.index + event[0].length; continue; }
    if (event[0].startsWith('![[')) {
      const locator = parseReference(event[0]);
      blocks.push(locator && remote && depth < 2 ? <div className="nv-document-file-embed" key={`embed-${event.index}`}><FilePreview remote={remote} locator={locator} onOpen={onOpen} renderContent={text => <MarkdownReader content={text} onOpen={onOpen} renderMarkdown={renderMarkdown} remote={remote} loadPdf={loadPdf} depth={depth + 1} />} /><button onClick={() => onOpen?.(locator)}>{locator.page ? `查看原页 · 第 ${locator.page} 页` : `打开 ${locator.label} ↗`}</button></div> : <div key={`embed-${event.index}`}><Inline text={event[0]} onOpen={onOpen} remote={remote} loadPdf={loadPdf} /></div>);
      cursor = event.index + event[0].length; continue;
    }
    let foldDepth = 1, j = i + 1;
    for (; j < events.length; j++) {
      if (/^\s*<details/i.test(events[j][0])) foldDepth++;
      if (/^\s*<\/details/i.test(events[j][0]) && --foldDepth === 0) break;
    }
    const end = events[j]?.index ?? source.length;
    const inner = source.slice(event.index + event[0].length, end);
    const summary = /<summary\b[^>]*>([\s\S]*?)<\/summary>/i.exec(inner);
    blocks.push(<DeferredDetails key={`fold-${event.index}`}><FoldSummary text={summary?.[1]?.trim()==='查看来源选区'?'查看原页':summary?.[1] || '展开内容'} {...{onOpen,renderMarkdown,remote,loadPdf}} /><RichMarkdownBody content={inner.replace(/<summary\b[^>]*>[\s\S]*?<\/summary>/i, '')} onOpen={onOpen} renderMarkdown={renderMarkdown} remote={remote} loadPdf={loadPdf} depth={depth} /></DeferredDetails>);
    cursor = events[j] ? end + events[j][0].length : source.length; i = j;
  }
  append(source.length);
  return blocks;
}

// React text nodes are intentional: arbitrary Vault HTML is never executed.
// Sources, folds, headings, code, and links remain usable without an HTML sink.
export function Inline({ text, onOpen, remote, loadPdf }) {
  const parts = String(text).split(/(!?\[\[[^\]]+\]\]|\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((?:https?:\/\/|session:)[^\s)]+\))/gi);
  return parts.map((part, index) => {
    const session = !part.startsWith('!') && parseSessionReference(part);
    if (session) return <button className="nv-vault-link" key={index} onClick={() => onOpen?.({ sessionId: session.sessionId, label: session.label })}>{session.label}</button>;
    const reference = parseReference(part);
    if (reference) {
      if (part.startsWith('![[') && reference.page && reference.rect && remote) {
        return <span className="nv-vault-pdf-embed" key={index}><PdfRegionPreview remote={remote} reference={reference} loadPdf={loadPdf} /><button className="nv-vault-link" onClick={() => onOpen?.(reference)}>{`查看原页 · 第 ${reference.page} 页`}</button></span>;
      }
      return <button className="nv-vault-link" key={index} onClick={() => onOpen?.(reference)}>{reference.page ? `查看原页 · 第 ${reference.page} 页` : reference.label}</button>;
    }
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(part);
    if (link) return <a key={index} href={link[2]} target="_blank" rel="noopener noreferrer">{link[1]}</a>;
    return part;
  });
}

export function MarkdownBody({ content, onOpen, renderMarkdown, remote, loadPdf, depth = 0 }) {
  if (renderMarkdown) return <RichMarkdownBody {...{ content, onOpen, renderMarkdown, remote, loadPdf, depth }} />;
  const lines = String(content).replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/), blocks = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }
    if (/^\s*<details(?:\s[^>]*)?>\s*$/.test(line)) {
      let depth = 1, end = index + 1;
      while (end < lines.length && depth) { if (/^\s*<details(?:\s[^>]*)?>/.test(lines[end])) depth++; if (/^\s*<\/details>/.test(lines[end])) depth--; if (depth) end++; }
      const inner = lines.slice(index + 1, end).join('\n'), summary = /<summary>(.*?)<\/summary>/.exec(inner);
      blocks.push(<DeferredDetails key={index}><FoldSummary text={summary?.[1] || '展开内容'} {...{onOpen,renderMarkdown,remote,loadPdf}} /><MarkdownBody content={inner.replace(/<summary>[\s\S]*?<\/summary>/, '')} onOpen={onOpen} renderMarkdown={renderMarkdown} remote={remote} loadPdf={loadPdf} /></DeferredDetails>);
      index = end + 1; continue;
    }
    const fence = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      let end = index + 1;
      while (end < lines.length && !(new RegExp(`^\\s{0,3}${fence[1][0]}{${fence[1].length},}\\s*$`).test(lines[end]))) end++;
      blocks.push(<pre key={index}><code>{lines.slice(index + 1, end).join('\n')}</code></pre>); index = end + 1; continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) { blocks.push(React.createElement(`h${heading[1].length}`, { key: index }, <Inline text={heading[2]} onOpen={onOpen} remote={remote} loadPdf={loadPdf} />)); index++; continue; }
    if (/^\s*(?:[-*+]\s|\d+[.)]\s)/.test(line)) {
      const items = []; const start = index;
      while (index < lines.length && /^\s*(?:[-*+]\s|\d+[.)]\s)/.test(lines[index])) {
        const item = lines[index].replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '');
        items.push(<li key={index}><Inline text={item} onOpen={onOpen} remote={remote} loadPdf={loadPdf} /></li>); index++;
      }
      blocks.push(<ul key={start}>{items}</ul>); continue;
    }
    if (/^\s*<\/?(?:details|summary)>/.test(line)) { index++; continue; }
    const paragraph = [line], start = index++;
    while (index < lines.length && lines[index].trim() && !/^(?:#{1,6}\s|\s*<details|\s*[-*+]\s|\s*`{3,}|\s*~{3,})/.test(lines[index])) paragraph.push(lines[index++]);
    const joined = paragraph.join('\n');
    blocks.push(renderMarkdown && !/!\[\[[^\]]+#page=/i.test(joined) ? <div key={start}>{renderMarkdown(joined, onOpen)}</div> : <p key={start}><Inline text={joined} onOpen={onOpen} remote={remote} loadPdf={loadPdf} /></p>);
  }
  return blocks;
}

export function MarkdownReader({ content, onOpen, renderMarkdown, remote, loadPdf, depth = 0 }) {
  return <article className="nv-vault-markdown">{markdownSections(content).map((section, index) => section.reference
    ? <DeferredDetails key={index}><FoldSummary text={section.title} {...{onOpen,renderMarkdown,remote,loadPdf}} /><MarkdownBody content={section.content} onOpen={onOpen} renderMarkdown={renderMarkdown} remote={remote} loadPdf={loadPdf} depth={depth} /></DeferredDetails>
    : <section key={index}>{section.title && (renderMarkdown ? renderMarkdown(`## ${section.title}`, onOpen) : <h2>{section.title}</h2>)}<MarkdownBody content={section.content} onOpen={onOpen} renderMarkdown={renderMarkdown} remote={remote} loadPdf={loadPdf} depth={depth} /></section>)}</article>;
}
