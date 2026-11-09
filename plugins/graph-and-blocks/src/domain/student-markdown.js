import {fencedMarkdownRanges} from './board-components.js';

export function studentMarkdown(source){
  const text=String(source??''),fences=fencedMarkdownRanges(text);
  let hidden=false,offset=0;
  return text.split('\n').filter(line=>{
    const insideFence=fences.some(([from,to])=>offset>=from&&offset<to);
    offset+=line.length+1;
    if(!insideFence&&/^##\s+/.test(line))hidden=/^##\s+(参考理解|教师参考|答案|参考答案|提示)(?:\s|$)/.test(line.trim());
    return !hidden;
  }).join('\n');
}
