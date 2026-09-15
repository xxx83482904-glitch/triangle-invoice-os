import test from "node:test";
import assert from "node:assert/strict";
import { fixture, admin, manager, timestamp } from "./document-fixture";
import { applyIssuedInvoiceEdits, type IssuedEdit } from "../src/lib/issued-invoice-edits";
import { documentRows } from "../src/lib/documents";
import { invoicePaymentSummary, issuedStatusLabels } from "../src/lib/invoice-status";
import { projectMoney } from "../src/lib/store";
import { saveEstimate, updateEstimateStatus, convertEstimate } from "../src/lib/estimates";
import type { AppData } from "../src/lib/types";

const billing = { id: "billing", role: "BILLING_EDITOR" as const };
function edit(data: AppData, status: IssuedEdit["status"], id = "issued-1"): IssuedEdit {
  const i = data.issuedInvoices.find((i) => i.id === id)!;
  return { id, updatedAt: i.updatedAt, invoiceNumber: i.invoiceNumber, projectId: i.projectId, issueDate: i.issueDate, dueDate: i.dueDate, total: i.total, status, needsReview: false };
}
function manual(data: AppData, amount: number) {
  data.payments.push({ id: "manual", type: "INCOME", issuedInvoiceId: "issued-1", amount, paymentDate: "2026-09-01", createdById: "admin", createdAt: timestamp, updatedAt: timestamp });
}

test("paid status records remaining income once and reconciles list, project money and date", () => {
  const data = fixture(); manual(data, 3000);
  const change = { ...edit(data, "PAID"), paymentDate: "2026-09-15" };
  applyIssuedInvoiceEdits(data, billing, "JAPAN", [change]);
  const invoice = data.issuedInvoices[0];
  assert.equal(invoice.status, "PAID"); assert.equal(invoice.paidAt, "2026-09-15");
  assert.equal(data.payments.find((p) => p.source === "INVOICE_STATUS")?.amount, 9000);
  assert.equal(projectMoney(data, "japan").paidIncomeAmount, 12000);
  assert.equal(projectMoney(data, "japan").unpaidIncomeAmount, 0);
  assert.equal(documentRows(data, billing, "JAPAN").find((r) => r.sourceId === invoice.id)?.statusLabel, "入金完了");
  assert.throws(() => applyIssuedInvoiceEdits(data, billing, "JAPAN", [change]));
  applyIssuedInvoiceEdits(data, billing, "JAPAN", [edit(data, "PAID")]);
  assert.equal(data.payments.length, 2);
});

test("unpaid reverses only status-created payments and preserves partial manual income", () => {
  const data = fixture(); manual(data, 3000);
  applyIssuedInvoiceEdits(data, billing, "JAPAN", [{ ...edit(data, "PAID"), paymentDate: "2026-09-15" }]);
  applyIssuedInvoiceEdits(data, billing, "JAPAN", [edit(data, "WAITING_PAYMENT")]);
  assert.equal(data.issuedInvoices[0].status, "PARTIALLY_PAID"); assert.equal(data.issuedInvoices[0].paidAt, undefined);
  assert.ok(!data.payments.find((p) => p.id === "manual")?.deletedAt);
  assert.ok(data.payments.find((p) => p.source === "INVOICE_STATUS")?.deletedAt);
  assert.equal(projectMoney(data, "japan").paidIncomeAmount, 3000);
  assert.equal(projectMoney(data, "japan").unpaidIncomeAmount, 9000);
});

test("complete/uncomplete/recomplete does not accumulate income and fully manual income is protected", () => {
  const data = fixture();
  applyIssuedInvoiceEdits(data, billing, "JAPAN", [{ ...edit(data, "PAID"), paymentDate: "2026-09-15" }]);
  applyIssuedInvoiceEdits(data, billing, "JAPAN", [edit(data, "WAITING_PAYMENT")]);
  assert.equal(data.issuedInvoices[0].status, "WAITING_PAYMENT"); assert.equal(projectMoney(data, "japan").paidIncomeAmount, 0);
  applyIssuedInvoiceEdits(data, billing, "JAPAN", [{ ...edit(data, "PAID"), paymentDate: "2026-09-16" }]);
  assert.equal(invoicePaymentSummary(data, data.issuedInvoices[0]).paid, 12000);
  const other = fixture(); manual(other, 12000); const before = JSON.stringify(other);
  assert.throws(() => applyIssuedInvoiceEdits(other, billing, "JAPAN", [edit(other, "WAITING_PAYMENT")]));
  assert.equal(JSON.stringify(other), before);
});

test("payment batches validate atomically including duplicates, invalid date and stale second row", () => {
  const data = fixture(); const before = JSON.stringify(data);
  const paid = { ...edit(data, "PAID"), paymentDate: "2026-09-15" };
  assert.throws(() => applyIssuedInvoiceEdits(data, billing, "JAPAN", [paid, { ...edit(data, "PAID", "issued-2"), updatedAt: "stale" }]));
  assert.throws(() => applyIssuedInvoiceEdits(data, billing, "JAPAN", [{ ...paid, paymentDate: "2026-02-30" }]));
  assert.throws(() => applyIssuedInvoiceEdits(data, billing, "JAPAN", [{ ...paid, invoiceNumber: "INV-002" }]));
  assert.throws(() => applyIssuedInvoiceEdits(data, billing, "JAPAN", [edit(data, "PAID")]));
  assert.equal(JSON.stringify(data), before);
  applyIssuedInvoiceEdits(data, billing, "JAPAN", [paid, { ...edit(data, "PAID", "issued-2"), paymentDate: "2026-09-15" }]);
  assert.equal(data.payments.length, 2);
});

test("payment changes respect scope and cannot move or alter paid invoice amounts", () => {
  const data = fixture(); const paid = { ...edit(data, "PAID"), paymentDate: "2026-09-15" };
  assert.throws(() => applyIssuedInvoiceEdits(data, { id: "mail", role: "MAIL_EDITOR" }, "JAPAN", [paid]));
  assert.throws(() => applyIssuedInvoiceEdits(data, billing, "CHINA", [paid]));
  assert.throws(() => applyIssuedInvoiceEdits(data, manager, "JAPAN", [{ ...edit(data, "PAID", "issued-2"), paymentDate: "2026-09-15" }]));
  applyIssuedInvoiceEdits(data, billing, "JAPAN", [paid]);
  assert.throws(() => applyIssuedInvoiceEdits(data, billing, "JAPAN", [{ ...edit(data, "PAID"), total: 13000 }]));
  assert.throws(() => applyIssuedInvoiceEdits(data, billing, "JAPAN", [{ ...edit(data, "PAID"), projectId: "other" }]));
  assert.throws(() => applyIssuedInvoiceEdits(data, billing, "JAPAN", [edit(data, "CANCELED")]));
});

test("canonical status follows manual payment records without modifying historical data", () => {
  const data = fixture(); const i = data.issuedInvoices[0]; i.status = "PAID"; i.needsReview = false;
  assert.equal(invoicePaymentSummary(data, i).status, "WAITING_PAYMENT");
  assert.equal(i.status, "PAID");
  manual(data, i.total);
  i.status = "ISSUED";
  assert.equal(documentRows(data, admin, "JAPAN").find((r) => r.sourceId === i.id)?.status, "PAID");
  assert.equal(issuedStatusLabels.WAITING_PAYMENT, "入金未完了");
});

test("estimate status updates propagate without altering amounts or converted invoices", () => {
  const data = fixture();
  const e = saveEstimate(data, billing, "JAPAN", { projectId: "japan", clientId: "client", issueDate: "2026-09-15", validUntil: "2026-10-15", status: "DRAFT", items: [{ description: "Design", quantity: 1, unitPrice: 1000, taxRate: 10 }] });
  const version = e.updatedAt; const before = projectMoney(data, "japan");
  updateEstimateStatus(data, billing, "JAPAN", { ...e, status: "SENT" });
  assert.equal(e.total, 1100); assert.deepEqual(projectMoney(data, "japan"), before);
  assert.equal(documentRows(data, billing, "JAPAN").find((r) => r.sourceId === e.id)?.statusLabel, "送付済み");
  assert.throws(() => updateEstimateStatus(data, billing, "JAPAN", { ...e, updatedAt: version, status: "ACCEPTED" }));
  assert.throws(() => updateEstimateStatus(data, { id: "mail", role: "MAIL_EDITOR" }, "JAPAN", { ...e, status: "SENT" }));
  convertEstimate(data, billing, "JAPAN", { ...e, issueDate: "2026-09-15", dueDate: "2026-10-15", transactionDate: "2026-09-15" });
  assert.throws(() => updateEstimateStatus(data, billing, "JAPAN", { ...e, status: "DRAFT" }));
  assert.equal(e.status, "CONVERTED");
});
