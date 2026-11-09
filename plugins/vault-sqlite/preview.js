// Preview length is a text budget, never permission to cut a formula in half.
export const isReferenceHeading=title=>['参考理解','教师参考','参考答案','答案','提示'].includes(String(title).trim());
const atoms = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|`[^`]+`)/g;
export function mapPreviewText(source, transform) {
  return String(source).split(atoms).map((part, index) => index % 2 ? part : transform(part)).join('');
}
export function previewText(source, limit = 240) {
  let result = '';
  for (const [index, part] of String(source).split(atoms).entries()) {
    if (result.length >= limit) break;
    // The full atom is handed to KaTeX; exceptionally long expressions are
    // left for the document reader rather than emitted as malformed TeX.
    if (index % 2) result += part.length <= 2000 ? part : '…';
    else result += part.replace(/\s+/g, ' ').slice(0, limit - result.length);
  }
  return result.trim();
}
