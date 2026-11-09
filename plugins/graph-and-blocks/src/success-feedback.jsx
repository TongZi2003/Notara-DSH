import React,{useCallback,useEffect,useRef,useState} from 'react';
import {Toast} from '@deepseek-ai/dsh-client-ui-primitives';

export function SuccessToast(props){return <Toast {...props} tone="success" holdMs={3000}/>;}

// Call only from a confirmed success branch. Errors and durable state belong
// to their existing controls; no text-based classification or delayed clearing.
export function useSuccessFeedback(){
 const [receipt,setReceipt]=useState(null),sequence=useRef(0),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const show=useCallback(text=>{if(alive.current)setReceipt({text,seq:++sequence.current});},[]);
 const clear=useCallback(()=>setReceipt(null),[]);
 const toast=receipt?<SuccessToast key={receipt.seq} text={receipt.text} onDone={()=>setReceipt(current=>current?.seq===receipt.seq?null:current)}/>:null;
 return [toast,show,clear];
}
