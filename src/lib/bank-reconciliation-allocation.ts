import type { ReconciliationBank, ReconciliationInvoice } from "@/lib/bank-reconciliation";

export type AllocationDraft = { id: string; invoiceKey: string; mode: "new" | "existing"; paymentId: string; amount: string; duplicateAcknowledged: boolean };
const cents = (value: number) => Math.round(value * 100);

export function allocationPreview(bank: ReconciliationBank, invoices: ReconciliationInvoice[], rows: AllocationDraft[]) {
  const seen = new Set<string>();
  const invoiceTotals = new Map<string, number>();
  const newTotals = new Map<string, number>();
  let total = 0;
  const allocations = rows.map((row) => {
    const invoice = invoices.find((item) => item.key === row.invoiceKey);
    const payment = invoice?.payments.find((item) => item.id === row.paymentId);
    const amount = Number(row.amount), value = cents(amount);
    const key = `${row.invoiceKey}:${row.mode === "new" ? "new" : row.paymentId}`;
    const duplicateWarning = row.mode === "new" && Boolean(invoice && (invoice.status === "PAID" || invoice.payments.some((item) => item.available > 0 || (item.date === bank.date && cents(item.amount) === value))));
    let error = "";
    if (!invoice || !invoice.eligible || invoice.conflict || (bank.side === "INCOME" ? invoice.kind !== "issued" : invoice.kind !== "received")) error = "照合対象の請求書を選択してください";
    else if (!Number.isFinite(amount) || amount <= 0 || amount > 1e12 || Math.abs(amount * 100 - value) >= 0.001) error = "金額は正の数・小数点以下2桁までです";
    else if (seen.has(key)) error = "同じ請求書・記録の配賦を1行にまとめてください";
    else if (row.mode === "existing" && (!payment || value > cents(payment.available))) error = "既存記録の未照合額を超えています";
    else if (row.mode === "new" && value > cents(invoice.outstanding)) error = "請求書の未入金・未払い額を超えています";
    seen.add(key);
    if (Number.isFinite(amount) && amount > 0) {
      total += value;
      invoiceTotals.set(row.invoiceKey, (invoiceTotals.get(row.invoiceKey) || 0) + value);
      if (row.mode === "new") newTotals.set(row.invoiceKey, (newTotals.get(row.invoiceKey) || 0) + value);
    }
    return { row, invoice, payment, amount, error, duplicateWarning };
  });
  const bankRemaining = (cents(bank.remaining) - total) / 100;
  return { allocations, total: total / 100, bankRemaining,
    valid: rows.length > 0 && rows.length <= 100 && !bank.issue && !bank.conflict && bankRemaining >= 0 && allocations.every((row) => !row.error && (!row.duplicateWarning || row.row.duplicateAcknowledged)),
    invoiceRemaining: (invoice: ReconciliationInvoice) => (cents(invoice.unmatched) - (invoiceTotals.get(invoice.key) || 0)) / 100,
    outstanding: (invoice: ReconciliationInvoice) => (cents(invoice.outstanding) - (newTotals.get(invoice.key) || 0)) / 100,
  };
}
