import {parseDrawingDocument} from '@oh-my-student/plugin-vault-sqlite/drawing-files';
import {safeRelativePath} from '@oh-my-student/plugin-vault-sqlite/vault-path';

export function findDrawingSnapshot(nodes,callId,beforeSeq=Infinity){
  let found=null;const seen=new Set();
  const visit=(block,depth=0)=>{
    if(!block||seen.has(block)||depth>20)return;seen.add(block);
    if(block.kind==='tool-result'&&block.callId===callId&&!block.isError&&block.seq<=beforeSeq){
      const value=block.meta?.notaraDrawing;
      try{
        if(value?.version!==1||typeof value.content!=='string'||value.content.length>4*1024*1024||typeof value.workspaceId!=='string'||typeof value.sourceSessionId!=='string'||typeof value.revision!=='string')return;
        safeRelativePath(value.path);if(!value.path.endsWith('.excalidraw'))return;parseDrawingDocument(value.content);found=value;
      }catch{/* Malformed presentation metadata never reads another file. */}
    }
    for(const child of block.subCalls??[])visit(child,depth+1);
  };
  for(const node of nodes??[])visit(node.data?.root);
  return found;
}
