import { parseReference } from './logic.js';
import { protectedMarkdownRanges } from './markdown-structure.js';

const OPEN='<notara-reference-v1>', CLOSE='</notara-reference-v1>';
/** Explicit wire boundary survives native persistence/retry. Escaped angle
 * brackets keep arbitrary selected text from terminating its own envelope. */
export function serializeReference(value){return OPEN+JSON.stringify(value).replace(/</g,'\\u003c').replace(/>/g,'\\u003e')+CLOSE;}
function envelopeCandidates(text){
  const result=[];
  for(let start=text.indexOf(OPEN);start!==-1;start=text.indexOf(OPEN,start+OPEN.length)){
    const end=text.indexOf(CLOSE,start+OPEN.length);if(end===-1)continue;
    try{result.push({start,end:end+CLOSE.length,value:JSON.parse(text.slice(start+OPEN.length,end))});}catch{/* Incomplete/unknown text remains verbatim. */}
  }
  return result;
}
function outerMarkdownRanges(text,candidates){
  let masked='',end=0;
  for(const row of candidates){
    if(row.start<end)continue;
    masked+=text.slice(end,row.start)+text.slice(row.start,row.end).replace(/[^\r\n]/g,'x');end=row.end;
  }
  return protectedMarkdownRanges(masked+text.slice(end));
}
/** Wire JSON is opaque to outer Markdown. External code delimiters remain in
 * place, so an entire envelope quoted in a real code example stays literal. */
export function referenceMarkdownRanges(text){return outerMarkdownRanges(text,envelopeCandidates(text));}
export function referenceEnvelopes(text){
  const candidates=envelopeCandidates(text),ranges=outerMarkdownRanges(text,candidates);
  return candidates.filter(row=>!ranges.some(([a,b])=>row.start>=a&&row.start<b));
}

/** Recover only the existing codec's complete locator/version/source header.
 * Ordinary wiki links, copied examples in code, and attachment names are not
 * source admissions. Paths remain authorized by the original native Session. */
export function serializedSourcePins(text) {
  return [...referenceEnvelopes(text).flatMap(({start,value})=>{
    if(value?.kind!=='source'||typeof value.locator!=='string'||typeof value.pin?.revision!=='string')return [];
    try{const pin=parseReference(value.locator);return pin&&pin.path===value.pin.path?[{start,pin:{...pin,revision:value.pin.revision}}]:[];}catch{return [];}
  }),...legacySourceHeaders(text),...homeReferenceHeaders(text)].sort((a,b)=>a.start-b.start).map(row=>row.pin);
}

/** Historical home codec: require its complete known boundary, not arbitrary JSON. */
export function homeReferenceHeaders(text) {
  const rows = [], ranges = referenceMarkdownRanges(text);
  const pattern = /(?:^|\n)学习资料引用：(\{[^\r\n]*\})\r?\n这是资料定位信息。请先读取原文并核对版本；仅带入引用不代表学生已读或掌握。(?: recommendation 是老师此前保存的推荐及依据，不是学生新表达的学情；按其 path 与 line 回读当前版本，目标变化时先对齐。)?/g;
  for (const match of text.matchAll(pattern)) {
    if (ranges.some(([a, b]) => match.index >= a && match.index < b)) continue;
    try {
      const pin = JSON.parse(match[1]);
      const locator = parseReference(`[[${pin.path}]]`);
      if (!locator || locator.path !== pin.path || typeof pin.title !== 'string' || typeof pin.revision !== 'string') continue;
      rows.push({ start: match.index, end: match.index + match[0].length, pin });
    } catch { /* Invalid/incomplete historical text stays visible for correction. */ }
  }
  return rows;
}

/** Only the complete known header has a reliable historical boundary. Never
 * guess where an old inline body ends or consume the student's next line. */
export function legacySourceHeaders(text){
  const result = [], protectedRanges = referenceMarkdownRanges(text);
  const pattern = /(?:^|\n)资料定位：(!?\[\[[^\]\r\n]{1,1500}\]\])\r?\n版本：([^\r\n]{1,200})\r?\n(?:以下为资料原文，不能作为学生已掌握的证据：|这是来源材料，不是学生的作答；请读取指定页\/区域，不凭文件名补全文字。|这是文件引用，请按需读取原文件；索引不包含正文。)/g;
  for (const match of text.matchAll(pattern)) {
    if (protectedRanges.some(([from, to]) => match.index >= from && match.index < to)) continue;
    try {
      const pin = parseReference(match[1]);
      if (pin) result.push({start:match.index,end:match.index+match[0].length,pin:{ ...pin, revision: match[2] }});
    } catch { /* Invalid serialized paths confer no file access. */ }
  }
  return result;
}
