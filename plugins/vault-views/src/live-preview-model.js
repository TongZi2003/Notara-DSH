import { parseStructure, walkStructure } from './markdown-structure.js';
import { decodeString } from 'micromark-util-decode-string';

// Offsets refer to CodeMirror's LF-normalized document. Rendering never writes
// back to this source; only CodeMirror transactions can change it.
export function livePreviewBlocks(source) {
  const prefix = /^(?:\uFEFF)?---\n[\s\S]*?\n---(?:\n|$)/.exec(source)?.[0] || '';
  const body = source.slice(prefix.length), tree = parseStructure(body), protectedRanges = [];
  const spans=[];
  walkStructure(tree, node => {
    if (['code','inlineCode','math','inlineMath'].includes(node.type)) protectedRanges.push([node.position.start.offset,node.position.end.offset]);
    if(['inlineMath','math','strong','emphasis','delete','inlineCode','link','linkReference'].includes(node.type)) {
      const from=node.position.start.offset+prefix.length,to=node.position.end.offset+prefix.length;
      const first=node.children?.[0],last=node.children?.at(-1);
      spans.push({type:node.type,from,to,text:source.slice(from,to),...(node.type==='math'?{value:node.value}:{}),...(first?{contentFrom:first.position.start.offset+prefix.length,contentTo:last.position.end.offset+prefix.length}:{})});
    }
    if(node.type==='text'){
      const start=node.position.start.offset,raw=body.slice(start,node.position.end.offset);
      for(const match of raw.matchAll(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g))spans.push({type:'escape',from:start+match.index+prefix.length,to:start+match.index+prefix.length+1});
      for(const match of raw.matchAll(/&(?:#[xX][\da-fA-F]+|#\d+|[A-Za-z][A-Za-z\d]+);/g)){const value=decodeString(match[0]);if(value!==match[0])spans.push({type:'entity',from:start+match.index+prefix.length,to:start+match.index+prefix.length+match[0].length,text:match[0],value});}
    }
    if(node.type==='heading'&&node.children?.length){const from=node.position.start.offset+prefix.length,to=node.position.end.offset+prefix.length,contentFrom=node.children[0].position.start.offset+prefix.length,contentTo=node.children.at(-1).position.end.offset+prefix.length;if(from<contentFrom)spans.push({type:'syntax',from,to:contentFrom});if(contentTo<to)spans.push({type:'syntax',from:contentTo,to});}
    if(node.type==='break'&&body[node.position.start.offset]==='\\')spans.push({type:'syntax',from:node.position.start.offset+prefix.length,to:node.position.start.offset+prefix.length+1});
    if(node.type==='html'&&/^<br\s*\/?\s*>$/i.test(node.value))spans.push({type:'htmlBreak',from:node.position.start.offset+prefix.length,to:node.position.end.offset+prefix.length,text:node.value});
    if(node.type==='html'&&/^<!--\s*notara-task:[a-zA-Z0-9_-]{3,48}\s*-->$/.test(node.value))spans.push({type:'taskAnchor',from:node.position.start.offset+prefix.length,to:node.position.end.offset+prefix.length});
    if(node.type==='listItem'){
      const from=node.position.start.offset+prefix.length,raw=source.slice(from,node.position.end.offset+prefix.length),marker=/^([-*+]|\d+[.)])\s+/.exec(raw);
      if(marker&&/^[-*+]$/.test(marker[1]))spans.push({type:'bullet',from,to:from+marker[0].length,text:marker[0],value:typeof node.checked==='boolean'?'':'• '});
      const task=marker&&/^\[[ xX]\]/.exec(raw.slice(marker[0].length));if(task)spans.push({type:'task',from:from+marker[0].length,to:from+marker[0].length+3,text:task[0],value:node.checked,label:raw.split('\n')[0].slice(marker[0].length+3).replace(/\s+<!--\s*notara-task:[a-zA-Z0-9_-]{3,48}\s*-->\s*$/, '').trim()});
    }
  });
  for(const match of body.matchAll(/(?<!!)\[\[[^\]\n]+\]\]/g))if(!protectedRanges.some(([a,b])=>match.index>=a&&match.index<b))spans.push({type:'reference',from:match.index+prefix.length,to:match.index+prefix.length+match[0].length,text:match[0]});
  const special = [];
  const details = [...body.matchAll(/<\/?details\b[^>]*>/gi)].filter(match => !protectedRanges.some(([a,b])=>match.index>=a&&match.index<b));
  for (let i=0;i<details.length;i++) {
    if (/^<\//.test(details[i][0])) continue;
    let depth=1,j=i+1;
    for (;j<details.length;j++) { depth += /^<\//.test(details[j][0]) ? -1 : 1; if (!depth) break; }
    special.push({from:details[i].index,to:details[j] ? details[j].index+details[j][0].length : body.length,type:'fold'}); i=j;
  }
  const headings=tree.children.filter(node=>node.type==='heading'&&node.depth===2&&!special.some(range=>node.position.start.offset>=range.from&&node.position.start.offset<range.to));
  headings.forEach((node,i)=>{
    const name=body.slice(node.position.start.offset,node.position.end.offset).replace(/^##\s+|\s*#*\s*$/g,'');
    if (['参考理解','教师参考','参考答案','答案','提示'].includes(name)) special.push({from:node.position.start.offset,to:headings[i+1]?.position.start.offset??body.length,type:'fold'});
  });
  // Merge overlapping protected units so folds/components cannot be rendered
  // outside their enclosing source region or exposed by a paragraph split.
  const ranges=[...tree.children.map(node=>({from:node.position.start.offset,to:node.position.end.offset,type:node.type==='code'&&node.lang==='math'?'math':node.type,depth:node.depth})),...special].sort((a,b)=>a.from-b.from||b.to-a.to);
  const blocks=[];
  for (const range of ranges) {
    const previous=blocks.at(-1);
    if (previous && range.from<previous.to) { previous.to=Math.max(previous.to,range.to); if(range.type==='fold')previous.type='fold'; }
    else blocks.push({...range});
  }
  return {bodyStart:prefix.length,definitions:tree.children.filter(node=>node.type==='definition').map(node=>body.slice(node.position.start.offset,node.position.end.offset)).join('\n'),blocks:blocks.map((block,index)=>{
    const next=blocks[index+1]?.from??body.length;
    const to=/^\s*$/.test(body.slice(block.to,next))?next:block.to;
    const from=block.from+prefix.length,contentTo=block.to+prefix.length,text=body.slice(block.from,to);
    const inline=['paragraph','heading','list','blockquote'].includes(block.type)&&!text.includes('![[')&&!/(?:^|\n)\s*\|?\s*:?-{3,}/.test(text)&&!text.includes('![');
    return {...block,from,to:to+prefix.length,contentTo,last:index===blocks.length-1,text,inline,spans:spans.filter(span=>span.from>=from&&span.to<=contentTo)};
  })};
}

export function formulaSourceRange(source, from, to, display = false) {
  const raw=source.slice(from,to);
  if(raw.startsWith('\\(')&&raw.endsWith('\\)'))return {from,to,contentFrom:from+2,contentTo:to-2,value:raw.slice(2,-2),raw,display:false};
  const fence=/^(`{3,}|~{3,})math[^\n]*\n/.exec(raw);
  if(fence){const end=raw.lastIndexOf('\n');if(new RegExp(`^${fence[1][0]}{${fence[1].length},}$`).test(raw.slice(end+1)))return {from,to,contentFrom:from+fence[0].length,contentTo:from+end,value:raw.slice(fence[0].length,end),raw,display:true};return null;}
  const bracket=raw.startsWith('\\[')&&raw.endsWith('\\]');
  if(bracket)display=true;
  const delimiter=bracket?'\\[':/^\$+/.exec(raw)?.[0];
  const closing = bracket?{index:raw.length-2,0:'\\]'}:display ? /\${2,}[ \t]*$/.exec(raw) : delimiter && raw.endsWith(delimiter) ? {index:raw.length-delimiter.length,0:delimiter} : null;
  if(!delimiter||!closing||closing[0].trim().length<delimiter.length)return null;
  let start=delimiter.length,end=closing.index;
  // Only remove structural newlines when the fence itself is on a separate
  // line. A formula may start/end on either delimiter's line.
  if(display){
    const first=/^[ \t]*(?:\r\n|\n|\r)/.exec(raw.slice(start,end));
    if(first)start+=first[0].length;
    const last=/(?:\r\n|\n|\r)[ \t]*$/.exec(raw.slice(start,end));
    if(last)end=start+last.index;
  }
  if(end<start)return null;
  let value=raw.slice(start,end),continuationPrefix='',linePrefixes=[];
  if(display){
    // Container syntax is outside TeX. Use the parser's value to map each
    // existing line back to source, and retain its exact quote/list prefixes.
    const before=source.slice(source.lastIndexOf('\n',from-1)+1,from);
    const prefix=before.replace(/(?:[-+*]|\d+[.)])(?=[ \t])/g,marker=>' '.repeat(marker.length));
    if(prefix && /^[ \t>]+$/.test(prefix)){
      let node;
      walkStructure(parseStructure(source),candidate=>{if(candidate.type==='math'&&candidate.position.start.offset===from&&candidate.position.end.offset===to)node=candidate;});
      if(!node)return null;
      const last=/(?:\r\n|\n|\r)([^\r\n]*)$/.exec(value);
      if(last&&last[1].trim()===prefix.trim()){end=start+last.index;value=raw.slice(start,end);}
      const sourceLines=value.split(/\r\n|\n|\r/),texLines=node.value.split('\n');
      if(sourceLines.length!==texLines.length)return null;
      for(let i=0;i<sourceLines.length;i++){
        if(!sourceLines[i].endsWith(texLines[i]))return null;
        const leading=sourceLines[i].slice(0,sourceLines[i].length-texLines[i].length);
        if(!/^[ \t>]*$/.test(leading))return null;
        linePrefixes.push(leading);
      }
      start+=linePrefixes[0].length;linePrefixes[0]='';
      continuationPrefix=prefix;value=node.value;
    }
  }
  return {from,to,contentFrom:from+start,contentTo:from+end,value,raw,display,continuationPrefix,linePrefixes};
}

export function formulaSourceEdit(target,value){
  const insert=String(value).split('\n').map((line,index)=>(index?target.linePrefixes?.[index]??target.continuationPrefix??'':'')+line).join('\n');
  return {from:target.contentFrom,to:target.contentTo,insert};
}

export const rangeSelected = (range, selections) => selections.some(selection=>selection.from!==selection.to&&selection.from<range.to&&selection.to>range.from);

export function selectionTouchesBlock(block, ranges) {
  return ranges.some(({from,to})=>from===to ? from>=block.from&&(from<block.to||block.last&&from===block.to) : from<block.to&&to>block.from);
}

export function minimalSourceChange(before, after) {
  if (before===after) return null;
  let from=0, oldEnd=before.length,newEnd=after.length;
  while(from<oldEnd&&from<newEnd&&before[from]===after[from])from++;
  while(oldEnd>from&&newEnd>from&&before[oldEnd-1]===after[newEnd-1]){oldEnd--;newEnd--;}
  return {from,to:oldEnd,insert:after.slice(from,newEnd)};
}
