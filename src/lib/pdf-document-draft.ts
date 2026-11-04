import { randomUUID } from "node:crypto";
import { documentItemTotals } from "@/lib/document-items";
import { invoicePaymentSummary } from "@/lib/invoice-status";
import { normalizePdfText, pdfAmountsChanged, pdfDraftSchema, pdfIssueMessage, samePdfContent, type PdfContent, type PdfDraft } from "@/lib/pdf-document-values";
import { pdfTextDefaults } from "@/lib/pdf-document-text";
import type { AppData, Estimate, IssuedInvoice, IssuedInvoiceItem } from "@/lib/types";

// The one place that turns dialog input into document values. The preview and the save both come
// through here, so what is previewed is what gets stored.

export class PdfDraftError extends Error {}

const maxDraftBytes = 2_000_000;
const maxDocumentTotal = 1_000_000_000_000;

export async function readPdfDraft(request: Request): Promise<PdfDraft> {
  const body = await request.text();
  if (body.length > maxDraftBytes) throw new PdfDraftError("内容が大きすぎます");
  let json: unknown;
  try { json = JSON.parse(body); } catch { throw new PdfDraftError("内容を読み取れませんでした"); }
  const result = pdfDraftSchema.safeParse(json);
  if (!result.success) throw new PdfDraftError(pdfIssueMessage(result.error.issues[0]));
  return result.data;
}

export const issuedPdfContent = (invoice: IssuedInvoice, items: IssuedInvoiceItem[]): PdfContent => ({
  number: invoice.invoiceNumber, issueDate: invoice.issueDate, dueDate: invoice.dueDate, notes: invoice.notes || "",
  items: items.map(({ description, details, quantity, unitPrice, taxRate }) => ({ description, details: details || "", quantity, unitPrice, taxRate })),
});

export const estimatePdfContent = (estimate: Estimate): PdfContent => ({
  number: estimate.estimateNumber, issueDate: estimate.issueDate, dueDate: estimate.validUntil, notes: estimate.notes || "",
  items: estimate.items.map(({ description, details, quantity, unitPrice, taxRate }) => ({ description, details: details || "", quantity, unitPrice, taxRate })),
});

function assertWithinLimit(total: number) {
  if (!Number.isSafeInteger(total) || total > maxDocumentTotal) throw new PdfDraftError("金額が上限を超えています");
}

// Amounts stay as saved unless a quantity, price, tax rate or line count really changed.
export function issuedInvoiceValues(invoice: IssuedInvoice, data: Pick<AppData, "payments">, saved: IssuedInvoiceItem[], content: PdfContent, timestamp: string) {
  const changed = pdfAmountsChanged(saved, content.items);
  const totals: Pick<IssuedInvoice, "subtotal" | "taxTotal" | "total" | "taxRounding"> = changed
    ? { ...documentItemTotals(content.items), taxRounding: "PER_RATE" }
    : { subtotal: invoice.subtotal, taxTotal: invoice.taxTotal, total: invoice.total, taxRounding: invoice.taxRounding };
  if (changed) assertWithinLimit(totals.total);
  if (totals.total !== invoice.total) {
    if (invoicePaymentSummary(data, invoice).paid > 0) throw new PdfDraftError("入金記録のある請求書の金額は変更できません");
    const scheduled = (invoice.installmentSchedule || []).reduce((sum, row) => sum + row.amount, 0);
    if (scheduled > totals.total) throw new PdfDraftError("分割入金予定の合計が請求額を超えます。先に予定を見直してください");
  }
  const items: IssuedInvoiceItem[] = content.items.map((item, index) => ({
    ...item, details: item.details || undefined, id: saved[index]?.id ?? randomUUID(), invoiceId: invoice.id, amount: Math.round(item.quantity * item.unitPrice),
    createdAt: saved[index]?.createdAt ?? timestamp, updatedAt: timestamp,
  }));
  return { totals, items };
}

// A preview never changes `data`: it returns copies carrying the draft.
export function issuedInvoicePdfDraft(invoice: IssuedInvoice, data: AppData, draft: PdfDraft) {
  const saved = data.issuedInvoiceItems.filter((item) => item.invoiceId === invoice.id);
  const next: IssuedInvoice = { ...invoice };
  let items = data.issuedInvoiceItems;
  if (draft.content && !samePdfContent(issuedPdfContent(invoice, saved), draft.content)) {
    const values = issuedInvoiceValues(invoice, data, saved, draft.content, invoice.updatedAt);
    Object.assign(next, values.totals, { invoiceNumber: draft.content.number, issueDate: draft.content.issueDate, dueDate: draft.content.dueDate, notes: draft.content.notes || undefined });
    items = [...data.issuedInvoiceItems.filter((item) => item.invoiceId !== invoice.id), ...values.items];
  }
  if (draft.text) next.pdfText = normalizePdfText(draft.text, pdfTextDefaults(invoice, data, "invoice"));
  return { invoice: next, data: { ...data, issuedInvoiceItems: items } };
}

export function estimatePdfDraft(estimate: Estimate, data: AppData, draft: PdfDraft): Estimate {
  const next: Estimate = { ...estimate };
  if (draft.content && !samePdfContent(estimatePdfContent(estimate), draft.content)) {
    if (!draft.content.issueDate || !draft.content.dueDate) throw new PdfDraftError("見積日と有効期限を入力してください");
    const totals = documentItemTotals(draft.content.items);
    assertWithinLimit(totals.total);
    Object.assign(next, totals, {
      taxRounding: "PER_RATE", estimateNumber: draft.content.number, issueDate: draft.content.issueDate, validUntil: draft.content.dueDate, notes: draft.content.notes,
      items: draft.content.items.map((item, index) => ({ ...item, details: item.details || undefined, id: estimate.items[index]?.id ?? randomUUID(), amount: Math.round(item.quantity * item.unitPrice) })),
    });
  }
  if (draft.text) next.pdfText = normalizePdfText(draft.text, pdfTextDefaults(estimate, data, "estimate"));
  return next;
}
