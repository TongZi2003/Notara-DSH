/** Small synthetic PDF fixture; generated locally without a renderer dependency. */
export function samplePdf(pages = 1) {
  const stream = 'BT /F1 20 Tf 50 730 Td (Synthetic integration handout) Tj 0 -40 Td (Select this region and keep the source reference.) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [3 0 R ${Array.from({length:pages-1},(_,i)=>`${i+6} 0 R`).join(' ')}] /Count ${pages} >>`.replace('R ]','R]'),
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  for(let i=1;i<pages;i++)objects.push(objects[2]);
  let body = '%PDF-1.4\n', offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body)); body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}
