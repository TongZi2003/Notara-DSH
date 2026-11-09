/** Same native node projection for bubble copy, navigation and queue editing.
 * No history mutation and no model-facing text is manufactured here. */
export function userMessageCopyText(text,nodes){
  return nodes.map(node=>node.id==='text'?node.data.display??node.data.text??text.slice(node.start,node.end):`【${node.data.label??node.data.name??text.slice(node.start,node.end)}】`).join('');
}
export function editableUserText(text,nodes){
  const originalText=userMessageCopyText(text,nodes);let offset=0;
  const references=nodes.flatMap(node=>{
    const raw=text.slice(node.start,node.end),display=userMessageCopyText(text,[node]);
    const start=offset;offset+=display.length;
    return raw===display?[]:[{raw,display,start,end:offset,originalText}];
  });
  return {text:originalText,references};
}
export function restoreUserTextEdit(edited,references){
  if(!references.length)return edited;
  const original=references[0].originalText;
  const fail=()=>{throw Error('请保留完整引用标签；如需移除引用，请移除这条排队消息后重新发送。');};
  if(typeof original!=='string')fail();
  // Anchor unchanged outer text first. Keep whole reference spans inside the
  // diff window whenever an edit reaches into a chip.
  let prefix=0,suffix=0;
  while(prefix<original.length&&prefix<edited.length&&original[prefix]===edited[prefix])prefix++;
  while(suffix<original.length-prefix&&suffix<edited.length-prefix&&original.at(-suffix-1)===edited.at(-suffix-1))suffix++;
  for(const ref of references){if(ref.start<prefix&&ref.end>prefix)prefix=ref.start;if(ref.start<original.length-suffix&&ref.end>original.length-suffix)suffix=original.length-ref.end;}
  const a=original.slice(prefix,original.length-suffix),b=edited.slice(prefix,edited.length-suffix),width=b.length+1,cells=(a.length+1)*width;
  if(cells>2_000_000)throw Error('编辑范围过大，请分次修改正文并保留引用标签。');
  const forward=new Uint32Array(cells),backward=new Uint32Array(cells),at=(i,j)=>i*width+j;
  for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++)forward[at(i,j)]=a[i-1]===b[j-1]?forward[at(i-1,j-1)]+1:Math.max(forward[at(i-1,j)],forward[at(i,j-1)]);
  for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)backward[at(i,j)]=a[i]===b[j]?backward[at(i+1,j+1)]+1:Math.max(backward[at(i+1,j)],backward[at(i,j+1)]);
  const total=backward[0],replacements=[];
  for(const ref of references){
    let start;
    if(ref.end<=prefix)start=ref.start;
    else if(ref.start>=original.length-suffix)start=ref.start+edited.length-original.length;
    else{
      const from=ref.start-prefix,to=ref.end-prefix,length=to-from,candidates=[];
      for(let j=0;j+length<=b.length;j++)if(b.slice(j,j+length)===ref.display&&forward[at(from,j)]+length+backward[at(to,j+length)]===total)candidates.push(j);
      if(candidates.length!==1)fail();
      const candidate=candidates[0];
      // All optimal edit paths must preserve this exact original span. A
      // repeated prose label is never eligible merely because its text fits.
      for(let i=from;i<to;i++)for(let j=0;j<=b.length;j++){
        if(forward[at(i,j)]+backward[at(i+1,j)]===total)fail();
        if(j<b.length&&a[i]===b[j]&&forward[at(i,j)]+1+backward[at(i+1,j+1)]===total&&j!==candidate+i-from)fail();
      }
      start=prefix+candidate;
    }
    replacements.push({start,end:start+ref.display.length,raw:ref.raw});
  }
  // New copied labels must not manufacture another hidden request. Also
  // reject deleting an indistinguishable duplicate instead of guessing which
  // occurrence the student meant. Existing same-name prose is left untouched.
  let i=0,j=0,added='',removed='';const changes=[];
  const flush=()=>{if(added||removed)changes.push({added,removed});added='';removed='';};
  while(i<a.length||j<b.length){
    if(i<a.length&&j<b.length&&a[i]===b[j]){flush();i++;j++;}
    else if(j<b.length&&(i===a.length||backward[at(i,j+1)]>backward[at(i+1,j)]))added+=b[j++];
    else removed+=a[i++];
  }
  flush();
  if(changes.some(change=>references.some(ref=>ref.display&&(change.added.includes(ref.display)||change.removed.includes(ref.display)))))fail();
  let result='',end=0;
  for(const row of replacements.sort((a,b)=>a.start-b.start)){
    if(row.start<end)throw Error('引用标签发生重叠，请取消编辑后重试。');
    result+=edited.slice(end,row.start)+row.raw;end=row.end;
  }
  return result+edited.slice(end);
}
