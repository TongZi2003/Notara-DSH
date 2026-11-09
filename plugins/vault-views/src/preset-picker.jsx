import React, { useEffect, useRef, useState } from 'react';
import { IconAgentPresetOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives';
import { presetDisplayText } from '@deepseek-ai/dsh-agent-preset-registry/display';
import { mainPresetGroups } from './main-preset-options.js';

/** Same public injected native seat/controller; only the choice list changes. */
export function MainPresetPicker({ sessionId, useSessionRetainInfo, load, select, introduced, useAgentPresetSeat, useDeveloperTools, t }) {
  const state = useAgentPresetSeat(value => value), developerTools = useDeveloperTools(value => value);
  const main = useSessionRetainInfo(info => sessionId === undefined || (info?.retainedBy.mainView ?? 0) > 0);
  const [open, setOpen] = useState(false), [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);
  useEffect(() => { if (!developerTools) { generation.current++; setOpen(false); setError(''); } }, [developerTools]);
  useEffect(() => { if (state.introduce && state.current) introduced(); }, [state.introduce, state.current, introduced]);
  const groups = mainPresetGroups(state.options);
  if (!main || !developerTools || !state.current || !groups.length) return null;
  // Keep a historical/staged worker's real label visible without offering it
  // as a new choice, or silently selecting a different composition.
  const chosen = state.options.find(option => option.id === state.current);
  const label = chosen ? presetDisplayText(chosen, t).name : '选择角色';
  const items = groups.flatMap(group => [
    { type: 'label', id: 'group:' + group.label, text: group.label },
    ...group.options.map(option => {
      const text = presetDisplayText(option, t);
      return { id: option.id, label: <span className="nv-preset-option"><span>{text.name}</span>{text.description && <small>{text.description}</small>}</span> };
    }),
  ]);
  const pick = async id => {
    if (!groups.some(group => group.options.some(option => option.id === id))) return;
    const token = ++generation.current;
    setOpen(false); setError('');
    try { const refusal = await select(id); if (token === generation.current && refusal) setError(refusal); }
    catch { if (token === generation.current) setError('暂时无法切换角色，请重试'); }
  };
  return <span className="nv-preset-picker">
    <Menu portal listClassName="nv-preset-menu" open={open} onClose={() => setOpen(false)} items={items} selectedId={state.current} onSelect={id => void pick(id)} anchor={<button type="button" className="nv-preset-trigger" aria-haspopup="menu" aria-expanded={open} title={state.error || t('seatHint')} disabled={state.busy} onClick={() => setOpen(!open)}><IconAgentPresetOutlineRegular/><span>{label}</span><svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><path d="m3 4.5 3 3 3-3"/></svg></button>}/>
    {error && <span className="nv-preset-error" role="alert">{error}</span>}
  </span>;
}

export function installMainPresetPicker(ctx) {
  const slot = 'conversation.hero.agentPreset';
  let installed, syncing = false;
  const sync = () => {
    if (syncing) return;
    syncing = true;
    try {
      const original = ctx.slots.entries(slot).find(entry => entry.options.priority !== -20);
      if (installed?.original === original) return;
      installed?.dispose(); installed = undefined;
      if (original) installed = { original, dispose: ctx.slots.register({ name: slot, priority: -20, locale: original.locale, inject: original.inject }, MainPresetPicker) };
    } finally { syncing = false; }
  };
  const stop = ctx.slots.subscribe(slot, sync); sync();
  return () => { stop(); installed?.dispose(); installed = undefined; };
}
