import React from 'react';
import { MarkdownDelegateProvider, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives';
import { parseReference, parseSessionReference, wikiToMarkdown } from './logic.js';

const labels = { code: { copyLabel: '复制', copiedLabel: '已复制' }, footnotes: '注释' };
function normalizeCjkBold(text) {
  return String(text ?? '').replace(/\*\*([「『《（【“‘])([^*\n]+?)([」』》）】”’])\*\*/g, '$1**$2**$3');
}
export function NativeVaultMarkdown({ text, onOpen }) {
  return <MarkdownDelegateProvider openFile={(path, options) => {
    const session = parseSessionReference(path);
    if (session) { onOpen?.({ sessionId: session.sessionId, label: session.label }); return; }
    const suffix = !path.includes('#') && Number.isSafeInteger(options?.line) && options.line > 0 ? `#L${options.line}` : '';
    const locator = parseReference(`[[${path}${suffix}]]`);
    if (locator) onOpen?.(locator);
  }}><MarkdownText text={normalizeCjkBold(wikiToMarkdown(text))} labels={labels} /></MarkdownDelegateProvider>;
}
export const renderNativeMarkdown = (text, onOpen) => <NativeVaultMarkdown text={text} onOpen={onOpen} />;
