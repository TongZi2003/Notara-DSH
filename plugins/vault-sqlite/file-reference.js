import { safeWorkspaceRelativePath, isVaultFormat } from './vault-path.js';

// Dots in a chapter number or decimal are not proof of a file extension.
// Resolve against real files: a literal attachment always wins over a note.
export function referenceCandidates(target) {
  target = safeWorkspaceRelativePath(target);
  return isVaultFormat(target) ? [target] : [target, `${target}.md`];
}
export function resolveReferencePath(target, paths) {
  return referenceCandidates(target).find(path => paths.has(path)) ?? null;
}

export function validateRect(rect) {
  if (!Array.isArray(rect) || rect.length !== 4 || rect.some(value => !Number.isFinite(value) || value < 0 || value > 1) || rect[2] <= 0 || rect[3] <= 0 || rect[0] + rect[2] > 1.000001 || rect[1] + rect[3] > 1.000001) throw new Error('请在页面内选择有效区域');
  return rect.map(value => Number(value.toFixed(6)));
}

export function validateTextRange(range) {
  if(!Array.isArray(range)||range.length!==2||!range.every(Number.isSafeInteger)||range[0]<0||range[1]<=range[0]||range[1]>8*1024*1024)throw new Error('文字选区无效');
  return [...range];
}
export function sourceStatus(record, ref) {
  return !ref.revision?'unverified':record.revision===ref.revision?'current':'stale';
}
export function sourceText(record, ref) {
  if(sourceStatus(record,ref)==='stale')throw new Error('来源已更新，请重新定位选区');
  const text=String(record.content).replace(/\r\n/g,'\n');
  if(!ref.range)return text;
  const [from,to]=validateTextRange(ref.range);if(to>text.length)throw new Error('文字选区超出来源范围');
  return text.slice(from,to);
}

/** Shared wiki-reference grammar; recognizing a file never grants Vault read/write. */
export function parseReference(text, { paths } = {}) {
  const match = /^!?\[\[([^\]|#\r\n]+)(#[^\]|\r\n]*)?(?:\|([^\]\r\n]+))?\]\]$/.exec(text);
  if (!match) return null;
  try {
    const target = safeWorkspaceRelativePath(match[1].trim());
    const path = (paths && resolveReferencePath(target, paths)) || (/\.[a-z0-9]+$/i.test(target) ? target : `${target}.md`);
    const locator={};
    if(/^#(?:page|text)=/.test(match[2]||'')){
      const params=new URLSearchParams(match[2].slice(1)), keys=[...params.keys()],pdf=params.has('page');
      if(new Set(keys).size!==keys.length||keys.some(key=>!(pdf?['page','rect','revision']:['text','revision']).includes(key)))return null;
      if(pdf){if(!/^\d+$/.test(params.get('page')))return null;locator.page=Number(params.get('page'));if(!Number.isSafeInteger(locator.page)||locator.page<1)return null;if(params.has('rect'))locator.rect=validateRect(params.get('rect').split(',').map(Number));}
      else {if(!/^\d+,\d+$/.test(params.get('text')))return null;locator.range=validateTextRange(params.get('text').split(',').map(Number));}
      if(params.has('revision')){const revision=params.get('revision');if(!/^[\w.:-]{1,128}$/.test(revision))return null;locator.revision=revision;}
    }else if(match[2])locator.subpath=match[2];
    return {path,...locator,label:match[3]||path.split('/').at(-1).replace(/\.md$/i,'')};
  } catch { return null; }
}

export function referenceFragment(ref) {
  const fragment=ref.page?`#page=${ref.page}${ref.rect?`&rect=${validateRect(ref.rect).join(',')}`:''}`:ref.range?`#text=${validateTextRange(ref.range).join(',')}`:ref.subpath||'';
  return fragment+(fragment&&(ref.page||ref.range)&&ref.revision?`&revision=${encodeURIComponent(ref.revision)}`:'');
}

export function referenceMarkdown(ref) {
  const label = ref.label.replace(/[\\\[\]]/g, '\\$&');
  if (/^#L[1-9]\d*(?:-L[1-9]\d*)?$/.test(ref.subpath || '')) return `[${label}](<${encodeURIComponent(ref.path).replaceAll('%2F', '/')}${ref.subpath}>)`;
  if (!isVaultFormat(ref.path)) return `[${label}](<${encodeURIComponent(ref.path).replaceAll('%2F', '/')}>)`;
  // Encode the whole locator: native openFile receives the intact PDF/heading
  // suffix, and our source-bound resource provider separates it from the path.
  return `[${label}](<${encodeURIComponent(ref.path + referenceFragment(ref)).replaceAll('%2F', '/')}>)`;
}

export const SESSION_LINK_PREFIX = '__notara_session__/';

export function validateSessionId(value) {
  const id = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9_.:-]{1,160}$/.test(id) ? id : null;
}

export function parseSessionReference(text) {
  if (typeof text !== 'string' || !text) return null;
  const wiki = /^\[\[\s*session:([^\]|\r\n]+)(?:\|([^\]\r\n]+))?\]\]$/i.exec(text);
  if (wiki) {
    const sessionId = validateSessionId(wiki[1]);
    return sessionId ? { sessionId, label: (wiki[2] || '').trim() || '打开关联课堂' } : null;
  }
  const md = /^\[([^\]\r\n]*)\]\(\s*<?session:([^\s>)\r\n]+)>?\s*\)$/i.exec(text);
  if (md) {
    const sessionId = validateSessionId(md[2]);
    return sessionId ? { sessionId, label: (md[1] || '').trim() || '打开关联课堂' } : null;
  }
  if (text.startsWith(SESSION_LINK_PREFIX)) {
    const raw = text.slice(SESSION_LINK_PREFIX.length);
    let decoded = raw;
    try { decoded = decodeURIComponent(raw); } catch { return null; }
    const sessionId = validateSessionId(decoded);
    return sessionId ? { sessionId, label: '打开关联课堂' } : null;
  }
  if (/^session:/i.test(text)) {
    const sessionId = validateSessionId(text.slice(8));
    return sessionId ? { sessionId, label: '打开关联课堂' } : null;
  }
  return null;
}

export function sessionReferenceMarkdown(ref) {
  const sessionId = validateSessionId(ref?.sessionId);
  if (!sessionId) return null;
  const label = String(ref?.label || '打开关联课堂').replace(/[\\\[\]]/g, '\\$&');
  return `[${label}](<${SESSION_LINK_PREFIX}${encodeURIComponent(sessionId)}>)`;
}
