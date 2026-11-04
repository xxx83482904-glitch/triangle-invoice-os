import { resolvePdfLayout, type ResolvedPdfLayout } from "@/lib/invoice-pdf-layout";
import { invoicePaymentSummary } from "@/lib/invoice-status";
import { estimatePdfContent, issuedPdfContent } from "@/lib/pdf-document-draft";
import { pdfTextDefaults, resolvePdfText, type PdfTextValues } from "@/lib/pdf-document-text";
import type { PdfContent, PdfDocumentKind } from "@/lib/pdf-document-values";
import { can } from "@/lib/rbac";
import type { AppData, Estimate, IssuedInvoice, User } from "@/lib/types";

// Everything the PDF dialog needs before it opens: the saved choices, the current content and what this person may change.
export type PdfLayoutMeta = {
  kind: PdfDocumentKind; updatedAt: string; total: number; layout: ResolvedPdfLayout; text: PdfTextValues; defaults: PdfTextValues; content: PdfContent;
  canEditContent: boolean; amountsLocked: boolean;
};

export function issuedPdfMeta(invoice: IssuedInvoice, data: AppData, user: Pick<User, "role">): PdfLayoutMeta {
  const defaults = pdfTextDefaults(invoice, data, "invoice");
  return {
    kind: "invoice", updatedAt: invoice.updatedAt, total: invoice.total, layout: resolvePdfLayout(invoice.pdfLayout), defaults, text: resolvePdfText(invoice.pdfText, defaults),
    content: issuedPdfContent(invoice, data.issuedInvoiceItems.filter((item) => item.invoiceId === invoice.id)),
    canEditContent: can(user, "manage:issuedInvoices") && !invoice.fileUrl,
    amountsLocked: invoicePaymentSummary(data, invoice).paid > 0,
  };
}

export function estimatePdfMeta(estimate: Estimate, data: AppData, user: Pick<User, "role">): PdfLayoutMeta {
  const defaults = pdfTextDefaults(estimate, data, "estimate");
  return {
    kind: "estimate", updatedAt: estimate.updatedAt, total: estimate.total, layout: resolvePdfLayout(estimate.pdfLayout), defaults, text: resolvePdfText(estimate.pdfText, defaults),
    content: estimatePdfContent(estimate),
    canEditContent: can(user, "manage:estimates") && !estimate.invoiceId && estimate.status !== "CONVERTED",
    amountsLocked: false,
  };
}
