import { isBankDate } from "@/lib/banking";
import type { ReceivedInvoiceStatus } from "@/lib/types";

export type ReceivedWorkFilter = "all" | "unpaid" | "overdue" | "dueSoon" | "review" | "scheduled" | "paid";
export const receivedFilterLabels: Record<ReceivedWorkFilter, string> = {
  all: "すべて", dueSoon: "期限近い", overdue: "期限超過", paid: "支払済み",
  review: "確認待ち", scheduled: "支払予定", unpaid: "未払い",
};

export type ReceivedInvoiceListRow = {
  status: ReceivedInvoiceStatus; dueDate: string; total: number; paidAmount: number;
  unpaidAmount: number; paymentComplete: boolean; unpaidExclusion?: string;
  vendorName: string; projectName: string; originalFileName?: string; memo?: string; ocrText?: string;
};
const reviewStatuses = new Set<ReceivedInvoiceStatus>(["OCR_PENDING", "REVIEWING", "APPROVAL_PENDING", "REJECTED", "ON_HOLD"]);

export function receivedInvoiceIsOverdue(row: Pick<ReceivedInvoiceListRow, "dueDate" | "unpaidAmount">, today: string) {
  return row.unpaidAmount > 0 && isBankDate(row.dueDate) && row.dueDate < today;
}
export function receivedInvoiceIsDueSoon(row: Pick<ReceivedInvoiceListRow, "dueDate" | "unpaidAmount">, today: string) {
  if (row.unpaidAmount <= 0 || !isBankDate(row.dueDate) || row.dueDate < today) return false;
  return Date.parse(row.dueDate + "T00:00:00Z") - Date.parse(today + "T00:00:00Z") <= 7 * 86400000;
}

function matchesFilter(row: ReceivedInvoiceListRow, filter: ReceivedWorkFilter, today: string) {
  if (filter === "unpaid") return row.unpaidAmount > 0;
  if (filter === "overdue") return receivedInvoiceIsOverdue(row, today);
  if (filter === "dueSoon") return receivedInvoiceIsDueSoon(row, today);
  if (filter === "review") return reviewStatuses.has(row.status);
  if (filter === "scheduled") return row.status === "SCHEDULED";
  // An excluded balance of zero is not a payment. Unknown zero-amount documents are not paid either.
  if (filter === "paid") return row.paymentComplete;
  return true;
}

export function filterReceivedInvoices<T extends ReceivedInvoiceListRow>(rows: T[], filter: ReceivedWorkFilter, query: string, today: string): T[] {
  const needle = query.trim().toLowerCase();
  return rows.filter((row) => matchesFilter(row, filter, today) && (!needle ||
    [row.vendorName, row.projectName, row.originalFileName, row.memo, row.ocrText].some((value) => value?.toLowerCase().includes(needle))));
}

export function receivedListTotals(rows: ReceivedInvoiceListRow[]) {
  const money = (value: number) => Number.isFinite(value) ? Math.round(value * 100) : 0;
  return {
    count: rows.length,
    total: rows.reduce((sum, row) => sum + money(row.total), 0) / 100,
    paid: rows.reduce((sum, row) => sum + money(row.paidAmount), 0) / 100,
    unpaid: rows.reduce((sum, row) => sum + money(row.unpaidAmount), 0) / 100,
    unpaidCount: rows.filter((row) => row.unpaidAmount > 0).length,
    excludedCount: rows.filter((row) => row.unpaidExclusion).length,
  };
}

export function receivedSummaryBasis(filter: ReceivedWorkFilter, query: string) {
  return ["表示中の絞り込み：" + receivedFilterLabels[filter], query.trim() ? "検索：「" + query.trim() + "」" : "検索：なし", "期間：全期間（日付なしを含む）"];
}
