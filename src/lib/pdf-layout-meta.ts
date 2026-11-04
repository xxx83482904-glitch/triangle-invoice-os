import { resolvePdfLayout, type ResolvedPdfLayout } from "@/lib/invoice-pdf-layout";
import type { InvoicePdfLayout } from "@/lib/types";

export type PdfLayoutMeta = { layout: ResolvedPdfLayout; saved: boolean; items: string[]; hasNotes: boolean };

// Line labels are shortened for the page-break picker; the full text stays in the PDF.
export function pdfLayoutMeta(document: { pdfLayout?: InvoicePdfLayout }, items: { description: string }[], hasNotes: boolean): PdfLayoutMeta {
  return {
    layout: resolvePdfLayout(document.pdfLayout),
    saved: Boolean(document.pdfLayout && Object.keys(document.pdfLayout).length),
    items: items.map((item) => { const label = item.description.trim().replace(/\s+/g, " "); return label.length > 18 ? `${label.slice(0, 18)}…` : label; }),
    hasNotes,
  };
}
