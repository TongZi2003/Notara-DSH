import { callVault } from './logic.js';
import { mergeCanvasDocuments } from '@oh-my-student/plugin-vault-sqlite/canvas-flow';
import { mergeDrawingDocuments } from '@oh-my-student/plugin-vault-sqlite/drawing-sync';

export function createMarkdownDraft(record, { key, storage } = {}) {
  let saved;
  try { saved = JSON.parse(storage?.getItem(key) || 'null'); } catch { /* Unavailable storage does not prevent editing. */ }
  const recover = saved && ['text', 'baseContent', 'baseRevision'].every(field => typeof saved[field] === 'string');
  let state = { text: recover ? saved.text : record.content, baseContent: recover ? saved.baseContent : record.content,
    baseRevision: recover ? saved.baseRevision : record.revision, generation: 0, saving: false, message: recover ? '已恢复未保存草稿' : '', conflict: recover&&typeof saved.conflict?.rejectedNativeContent==='string'?saved.conflict:null, storageWarning: false, layoutOnly:false,drawingShared:false };
  if (state.text === record.content) state = { ...state, baseContent: record.content, baseRevision: record.revision };
  else if (state.baseRevision !== record.revision) state.conflict = {...record,...(state.conflict?.rejectedNativeContent?{rejectedNativeContent:state.conflict.rejectedNativeContent}:{})};
  const listeners = new Set();
  const update = patch => {
    state = { ...state, ...patch };
    try {
      if (state.text === state.baseContent&&!state.conflict?.rejectedNativeContent) storage?.removeItem(key);
      else storage?.setItem(key, JSON.stringify({ text: state.text, baseContent: state.baseContent, baseRevision: state.baseRevision,...(state.conflict?.rejectedNativeContent?{conflict:state.conflict}:{}) }));
      state.storageWarning = !storage && state.text !== state.baseContent;
    } catch { state.storageWarning = true; }
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    edit(text,{layout=false,share=false,conflict}={}) { update({ text, message: '',layoutOnly:layout&&(state.layoutOnly||state.text===state.baseContent),drawingShared:share,...(conflict?{conflict}:{}) }); },
    loadCurrent(next, message = '') {
      if (state.saving) return;
      update({ text: next.content, baseContent: next.content, baseRevision: next.revision, conflict: null, generation: state.generation + 1, message,layoutOnly:false });
    },
    receive(next, readGeneration = state.generation) {
      if (state.saving || readGeneration !== state.generation || next.revision === state.baseRevision || next.revision===state.conflict?.revision) return;
      if(state.conflict){update({conflict:{...next,...(state.conflict.rejectedNativeContent?{rejectedNativeContent:state.conflict.rejectedNativeContent}:{})},generation:state.generation+1,message:'文件已有新修改，当前冲突草稿仍保留'});return;}
      if (state.text === state.baseContent || state.text === next.content) update({ text: next.content, baseContent: next.content, baseRevision: next.revision, conflict: null,layoutOnly:false,generation:state.generation+1 });
      else {
        let merged;
        if(/\.canvas$/i.test(record.path))try{merged=mergeCanvasDocuments(JSON.parse(state.baseContent),JSON.parse(state.text),JSON.parse(next.content));}catch{/* Keep the draft on malformed external content. */}
        if(/\.excalidraw$/i.test(record.path))try{merged=mergeDrawingDocuments(JSON.parse(state.baseContent),JSON.parse(state.text),JSON.parse(next.content));}catch{/* Keep local ink. */}
        if(merged)update({text:JSON.stringify(merged,null,2)+'\n',baseContent:next.content,baseRevision:next.revision,conflict:null,generation:state.generation+1,message:'新板书已同步，未保存修改已保留'});
        else update({ conflict: next,generation:state.generation+1, message: '文件已在其他地方更新，草稿已保留' });
      }
    },
    async save(remote, merged = false) {
      if (state.saving || state.text === state.baseContent && !state.conflict || state.conflict&&!merged) return null;
      const content = state.text, expectedRevision = merged && state.conflict ? state.conflict.revision : state.baseRevision;
      const drawing=/\.excalidraw$/i.test(record.path),base=state.baseContent,startingConflict=state.conflict;
      update({ saving: true, message: '' });
      try {
        const result = drawing?await callVault(remote,'drawingCommit',{path:record.path,base,content}):await callVault(remote, 'save', { path: record.path, content, expectedRevision });
        let text=state.text,committed=result.content??content,conflict=state.conflict&&state.conflict!==startingConflict?state.conflict:null;
        if(drawing&&!conflict){const combined=mergeDrawingDocuments(JSON.parse(content),JSON.parse(state.text),JSON.parse(committed));if(combined)text=JSON.stringify(combined,null,2)+'\n';else conflict={path:record.path,content:committed,revision:result.revision};}
        update({text,baseContent:conflict?content:committed,baseRevision:result.revision,generation:state.generation+1,saving:false,conflict,layoutOnly:text===committed?false:state.layoutOnly,message:conflict?'文件已有新修改，当前草稿已保留':text===committed?'已保存':'已保存，仍有新修改'});
        return result;
      } catch (error) {
        let conflict = state.conflict;
        if (String(error.message).includes('vault_revision_conflict') || error.code === 'vault_revision_conflict'||String(error.message).includes('drawing_conflict')) {
          try { const latest=await callVault(remote, 'read', { path: record.path });conflict={...latest,...(state.conflict?.rejectedNativeContent?{rejectedNativeContent:state.conflict.rejectedNativeContent}:{})}; } catch { conflict=state.conflict;/* Keep the draft even when refresh also fails. */ }
        }
        update({ saving: false, conflict, message: conflict ? '文件已在其他地方更新，请对照最新内容合并后保存' : '保存失败，草稿已保留，请重试' });
        return null;
      }
    },
  };
}

const drafts = new Map();
const draftKey = (workspaceId, path) => `notara.markdown-draft.v1:${JSON.stringify([workspaceId ?? 'configured-root', path])}`;
export const markdownGeneration = (workspaceId, path) => drafts.get(draftKey(workspaceId, path))?.getSnapshot().generation ?? 0;
export function markdownDraft(record, workspaceId) {
  const key = draftKey(workspaceId, record.path);
  if (!drafts.has(key)) {
    let storage;
    try { storage = globalThis.localStorage; } catch { /* Restricted browser storage. */ }
    drafts.set(key, createMarkdownDraft(record, { key, storage }));
  }
  return drafts.get(key);
}
