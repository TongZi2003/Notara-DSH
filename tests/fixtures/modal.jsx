// Isolated component tests do not boot the DSH module loader. Keyboard/focus
// ownership is verified against the real native Modal in integration tests.
import React from 'react';
import { createPortal } from 'react-dom';
// Native Toast timing is separately exercised by the native runtime tests.
export function Toast({text,holdMs=3000,onDone}){
 const done=React.useRef(onDone);done.current=onDone;
 React.useEffect(()=>{const timer=setTimeout(()=>done.current(),holdMs+1000);return()=>clearTimeout(timer);},[holdMs]);
 return createPortal(<div role="alert" style={{position:'fixed',top:40,left:'50%',zIndex:1100,pointerEvents:'none'}}>{text}</div>,document.body);
}
export const Button = React.forwardRef(({ variant, size, icon, children, ...props }, ref) => <button {...props} ref={ref}>{icon}{children}</button>);
export function Input({ icon, ...props }) { return <span>{icon}<input {...props}/></span>; }
export function Menu({open,anchor,items,onSelect,onClose}) {
  return <div>{anchor}{open && <div role="menu">{items.map(item => <button key={item.id} role="menuitem" onClick={()=>{onSelect(item.id);onClose();}}>{item.label}</button>)}</div>}</div>;
}
export function Modal({ open, title, className, children, onClose }) {
  if (!open) return null;
  return createPortal(<div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: '#0004' }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}><div role="dialog" aria-modal="true" aria-label={title} className={className}>{children}</div></div>, document.body);
}
