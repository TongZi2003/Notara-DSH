import { assertDisplayedRevision, callVault, pdfReference, relativePath, validateRect } from './logic.js';
import { bindVaultRemote, workspaceForSession } from '@oh-my-student/plugin-vault-sqlite/workspace-client';
import { serializeReference,referenceEnvelopes,legacySourceHeaders,homeReferenceHeaders } from './reference-facts.js';
import { isVaultFormat } from '@oh-my-student/plugin-vault-sqlite/vault-path';
import {validateTextRange,referenceFragment,sourceText} from '@oh-my-student/plugin-vault-sqlite/file-reference';
import { renderPdfReference } from './pdf-source.js';

async function referenceRecord(remote, path) {
  if (isVaultFormat(path)) return callVault(remote, 'read', { path });
  const result = await callVault(remote, 'query', { paths: [path], limit: 1 });
  if (!result.documents?.[0]) throw new Error('文件不存在或暂不可读');
  return result.documents[0];
}

export const REFERENCE_SOURCE = 'notara-vault-reference';
export function currentSessionId(ctx) {
  const current=ctx.get?.('uiSession')?.adapter?.current;
  if(current)return current.getSnapshot()?.key;
  return Object.values(ctx.sessions.list.getSnapshot()?.byId ?? {}).find(row => (row.retainedBy?.mainView ?? 0) > 0)?.id;
}
export function captureSourceOwner(ctx){
  const id=currentSessionId(ctx),scope=id&&ctx.sessions.scope(id),workspace=workspaceForSession(ctx,id);
  return ()=>currentSessionId(ctx)===id&&ctx.sessions.scope(id)===scope&&workspaceForSession(ctx,id)===workspace;
}

/** Freeze an explicit drawing submission. Subsequent file changes do not
 * change this image or require reading the live file again at send time. */
export async function bringDrawingSnapshot(ctx,{blob,meta},owner){
  if(owner&&!owner())throw Error('对话已切换，快照没有带入其他会话。');
  const id=currentSessionId(ctx),scope=id&&ctx.sessions.scope(id),conversation=ctx.get('conversation');
  if(!scope||!conversation?.createDrafts||!conversation.releaseDraftAttachments)throw Error('请先打开一个可继续的对话');
  const input=conversation.input.for(scope),state=input?.state.getSnapshot();
  if(!state||state.phase!=='plain'||conversation.blocks?.storeFor(id).getSnapshot())throw Error('当前对话暂不可编辑');
  relativePath(meta.path);
  if(meta.workspaceId!==workspaceForSession(ctx,id))throw Error('画布与当前对话不属于同一工作区');
  const text=`请看看这份${meta.mode==='selection'?'选区':'整幅'}画布快照。\n来源：${meta.path}\n保存版本：${meta.revision}\n快照：${meta.snapshotHash}${meta.unsaved?'（包含当时未保存的笔迹）':''}\n元素信息：${JSON.stringify(meta.elements)}\n这是用户主动提交的画面，可能包含老师的内容；不据此推断独立完成。`;
  if(text.length>120000)throw Error('选区内容过多，请缩小选区后重试');
  const created=conversation.createDrafts(id,[new File([blob],`${meta.path.split('/').at(-1).replace(/\.excalidraw$/,'')}-${meta.snapshotHash.slice(0,8)}.png`,{type:'image/png'})]);
  try{
    if(owner&&!owner()||!input.addAttachments(created.map(a=>a.id)))throw Error('当前对话暂不可编辑');
    const latest=input.state.getSnapshot(),end=draftEnd(latest);
    if(scope.bail(scope,'slash/input-insert-text',{text:(latest.draft?'\n\n':'')+text,span:{start:end,end,draftRev:latest.draftRev}})!==true)throw Error('快照说明未带入，请重试');
  }catch(error){for(const attachment of created)input.removeAttachment(attachment.id);conversation.releaseDraftAttachments(created);throw error;}
}
export function draftEnd(state) {
  return state.draft.length - state.occurrences.reduce((sum, item) => sum + item.length - 1, 0);
}
function parsePin(text) {
  const pin = JSON.parse(text);
  relativePath(pin.path);
  if (typeof pin.title !== 'string' || typeof pin.revision !== 'string') throw new Error('请重新带入资料');
  if (pin.imageName !== undefined && (typeof pin.imageName !== 'string' || pin.imageName.length > 1000 || /[\r\n]/.test(pin.imageName))) throw new Error('请重新带入 PDF 选区');
  if (pin.page !== undefined && (!Number.isSafeInteger(pin.page) || pin.page < 1)) throw new Error('页码无效');
  if (pin.rect) validateRect(pin.rect);
  if(pin.range)validateTextRange(pin.range);
  if(pin.range&&(pin.page!==undefined||pin.rect||!/\.md$/i.test(pin.path)))throw new Error('文字选区必须来自 Markdown 文档');
  if(pin.rect&&pin.page===undefined)throw new Error('区域引用缺少页码');
  return pin;
}

export const sourceReferenceRule={id:'notara-source',order:-30,match(text,from){
  const candidates=referenceEnvelopes(text).flatMap(row=>{
    if(row.start<from||row.value?.kind!=='source')return [];
    try{return [{...row,pin:parsePin(JSON.stringify(row.value.pin))}];}catch{return [];}
  });
  for(const row of legacySourceHeaders(text))if(row.start>=from)candidates.push({...row,pin:{...row.pin,title:row.pin.label||row.pin.path.split('/').at(-1)}});
  for(const row of homeReferenceHeaders(text))if(row.start>=from)candidates.push(row);
  const row=candidates.sort((a,b)=>a.start-b.start)[0];
  if(row)return {id:'notara-source',start:row.start,end:row.end,data:{pin:row.pin,label:row.pin.title}};
}};
export function registerReferences(ctx) {
  const stopRule=ctx.uiConversation?.userText?.register(sourceReferenceRule);
  let stopSource;
  try{stopSource=ctx.inputTriggers.registerSource({
    trigger: '@', name: REFERENCE_SOURCE, order: 19, showGroupTitle: false,
    async candidates() { return []; }, onPick() {},
    codec: {
      clipboardText(ref) { try { return `【${parsePin(ref).title}】`; } catch { return '【学习资料】'; } },
      async serialize(ref, signal) {
        const pin = parsePin(ref);
        signal?.throwIfAborted();
        const record = await referenceRecord(bindVaultRemote(ctx.remote.notaraVault, pin.workspaceId), pin.path);
        signal?.throwIfAborted();
        if (record.revision !== pin.revision) throw new Error('资料已经更新，请重新带入');
        const locator = /\.pdf$/i.test(pin.path)&&pin.page!==undefined ? pdfReference(pin.path, pin.page, pin.rect, pin.revision) : `[[${pin.path}${referenceFragment(pin)}]]`;
        return serializeReference({kind:'source',pin,locator,instruction:pin.range?'这是来源文字选区，不是学生的作答；仅提供指定范围，其他内容按需读取原文件。':'这是文件引用，请按需读取原文件；索引不包含正文。',
          ...(pin.range?{selection:sourceText(record,pin)}:{}),
          ...(pin.imageName?{image:`对应图片附件：${pin.imageName}。图片仅包含第 ${pin.page} 页${pin.rect?'的所选区域':''}；以实际收到的图片为准，若图片缺失请让学生重新带入，不声称已看过原页。`}:{})});
      },
    },
  });}catch(error){stopRule?.();throw error;}
  return ()=>{stopSource();stopRule?.();};
}

/** Native facade edits only. No send call, DOM editing, or session creation. */
export async function bringReferences(ctx, requests, intent = '', owner, { renderPdf = renderPdfReference } = {}) {
  const selectedId = currentSessionId(ctx);
  if (owner && (typeof owner.sessionId !== 'string' || typeof owner.isCurrent !== 'function')) throw new Error('请重新打开所属会话的活动面板');
  const sessionId = owner?.sessionId ?? selectedId, scope = sessionId && ctx.sessions.scope(sessionId);
  if (!scope || !Array.isArray(requests) || !requests.length) throw new Error('请先打开一个可编辑的对话');
  const workspaceId = workspaceForSession(ctx, sessionId);
  const current = () => currentSessionId(ctx) === selectedId && ctx.sessions.scope(sessionId) === scope && workspaceForSession(ctx, sessionId) === workspaceId && (!owner || owner.isCurrent());
  if (!current()) throw new Error('对话已切换，请重新带入');
  if (workspaceId === null) throw new Error('请先选择工作区');
  if (requests.some(request => Object.hasOwn(request, 'workspaceId') && request.workspaceId !== workspaceId)) throw new Error('资料来自其他工作区，请切回来源工作区后带入');
  const remote = bindVaultRemote(ctx.remote.notaraVault, workspaceId);
  const unique = new Map();
  for (const request of requests) { relativePath(request.path); unique.set(JSON.stringify([request.path, request.page, request.rect,request.range]), request); }
  if (unique.size > 12) throw new Error('每次最多带入 12 份资料');
  const records = new Map();
  const loadedPins = await Promise.all([...unique.values()].map(async request => {
    const record = await referenceRecord(remote, request.path);
    if (request.revision !== undefined || request.page !== undefined || request.rect !== undefined || request.range !== undefined) assertDisplayedRevision(record, request.revision);
    const pin = { path: request.path, title: request.title || request.path.split('/').at(-1).replace(/\.md$/i, ''), revision: record.revision };
    if (workspaceId !== undefined) pin.workspaceId = workspaceId;
    if (request.page) pin.page = request.page;
    if (request.rect) pin.rect = validateRect(request.rect);
    if(request.range){pin.range=validateTextRange(request.range);sourceText(record,pin);}
    if (/\.pdf$/i.test(pin.path)&&pin.page!==undefined) pin.imageName = `${pin.path.split('/').at(-1)}-p${pin.page}-${pin.rect?.join('_') || 'page'}-${pin.revision.slice(0, 12)}.png`;
    records.set(pin, record);
    parsePin(JSON.stringify(pin)); return pin;
  }));
  const pins = [...new Map(loadedPins.map(pin => [JSON.stringify(pin), pin])).values()];
  if (!current() || ctx.conversation.blocks.storeFor(sessionId).getSnapshot()) throw new Error('对话已切换，请重新带入');
  const input = ctx.conversation.input.for(scope);
  let state = input.state.getSnapshot();
  if (state.phase !== 'plain') throw new Error('请先结束当前输入操作');
  let pending = pins.filter(pin => !state.occurrences.some(item => item.source === REFERENCE_SOURCE && item.ref === JSON.stringify(pin)));
  if (state.occurrences.length + pending.length > 12) throw new Error('当前草稿最多保留 12 份引用');
  const conversation = ctx.conversation;
  const existingImages = () => new Set((conversation.resolveDraftAttachments?.(input.state.getSnapshot().attachmentIds ?? []) ?? []).map(item => item.file.name));
  const images = existingImages(), files = [];
  for (const pin of pins) {
    if (!pin.imageName || images.has(pin.imageName)) continue;
    if (!conversation.createDrafts || !input.addFiles) throw new Error('当前对话无法接收 PDF 图片，请重新打开后重试');
    const blob = await renderPdf(records.get(pin), pin);
    if (!current()) throw new Error('对话已切换，请重新带入');
    files.push(new File([blob], pin.imageName, { type: 'image/png' }));
    images.add(pin.imageName);
  }
  if (!current() || conversation.blocks.storeFor(sessionId).getSnapshot()) throw new Error('对话已切换，请重新带入');
  state = input.state.getSnapshot();
  if (state.phase !== 'plain') throw new Error('请先结束当前输入操作');
  pending = pins.filter(pin => !state.occurrences.some(item => item.source === REFERENCE_SOURCE && item.ref === JSON.stringify(pin)));
  if (state.occurrences.length + pending.length > 12) throw new Error('当前草稿最多保留 12 份引用');
  const reference = pin => ({ source: REFERENCE_SOURCE, ref: JSON.stringify(pin), label: pin.title, appearance: 'file', clipboardText: `【${pin.title}】` });
  if (files.length) {
    const present = existingImages(), drafts = conversation.createDrafts(sessionId, files.filter(file => !present.has(file.name)));
    try {
      if (!input.addFiles(pending.map(reference), drafts.map(item => item.id))) throw new Error('资料未能带入，请重试');
    } catch (error) { conversation.releaseDraftAttachments(drafts); throw error; }
    state = input.state.getSnapshot();
  } else for (const pin of pending) {
    const end = draftEnd(state);
    if (!input.insertReference(reference(pin), { start: end, end, draftRev: state.draftRev })) throw new Error('引用未完全带入，请重试');
    state = input.state.getSnapshot();
  }
  if (intent && !state.draft.includes(intent)) {
    const end = draftEnd(state);
    if (scope.bail(scope, 'slash/input-insert-text', { text: (state.draft ? '\n\n' : '') + intent, span: { start: end, end, draftRev: state.draftRev } }) !== true) throw new Error('学习诉求未带入，请重试');
  }
  if (!owner) ctx.layout.selectPanel(null);
}
