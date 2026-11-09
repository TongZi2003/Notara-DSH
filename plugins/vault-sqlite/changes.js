/** Ephemeral invalidations only: files and the index remain authoritative. */
export function createVaultChanges() {
  const subscribers = new Set();
  let closed = false;
  return {
    publish(changes) {
      if (closed || !changes.length) return;
      for (const subscriber of subscribers) {
        if (!subscriber.reset) {
          for (const change of changes) {
            subscriber.pending.set(change.path, change.revision);
            if (subscriber.pending.size > 256) { subscriber.pending.clear(); subscriber.reset = true; break; }
          }
        }
        subscriber.wake?.();
      }
    },
    async *subscribe(signal) {
      if (closed || signal?.aborted) return;
      const subscriber = { pending: new Map(), reset: true, wake: null };
      const abort = () => subscriber.wake?.();
      subscribers.add(subscriber); signal?.addEventListener('abort', abort, { once: true });
      try {
        while (!closed && !signal?.aborted) {
          if (!subscriber.reset && !subscriber.pending.size) {
            await new Promise(resolve => { subscriber.wake = resolve; });
            subscriber.wake = null;
            continue;
          }
          const value = { reset: subscriber.reset, changes: [...subscriber.pending].map(([path, revision]) => ({ path, revision })) };
          subscriber.reset = false; subscriber.pending.clear();
          yield value;
        }
      } finally { subscribers.delete(subscriber); signal?.removeEventListener('abort', abort); }
    },
    close() { closed = true; for (const subscriber of subscribers) subscriber.wake?.(); },
  };
}
