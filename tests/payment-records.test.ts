import assert from "node:assert/strict";
import test from "node:test";
import { admin, fixture, timestamp } from "./document-fixture";
import { adjustPayment, assertReceivedPaidAllowed, cancelPayment, isLegacyStatusPayment, paymentOrigin, paymentRecordsFor, receivedPaymentSummary, recordPayment } from "../src/lib/payment-records";
import { applyReceivedInvoiceFields } from "../src/lib/received-invoice-edits";
import type { Payment } from "../src/lib/types";

const today = "2026-10-31";
function setup() {
  const data = fixture();
  data.users.push({ id: "admin", name: "Admin", email: "admin@example.invalid", passwordHash: "unused", role: "ADMIN", createdAt: timestamp, updatedAt: timestamp });
  const invoice = data.receivedInvoices[0];
  invoice.status = "SCHEDULED"; invoice.mailProcessed = false; data.mailDocuments[0].mailProcessed = false;
  return { data, invoice };
}
const record = (data: ReturnType<typeof setup>["data"], amount: number, extra: Record<string, unknown> = {}) =>
  recordPayment(data, admin, "JAPAN", { kind: "received", invoiceId: "received-1", amount, paymentDate: today, ...extra }, today);

test("a status change alone never marks a received invoice paid; the stored status is compared with payment records", () => {
  const { data, invoice } = setup();
  assert.throws(() => assertReceivedPaidAllowed(data, invoice), /支払記録の登録か銀行照合/);
  assert.deepEqual([receivedPaymentSummary(data, invoice).status, receivedPaymentSummary(data, invoice).outstanding, receivedPaymentSummary(data, invoice).statusMismatch], ["SCHEDULED", 8000, false]);
  invoice.status = "PAID";
  const legacy = receivedPaymentSummary(data, invoice);
  assert.equal(legacy.statusMismatch, true); assert.equal(legacy.status, "SCHEDULED"); assert.equal(legacy.complete, false);
  assert.equal(data.payments.length, 0);
});

test("manual records are explicit, scoped, bounded by the outstanding amount, and complete the document", () => {
  const { data, invoice } = setup();
  assert.throws(() => recordPayment(data, { id: "mail", role: "MAIL_EDITOR" }, "JAPAN", { kind: "received", invoiceId: invoice.id, amount: 1000, paymentDate: today }, today), /権限/);
  assert.throws(() => recordPayment(data, admin, "CHINA", { kind: "received", invoiceId: invoice.id, amount: 1000, paymentDate: today }, today), /日本版/);
  assert.throws(() => record(data, 1000, { paymentDate: "2026-11-01" }), /今日以前/);
  assert.throws(() => record(data, 9000), /未払い額/);
  assert.throws(() => record(data, 1000, { invoiceUpdatedAt: "stale" }), /更新されています/);
  assert.throws(() => record(data, 0.001));
  assert.throws(() => recordPayment(data, admin, "JAPAN", { kind: "received", invoiceId: "missing", amount: 1, paymentDate: today }, today), /見つかりません/);
  assert.equal(data.payments.length, 0);
  const first = record(data, 3000, { paymentDate: "2026-10-20", method: "現金", memo: "一部", reason: "通帳で確認" });
  assert.equal(first.status, "SCHEDULED"); assert.equal(invoice.status, "SCHEDULED");
  const payment = data.payments[0];
  assert.deepEqual([payment.source, payment.method, payment.memo, payment.history?.[0].kind, payment.history?.[0].reason, paymentOrigin(payment)], ["MANUAL", "現金", "一部", "RECORDED", "通帳で確認", "MANUAL"]);
  const second = record(data, 5000);
  assert.equal(second.status, "PAID"); assert.equal(invoice.status, "PAID"); assert.equal(invoice.paidAt, today);
  assert.equal(invoice.mailProcessed, true); assert.equal(data.mailDocuments[0].mailProcessed, true);
  assert.equal(assertReceivedPaidAllowed(data, invoice).complete, true);
  assert.throws(() => record(data, 1), /未払い額/);
  assert.equal(data.payments.find((row) => row.amount === 5000)?.method, "手入力");
});

test("amount corrections are independent of payment records and report the overpaid balance", () => {
  const { data, invoice } = setup();
  record(data, 8000);
  const form = new FormData();
  for (const [key, value] of Object.entries({ expectedUpdatedAt: invoice.updatedAt, projectId: "japan", vendorId: "vendor", issueDate: "2026-09-15", dueDate: "2026-10-15", subtotal: "5000", taxTotal: "0", total: "5000", memo: "契約番号を金額と読み違えていた" })) form.set(key, value);
  applyReceivedInvoiceFields(data, admin, "JAPAN", invoice.id, form);
  assert.equal(invoice.total, 5000);
  const summary = receivedPaymentSummary(data, invoice);
  assert.deepEqual([summary.paid, summary.overpaid, summary.outstanding, summary.complete], [8000, 3000, 0, true]);
  assert.equal(data.payments.length, 1);
});

test("adjust and cancel need a reason, keep a history, respect the document total and refuse bank-linked records", () => {
  const { data, invoice } = setup();
  record(data, 3000, { paymentDate: "2026-10-20" }); record(data, 5000);
  const partial = data.payments.find((row) => row.amount === 3000)!, full = data.payments.find((row) => row.amount === 5000)!;
  assert.equal(invoice.status, "PAID");
  assert.throws(() => adjustPayment(data, admin, "JAPAN", { paymentId: partial.id, updatedAt: partial.updatedAt, amount: 2000, paymentDate: "2026-10-19", reason: "" }, today));
  assert.throws(() => adjustPayment(data, admin, "JAPAN", { paymentId: partial.id, updatedAt: "stale", amount: 2000, paymentDate: "2026-10-19", reason: "x" }, today), /更新されています/);
  assert.throws(() => adjustPayment(data, admin, "JAPAN", { paymentId: partial.id, updatedAt: partial.updatedAt, amount: 3000, paymentDate: "2026-10-20", reason: "x" }, today), /変更がありません/);
  assert.throws(() => adjustPayment(data, admin, "JAPAN", { paymentId: partial.id, updatedAt: partial.updatedAt, amount: 4000, paymentDate: "2026-10-20", reason: "x" }, today), /請求額/);
  assert.throws(() => adjustPayment(data, { id: "mail", role: "MAIL_EDITOR" }, "JAPAN", { paymentId: partial.id, updatedAt: partial.updatedAt, amount: 2000, paymentDate: "2026-10-19", reason: "x" }, today), /権限/);
  const adjusted = adjustPayment(data, admin, "JAPAN", { paymentId: partial.id, updatedAt: partial.updatedAt, amount: 2000, paymentDate: "2026-10-19", reason: "原本の金額に合わせた" }, today);
  assert.equal(adjusted.status, "SCHEDULED"); assert.equal(invoice.status, "SCHEDULED"); assert.equal(invoice.mailProcessed, false);
  assert.deepEqual([partial.amount, partial.paymentDate, partial.history?.at(-1)?.kind, partial.history?.at(-1)?.before, partial.history?.at(-1)?.after], [2000, "2026-10-19", "ADJUSTED", { amount: 3000, paymentDate: "2026-10-20" }, { amount: 2000, paymentDate: "2026-10-19" }]);
  assert.throws(() => cancelPayment(data, admin, "JAPAN", { paymentId: full.id, updatedAt: full.updatedAt, reason: "" }));
  const canceled = cancelPayment(data, admin, "JAPAN", { paymentId: full.id, updatedAt: full.updatedAt, reason: "状態変更で自動作成された重複" });
  assert.equal(canceled.status, "SCHEDULED"); assert.ok(full.deletedAt); assert.equal(full.history?.at(-1)?.kind, "CANCELED");
  assert.equal(receivedPaymentSummary(data, invoice).paid, 2000);
  assert.throws(() => cancelPayment(data, admin, "JAPAN", { paymentId: full.id, updatedAt: full.updatedAt, reason: "again" }), /更新されています/);
  // A bank-linked record is protected until the reconciliation is removed.
  data.bankReconciliations.push({ id: "link", company: "JAPAN", transactionId: "bank-row", invoiceKind: "received", invoiceId: invoice.id, paymentId: partial.id, amount: 2000, createdPayment: false, bankEvidence: "", invoiceEvidence: "", paymentEvidence: "", note: "", confirmedById: admin.id, createdAt: timestamp, updatedAt: timestamp });
  assert.throws(() => cancelPayment(data, admin, "JAPAN", { paymentId: partial.id, updatedAt: partial.updatedAt, reason: "x" }), /銀行照合済み/);
  assert.throws(() => adjustPayment(data, admin, "JAPAN", { paymentId: partial.id, updatedAt: partial.updatedAt, amount: 1000, paymentDate: "2026-10-19", reason: "x" }, today), /銀行照合済み/);
  const views = paymentRecordsFor(data, "JAPAN", "received", invoice.id, today);
  assert.deepEqual(views.map((row) => [row.amount, row.canceled, row.linked, row.linkedAmount, row.originLabel]), [[2000, false, true, 2000, "手入力"], [5000, true, false, 0, "手入力"]]);
  assert.equal(views[0].history.map((entry) => entry.kind).join(","), "RECORDED,ADJUSTED");
  assert.equal(views[1].history.at(-1)?.reason, "状態変更で自動作成された重複");
  assert.equal(views[0].createdBy, "Admin");
});

test("legacy rows are recognized by origin and issued invoices use the same explicit entry", () => {
  const legacy: Payment = { id: "p", type: "EXPENSE", receivedInvoiceId: "received-1", amount: 1, paymentDate: today, method: "ステータス変更", memo: "ステータス変更で支払済みにしました", createdById: "admin", createdAt: timestamp, updatedAt: timestamp };
  assert.equal(isLegacyStatusPayment(legacy), true); assert.equal(paymentOrigin(legacy), "LEGACY_STATUS");
  assert.equal(paymentOrigin({ ...legacy, method: "銀行振込", memo: undefined }), "LEGACY_MANUAL");
  assert.equal(paymentOrigin({ ...legacy, source: "BANK_RECONCILIATION" }), "BANK_RECONCILIATION");
  assert.equal(paymentOrigin({ ...legacy, source: "MANUAL" }), "MANUAL");
  const { data } = setup();
  assert.throws(() => recordPayment(data, admin, "JAPAN", { kind: "issued", invoiceId: "issued-1", amount: 12000, paymentDate: today }, today), /発行済み/);
  data.issuedInvoices[0].status = "ISSUED";
  const result = recordPayment(data, admin, "JAPAN", { kind: "issued", invoiceId: "issued-1", amount: 12000, paymentDate: today }, today);
  assert.equal(result.status, "PAID"); assert.equal(data.issuedInvoices[0].status, "PAID"); assert.equal(data.payments[0].source, "MANUAL"); assert.equal(data.payments[0].type, "INCOME");
});
