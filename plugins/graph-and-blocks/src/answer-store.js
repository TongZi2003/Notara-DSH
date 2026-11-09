/** A shared draft projection for Markdown + Canvas, never a learning-fact store. */
export function createAnswerStore({ storage = null, namespace = 'notara.blocks.v1', limit = 500 } = {}) {
  const values = new Map(), listeners = new Map();
  const notify = key => { for (const fn of listeners.get(key) ?? []) fn(); };
  return {
    get(key) {
      if (!values.has(key) && storage) {
        try { const raw = storage.getItem(`${namespace}:${key}`); if (raw && raw.length < 32000) values.set(key, JSON.parse(raw)); } catch { /* private browsing or stale draft */ }
      }
      return values.get(key) ?? null;
    },
    set(key, value) {
      if (JSON.stringify(value).length > 32000) throw new Error('作答内容过长');
      values.set(key, value);
      while (values.size > limit) { const oldest = values.keys().next().value; values.delete(oldest); try { storage?.removeItem(`${namespace}:${oldest}`); } catch {} }
      try { storage?.setItem(`${namespace}:${key}`, JSON.stringify(value)); } catch {}
      notify(key);
    },
    subscribe(key, fn) { if (!listeners.has(key)) listeners.set(key, new Set()); listeners.get(key).add(fn); return () => { listeners.get(key)?.delete(fn); if (!listeners.get(key)?.size) listeners.delete(key); }; },
    clear() { const keys = [...values.keys()]; for (const key of keys) { try { storage?.removeItem(`${namespace}:${key}`); } catch {} } values.clear(); for (const key of keys) notify(key); },
  };
}
let browserStorage = null;
try { if (typeof sessionStorage !== 'undefined') browserStorage = sessionStorage; } catch { /* sandboxed preview */ }
export const answerStore = createAnswerStore({ storage: browserStorage });
export function answerKey({ scope, nodeId = '', blockId = '', fingerprint }) {
  // scope must be supplied by the host, not by teacher-authored Markdown.
  return JSON.stringify([String(scope), String(nodeId), String(blockId), String(fingerprint)]);
}
