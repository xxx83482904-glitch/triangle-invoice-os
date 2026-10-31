import type { ReconciliationBank, ReconciliationInvoice } from "@/lib/bank-reconciliation";
import type { AccountingCategory } from "@/lib/banking-types";
import type { CompanyScope } from "@/lib/company";
import { bankCategorySection } from "@/lib/bank-category-catalog";
import { bankCategorySide } from "@/lib/bank-classification";

// Expense categories a fee can be booked to; names containing 手数料 come first so the default is sensible.
export function feeCategoryOptions(categories: AccountingCategory[], company: CompanyScope) {
  const expense = categories.filter((row) => row.company === company && !row.parentId && row.available && !row.deletedAt && (bankCategorySide(row) === "EXPENSE" || bankCategorySection(row.group).id === "EXPENSE"));
  const score = (row: AccountingCategory) => /手数料/.test(row.name) ? 0 : 1;
  return expense.sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name, "ja")).map((row) => ({ id: row.id, name: row.name }));
}

export type AllocationFee = { amount: string; categoryId: string };
export type AllocationDraft = { id: string; invoiceKey: string; mode: "new" | "existing"; paymentId: string; amount: string; duplicateAcknowledged: boolean; fee?: AllocationFee };
const cents = (value: number) => Math.round(value * 100);

// The fee difference the screen may offer to absorb as 支払手数料: small, positive and only for a new payment record.
export const FEE_DIFFERENCE_LIMIT = 1100;
export function feeDifference(bank: ReconciliationBank, invoice: ReconciliationInvoice) {
  const difference = bank.side === "INCOME" ? cents(invoice.outstanding) - cents(bank.remaining) : cents(bank.remaining) - cents(invoice.outstanding);
  if (difference <= 0 || difference > Math.max(cents(FEE_DIFFERENCE_LIMIT), cents(invoice.total) * 0.02)) return 0;
  return difference / 100;
}

export function allocationPreview(bank: ReconciliationBank, invoices: ReconciliationInvoice[], rows: AllocationDraft[]) {
  const seen = new Set<string>();
  const invoiceTotals = new Map<string, number>();
  const newTotals = new Map<string, number>();
  let total = 0, fees = 0;
  const allocations = rows.map((row) => {
    const invoice = invoices.find((item) => item.key === row.invoiceKey);
    const payment = invoice?.payments.find((item) => item.id === row.paymentId);
    const amount = Number(row.amount), value = cents(amount);
    const fee = row.fee ? Number(row.fee.amount) : 0, feeValue = cents(fee);
    // Payer-borne fee (income) is part of what the invoice received; bank-borne fee (expense) is part of what left the bank.
    const invoiceValue = value + (bank.side === "INCOME" ? feeValue : 0), bankValue = value + (bank.side === "EXPENSE" ? feeValue : 0);
    const key = `${row.invoiceKey}:${row.mode === "new" ? "new" : row.paymentId}`;
    const duplicateWarning = row.mode === "new" && Boolean(invoice && (invoice.status === "PAID" || invoice.payments.some((item) => item.available > 0 || (item.date === bank.date && cents(item.amount) === value))));
    let error = "";
    if (!invoice || !invoice.eligible || invoice.conflict || (bank.side === "INCOME" ? invoice.kind !== "issued" : invoice.kind !== "received")) error = "照合対象の請求書を選択してください";
    else if (!Number.isFinite(amount) || amount <= 0 || amount > 1e12 || Math.abs(amount * 100 - value) >= 0.001) error = "金額は正の数・小数点以下2桁までです";
    else if (row.fee && (row.mode !== "new" || !Number.isFinite(fee) || fee <= 0 || Math.abs(fee * 100 - feeValue) >= 0.001)) error = "手数料差額は新しい支払記録に、正の金額で付けてください";
    else if (row.fee && fees > 0) error = "手数料差額の処理は1件の配賦にだけ付けられます";
    else if (seen.has(key)) error = "同じ請求書・記録の配賦を1行にまとめてください";
    else if (row.mode === "existing" && (!payment || value > cents(payment.available))) error = "既存記録の未照合額を超えています";
    else if (row.mode === "new" && invoiceValue > cents(invoice.outstanding)) error = "請求書の未入金・未払い額を超えています";
    seen.add(key);
    if (Number.isFinite(amount) && amount > 0) {
      total += bankValue; fees += feeValue;
      invoiceTotals.set(row.invoiceKey, (invoiceTotals.get(row.invoiceKey) || 0) + invoiceValue);
      if (row.mode === "new") newTotals.set(row.invoiceKey, (newTotals.get(row.invoiceKey) || 0) + invoiceValue);
    }
    return { row, invoice, payment, amount, fee, error, duplicateWarning };
  });
  const bankRemaining = (cents(bank.remaining) - total) / 100;
  return { allocations, total: total / 100, fees: fees / 100, bankRemaining,
    valid: rows.length > 0 && rows.length <= 100 && !bank.issue && !bank.conflict && bankRemaining >= 0 && allocations.every((row) => !row.error && (!row.duplicateWarning || row.row.duplicateAcknowledged)),
    invoiceRemaining: (invoice: ReconciliationInvoice) => (cents(invoice.unmatched) - (invoiceTotals.get(invoice.key) || 0)) / 100,
    outstanding: (invoice: ReconciliationInvoice) => (cents(invoice.outstanding) - (newTotals.get(invoice.key) || 0)) / 100,
  };
}
