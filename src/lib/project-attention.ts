import { outstandingAmount } from "@/lib/accounting-summary";
import { isBankDate } from "@/lib/banking";
import { isBillableIssuedInvoice } from "@/lib/documents";
import { receivedPayableSummary } from "@/lib/received-invoice-payables";
import type { AppData, Project } from "@/lib/types";

export type ProjectAttention = { kind: "incomeOverdue" | "expenseOverdue" | "incomeSoon" | "expenseSoon" | "documentReview"; label: string; count: number; financial: boolean; priority: number };

// Read-only presentation. Use existing payable and billable rules; no contract/stage inference.
export function projectAttention(data: AppData, project: Project, today: string): ProjectAttention[] {
  if (project.deletedAt) return [];
  if (!isBankDate(today)) throw new Error("基準日が不正です");
  const soon = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86400000).toISOString().slice(0, 10);
  const counts = { incomeOverdue: 0, expenseOverdue: 0, incomeSoon: 0, expenseSoon: 0, documentReview: 0 };
  const deadline = (kind: "income" | "expense", dueDate: string, remaining: number) => {
    if (!Number.isFinite(remaining) || remaining <= 0 || !isBankDate(dueDate)) return;
    if (dueDate < today) counts[kind === "income" ? "incomeOverdue" : "expenseOverdue"]++;
    else if (dueDate <= soon) counts[kind === "income" ? "incomeSoon" : "expenseSoon"]++;
  };
  for (const invoice of data.issuedInvoices) {
    if (invoice.deletedAt || invoice.projectId !== project.id || invoice.status === "CANCELED") continue;
    let review = invoice.status === "DRAFT" || Boolean(invoice.needsReview);
    if (isBillableIssuedInvoice(invoice)) {
      const paid = data.payments.filter((payment) => !payment.deletedAt && Number.isFinite(payment.amount) && payment.type === "INCOME" && payment.issuedInvoiceId === invoice.id).reduce((sum, payment) => sum + payment.amount, 0);
      const remaining = outstandingAmount(invoice.total, paid);
      // As on the dashboard, PAID without sufficient records calls for verification, not another payment.
      if (invoice.status === "PAID" && remaining > 0) review = true;
      else deadline("income", invoice.dueDate, remaining);
    }
    if (review) counts.documentReview++;
  }
  for (const invoice of data.receivedInvoices) {
    if (invoice.projectId !== project.id) continue;
    const summary = receivedPayableSummary(data, invoice);
    if (summary.unpaidExclusion) continue;
    const paymentMismatch = invoice.status === "PAID" && summary.unpaidAmount > 0;
    if (paymentMismatch || ["OCR_PENDING", "REVIEWING", "APPROVAL_PENDING"].includes(invoice.status)) counts.documentReview++;
    if (!paymentMismatch) deadline("expense", invoice.dueDate, summary.unpaidAmount);
  }
  return ([
    ["expenseOverdue", "支払期限超過", true, 30], ["incomeOverdue", "入金期限超過", true, 30],
    ["expenseSoon", "7日以内の支払い", true, 20], ["incomeSoon", "7日以内の入金", true, 20],
    ["documentReview", "書類確認待ち", false, 10],
  ] as const).flatMap(([kind, label, financial, priority]) => counts[kind] ? [{ kind, label, financial, priority, count: counts[kind] }] : []);
}
