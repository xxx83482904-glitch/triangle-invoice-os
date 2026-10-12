import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import wordmark from './assets/triangle-wordmark.svg?raw';
import { chineseMoney, documentLabels, quotationTotals, quoteErrors, type Quotation, type QuoteImage } from './quotation';

type FontBytes = ArrayBuffer | Uint8Array;
export type QuotationFonts = { body: FontBytes; regular: FontBytes; bold: FontBytes };
let fontPromise: Promise<QuotationFonts> | undefined;
export async function loadQuoteFont() {
  if (!fontPromise) fontPromise = Promise.all(['NotoSansSC-Regular.ttf', 'Montserrat-Regular.ttf', 'Montserrat-Bold.ttf'].map(async name => {
    const response = await fetch(`${import.meta.env.BASE_URL}fonts/${name}`);
    if (!response.ok) throw new Error('font');
    return response.arrayBuffer();
  })).then(([body, regular, bold]) => ({ body, regular, bold })).catch(e => { fontPromise = undefined; throw e; });
  return fontPromise;
}

/** A4 adaptation of the vault's white / ink / outlined-wordmark format. */
export async function generateQuotationPdf(q: Quotation, fontBytes?: QuotationFonts) {
  if (quoteErrors(q).length) throw new Error('validation');
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  const bytes = fontBytes ?? await loadQuoteFont();
  const [font, latin, bold] = await Promise.all([bytes.body, bytes.regular, bytes.bold].map(b => pdf.embedFont(b, { subset: true })));
  const supported = new Set(font.getCharacterSet());
  for (const ch of JSON.stringify({ ...q, images: q.images.map(i => i.caption), seal: null, signature: null })) {
    if (ch.codePointAt(0)! >= 32 && !supported.has(ch.codePointAt(0)!)) throw new Error(`glyph:${ch}`);
  }
  pdf.setTitle(`${q.title} - ${q.project}`); pdf.setAuthor(q.issuer); pdf.setSubject(q.number); pdf.setCreator('THE TRIANGLE.JP Design Fee Calculator');
  const t = documentLabels[q.language], totals = quotationTotals(q);
  const money = (n: number, digits = 0) => n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const W = 595.28, H = 841.89, margin = 48, width = W - margin * 2, bottom = 78;
  const ink = rgb(20 / 255, 20 / 255, 20 / 255), gray = rgb(.48, .48, .48);
  let page: PDFPage, y = 0, x = margin, measure = width;
  let continuation = () => sectionPage(t.overview, 'PROJECT OVERVIEW');
  function draw(value: string, px: number, top: number, size: number, face = font, muted = false) {
    if (value) page.drawText(value, { x: px, y: top - size, size, font: face, color: muted ? gray : ink });
  }
  function rule(top: number, px = margin, length = width) {
    page.drawLine({ start: { x: px, y: top }, end: { x: px + length, y: top }, thickness: .55, color: ink });
  }
  function wrap(value: string, size: number, available = measure, face: PDFFont = font) {
    const result: string[] = [];
    for (const paragraph of value.replace(/\r/g, '').replace(/\t/g, '  ').split('\n')) {
      let line = '';
      for (const ch of paragraph) {
        if (line && face.widthOfTextAtSize(line + ch, size) > available) {
          // Keep closing punctuation off the beginning of a line in Japanese/Chinese.
          const tail = [...line].at(-1)!;
          if (/[，。、：；！？）》」』】,.!?;:)]/.test(ch) || /[（《「『【(]/.test(tail)) {
            result.push([...line].slice(0, -1).join('')); line = tail + ch;
          } else { result.push(line); line = ch; }
        }
        else line += ch;
      }
      result.push(line);
    }
    return result;
  }
  function ensure(height: number) {
    if (y - height < bottom) {
      const savedX = x, savedMeasure = measure;
      continuation(); x = savedX; measure = savedMeasure;
    }
  }
  function text(value: string, size = 10, leading = 17, face = font, muted = false) {
    for (const line of wrap(value, size, measure, face)) {
      ensure(leading); draw(line, x, y, size, face, muted); y -= leading;
    }
  }
  function sectionPage(title: string, english: string) {
    page = pdf.addPage([W, H]); x = margin; measure = width; y = H - 45;
    // Keep the four-line hierarchy, with a bounded running title for long editable titles.
    const running = wrap(q.title, 8.5, width)[0];
    draw(running, margin, y, 8.5, font, true); y -= 16;
    draw('DESIGN FEE QUOTATION', margin, y, 7, latin, true); y -= 34;
    const titleLines = wrap(title, 22, width);
    for (const line of titleLines) { draw(line, margin, y, 22); y -= 31; }
    draw(english, margin, y, 8, latin); y -= 26; rule(y); y -= 27;
  }
  function section(title: string, english: string) {
    continuation = () => sectionPage(title, english); continuation();
  }
  function label(value: string, english?: string) {
    ensure(48); text(value, 10, 18);
    if (english) text(english, 7, 15, latin, true);
  }
  function field(name: string, value: string) {
    if (!value.trim()) return;
    const rows = wrap(value, 10, width - 120);
    ensure(Math.min(rows.length, 3) * 17 + 12);
    draw(name, margin, y, 8.5, font, true);
    x = margin + 120; measure = width - 120;
    text(value, 10, 17); y -= 12; x = margin; measure = width;
  }
  function amountHero() {
    ensure(130); text(t.total, 10, 24);
    const value = money(totals.total), size = Math.min(46, (width - 48) / bold.widthOfTextAtSize(value, 1));
    draw(value, margin, y, size, bold);
    draw('RMB', margin + bold.widthOfTextAtSize(value, size) + 12, y - size + 12, 9, latin);
    y -= size + 15;
    text(`${t.upper}  ${chineseMoney(totals.total)}`, 9, 16); y -= 15;
  }
  async function embed(img: QuoteImage) { return img.data.startsWith('data:image/png') ? pdf.embedPng(img.data) : pdf.embedJpg(img.data); }

  // Cover: large type, an open information grid and the actual proposal amount.
  page = pdf.addPage([W, H]); y = H - 48;
  draw('DESIGN SERVICES', margin, y, 8, latin); draw(q.date.replaceAll('-', '.'), W - margin - latin.widthOfTextAtSize(q.date.replaceAll('-', '.'), 8), y, 8, latin);
  y -= 25; rule(y); y -= 43;
  text('DESIGN FEE', 43, 49, bold); text('QUOTATION', 43, 49, bold);
  y -= 10; text(q.title, 17, 25); y -= 43;
  text(q.project, 28, 38); y -= 25;
  field(t.client, q.client); field(t.number, q.number); field(t.service, q.service);
  const [whole, fraction] = q.area.split('.');
  field(t.area, `${money(Number(whole))}${fraction ? '.' + fraction : ''} ㎡`);
  field(t.period, q.period); field(t.areaNote, q.areaNote); field(t.designer, q.designer);
  ensure(165); y = Math.min(y - 25, 260); rule(y); y -= 25; amountHero();
  if (q.taxMode === 'unspecified') text(t.unspecified, 8, 15, font, true);

  section(t.fees, 'FEES & TERMS');
  amountHero();
  function feeRow(name: string, value: string) {
    ensure(36);
    const valueWidth = latin.widthOfTextAtSize(value, 11);
    const rows = wrap(name, 9.5, width - valueWidth - 24);
    ensure(rows.length * 16 + 15);
    rows.forEach((line, i) => draw(line, margin, y - i * 16, 9.5));
    draw(value, W - margin - valueWidth, y, 11, latin);
    y -= rows.length * 16 + 14; rule(y); y -= 11;
  }
  feeRow(t.base, `${money(totals.base)} RMB`);
  // The area symbol needs the CJK font; the numeric columns use Montserrat.
  feeRow(t.average, `${money(totals.average, 1)} RMB/m²`);
  if (totals.additional) feeRow(t.additional, `${money(totals.additional)} RMB`);
  if (totals.discount) feeRow(t.discount, `-${money(totals.discount)} RMB`);
  if (q.taxMode !== 'unspecified') {
    feeRow(t.subtotal, `${money(totals.subtotal)} RMB`);
    feeRow(`${q.taxMode === 'included' ? t.included : t.tax} (${q.taxRate}%)`, `${money(totals.tax)} RMB`);
  }
  text(t.averageNote, 8, 13, font, true);
  if (q.taxMode === 'unspecified') text(t.unspecified, 8, 15, font, true);
  y -= 20; label(t.notes, 'QUOTATION CONDITIONS');
  text(`${t.validity}：${q.validDays}${t.days}`, 9.5, 17); text(q.notes, 9.5, 17);
  if (q.payment.trim()) { y -= 17; label(t.payment, 'PAYMENT'); text(q.payment, 9.5, 17); }
  ensure(150); y -= 25; rule(y); y -= 18;
  text(q.issuer, 11, 21); text(q.address, 8.5, 15); if (q.contact) text(q.contact, 8.5, 15);
  ensure(110); const marksTop = y - 12;
  if (q.seal) { const img = await embed(q.seal); const scale = Math.min(90 / img.width, 90 / img.height); page.drawImage(img, { x: margin + 210, y: marksTop - img.height * scale, width: img.width * scale, height: img.height * scale }); }
  if (q.signature) { const img = await embed(q.signature); const scale = Math.min(120 / img.width, 58 / img.height); page.drawImage(img, { x: W - margin - 120, y: marksTop - img.height * scale, width: img.width * scale, height: img.height * scale }); }
  y = marksTop - (q.seal || q.signature ? 78 : 8);
  x = W - margin - 120; measure = 120; text(q.representative, 11, 18); x = margin; measure = width;

  // Each pair shares a spread. Overflow continues in the same column on a new page,
  // so one long editable stage can never overwrite its neighbour.
  const stages = q.stages.filter(s => s.enabled);
  for (let start = 0; start < stages.length; start += 2) {
    section(t.scope, 'SCOPE OF SERVICES');
    const pages = [page!], starts = [y], colWidth = (width - 31) / 2;
    for (let col = 0; col < 2 && stages[start + col]; col++) {
      const stage = stages[start + col]; let sheet = 0;
      page = pages[0]; y = starts[0]; x = margin + col * (colWidth + 31); measure = colWidth;
      continuation = () => {
        sheet++;
        if (!pages[sheet]) { sectionPage(t.scope, 'SCOPE OF SERVICES'); pages.push(page); starts.push(y); }
        page = pages[sheet]; y = starts[sheet]; x = margin + col * (colWidth + 31); measure = colWidth;
        draw(`${String(start + col + 1).padStart(2, '0')} / ${q.language === 'zh' ? '续' : '続き'}`, x, y, 9); y -= 26;
      };
      text(String(start + col + 1).padStart(2, '0'), 31, 46, bold);
      const parts = stage.title.match(/^(.*?)\s*[（(]([A-Za-z &]+)[）)]\s*$/);
      text(parts ? parts[1] : stage.title, 17, 25);
      if (parts) text(parts[2].toUpperCase(), 7, 16, latin);
      y -= 20; text(stage.goal, 10, 17); y -= 21;
      const items = stage.items.split('\n').filter(s => s.trim());
      for (const [index, item] of items.entries()) {
        ensure(32); draw(String(index + 1).padStart(2, '0'), x, y - 1, 7, latin, true);
        const origin = x; x += 22; measure -= 22; text(item, 9.3, 15.5); x = origin; measure = colWidth; y -= 8;
      }
      if (stage.deliverables.trim()) {
        ensure(65); y -= 12; rule(y, x, colWidth); y -= 14;
        label(t.deliverables); text(stage.deliverables, 9.3, 16);
      }
    }
    x = margin; measure = width;
  }
  if (q.exclusions.trim()) {
    section(t.exclusions, 'EXCLUSIONS');
    for (const paragraph of q.exclusions.split('\n').filter(p => p.trim())) {
      ensure(60); text(paragraph, 10.5, 20); y -= 19;
    }
  }
  if (q.images.length) {
    const title = q.language === 'zh' ? '设计范围与参考图纸' : '設計範囲・参考図面';
    for (const [index, img] of q.images.entries()) {
      section(title, 'DRAWINGS & REFERENCES');
      const asset = await embed(img), scale = Math.min(width / asset.width, 460 / asset.height);
      page!.drawImage(asset, { x: margin + (width - asset.width * scale) / 2, y: y - asset.height * scale, width: asset.width * scale, height: asset.height * scale });
      y -= asset.height * scale + 26; rule(y); y -= 16;
      text(String(index + 1).padStart(2, '0'), 9, 20, latin); text(img.caption, 10, 18);
    }
  }
  const paths = [...wordmark.matchAll(/<path d="([^"]+)"/g)].map(m => m[1]);
  if (paths.length !== 14) throw new Error('wordmark');
  pdf.getPages().forEach((p, i, all) => {
    p.drawText(`${String(i + 1).padStart(2, '0')} / ${String(all.length).padStart(2, '0')}`, { x: margin, y: 36, font: latin, size: 7, color: ink });
    // Original Figma paths, untouched. Never recreate the logo with typed letters.
    for (const path of paths) p.drawSvgPath(path, { x: W - margin - 145, y: 44, scale: 145 / 226, color: ink });
  });
  return pdf.save();
}
