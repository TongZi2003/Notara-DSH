/** Shared candidate selection, independent of grid or graph layout. */
export const selectionModifier = event => Boolean(event.ctrlKey || event.metaKey);
export const listSelectionGesture = event => (event.button == null || event.button === 0) && Boolean(selectionModifier(event) || event.shiftKey);
export function selectCandidates(current, order, path, anchor, event = {}, limit = 12) {
  let next;
  const from = order.indexOf(anchor), to = order.indexOf(path);
  if (event.shiftKey && from >= 0 && to >= 0) {
    const range = order.slice(Math.min(from, to), Math.max(from, to) + 1);
    next = selectionModifier(event) ? [...new Set([...current, ...range])] : range;
  } else next = current.includes(path) ? current.filter(value => value !== path) : [...current, path];
  if (next.length > limit) throw new Error(`每次最多带入 ${limit} 份资料`);
  return { paths: next, anchor: event.shiftKey && from >= 0 ? anchor : path };
}
