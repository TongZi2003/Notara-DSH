import { parseReference, parseSessionReference } from '@oh-my-student/plugin-vault-sqlite/file-reference';
import { workspaceForSession } from '@oh-my-student/plugin-vault-sqlite/workspace-client';
import { protectedMarkdownRanges } from './markdown-structure.js';
import { currentSessionId } from './composer.js';

const SOURCE = 'notara-wiki-reference';
function reference(token) {
  const session = parseSessionReference(token), file = parseReference(token);
  if (!session && !file) return null;
  return { source: SOURCE, ref: token, clipboardText: token, label: (session || file).label, appearance: session ? 'session' : 'file' };
}

export function wikiReferenceEdits(state) {
  if (state.phase !== 'plain') return [];
  const text = state.draft, occurrences = state.occurrences ?? [], protectedRanges = protectedMarkdownRanges(text);
  return [...text.matchAll(/!?\[\[[^\]\r\n]+\]\]/g)].flatMap(match => {
    const start = match.index, end = start + match[0].length;
    let slashes = 0; for (let i = start - 1; i >= 0 && text[i] === '\\'; i--) slashes++;
    if (slashes % 2 || protectedRanges.some(([a, b]) => start < b && end > a)
      || occurrences.some(o => start < o.offset + o.length && end > o.offset)) return [];
    const ref = reference(match[0]); if (!ref) return [];
    const shift = occurrences.filter(o => o.offset + o.length <= start).reduce((n, o) => n + o.length - 1, 0);
    return [{ reference: ref, span: { start: start - shift, end: end - shift, draftRev: state.draftRev } }];
  });
}

/** Render pasted locators using native chips; leave typed code and undo alone. */
export function registerWikiReferenceInput(ctx, surface = window) {
  const stopSource = ctx.inputTriggers.registerSource({ trigger: '@', name: SOURCE, order: 20, showGroupTitle: false,
    async candidates() { return []; }, onPick() {},
    openReference(session, { ref }) {
      const workspaceId = workspaceForSession(ctx, session.sessionId); if (workspaceId === null) return false;
      const classroom = parseSessionReference(ref), file = parseReference(ref);
      if (!classroom && !file) return false;
      const event = new CustomEvent(classroom ? 'notara:open-session' : 'notara:open-document', {
        cancelable: true, detail: { ...(classroom || file), workspaceId },
      });
      const accepted = !window.dispatchEvent(event);
      return classroom ? accepted : true;
    },
    codec: {
      clipboardText: token => token,
      async serialize(token, signal) { signal?.throwIfAborted(); if (!reference(token)) throw Error('引用无法读取，请重新带入。'); return token; },
    },
  });
  const pending = new Set();
  const paste = event => {
    if (!event.target?.closest?.('[data-composer-input]') || !event.clipboardData?.getData('text/plain').includes('[[')) return;
    const sessionId = currentSessionId(ctx), scope = sessionId && ctx.sessions.scope(sessionId);
    if (!scope) return;
    // Let the native editor admit the paste first. One follow-up CAS edit per
    // reference, without replacing the document or moving the caret by hand.
    const timer = setTimeout(() => {
      pending.delete(timer);
      if (currentSessionId(ctx) !== sessionId || ctx.sessions.scope(sessionId) !== scope) return;
      const input = ctx.conversation.input.for(scope);
      for (let left = wikiReferenceEdits(input.state.getSnapshot()).length; left > 0; left--) {
        const edit = wikiReferenceEdits(input.state.getSnapshot())[0]; if (!edit) break;
        if (!input.insertReference(edit.reference, edit.span)) break;
      }
    }, 0);
    pending.add(timer);
  };
  surface.addEventListener('paste', paste, true);
  return () => { surface.removeEventListener('paste', paste, true); for (const timer of pending) clearTimeout(timer); stopSource(); };
}
