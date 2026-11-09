import React from 'react';

/** Keep the host selector and provider-specific badges; constrain only its closed caption. */
export function installCompactModelLabel(ctx) {
  const name = 'conversation.input.model.label';
  let installed, syncing = false;
  const sync = () => {
    if (syncing) return;
    syncing = true;
    try {
      const original = ctx.slots.entries(name).find(entry => entry.options.priority !== -20);
      if (installed && installed.original === original) return;
      installed?.dispose();
      const Original = original?.component;
      const Label = props => {
        const content = Original ? <Original {...props}/> : props.model.name;
        return props.placement === 'trigger' ? <span className="nv-model-caption" title={props.model.name}>{content}</span> : content;
      };
      installed = { original, dispose: ctx.slots.register({ name, priority: -20, locale: original?.locale, inject: original?.inject }, Label) };
    } finally { syncing = false; }
  };
  const stop = ctx.slots.subscribe(name, sync); sync();
  return () => { stop(); installed?.dispose(); };
}
