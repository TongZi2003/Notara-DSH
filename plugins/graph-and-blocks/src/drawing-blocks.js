import {fromMarkdown} from 'mdast-util-from-markdown';
/** Only top-level fenced drawing blocks are executable UI references. */
export function splitDrawingBlocks(source){
  const parts=[];let cursor=0;
  for(const node of fromMarkdown(source).children){
    if(node.type!=='code'||node.lang!=='drawing')continue;
    const start=node.position.start.offset,end=node.position.end.offset,raw=source.slice(start,end);
    if(!/^ {0,3}(`{3,}|~{3,})drawing\s*\n/.test(raw))continue;
    if(start>cursor)parts.push({type:'text',text:source.slice(cursor,start)});
    const callId=node.value.trim();parts.push({type:'drawing',callId:/^[\w:-]{1,180}$/.test(callId)&&/\n {0,3}(`{3,}|~{3,})\s*$/.test(raw)?callId:null});cursor=end;
  }
  if(cursor<source.length)parts.push({type:'text',text:source.slice(cursor)});
  return parts;
}
