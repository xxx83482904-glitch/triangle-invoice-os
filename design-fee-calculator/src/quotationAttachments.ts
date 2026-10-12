import { PDFDocument } from 'pdf-lib';
import type { QuotePdfDrawing } from './quotation';

export function attachmentBytes(data: string) {
  const raw = atob(data.slice(data.indexOf(',') + 1));
  return Uint8Array.from(raw, ch => ch.charCodeAt(0));
}

export async function readPdfDrawing(file: Pick<File, 'name' | 'size' | 'arrayBuffer'>): Promise<QuotePdfDrawing> {
  if (file.size > 8_000_000) throw new Error('pdf-size');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw new Error('pdf-invalid');
  let doc: PDFDocument;
  try { doc = await PDFDocument.load(bytes, { updateMetadata: false }); } catch { throw new Error('pdf-invalid'); }
  const pages = doc.getPageCount();
  if (!pages || pages > 50) throw new Error('pdf-pages');
  // Chunk conversion avoids call-stack overflow for large architectural drawings.
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 16384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
  return { kind: 'pdf', name: file.name.slice(0, 300), caption: file.name.replace(/\.pdf$/i, '').slice(0, 300), pages, data: 'data:application/pdf;base64,' + btoa(binary) };
}
