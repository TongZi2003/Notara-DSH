import { callVault } from './logic.js';

/** Copy first; never replace text entered while the two RPCs were in flight. */
export async function preserveDraftCopy(draft, remote, sourcePath) {
  const source = draft.getSnapshot();
  if (!source.conflict || source.saving) return null;
  const suffix = `（草稿-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${crypto.randomUUID().slice(0, 4)}）`;
  const path = sourcePath.replace(/(\.[^/.]+)$/, `${suffix}$1`);
  const saved = await callVault(remote, 'save', { path, content: source.text, expectedRevision: null });
  if(source.conflict.rejectedNativeContent)await callVault(remote,'save',{path:path.replace(/(\.[^/.]+)$/,'（未合并笔迹）$1'),content:source.conflict.rejectedNativeContent,expectedRevision:null});
  const latest = await callVault(remote, 'read', { path: sourcePath });
  const current = draft.getSnapshot();
  const loaded = !current.saving && current.text === source.text && current.baseRevision === source.baseRevision && current.generation === source.generation;
  if (loaded) draft.loadCurrent(latest, '草稿已另存，已载入文件版本');
  else draft.receive(latest, current.generation);
  return { path, loaded, revision: saved.revision };
}
