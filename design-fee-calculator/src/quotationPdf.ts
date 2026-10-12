import { PDFDocument, StandardFonts, rgb, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { chineseMoney, documentLabels, quotationTotals, quoteErrors, type Quotation, type QuoteImage } from './quotation';

let fontPromise: Promise<ArrayBuffer> | undefined;
export async function loadQuoteFont() {
  if (!fontPromise) fontPromise = fetch(`${import.meta.env.BASE_URL}fonts/NotoSansSC-Regular.ttf`).then(r => {
    if (!r.ok) throw new Error('font'); return r.arrayBuffer();
  }).catch(e => { fontPromise = undefined; throw e; });
  return fontPromise;
}

export async function generateQuotationPdf(q: Quotation, fontBytes?: ArrayBuffer | Uint8Array) {
  if (quoteErrors(q).length) throw new Error('validation');
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes ?? await loadQuoteFont(), { subset: true });
  const latin = await pdf.embedFont(StandardFonts.Helvetica);
  const supported = new Set(font.getCharacterSet());
  // Missing glyphs must not silently disappear from a business document.
  for (const ch of JSON.stringify({ ...q, images: q.images.map(i => i.caption), seal: null, signature: null })) {
    if (ch.codePointAt(0)! >= 32 && !supported.has(ch.codePointAt(0)!)) throw new Error(`glyph:${ch}`);
  }
  pdf.setTitle(`${q.title} - ${q.project}`); pdf.setAuthor(q.issuer); pdf.setSubject(q.number); pdf.setCreator('THE TRIANGLE.JP Design Fee Calculator');
  const t = documentLabels[q.language], totals = quotationTotals(q);
  const money = (n: number, digits = 0) => n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const W = 595.28, H = 841.89, left = 72, width = W - left * 2, bottom = 74;
  let page: PDFPage, y = 0;
  function newPage(top = 74) { page = pdf.addPage([W, H]); y = H - top; }
  function ensure(height: number) { if (y - height < bottom) newPage(); }
  function lines(text: string, size: number, maxWidth: number) {
    const result: string[] = [];
    for (const paragraph of text.replace(/\r/g, '').replace(/\t/g, '  ').split('\n')) {
      let line = '';
      for (const ch of paragraph) {
        if (line && font.widthOfTextAtSize(line + ch, size) > maxWidth) { result.push(line); line = ch; }
        else line += ch;
      }
      result.push(line);
    }
    return result;
  }
  function text(value: string, size = 9.5, gap = 16, indent = 0) {
    for (const line of lines(value, size, width - indent)) {
      ensure(gap); if (line) page.drawText(line, { x: left + indent, y: y - size, font, size, color: rgb(.1, .1, .1) }); y -= gap;
    }
  }
  function heading(value: string) { ensure(65); y -= 10; text(value, 12, 22); }
  function field(label: string, value: string) { if (value.trim()) text(`${label}：${value}`); }
  async function embed(img: QuoteImage) { return img.data.startsWith('data:image/png') ? pdf.embedPng(img.data) : pdf.embedJpg(img.data); }

  newPage(112);
  for (const line of lines(q.title, 18, width)) { ensure(28); page!.drawText(line, { x: (W - font.widthOfTextAtSize(line, 18)) / 2, y: y - 18, font, size: 18 }); y -= 28; }
  y -= 27; heading(t.overview);
  field(t.number, q.number); field(t.date, q.date); field(t.client, q.client);
  field(t.project, q.project); field(t.service, q.service); field(t.period, q.period);
  const [wholeArea, fractionalArea] = q.area.split('.');
  field(t.area, `${money(Number(wholeArea))}${fractionalArea ? '.' + fractionalArea : ''} ㎡`); field(t.areaNote, q.areaNote); field(t.designer, q.designer);
  if (q.images.length) {
    y -= 18;
    for (let i = 0; i < q.images.length; i += 2) {
      const boxW = (width - 14) / 2;
      const row = q.images.slice(i, i + 2);
      const rowHeight = 152 + Math.max(...row.map(img => lines(img.caption, 8, boxW).length)) * 12;
      ensure(rowHeight); const top = y;
      for (let j = 0; j < 2 && q.images[i + j]; j++) {
        const img = q.images[i + j], asset = await embed(img);
        const fit = Math.min(boxW / asset.width, 132 / asset.height), x = left + j * (boxW + 14);
        page!.drawImage(asset, { x: x + (boxW - asset.width * fit) / 2, y: top - asset.height * fit, width: asset.width * fit, height: asset.height * fit });
        const caption = lines(img.caption, 8, boxW);
        caption.forEach((l, k) => page!.drawText(l, { x, y: top - 146 - k * 12, font, size: 8 }));
      }
      y = top - rowHeight;
    }
  }
  const stages = q.stages.filter(s => s.enabled);
  if (stages.length || q.exclusions.trim()) {
    newPage(); heading(t.scope);
    for (const stage of stages) {
      heading(stage.title);
      field(t.goal, stage.goal);
      const items = stage.items.split('\n').filter(s => s.trim());
      items.forEach((item, i) => text(`${i + 1}.  ${item}`, 9.3, 15.5, 0));
      if (stage.deliverables.trim()) { ensure(45); y -= 5; text(t.deliverables + '：', 9.5, 18); text(stage.deliverables, 9.3, 17); }
      y -= 4;
    }
    if (q.exclusions.trim()) { heading(t.exclusions); text(q.exclusions, 9.3, 17); }
  }
  newPage(100); heading(t.fees); text(t.adjustmentNote, 9, 20); y -= 9;
  function feeRow(label: string, value: string, large = false) {
    const size = large ? 14 : 10;
    const valueWidth = font.widthOfTextAtSize(value, size);
    const wrapped = lines(label, size, width - valueWidth - 22);
    ensure(wrapped.length * 20 + 13);
    wrapped.forEach((l, i) => page!.drawText(l, { x: left, y: y - size - i * 20, font, size }));
    page!.drawText(value, { x: W - left - valueWidth, y: y - size, font, size });
    y -= wrapped.length * 20 + 13;
  }
  feeRow(t.base, `${money(totals.base)} RMB`);
  feeRow(t.average, `${money(totals.average, 1)} RMB/㎡`);
  if (totals.additional) feeRow(t.additional, `${money(totals.additional)} RMB`);
  if (totals.discount) feeRow(t.discount, `-${money(totals.discount)} RMB`);
  if (q.taxMode !== 'unspecified') {
    feeRow(t.subtotal, `${money(totals.subtotal)} RMB`);
    feeRow(`${q.taxMode === 'included' ? t.included : t.tax}（${q.taxRate}%）`, `${money(totals.tax)} RMB`);
  }
  ensure(110); page!.drawLine({ start: { x: left, y }, end: { x: W - left, y }, thickness: .7 }); y -= 16;
  feeRow(t.total, `${money(totals.total)} RMB`, true);
  text(`${t.upper}：${chineseMoney(totals.total)}`, 10, 19);
  y -= 8; text(t.averageNote, 8, 14);
  if (q.taxMode === 'unspecified') text(t.unspecified, 9, 17);
  heading(t.notes); field(t.validity, `${q.validDays}${t.days}`); text(q.notes);
  if (q.payment.trim()) { heading(t.payment); text(q.payment); }
  ensure(175); y -= 35;
  text(q.issuer, 10, 20); text(q.address, 9, 17); if (q.contact) text(q.contact, 9, 17);
  ensure(130); const marksTop = y - 8;
  if (q.seal) { const img = await embed(q.seal); const fit = Math.min(108 / img.width, 108 / img.height); page!.drawImage(img, { x: left + 110, y: marksTop - img.height * fit, width: img.width * fit, height: img.height * fit }); }
  if (q.signature) { const img = await embed(q.signature); const fit = Math.min(130 / img.width, 74 / img.height); page!.drawImage(img, { x: W - left - 140, y: marksTop - img.height * fit, width: img.width * fit, height: img.height * fit }); }
  y = marksTop - 86; text(q.representative, 12, 20, width - 140);
  pdf.getPages().forEach((p, i, pages) => {
    p.drawText(`${i + 1} / ${pages.length}`, { x: left, y: 43, font: latin, size: 8, color: rgb(.55, .55, .55) });
    p.drawText('THE TRIANGLE.JP', { x: W - left - 153, y: 41, font: latin, size: 15, color: rgb(.15, .15, .15) });
  });
  return pdf.save();
}
