import assert from "node:assert/strict";
import test from "node:test";
import { bankReconciliationOverview } from "../src/lib/bank-reconciliation";
import { bankDocumentReview } from "../src/lib/bank-review";
import { filterIntegrityReport, integrityReport, summarizeIntegrity } from "../src/lib/integrity";
import { paymentStateMismatchFixture } from "./payment-state-mismatch-fixture";

const today = "2026-11-01";
for (const id of ["paid-unprocessed", "scheduled-processed"]) {
  test(`${id}: correct payment state is not a mismatch; mail difference is informational`, () => {
    const data = paymentStateMismatchFixture(), before = JSON.stringify(data);
    const overview = bankReconciliationOverview(data, "JAPAN", today);
    assert.equal(overview.invoices.find((row) => row.id === id)!.stateMismatch, false);
    const report = integrityReport(data, "JAPAN", { today, overview });
    assert.equal(report.issues.some((row) => row.kind === "payment_mismatch" && row.target.id === id), false);
    const issue = report.issues.find((row) => row.kind === "mail_processing_mismatch" && row.target.id === id);
    assert.ok(issue);
    assert.equal(issue.severity, "INFO");
    assert.match(issue.detail, /支払記録/);
    assert.match(issue.action, /一致させる必要はありません/);
    assert.equal(bankDocumentReview(data, "JAPAN", overview).items.some((row) => row.id === `state:received:${id}`), false);
    assert.equal(JSON.stringify(data), before);
  });
}

test("mail-only differences and invoice-only processing differences are both reported once", () => {
  const data = paymentStateMismatchFixture();
  data.receivedInvoices[0].mailProcessed = true; // only linked mail differs
  data.mailDocuments[1].mailProcessed = false; // only invoice's processing flag differs
  const report = integrityReport(data, "JAPAN", { today });
  assert.equal(report.counts.payment_mismatch, 0);
  assert.equal(report.counts.mail_processing_mismatch, 2);
  const view = filterIntegrityReport(report, "mail_processing_mismatch");
  assert.equal(view.filteredTotal, 2);
  assert.ok(view.items.every((row) => row.severity === "INFO"));
  assert.equal(summarizeIntegrity(report).kinds.find((row) => row.kind === "mail_processing_mismatch")!.count, 2);
});

test("matching mail states have no informational difference; deleted and other-company mail is ignored", () => {
  const data = paymentStateMismatchFixture();
  for (const row of data.receivedInvoices) row.mailProcessed = row.status === "PAID";
  for (const row of data.mailDocuments) row.mailProcessed = row.relatedReceivedInvoiceId === "paid-unprocessed";
  data.mailDocuments.push({ ...data.mailDocuments[0], id: "deleted", mailProcessed: false, deletedAt: today }, { ...data.mailDocuments[0], id: "other-company", company: "CHINA", mailProcessed: false });
  const report = integrityReport(data, "JAPAN", { today });
  assert.equal(report.counts.mail_processing_mismatch, 0);
  assert.equal(report.counts.payment_mismatch, 0);
  assert.equal(integrityReport(data, "CHINA", { today }).counts.mail_processing_mismatch, 0);
});

test("actual unpaid PAID status, paid SCHEDULED status and overpayment still surface", () => {
  const data = paymentStateMismatchFixture();
  data.receivedInvoices[0].status = "SCHEDULED";
  data.receivedInvoices[1].status = "PAID";
  let report = integrityReport(data, "JAPAN", { today });
  assert.equal(report.counts.payment_mismatch, 2);
  assert.ok(report.issues.filter((row) => row.kind === "payment_mismatch").every((row) => row.severity === "WARNING"));
  data.receivedInvoices[0].status = "PAID";
  data.payments[0].amount++;
  report = integrityReport(data, "JAPAN", { today });
  assert.equal(report.issues.find((row) => row.kind === "payment_mismatch" && row.target.id === "paid-unprocessed")!.severity, "ERROR");
});

test("ineligible and archived documents remain outside both checks", () => {
  const data = paymentStateMismatchFixture();
  data.receivedInvoices[0].status = "ARCHIVED";
  data.receivedInvoices[1].status = "REJECTED";
  const report = integrityReport(data, "JAPAN", { today });
  assert.equal(report.counts.payment_mismatch, 0);
  assert.equal(report.counts.mail_processing_mismatch, 0);
});
