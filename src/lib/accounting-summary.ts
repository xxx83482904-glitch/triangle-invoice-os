import { isBillableIssuedInvoice } from "@/lib/documents";
import type { IssuedInvoice, Payment, ReceivedInvoice } from "@/lib/types";

export function outstandingAmount(total: number, paid: number) {
  return Math.max(Math.round((total - paid) * 100) / 100, 0);
}

export function monthlyInvoiceSummary(issuedInvoices: IssuedInvoice[], receivedInvoices: ReceivedInvoice[], payments: Payment[]) {
  const issued = issuedInvoices.filter(isBillableIssuedInvoice);
  const received = receivedInvoices.filter((invoice) => !invoice.deletedAt);
  const issuedIds = new Set(issued.map((invoice) => invoice.id));
  const receivedIds = new Set(received.map((invoice) => invoice.id));
  const incomeByInvoice = new Map<string, number>();
  const months = new Map<string, { month: string; issuedTotal: number; incomeTotal: number; unpaidIssuedAmount: number; receivedDueTotal: number; expenseTotal: number }>();
  const rowFor = (date: string) => {
    const month = /^\d{4}-(0[1-9]|1[0-2])(?:-|$)/.test(date) ? date.slice(0, 7) : "未設定";
    let row = months.get(month);
    if (!row) {
      row = { month, issuedTotal: 0, incomeTotal: 0, unpaidIssuedAmount: 0, receivedDueTotal: 0, expenseTotal: 0 };
      months.set(month, row);
    }
    return row;
  };
  for (const payment of payments) {
    if (payment.deletedAt) continue;
    if (payment.type === "INCOME" && payment.issuedInvoiceId && issuedIds.has(payment.issuedInvoiceId)) {
      incomeByInvoice.set(payment.issuedInvoiceId, (incomeByInvoice.get(payment.issuedInvoiceId) ?? 0) + payment.amount);
      rowFor(payment.paymentDate).incomeTotal += payment.amount;
    } else if (payment.type === "EXPENSE" && payment.receivedInvoiceId && receivedIds.has(payment.receivedInvoiceId)) {
      rowFor(payment.paymentDate).expenseTotal += payment.amount;
    }
  }
  for (const invoice of issued) {
    const row = rowFor(invoice.issueDate);
    row.issuedTotal += invoice.total;
    // Outstanding is attributed to its invoice's issue month, not the receipt month.
    row.unpaidIssuedAmount += outstandingAmount(invoice.total, incomeByInvoice.get(invoice.id) ?? 0);
  }
  for (const invoice of received) rowFor(invoice.dueDate).receivedDueTotal += invoice.total;
  return [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
}
