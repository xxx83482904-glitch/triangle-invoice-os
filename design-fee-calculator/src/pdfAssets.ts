import { rgb, type PDFDocument, type PDFFont, type PDFPage } from 'pdf-lib';
import wordmark from './assets/triangle-wordmark.svg?raw';
type FontBytes = ArrayBuffer | Uint8Array;
export type QuotationFonts = { body: FontBytes; regular: FontBytes; bold: FontBytes };
let fontPromise: Promise<QuotationFonts> | undefined;
export async function loadQuoteFont() {
  if (!fontPromise) fontPromise = Promise.all(['NotoSansSC-Regular.ttf', 'Montserrat-Regular.ttf', 'Montserrat-Bold.ttf'].map(async name => {
    const response = await fetch(`${import.meta.env.BASE_URL}fonts/${name}?v=2`);
    if (!response.ok) throw new Error('font');
    return response.arrayBuffer();
  })).then(([body, regular, bold]) => ({ body, regular, bold })).catch(e => { fontPromise = undefined; throw e; });
  return fontPromise;
}
export function addPageFooters(pdf: PDFDocument, latin: PDFFont, skip = new Set<PDFPage>()) {
  const paths = [...wordmark.matchAll(/<path d="([^"]+)"/g)].map(m => m[1]);
  if (paths.length !== 14) throw new Error('wordmark');
  const ink = rgb(20 / 255, 20 / 255, 20 / 255);
  pdf.getPages().forEach((p, i, all) => {
    if (skip.has(p)) return;
    p.drawText(`${String(i + 1).padStart(2, '0')} / ${String(all.length).padStart(2, '0')}`, { x: 48, y: 36, font: latin, size: 7, color: ink });
    for (const path of paths) p.drawSvgPath(path, { x: p.getWidth() - 48 - 145, y: 44, scale: 145 / 226, color: ink });
  });
}
