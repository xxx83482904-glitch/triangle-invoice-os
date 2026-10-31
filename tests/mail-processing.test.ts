import assert from "node:assert/strict";
import test from "node:test";
import { admin, fixture, timestamp } from "./document-fixture";
import { recordPayment, cancelPayment, adjustPayment } from "../src/lib/payment-records";
import { linkMailDocumentToReceivedInvoice, unlinkMailDocument, unlinkMailDocumentsForInvoice } from "../src/lib/mail-links";
import { documentRows } from "../src/lib/documents";
import { dashboardSummary } from "../src/lib/dashboard";
import { applyMailSorterEdits } from "../src/lib/mail-processing";

const today = "2026-11-01";
for (const processed of [false, true, undefined]) {
  test(`payment registration, correction and cancellation preserve manual processing ${processed}`, () => {
    const data = fixture(), invoice = data.receivedInvoices[0], mail = data.mailDocuments[0];
    invoice.status = "SCHEDULED";
    invoice.mailProcessed = processed; mail.mailProcessed = processed;
    recordPayment(data, admin, "JAPAN", { kind: "received", invoiceId: invoice.id, amount: 8000, paymentDate: today }, today);
    assert.equal(invoice.status, "PAID");
    assert.equal(invoice.mailProcessed, processed); assert.equal(mail.mailProcessed, processed); assert.equal(mail.updatedAt, timestamp);
    const payment = data.payments[0];
    adjustPayment(data, admin, "JAPAN", { paymentId: payment.id, updatedAt: payment.updatedAt, amount: 4000, paymentDate: today, reason: "合成検証" }, today);
    assert.equal(invoice.status, "SCHEDULED");
    assert.equal(invoice.mailProcessed, processed); assert.equal(mail.mailProcessed, processed);
    cancelPayment(data, admin, "JAPAN", { paymentId: payment.id, updatedAt: payment.updatedAt, reason: "合成検証" });
    assert.equal(invoice.mailProcessed, processed); assert.equal(mail.mailProcessed, processed); assert.equal(mail.updatedAt, timestamp);
  });

  test(`link, unlink and invoice deletion preserve manual processing ${processed}`, () => {
    const data = fixture(), invoice = data.receivedInvoices[0], mail = data.mailDocuments[0];
    invoice.mailProcessed = processed; mail.mailProcessed = processed;
    unlinkMailDocument(data, admin, "JAPAN", { mailDocumentId: mail.id });
    assert.equal(mail.mailProcessed, processed);
    linkMailDocumentToReceivedInvoice(data, admin, "JAPAN", { mailDocumentId: mail.id, receivedInvoiceId: invoice.id });
    assert.equal(mail.mailProcessed, processed); assert.equal(invoice.mailProcessed, processed);
    assert.equal(unlinkMailDocumentsForInvoice(data, invoice.id), 1);
    assert.equal(mail.mailProcessed, processed); assert.equal(invoice.mailProcessed, processed);
  });
}

test("legacy missing processing flags are unprocessed in dashboard and mail staff documents even when paid", () => {
  const data = fixture();
  data.receivedInvoices[0].mailProcessed = undefined;
  data.mailDocuments = [];
  assert.equal(dashboardSummary(data, admin, "JAPAN", today).pendingMail, 1);
  const row = documentRows(data, { ...admin, role: "MAIL_EDITOR" }, "JAPAN").find((item) => item.sourceId === "received-1")!;
  assert.equal(row.status, "UNPROCESSED");
  assert.equal(data.receivedInvoices[0].mailProcessed, undefined);
});

test("manual processing changes the chosen mail and its invoice, preserving payments, siblings and financial fields", () => {
  const data = fixture(), invoice = data.receivedInvoices[0], mail = data.mailDocuments[0];
  data.mailDocuments.push({ ...mail, id: "sibling" });
  invoice.paidAt = today;
  const before = structuredClone(data);
  const edit = { mailDocumentId: mail.id, receivedInvoiceId: invoice.id, mailUpdatedAt: mail.updatedAt, invoiceUpdatedAt: invoice.updatedAt, processingStatus: "unprocessed" };
  assert.deepEqual(applyMailSorterEdits(data, { ...admin, role: "MAIL_EDITOR" }, "JAPAN", [edit]), { updated: 2 });
  assert.equal(mail.mailProcessed, false); assert.equal(invoice.mailProcessed, false);
  assert.ok(mail.updatedAt > timestamp); assert.ok(invoice.updatedAt > timestamp);
  const expected = structuredClone(before);
  Object.assign(expected.mailDocuments[0], { mailProcessed: false, updatedAt: mail.updatedAt });
  Object.assign(expected.receivedInvoices[0], { mailProcessed: false, updatedAt: invoice.updatedAt });
  assert.deepEqual(data, expected);
  assert.deepEqual(applyMailSorterEdits(data, admin, "JAPAN", [{ ...edit, mailUpdatedAt: mail.updatedAt, invoiceUpdatedAt: invoice.updatedAt }]), { updated: 0 });
  assert.deepEqual(data, expected);
});

test("unlinked mail and standalone invoices can be manually processed without changing payment state", () => {
  const data = fixture(), mail = data.mailDocuments[0], invoice = data.receivedInvoices[0];
  mail.relatedReceivedInvoiceId = undefined; mail.mailProcessed = false;
  invoice.mailProcessed = false; invoice.status = "SCHEDULED";
  applyMailSorterEdits(data, admin, "JAPAN", [{ mailDocumentId: mail.id, processingStatus: "processed" }, { receivedInvoiceId: invoice.id, processingStatus: "processed" }]);
  assert.equal(mail.mailProcessed, true); assert.equal(invoice.mailProcessed, true);
  assert.equal(invoice.status, "SCHEDULED"); assert.equal(data.payments.length, 0);
  assert.equal(dashboardSummary(data, admin, "JAPAN", today).pendingMail, 0);
});

test("category-only saves preserve processing and invoice timestamps", () => {
  const data = fixture(), before = structuredClone(data.receivedInvoices);
  applyMailSorterEdits(data, admin, "JAPAN", [{ mailDocumentId: "mail-1", category: "NOTICE" }]);
  assert.equal(data.mailDocuments[0].category, "NOTICE"); assert.equal(data.mailDocuments[0].mailProcessed, true);
  assert.deepEqual(data.receivedInvoices, before);
});

for (const edit of [
  { mailDocumentId: "missing", processingStatus: "unprocessed" },
  { mailDocumentId: "mail-1", mailUpdatedAt: "stale", processingStatus: "unprocessed" },
  { mailDocumentId: "mail-1", invoiceUpdatedAt: "stale", processingStatus: "unprocessed" },
  { mailDocumentId: "mail-1", receivedInvoiceId: "wrong-link", processingStatus: "unprocessed" },
  { mailDocumentId: "mail-1", processingStatus: "invalid" },
  { receivedInvoiceId: "received-1", category: "NOTICE" },
  { mailDocumentId: "mail-1", processingStatus: "processed" },
]) {
  test(`invalid or conflicting batch is atomic: ${JSON.stringify(edit)}`, () => {
    const data = fixture(), before = structuredClone(data);
    assert.throws(() => applyMailSorterEdits(data, admin, "JAPAN", [{ mailDocumentId: "mail-1", processingStatus: "unprocessed" }, edit]));
    assert.deepEqual(data, before);
  });
}

test("manual processing rejects unauthorized, cross-company and deleted targets without mutation", () => {
  const data = fixture();
  data.mailDocuments.push({ ...data.mailDocuments[0], id: "china-mail", company: "CHINA" }, { ...data.mailDocuments[0], id: "deleted-mail", deletedAt: timestamp });
  data.receivedInvoices.push({ ...data.receivedInvoices[0], id: "china-invoice", projectId: "china" }, { ...data.receivedInvoices[0], id: "deleted-invoice", deletedAt: timestamp });
  const before = structuredClone(data);
  assert.throws(() => applyMailSorterEdits(data, { ...admin, role: "GUEST" }, "JAPAN", [{ mailDocumentId: "mail-1", processingStatus: "processed" }]), /権限/);
  assert.throws(() => applyMailSorterEdits(data, admin, "CHINA", [{ mailDocumentId: "china-mail", processingStatus: "processed" }]), /日本/);
  for (const id of ["china-mail", "deleted-mail"]) assert.throws(() => applyMailSorterEdits(data, admin, "JAPAN", [{ mailDocumentId: id, processingStatus: "processed" }]), /見つかりません/);
  for (const id of ["china-invoice", "deleted-invoice"]) assert.throws(() => applyMailSorterEdits(data, admin, "JAPAN", [{ receivedInvoiceId: id, processingStatus: "processed" }]), /見つかりません/);
  assert.deepEqual(data, before);
});

test("dashboard deduplicates linked documents but does not infer completion from linking or payment", () => {
  const data = fixture();
  data.mailDocuments.push({ ...data.mailDocuments[0], id: "sibling", mailProcessed: false });
  assert.equal(dashboardSummary(data, admin, "JAPAN", today).pendingMail, 1);
  data.mailDocuments[0].mailProcessed = false;
  assert.equal(dashboardSummary(data, admin, "JAPAN", today).pendingMail, 1);
  data.mailDocuments.forEach((mail) => { mail.mailProcessed = true; });
  assert.equal(dashboardSummary(data, admin, "JAPAN", today).pendingMail, 0);
});
