import MarkdownIt from 'markdown-it';
import { previewText,isReferenceHeading } from './preview.js';
import {parseReference} from './file-reference.js';

const markdown = new MarkdownIt({ html: true, linkify: false, typographer: false });
markdown.inline.ruler.before('text','notara_calendar_date',(state,silent)=>{
  if(state.linkLevel>0)return false;
  const at=state.src.indexOf('📅',state.pos);if(at<0||at>=state.posMax)return false;
  const prefix=state.src.slice(state.pos,at);
  // Stop at exactly the Markdown text terminators; let native rules consume
  // escapes, code spans, math and links before examining later plain text.
  if(/[\n!#$%&*+\-:<=>@[\\\]^_`{}~]/.test(prefix))return false;
  const match=/^📅\s*(\d{4}-\d{2}-\d{2})(?![\p{L}\p{N}_-])/u.exec(state.src.slice(at));
  if(!match)return false;
  if(!silent){state.pending+=prefix;const token=state.push('notara_calendar_date','',0);token.meta={date:match[1],from:at,to:at+match[0].length};token.content=match[0];}
  state.pos=at+match[0].length;return true;
});
export function calendarTaskDate(text){const token=markdown.parseInline(text,{})[0]?.children?.find(row=>row.type==='notara_calendar_date');if(!token)return null;const {date,from,to}=token.meta;return {date,title:(text.slice(0,from)+text.slice(to)).trim()};}

/** New plans and legacy guides share one classification; filenames are not rewritten. */
export function isLearningPlan({path='',type,title='',tags=[],template=false}={}){
  if(!/\.md$/i.test(path)||template||/^(日记|模板)\//.test(path))return false;
  if(type==='plan'||type==='guide')return true;
  if(['route','lesson','learner-profile','daily','diary','template','skill','base'].includes(type))return false;
  return typeof title==='string'&&title.includes('导读')||path.split('/').at(-1).includes('导读')||tags.includes('导读');
}

/** Replace only the parsed date, preserving code, math, references and task anchors. */
export function replaceCalendarTaskDate(text,date){
  const token=markdown.parseInline(text,{})[0]?.children?.find(row=>row.type==='notara_calendar_date');
  if(token){const {from,to}=token.meta;return text.slice(0,from)+'📅 '+date+text.slice(to);}
  const {content,anchorId}=stripTaskAnchor(text);
  return anchorId?content+' 📅 '+date+text.slice(content.length):text.trimEnd()+' 📅 '+date;
}
markdown.inline.ruler.before('escape', 'notara_math', (state, silent) => {
  const start = state.pos, marker = state.src.startsWith('$$', start) ? '$$' : state.src[start] === '$' ? '$' : state.src.startsWith('\\(', start) ? '\\(' : state.src.startsWith('\\[', start) ? '\\[' : null;
  if (!marker) return false;
  const endMarker = marker === '\\(' ? '\\)' : marker === '\\[' ? '\\]' : marker;
  const end = state.src.indexOf(endMarker, start + marker.length);
  if (end < 0) return false;
  if (!silent) { const token = state.push('notara_math', '', 0); token.content = state.src.slice(start, end + endMarker.length); }
  state.pos = end + endMarker.length; return true;
});
// A real inline token: escapes, backtick spans and indented/fenced blocks are
// consumed by the parser, so displayed examples never become learning facts.
markdown.inline.ruler.before('escape', 'notara_wikilink', (state, silent) => {
  if (!state.src.startsWith('[[', state.pos)&&!state.src.startsWith('![[',state.pos)) return false;
  const match = /^!?\[\[([^\]|#]+)(?:[^\]]*)\]\]/.exec(state.src.slice(state.pos));
  if (!match) return false;
  if (!silent) { const token = state.push('notara_wikilink', '', 0); token.content = match[1].trim(); token.meta={reference:parseReference(match[0])}; }
  state.pos += match[0].length;
  return true;
});

const TASK_ANCHOR_RE = /^(.*?)(?:\s+<!--\s*notara-task:([a-zA-Z0-9_-]{3,48})\s*-->|\s+\^([a-zA-Z0-9_-]{3,48}))\s*$/;
export function stripTaskAnchor(rawText) {
  const source = String(rawText ?? '');
  const match = TASK_ANCHOR_RE.exec(source);
  if (!match) return { content: source, anchorId: null, rawText: source };
  return { content: match[1].trimEnd(), anchorId: match[2] ?? match[3] ?? null, rawText: source };
}

function declaredRelation(section, subsection, content) {
  const match = /^\[\[[^\]\r\n]+\]\](?:[（(]([^）)]+)[）)])?\s*[:：]\s*(\S[\s\S]*)$/.exec(content.trim());
  if (!match) return null;
  const description = match[2].trim();
  if (section === '学生理解' && ['已建立的联系', '待探索的联系'].includes(subsection)) {
    const qualifier = match[1]?.split(/[／/]/).map(part => part.trim());
    if (!qualifier) return { kind: 'association', context: '', description, evidence: 'legacy' };
    const kind = { '前序依赖': 'prerequisite', '知识标签': 'example', '横向联系': 'association' }[qualifier[0]];
    if (!kind || qualifier.length > 2 || qualifier.length === 2 && !qualifier[1] || kind === 'example' && qualifier.length > 1) return null;
    return { kind, context: qualifier[1] ?? '', description, evidence: 'qualified' };
  }
  if (match[1]) return null;
  const kind = { '前序依赖': 'prerequisite', '横向联系': 'association' }[section];
  const grouped = typeof subsection === 'string' && new RegExp(`^${kind === 'prerequisite' ? '路线' : '主题'}[:：]\\s*(.+)$`).exec(subsection);
  if (!kind || subsection !== '' && !grouped) return null;
  return { kind, context: grouped ? grouped[1].trim() : '', description, evidence: '' };
}

export function markdownFacts(body, lineOffset = 0) {
  const tokens = markdown.parse(body, {}), lines = body.split(/\r?\n/), tasks = [], links = [];
  let section = '',subsection='',detailsDepth=0,quoteDepth=0;
  const items=[];
  const trackDetails=html=>{
    // Consume complete HTML tokens so quoted attributes, raw script content
    // and custom elements cannot masquerade as a collapsed teacher region.
    const tags=/<!--[^]*?(?:-->|$)|<(script|pre|style|textarea)(?=[\s>])(?:[^>"']|"[^"]*"|'[^']*')*>[^]*?(?:<\/\1\s*>|$)|<(\/?)([a-z][a-z\d:-]*)(?=[\s/>])(?:[^<>"']|"[^"]*"|'[^']*')*>/gi;
    for(const match of html.matchAll(tags))if(match[3]?.toLowerCase()==='details')detailsDepth=Math.max(0,detailsDepth+(match[2]?-1:1));
  };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if(token.type==='html_block')trackDetails(token.content);
    if(token.type==='blockquote_open')quoteDepth++;
    if(token.type==='blockquote_close')quoteDepth--;
    if(token.type==='list_item_open')items.push({used:false});
    if(token.type==='list_item_close')items.pop();
    if (token.type === 'heading_open'&&!detailsDepth&&!quoteDepth&&!items.length&&token.level===0) {
      if (token.tag === 'h2') {section = tokens[i + 1]?.content?.trim() ?? '';subsection='';}
      else if (token.tag === 'h1') {section = '';subsection='';}
      else subsection=token.tag==='h3'?(tokens[i+1]?.content?.trim()??''):null;
    }
    if (token.type === 'list_item_open' && token.map) {
      const index = token.map[0], task = lines[index]?.match(/^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s+(.*)$/);
      if (task) {
        const parsed = stripTaskAnchor(task[2]);
        tasks.push({ line: index + lineOffset + 1, checked: task[1] !== ' ', text: parsed.content, rawText: task[2], anchorId: parsed.anchorId, hidden: isReferenceHeading(section) || detailsDepth > 0 || /<details\b/i.test(task[2]) });
      }
    }
    if (token.type === 'inline') {
      // One explicit, current relation per direct list item. Other links in its
      // explanation remain references. History, quotations and nested citations
      // do not declare a current relationship; assistance is not an admission gate.
      const item=items.at(-1),first=token.children?.find(child=>child.type!=='text'||child.content.trim());
      const declaration=!detailsDepth&&!quoteDepth&&items.length===1&&!item.used&&first?.type==='notara_wikilink' ? declaredRelation(section,subsection,token.content) : null;
      if(item)item.used=true;
      for (const child of token.children ?? []) {
        if(child.type==='html_inline')trackDetails(child.content);
        let target = child.type === 'notara_wikilink' ? child.content : child.type === 'link_open' ? child.attrGet('href') : null,ref=child.meta?.reference;
        if (!target) continue;
        try {
          if(child.type==='link_open'){
            const rawHash=target.indexOf('#'),decoded=decodeURIComponent(target);
            // Standard Markdown separates the fragment before URI decoding.
            // Native resource links also accept a fully encoded locator; in
            // that case the last hash after a file extension is its fragment.
            const encodedHash=decoded.lastIndexOf('#');
            const fragment=rawHash>=0?decodeURIComponent(target.slice(rawHash)):encodedHash>=0&&/\.[a-z0-9]+$/i.test(decoded.slice(0,encodedHash))?decoded.slice(encodedHash):'';
            target=rawHash>=0?decodeURIComponent(target.slice(0,rawHash)):fragment?decoded.slice(0,encodedHash):decoded;
            if(fragment){const anchor=parseReference(`[[source${/\.pdf$/i.test(target)?'.pdf':'.md'}${fragment}]]`);if(anchor&&(anchor.page||anchor.range))ref={...anchor,path:target};}
          }
        } catch { continue; }
        if (!target || /^[a-z][a-z\d+.-]*:/i.test(target)) continue;
        const relation=child===first?declaration:null;
        links.push({ target, relative: child.type === 'link_open', section: relation?.evidence ? `学生理解/${subsection}` : section || '引用', style: relation?.evidence&&subsection==='已建立的联系' ? 'solid' : 'dashed',...(relation?{relation}:{}),...(ref&&(ref.page||ref.range)?{reference:ref}:{}) });
      }
    }
  }
  return { tasks, links };
}

/** Strip whole collapsed source/answer regions before truncation or flattening.
 * Unclosed/incomplete details conservatively hide the remainder; nesting does
 * not expose the outer answer when an inner details element ends. */
export function documentSummary(body) {
  const source = body.replace(/<!--[\s\S]*?(?:-->|$)/g, ''), tag = /<\s*(\/?)\s*details(?=[\s/>]|$)/gi;
  let depth = 0, cursor = 0, visible = '', match;
  while ((match = tag.exec(source))) {
    if (!depth) visible += source.slice(cursor, match.index);
    const end = source.indexOf('>', tag.lastIndex);
    if (end < 0) return previewText(visible.split(/^##\s+(?:参考理解|学生理解)\s*#*\s*\r?$/m)[0]);
    depth = match[1] ? Math.max(0, depth - 1) : depth + 1;
    cursor = end + 1; tag.lastIndex = cursor;
  }
  if (!depth) visible += source.slice(cursor);
  return previewText(visible.split(/^##\s+(?:参考理解|学生理解)\s*#*\s*\r?$/m)[0]);
}
