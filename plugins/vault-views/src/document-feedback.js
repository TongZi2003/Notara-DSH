// Exact acknowledgements emitted by markdown-drafts / document-recovery.
// Their receipts are shown at the initiating action; all other messages stay.
const acknowledgements=new Set(['已保存','已保存，仍有新修改','草稿已另存，已载入文件版本']);
export function documentStatus(state,dirty){
 if(state.saving)return '正在保存…';
 return (acknowledgements.has(state.message)?'':state.message)||(dirty?'未保存':'');
}
