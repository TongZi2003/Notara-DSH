import katex from 'katex';
// No editor dependency, macros, network, or trusted commands in learner content.
export function renderMath(source, displayMode = false) {
  try { return katex.renderToString(String(source), { displayMode, trust: false, throwOnError: true, strict: 'ignore', maxExpand: 300, maxSize: 30, output: 'mathml' }); }
  catch { return null; }
}
