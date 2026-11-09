// Transient UI receipts only. The durable teaching state remains in whiteboard().
export function createWhiteboardFeedback(){
 let value=null,seq=0;const listeners=new Set();
 const publish=()=>{for(const listener of listeners)listener();};
 return {
  getSnapshot:()=>value,
  subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},
  show:receipt=>{value={...receipt,seq:++seq};publish();},
  dismiss:sequence=>{if(value?.seq===sequence){value=null;publish();}},
 };
}

export function whiteboardStatusLabel(state,path){
 if(!state?.bound)return '白板教学 · 未启用';
 if(state.path!==path)return '此白板未用于当前会话教学';
 if(state.missing)return '白板教学 · 文件缺失';
 if(state.invalid)return '白板教学 · 文件格式异常';
 return state.enabled?'白板教学 · 已启用':'白板教学 · 已停用';
}
