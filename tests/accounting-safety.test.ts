import test from "node:test";
import assert from "node:assert/strict";
import { documentItemTotals, documentTaxBreakdown } from "../src/lib/document-items";
import { monthlyInvoiceSummary } from "../src/lib/accounting-summary";
import { projectMoney } from "../src/lib/store";
import { saveEstimate, convertEstimate } from "../src/lib/estimates";
import { fixture, admin, timestamp } from "./document-fixture";
import type { AppData, Payment, TaxRate } from "../src/lib/types";

test("consumption tax rounds once per rate including mixed and untaxed rows", () => {
  const rows = [10, 10, 8, 8, 0, -1].map((taxRate) => ({ quantity: 1, unitPrice: 15, taxRate: taxRate as TaxRate }));
  assert.deepEqual(documentItemTotals(rows), { subtotal: 90, taxTotal: 5, total: 95 });
  assert.deepEqual(documentTaxBreakdown(rows.map((row) => ({ ...row, amount: 15 }))), [
    { taxRate: 10, subtotal: 30, tax: 3 }, { taxRate: 8, subtotal: 30, tax: 2 },
    { taxRate: 0, subtotal: 15, tax: 0 }, { taxRate: -1, subtotal: 15, tax: 0 },
  ]);
  assert.deepEqual(documentItemTotals([]), { subtotal: 0, taxTotal: 0, total: 0 });
  assert.deepEqual(documentItemTotals([{ quantity: 0.5, unitPrice: 31, taxRate: 10 }, { quantity: 0.5, unitPrice: 31, taxRate: 10 }]), { subtotal: 32, taxTotal: 3, total: 35 });
  assert.deepEqual(documentItemTotals(Array.from({ length: 100 }, () => ({ quantity: 1, unitPrice: 5, taxRate: 10 as const }))), { subtotal: 500, taxTotal: 50, total: 550 });
});

test("new estimates and conversions keep the rate-level totals and calculation version", () => {
  const data = fixture();
  const estimate = saveEstimate(data, admin, "JAPAN", { projectId: "japan", clientId: "client", issueDate: "2026-09-01", validUntil: "2026-09-30", status: "DRAFT", items: [
    { description: "A", quantity: 1, unitPrice: 15, taxRate: 10 }, { description: "B", quantity: 1, unitPrice: 15, taxRate: 10 },
  ] });
  assert.equal(estimate.taxTotal, 3); assert.equal(estimate.total, 33); assert.equal(estimate.taxRounding, "PER_RATE");
  const invoice = convertEstimate(data, admin, "JAPAN", { id: estimate.id, updatedAt: estimate.updatedAt, issueDate: "2026-09-01", dueDate: "2026-09-30", transactionDate: "2026-09-01" });
  assert.equal(invoice.taxTotal, 3); assert.equal(invoice.total, 33); assert.equal(invoice.taxRounding, "PER_RATE");
});

function financialData() {
  const data = fixture();
  data.issuedInvoices = [{ ...data.issuedInvoices[0], status: "ISSUED", issueDate: "2026-09-01", total: 110000 }];
  data.receivedInvoices[0].total = 33000;
  return data;
}

function pay(data: AppData, invoiceId: string, amount: number, paymentDate: string, type: Payment["type"] = "INCOME") {
  data.payments.push({ id: `pay-${data.payments.length}`, type, issuedInvoiceId: type === "INCOME" ? invoiceId : undefined,
    receivedInvoiceId: type === "EXPENSE" ? invoiceId : undefined, amount, paymentDate, createdById: "admin", createdAt: timestamp, updatedAt: timestamp });
}

test("invoice margin is independent of collection and excludes drafts, cancellations and deleted rows", () => {
  const data = financialData();
  let money = projectMoney(data, "japan");
  assert.equal(money.grossProfit, 77000); assert.equal(money.grossProfitRate, 0.7);
  assert.equal(money.unpaidIncomeAmount, 110000); assert.equal(money.paidIncomeAmount - money.paidExpenseAmount, 0);
  pay(data, "issued-1", 30000, "2026-10-01");
  pay(data, "received-1", 10000, "2026-10-01", "EXPENSE");
  money = projectMoney(data, "japan");
  assert.equal(money.grossProfit, 77000); assert.equal(money.grossProfitRate, 0.7);
  assert.equal(money.unpaidIncomeAmount, 80000); assert.equal(money.paidIncomeAmount - money.paidExpenseAmount, 20000);
  for (const status of ["DRAFT", "CANCELED"] as const) data.issuedInvoices.push({ ...data.issuedInvoices[0], id: status, status, total: 999999 });
  data.issuedInvoices.push({ ...data.issuedInvoices[0], id: "deleted", deletedAt: timestamp });
  pay(data, "DRAFT", 999999, "2026-10-01");
  assert.deepEqual(projectMoney(data, "japan"), money);
});

test("overpayments never cancel another invoice's receivable or payable", () => {
  const data = financialData();
  data.issuedInvoices.push({ ...data.issuedInvoices[0], id: "unpaid", total: 20000 });
  data.receivedInvoices.push({ ...data.receivedInvoices[0], id: "unpaid-expense", total: 7000 });
  pay(data, "issued-1", 160000, "2026-10-01");
  pay(data, "received-1", 43000, "2026-10-01", "EXPENSE");
  const before = structuredClone(data);
  assert.equal(projectMoney(data, "japan").unpaidIncomeAmount, 20000);
  assert.equal(projectMoney(data, "japan").unpaidExpenseAmount, 7000);
  const rows = monthlyInvoiceSummary(data.issuedInvoices, data.receivedInvoices, data.payments);
  assert.equal(rows.find((row) => row.month === "2026-09")?.unpaidIssuedAmount, 20000);
  assert.deepEqual(data, before);
});

test("previous-month collections do not offset new unpaid invoices", () => {
  const data = financialData(); data.receivedInvoices = [];
  data.issuedInvoices[0].total = 100000;
  data.issuedInvoices.push({ ...data.issuedInvoices[0], id: "october", issueDate: "2026-10-01" });
  pay(data, "issued-1", 100000, "2026-10-02");
  assert.deepEqual(monthlyInvoiceSummary(data.issuedInvoices, [], data.payments), [
    { month: "2026-09", issuedTotal: 100000, incomeTotal: 0, unpaidIssuedAmount: 0, receivedDueTotal: 0, expenseTotal: 0 },
    { month: "2026-10", issuedTotal: 100000, incomeTotal: 100000, unpaidIssuedAmount: 100000, receivedDueTotal: 0, expenseTotal: 0 },
  ]);
});

test("monthly totals ignore deleted and unrelated payments and keep missing dates visible", () => {
  const data = financialData(); data.issuedInvoices[0].issueDate = "";
  pay(data, "issued-1", 100, "2026-10-01"); data.payments[0].deletedAt = timestamp;
  pay(data, "missing", 50000, "2025-01-01");
  pay(data, "received-1", 10000, "2026-10-01", "EXPENSE");
  const rows = monthlyInvoiceSummary(data.issuedInvoices, data.receivedInvoices, data.payments);
  assert.equal(rows.length, 2);
  assert.equal(rows.find((row) => row.month === "未設定")?.unpaidIssuedAmount, 110000);
  assert.equal(rows.find((row) => row.month === "2026-10")?.expenseTotal, 10000);
  assert.equal(rows.find((row) => row.month === "2026-10")?.incomeTotal, 0);
});
