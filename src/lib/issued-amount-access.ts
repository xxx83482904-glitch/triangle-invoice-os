import { can, type UserAccess } from "@/lib/rbac";
import type { Estimate, IssuedInvoice } from "@/lib/types";

/** Client-safe. Who is looking: access for can(), id for "made it myself". */
export type AmountViewer = UserAccess & { id: string };
export type IssuedRecordKind = "invoice" | "estimate";

/**
 * Money on issued invoices and estimates (amounts, items, PDFs, original files) is shown to administrators,
 * to members whose 「請求書の金額」 switch is on, and to the person who made or uploaded that record.
 */
export function canSeeIssuedAmounts(user: AmountViewer | null | undefined, record: { createdById?: string | null }) {
  if (!user) return false;
  if (can(user, "view:issuedInvoiceAmounts")) return true;
  return Boolean(record.createdById) && record.createdById === user.id;
}

export const hiddenAmountLabel = "金額は非表示です";

export function hiddenAmountNote(kind: IssuedRecordKind) {
  return `この${kind === "estimate" ? "見積書" : "請求書"}の金額とPDFは、管理者と作成した人だけが見られます。`;
}

export function hiddenChangeMessage(kind: IssuedRecordKind) {
  return `この${kind === "estimate" ? "見積書" : "請求書"}は、管理者と作成した人だけが変更できます。`;
}

/** Server-side guard for every change to an issued invoice or estimate. */
export function assertCanChangeIssuedRecord(user: AmountViewer, record: { createdById?: string | null }, kind: IssuedRecordKind) {
  if (!canSeeIssuedAmounts(user, record)) throw new Error(hiddenChangeMessage(kind));
}

/** An estimate as sent to the browser: someone else's keeps its number, dates and status but carries no money. */
export type EstimateView = Estimate & { amountsHidden?: boolean };

export function estimateForViewer(user: AmountViewer, estimate: Estimate): EstimateView {
  if (canSeeIssuedAmounts(user, estimate)) return estimate;
  return { ...estimate, items: [], subtotal: 0, taxTotal: 0, total: 0, pdfLayout: undefined, pdfText: undefined, amountsHidden: true };
}

/** An issued invoice for an export or the agent API: someone else's keeps its number, dates and status, money and files are removed. */
export function issuedInvoiceForViewer(user: AmountViewer, invoice: IssuedInvoice) {
  if (canSeeIssuedAmounts(user, invoice)) return invoice;
  return {
    ...invoice, subtotal: null, taxTotal: null, total: null, installmentSchedule: undefined, pdfUrl: undefined, fileUrl: undefined, fileHash: undefined,
    ocrText: undefined, ocrWarnings: undefined, ocrConfidence: undefined, pdfLayout: undefined, pdfText: undefined, amountsHidden: true as const,
  };
}
