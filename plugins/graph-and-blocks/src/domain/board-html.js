import {fromMarkdown} from 'mdast-util-from-markdown';
import {math} from 'micromark-extension-math';
import {mathFromMarkdown} from 'mdast-util-math';
import {notaraParseMath} from './markdown-math.js';
// Adapted from Notara Desktop packages/vault-core/src/board-html.js (2026-10-24); see DEVELOPMENT.md.
import { renderMath } from './math-latex.js';

export class HtmlComponentError extends Error {
  constructor(message, line) {
    super(message);
    this.name = 'HtmlComponentError';
    this.line = line;
  }
}

const fail = (message, line) => {
  throw new HtmlComponentError(message, line);
};

const escapeHtml = value =>
  String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));

const HTML_TAGS = new Set([
  'div', 'span', 'p', 'section', 'article', 'header', 'footer', 'aside', 'nav', 'main',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins', 'mark', 'small', 'sub', 'sup',
  'kbd', 'code', 'pre', 'samp', 'var', 'blockquote', 'q', 'cite', 'dfn', 'abbr', 'time',
  'hr', 'br', 'wbr',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'caption', 'colgroup', 'col', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'details', 'summary', 'figure', 'figcaption',
  'label', 'button', 'meter', 'progress',
]);

const VOID_TAGS = new Set(['hr', 'br', 'wbr', 'col', 'input']);

const SVG_TAG_MAP = new Map([
  ['svg', 'svg'],
  ['g', 'g'],
  ['path', 'path'],
  ['rect', 'rect'],
  ['circle', 'circle'],
  ['ellipse', 'ellipse'],
  ['line', 'line'],
  ['polyline', 'polyline'],
  ['polygon', 'polygon'],
  ['text', 'text'],
  ['tspan', 'tspan'],
  ['defs', 'defs'],
  ['marker', 'marker'],
  ['lineargradient', 'linearGradient'],
  ['radialgradient', 'radialGradient'],
  ['stop', 'stop'],
  ['clippath', 'clipPath'],
  ['mask', 'mask'],
  ['pattern', 'pattern'],
  ['symbol', 'symbol'],
  ['use', 'use'],
  ['title', 'title'],
  ['desc', 'desc'],
]);

const SVG_ATTR_MAP = new Map([
  ['xmlns', 'xmlns'],
  ['viewbox', 'viewBox'],
  ['preserveaspectratio', 'preserveAspectRatio'],
  ['x', 'x'],
  ['y', 'y'],
  ['x1', 'x1'],
  ['y1', 'y1'],
  ['x2', 'x2'],
  ['y2', 'y2'],
  ['cx', 'cx'],
  ['cy', 'cy'],
  ['r', 'r'],
  ['rx', 'rx'],
  ['ry', 'ry'],
  ['d', 'd'],
  ['points', 'points'],
  ['dx', 'dx'],
  ['dy', 'dy'],
  ['rotate', 'rotate'],
  ['textlength', 'textLength'],
  ['lengthadjust', 'lengthAdjust'],
  ['fill', 'fill'],
  ['fill-opacity', 'fill-opacity'],
  ['fill-rule', 'fill-rule'],
  ['stroke', 'stroke'],
  ['stroke-width', 'stroke-width'],
  ['stroke-dasharray', 'stroke-dasharray'],
  ['stroke-dashoffset', 'stroke-dashoffset'],
  ['stroke-linecap', 'stroke-linecap'],
  ['stroke-linejoin', 'stroke-linejoin'],
  ['stroke-miterlimit', 'stroke-miterlimit'],
  ['stroke-opacity', 'stroke-opacity'],
  ['opacity', 'opacity'],
  ['transform', 'transform'],
  ['transform-origin', 'transform-origin'],
  ['text-anchor', 'text-anchor'],
  ['dominant-baseline', 'dominant-baseline'],
  ['alignment-baseline', 'alignment-baseline'],
  ['baseline-shift', 'baseline-shift'],
  ['font-family', 'font-family'],
  ['font-size', 'font-size'],
  ['font-weight', 'font-weight'],
  ['font-style', 'font-style'],
  ['letter-spacing', 'letter-spacing'],
  ['word-spacing', 'word-spacing'],
  ['vector-effect', 'vector-effect'],
  ['marker-start', 'marker-start'],
  ['marker-mid', 'marker-mid'],
  ['marker-end', 'marker-end'],
  ['refx', 'refX'],
  ['refy', 'refY'],
  ['markerwidth', 'markerWidth'],
  ['markerheight', 'markerHeight'],
  ['markerunits', 'markerUnits'],
  ['orient', 'orient'],
  ['gradientunits', 'gradientUnits'],
  ['gradienttransform', 'gradientTransform'],
  ['spreadmethod', 'spreadMethod'],
  ['fx', 'fx'],
  ['fy', 'fy'],
  ['fr', 'fr'],
  ['offset', 'offset'],
  ['stop-color', 'stop-color'],
  ['stop-opacity', 'stop-opacity'],
  ['clip-path', 'clip-path'],
  ['clippathunits', 'clipPathUnits'],
  ['mask', 'mask'],
  ['maskunits', 'maskUnits'],
  ['maskcontentunits', 'maskContentUnits'],
  ['patternunits', 'patternUnits'],
  ['patterncontentunits', 'patternContentUnits'],
  ['patterntransform', 'patternTransform'],
  ['href', 'href'],
]);

const HTML_ATTRS = new Set([
  'class', 'id', 'style', 'title', 'role', 'dir', 'lang', 'tabindex', 'hidden', 'open',
  'colspan', 'rowspan', 'scope', 'headers', 'span', 'align', 'valign', 'width', 'height',
  'border', 'cellpadding', 'cellspacing',
  'type', 'name', 'value', 'placeholder', 'checked', 'disabled', 'readonly',
  'min', 'max', 'step', 'size', 'maxlength', 'low', 'high', 'optimum', 'for', 'start', 'reversed',
]);

const BOOLEAN_ATTRS = new Set(['open', 'disabled', 'hidden', 'reversed']);

const ALLOWED_DATA_ATTRS = new Set([
  'data-ask', 'data-source', 'data-color', 'data-label', 'data-hint',
  'data-stem', 'data-title',
  'data-role', 'data-state', 'data-step', 'data-panel', 'data-value', 'data-unit', 'data-variant',
]);


const SAFE_PATH = path =>
  Boolean(path) &&
  !/[\\\u0000-\u001f\u007f]/.test(path) &&
  !path.startsWith('/') &&
  !path.split('#')[0].split('/').some(part => !part || part.startsWith('.') || part.includes(':'));

const CSS_PROPERTIES = new Set(('display box-sizing width height min-width max-width min-height max-height margin margin-top margin-right margin-bottom margin-left padding padding-top padding-right padding-bottom padding-left gap row-gap column-gap grid-template-columns grid-template-rows grid-column grid-row grid-auto-flow align-items align-content align-self justify-content justify-items justify-self flex flex-direction flex-wrap flex-grow flex-shrink flex-basis order color background background-color background-image border border-top border-right border-bottom border-left border-color border-width border-style border-radius border-collapse border-spacing outline outline-color outline-width outline-style box-shadow opacity font-size font-weight font-style line-height letter-spacing text-align text-decoration text-transform white-space word-break overflow-wrap vertical-align list-style-type overflow overflow-x overflow-y position top right bottom left inset z-index transform transform-origin fill stroke stroke-width').split(' '));
const CSS_FUNCTIONS = new Set(('rgb rgba hsl hsla hwb lab lch oklab oklch color color-mix light-dark linear-gradient repeating-linear-gradient radial-gradient repeating-radial-gradient conic-gradient repeating-conic-gradient calc min max clamp translate translatex translatey translate3d scale scalex scaley scale3d rotate rotatex rotatey rotatez skew skewx skewy matrix matrix3d perspective').split(' '));

/** Layout/color CSS only. No resource functions, dynamic var/attr values or custom properties. */
export function sanitizeCssStyle(rawStyle) {
  const cleaned = String(rawStyle ?? '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/[\u0000-\u001f\u007f\\]/g, ' ')
    .trim();
  if (!cleaned) return '';
  const declarations = cleaned.split(';');
  const safe = [];
  for (const decl of declarations) {
    const colon = decl.indexOf(':');
    if (colon <= 0) continue;
    const prop = decl.slice(0, colon).trim().toLowerCase();
    const val = decl.slice(colon + 1).trim();
    if (!prop || !val) continue;
    if (!CSS_PROPERTIES.has(prop)) continue;
    if (!/^[\w\s#%.,()\/+\-:'"]+$/.test(val) || /https?:|\/\/|file:|data:|javascript:|vbscript:/i.test(val)) continue;
    if ([...val.matchAll(/([A-Za-z_-][A-Za-z0-9_-]*)\s*\(/g)].some(match => !CSS_FUNCTIONS.has(match[1].toLowerCase()))) continue;
    if (/(?:url\s*\(|expression\s*\(|javascript:|vbscript:|data:|-moz-binding|behavior\s*:|@import)/i.test(val)) continue;
    if (prop === 'position' && /^(?:fixed|sticky)$/i.test(val)) continue;
    if (prop === 'content') continue;
    if (prop === 'z-index') {
      const z = Number.parseInt(val, 10);
      if (!Number.isFinite(z)) continue;
      safe.push(`z-index:${Math.max(-5, Math.min(20, z))}`);
      continue;
    }
    safe.push(`${prop}:${val}`);
  }
  return safe.join(';');
}

const ATTR_REGEX = /([A-Za-z_:@][A-Za-z0-9_.:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function parseAttributes(attrString) {
  const attrs = [];
  for (const match of attrString.matchAll(ATTR_REGEX)) {
    const rawName = match[1];
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    const hasValue = match[2] !== undefined || match[3] !== undefined || match[4] !== undefined;
    attrs.push({ rawName, lower: rawName.toLowerCase(), value, hasValue });
  }
  return attrs;
}

function renderRichHtmlText(rawText, options) {
  return renderTextSegment(String(rawText ?? ''), options);
}

function renderTextSegment(text, { insideSvg = false, insideCode = false, exporting = false } = {}) {
  if (!text) return '';
  if (insideCode) return escapeHtml(text);
  const spans=[];
  const collect=node=>{
    if(['math','inlineMath','code','inlineCode'].includes(node.type))spans.push(node);
    else for(const child of node.children??[])collect(child);
  };
  collect(notaraParseMath(fromMarkdown,text,{mdastExtensions:[mathFromMarkdown()]},math()));
  spans.sort((a,b)=>a.position.start.offset-b.position.start.offset);
  let out = '', slot=0;
  for (let i = 0; i < text.length;) {
    while(spans[slot]&&spans[slot].position.start.offset<i)slot++;
    const span=spans[slot];
    if(span&&span.position.start.offset===i){
      const end=span.position.end.offset,raw=text.slice(i,end),isMath=span.type==='math'||span.type==='inlineMath';
      out+=isMath ? insideSvg ? escapeHtml(span.value) : renderMath(span.value,span.type==='math')??escapeHtml(raw) : escapeHtml(raw);
      slot++;i=end;continue;
    }
    const rest = text.slice(i);
    const wiki = rest.match(/^\[\[([^\]|\n]+?)(?:\\?\|([^\]\n]*))?\]\]/);
    if (wiki && !insideSvg) {
      const path = wiki[1].trim();
      const label = (wiki[2] ?? path.split('#')[0].split('/').pop().replace(/\.md$/, '')).trim();
      if (!exporting && SAFE_PATH(path)) {
        out += `<button type="button" class="nb-source-link" data-source="${escapeHtml(path)}">${escapeHtml(label)}</button>`;
      } else {
        out += `<span>${escapeHtml(label)}</span>`;
      }
      i += wiki[0].length;
      continue;
    }
    out += escapeHtml(text[i++]);
  }
  return out;
}

/**
 * Core isomorphic sanitizer and declarative binder for Notara safe HTML + inline SVG.
 * Strips all executable tags/attributes while preserving layout, tables, details,
 * SVG graphics, and declarative attributes (`data-step`, `data-source`).
 */
export function sanitizeBoardHtmlWithMeta(rawHtml, { exporting = false, strict = false } = {}) {
  let source = String(rawHtml ?? '').replace(/\r\n?/g, '\n');

  // 1. Strip dangerous container blocks completely (including their inner text)
  source = source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|object|applet|foreignobject|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|style|iframe|object|applet|foreignobject|noscript)\b[\s\S]*$/gi, '');

  let stem = '', title = '';

  const tagPattern = /<\/?([A-Za-z][A-Za-z0-9:-]*)(\s[^<>]*?)?\s*(\/?)>/g;
  const out = [];
  const openStack = [];
  let svgDepth = 0;
  let cursor = 0;

  for (const match of source.matchAll(tagPattern)) {
    const fullMatch = match[0];
    const isClosing = fullMatch.startsWith('</');
    const rawTagName = match[1];
    const lowerTag = rawTagName.toLowerCase();
    const attrPart = match[2] ?? '';
    const explicitSelfClose = Boolean(match[3]);

    // Render preceding text
    if (match.index > cursor) {
      const textChunk = source.slice(cursor, match.index);
      out.push(renderRichHtmlText(textChunk, { insideSvg: svgDepth > 0, insideCode: openStack.includes('pre') || openStack.includes('code'), exporting }));
    }
    cursor = match.index + fullMatch.length;

    const canonicalSvgTag = SVG_TAG_MAP.get(lowerTag);
    const isAllowedHtml = HTML_TAGS.has(lowerTag);
    if (!canonicalSvgTag && !isAllowedHtml) {
      // Disallowed tag (e.g. <img>, <form>, <embed>, <a>, <video>): strip the tag itself
      continue;
    }

    const canonicalTag = canonicalSvgTag ?? lowerTag;
    const isVoid = VOID_TAGS.has(lowerTag);

    if (isClosing) {
      if (isVoid) continue;
      // Find matching open tag in stack
      const stackIdx = openStack.lastIndexOf(canonicalTag);
      if (stackIdx < 0) continue;
      while (openStack.length > stackIdx) {
        const popped = openStack.pop();
        if (popped === 'svg') svgDepth = Math.max(0, svgDepth - 1);
        out.push(`</${popped}>`);
      }
      continue;
    }

    // Opening or self-closing tag
    const parsedAttrs = parseAttributes(attrPart);
    const sanitizedAttrs = new Map();

    for (const attr of parsedAttrs) {
      const { lower, value, hasValue } = attr;
      if (lower.startsWith('on') || lower === 'srcdoc' || lower === 'formaction' || lower === 'value' || lower === 'checked' || lower === 'aria-checked') continue;

      if (lower === 'data-stem' && value.trim()) {
        stem = value.trim().slice(0, 600);
      } else if (lower === 'data-title' && value.trim()) {
        title = value.trim().slice(0, 120);
      }
      if (lower === 'role' && /^(radio|checkbox|textbox|combobox)$/i.test(value)) continue;

      if (lower === 'style') {
        const cleanStyle = sanitizeCssStyle(value);
        if (cleanStyle) sanitizedAttrs.set('style', cleanStyle);
        continue;
      }

      if (lower === 'href' || lower === 'xlink:href') {
        // Only internal fragment references (#marker-id) are allowed in SVG
        if (canonicalSvgTag && /^#[A-Za-z0-9_.:-]+$/.test(value.trim())) {
          sanitizedAttrs.set('href', value.trim());
        }
        continue;
      }

      if (lower === 'data-source') {
        if (SAFE_PATH(value.trim())) {
          sanitizedAttrs.set('data-source', value.trim());
        }
        continue;
      }

      if (lower === 'data-ask') {
        const askText = value.trim().slice(0, 400);
        if (askText) sanitizedAttrs.set('data-ask', askText);
        continue;
      }

      if (lower === 'xmlns') {
        if (canonicalTag === 'svg' && value.trim() === 'http://www.w3.org/2000/svg') {
          sanitizedAttrs.set('xmlns', 'http://www.w3.org/2000/svg');
        }
        continue;
      }

      if (SVG_ATTR_MAP.has(lower)) {
        const svgAttr = SVG_ATTR_MAP.get(lower);
        if (/url\s*\(/i.test(value) && !/^url\(\s*#[A-Za-z0-9_.:-]+\s*\)$/i.test(value.trim())) continue;
        if (/javascript:|data:|https?:|\/\//i.test(value)) continue;
        sanitizedAttrs.set(svgAttr, value);
        continue;
      }

      if (HTML_ATTRS.has(lower) || ALLOWED_DATA_ATTRS.has(lower) || /^aria-[a-z0-9-]+$/.test(lower)) {
        if (BOOLEAN_ATTRS.has(lower) && !hasValue) {
          sanitizedAttrs.set(lower, null);
        } else {
          sanitizedAttrs.set(lower, value);
        }
      }
    }

    if (lowerTag === 'button') {
      sanitizedAttrs.set('type', 'button');
    }

    const attrSerialized = [...sanitizedAttrs.entries()]
      .map(([k, v]) => (v === null ? ` ${k}` : ` ${k}="${escapeHtml(v)}"`))
      .join('');

    const selfCloseSvg = Boolean(canonicalSvgTag && explicitSelfClose && canonicalTag !== 'svg');
    if (isVoid) {
      out.push(`<${canonicalTag}${attrSerialized}>`);
    } else if (selfCloseSvg) {
      out.push(`<${canonicalTag}${attrSerialized}/>`);
    } else {
      out.push(`<${canonicalTag}${attrSerialized}>`);
      openStack.push(canonicalTag);
      if (canonicalTag === 'svg') svgDepth++;
    }
  }

  if (cursor < source.length) {
    out.push(renderRichHtmlText(source.slice(cursor), { insideSvg: svgDepth > 0, insideCode: openStack.includes('pre') || openStack.includes('code'), exporting }));
  }

  while (openStack.length) {
    const popped = openStack.pop();
    if (popped === 'svg') svgDepth = Math.max(0, svgDepth - 1);
    out.push(`</${popped}>`);
  }

  return { html: out.join(''), stem, title };
}

export function sanitizeBoardHtml(rawHtml, options = {}) {
  return sanitizeBoardHtmlWithMeta(rawHtml, options).html;
}

const SAFE_HTML_BLOCK_OPEN = /^ {0,3}<(svg|div|table|details|section|figure|article|aside|header|footer)\b/i;

export function isSafeHtmlBlockStart(line) {
  return SAFE_HTML_BLOCK_OPEN.test(String(line ?? ''));
}

export function parseHtmlComponent(source) {
  const cleaned = String(source ?? '').replace(/\r\n?/g, '\n').trim();
  if (!cleaned) fail('html 组件内容不能为空。', 1);
  if (cleaned.length > 24000) fail('html 组件内容最多 24000 字。', 1);

  const meta = sanitizeBoardHtmlWithMeta(cleaned, { strict: true });
  if (!meta.html.trim()) fail('html 组件没有可渲染的安全标签或内容。', 1);
  return { html: meta.html, raw: cleaned, stem: meta.stem || meta.title || '', title: meta.title || meta.stem || '' };
}

// Keep the pre-retirement identity of display-only HTML, so an existing
// step/panel draft survives. Removing actual controls changes sanitized HTML.
export function htmlIdentity(spec) { return ['html', spec.stem ?? '', 'single', 'optional', spec.html ?? ''].join('\u0000'); }

export const HTML_SYNTAX =
  '```html\n<div data-title="条件对照">\n  <svg viewBox="0 0 360 90">...</svg>\n  <p>观察图中两个位置的区别。</p>\n</div>\n```\n支持安全 HTML 排版、内联 SVG 图解及 data-step/data-panel 分步展示；学生在课堂输入框中作答。严禁脚本、事件属性和外部资源。';
