import assert from "node:assert/strict";
import test from "node:test";
import { documentSubjectSchema, withDocumentSubject } from "../src/lib/document-subject";
import { applyIssuedInvoiceEdits, type IssuedEdit } from "../src/lib/issued-invoice-edits";
import { saveEstimate, convertEstimate } from "../src/lib/estimates";
import { documentRows } from "../src/lib/documents";
import { pdfTextDefaults, resolvePdfText } from "../src/lib/pdf-document-text";
import { fixture, admin } from "./document-fixture";

test("subject reuses PDF text, preserves other overrides and can reset to project wording", () => {
  const text = { subject: "Previous", issuerName: "Custom issuer" };
  assert.equal(withDocumentSubject(text, undefined), text);
  assert.deepEqual(withDocumentSubject(text, "  New subject  "), { ...text, subject: "New subject" });
  assert.deepEqual(withDocumentSubject(text, " "), { issuerName: "Custom issuer" });
  assert.equal(text.subject, "Previous");
  assert.throws(() => documentSubjectSchema.parse("x".repeat(501)));
});

test("invoice subject persists to list and PDF without changing project, amount or original", () => {
  const data = fixture(), invoice = data.issuedInvoices[0], before = structuredClone(invoice);
  invoice.pdfText = { recipient: "Custom recipient" };
  const edit: IssuedEdit = { id: invoice.id, updatedAt: invoice.updatedAt, invoiceNumber: invoice.invoiceNumber,
    projectId: invoice.projectId, issueDate: invoice.issueDate, dueDate: invoice.dueDate, total: invoice.total,
    status: invoice.status, needsReview: true, subject: "店舗改装 第2期" };
  applyIssuedInvoiceEdits(data, admin, "JAPAN", [edit]);
  const saved = data.issuedInvoices[0];
  assert.equal(saved.pdfText?.subject, edit.subject);
  assert.equal(saved.pdfText?.recipient, "Custom recipient");
  assert.equal(saved.projectId, before.projectId);
  assert.equal(saved.total, before.total);
  assert.equal(saved.fileUrl, before.fileUrl);
  assert.equal(documentRows(data, admin, "JAPAN").find((row) => row.sourceId === saved.id)?.subject, edit.subject);
  assert.equal(resolvePdfText(saved.pdfText, pdfTextDefaults(saved, data, "invoice")).subject, edit.subject);
  assert.throws(() => applyIssuedInvoiceEdits(data, admin, "JAPAN", [edit]), /更新/);
  applyIssuedInvoiceEdits(data, admin, "JAPAN", [{ ...edit, updatedAt: saved.updatedAt, subject: "" }]);
  const reset = data.issuedInvoices[0];
  assert.equal(resolvePdfText(reset.pdfText, pdfTextDefaults(reset, data, "invoice")).subject, "Japan project");
});

test("estimate create, edit and conversion retain subject without copying estimate-only labels", () => {
  const data = fixture();
  const input = { projectId: "japan", clientId: "client", issueDate: "2026-11-11", validUntil: "2026-12-11",
    status: "DRAFT" as const, subject: "設計費用", items: [{ description: "Design", quantity: 1, unitPrice: 1000, taxRate: 10 as const }] };
  const estimate = saveEstimate(data, admin, "JAPAN", input);
  estimate.pdfText = { ...estimate.pdfText, title: "見積書", recipient: "Custom recipient" };
  const edited = saveEstimate(data, admin, "JAPAN", { ...input, id: estimate.id, updatedAt: estimate.updatedAt, subject: "設計費用 改訂版" });
  assert.equal(edited.pdfText?.recipient, "Custom recipient");
  assert.equal(documentRows(data, admin, "JAPAN").find((row) => row.sourceId === edited.id)?.subject, "設計費用 改訂版");
  const invoice = convertEstimate(data, admin, "JAPAN", { id: edited.id, updatedAt: edited.updatedAt,
    issueDate: "2026-11-11", transactionDate: "2026-11-11", dueDate: "2026-12-11" });
  const text = resolvePdfText(invoice.pdfText, pdfTextDefaults(invoice, data, "invoice"));
  assert.equal(text.subject, "設計費用 改訂版");
  assert.equal(text.title, "請求書");
  assert.equal(invoice.total, edited.total);
});
