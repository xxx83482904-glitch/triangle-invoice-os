import test from "node:test";
import assert from "node:assert/strict";
import { documentRows, isBillableIssuedInvoice } from "../src/lib/documents";
import { inferIssuedInvoice } from "../src/lib/ocr";
import PDFDocument from "pdfkit";
import { applyIssuedInvoiceEdits, type IssuedEdit } from "../src/lib/issued-invoice-edits";
import { projectMoney } from "../src/lib/store";
import { fixture, admin, manager } from "./document-fixture";

function edit(data = fixture()): IssuedEdit {
  const i = data.issuedInvoices[0];
  return { id: i.id, updatedAt: i.updatedAt, invoiceNumber: i.invoiceNumber, projectId: i.projectId, issueDate: i.issueDate, dueDate: i.dueDate, total: i.total, status: "ISSUED", needsReview: false };
}
test("canonical list deduplicates linked mail and receipt, keeps older contracts", () => {
  const rows = documentRows(fixture(), admin, "JAPAN");
  assert.equal(rows.filter((r) => r.fileUrl === "/api/files/received.pdf").length, 1);
  assert.equal(rows.find((r) => r.kind === "received")?.month, "2026-08");
  assert.equal(rows.find((r) => r.kind === "received")?.category, "RECEIPT");
  assert.ok(rows.some((r) => r.id === "attachment:old-contract"));
  assert.ok(!rows.some((r) => r.sourceId === "issued-cn"));
});
test("staff see only assigned permitted documents, mail staff see no issued totals", () => {
  assert.deepEqual(documentRows(fixture(), manager, "JAPAN").map((r) => r.id).sort(), ["attachment:old-contract", "contract:japan", "issued:issued-1"]);
  const rows = documentRows(fixture(), { id: "mail", role: "MAIL_EDITOR" }, "JAPAN");
  assert.deepEqual(rows.map((r) => r.kind), ["mail"]);
  assert.equal(rows[0].total, undefined);
  assert.deepEqual(documentRows(fixture(), { id: "mail", role: "MAIL_EDITOR" }, "CHINA"), []);
});
test("direct Japan receipt remains accessible to mail staff", () => {
  const data = fixture(); data.mailDocuments = [];
  const rows = documentRows(data, { id: "mail", role: "MAIL_EDITOR" }, "JAPAN");
  assert.equal(rows[0].sourceId, "received-1"); assert.equal(rows[0].state, "done"); assert.equal(rows[0].total, undefined);
});
test("deleted documents and their orphan attachments stay out of list", () => {
  const data = fixture(); data.projects[0].deletedAt = "2026-09-15"; data.mailDocuments[0].deletedAt = "2026-09-15";
  assert.deepEqual(documentRows(data, admin, "JAPAN").map((r) => r.sourceId), ["issued-2"]);
});
test("additional files on linked mail remain listed under the canonical receipt", () => {
  const data = fixture(); data.attachments.push({ ...data.attachments[0], id: "extra", fileUrl: "/api/files/extra.pdf" });
  assert.ok(documentRows(data, admin, "JAPAN").some((r) => r.id === "attachment:extra"));
});
test("OCR drafts and canceled invoices are excluded from financial totals", () => {
  const data = fixture();
  assert.equal(projectMoney(data, "japan").invoicedAmount, 0);
  applyIssuedInvoiceEdits(data, manager, "JAPAN", [edit(data)]);
  assert.equal(projectMoney(data, "japan").invoicedAmount, 12000);
  data.issuedInvoices[0].status = "CANCELED";
  assert.equal(isBillableIssuedInvoice(data.issuedInvoices[0]), false);
});
test("edits reject stale versions, inaccessible projects, missing review and bad dates", () => {
  assert.throws(() => applyIssuedInvoiceEdits(fixture(), manager, "JAPAN", [{ ...edit(), updatedAt: "stale" }]));
  assert.throws(() => applyIssuedInvoiceEdits(fixture(), manager, "JAPAN", [{ ...edit(), projectId: "other" }]));
  assert.throws(() => applyIssuedInvoiceEdits(fixture(), manager, "JAPAN", [{ ...edit(), needsReview: true }]));
  assert.throws(() => applyIssuedInvoiceEdits(fixture(), manager, "JAPAN", [{ ...edit(), issueDate: "2026-02-30" }]));
  assert.throws(() => applyIssuedInvoiceEdits(fixture(), manager, "JAPAN", [{ ...edit(), dueDate: "2026-01-01" }]));
});
test("paid status requires payment records and invoice numbers remain unique", () => {
  assert.throws(() => applyIssuedInvoiceEdits(fixture(), admin, "JAPAN", [{ ...edit(), status: "PAID" }]));
  assert.throws(() => applyIssuedInvoiceEdits(fixture(), admin, "JAPAN", [{ ...edit(), status: "PARTIALLY_PAID" }]));
  assert.throws(() => applyIssuedInvoiceEdits(fixture(), admin, "JAPAN", [{ ...edit(), invoiceNumber: "INV-002" }]));
});
test("outgoing OCR extracts adjacent dates separately without inventing tax or fields", () => {
  const result = inferIssuedInvoice({ text: "Invoice Number: TEST-0001\nInvoice date: 2026-09-15 Due date: 2026-10-15\nTotal amount: 12,000", warnings: [], engine: "test" });
  assert.equal(result.invoiceNumber, "TEST-0001"); assert.equal(result.issueDate, "2026-09-15"); assert.equal(result.dueDate, "2026-10-15"); assert.equal(result.total, 12000);
  const missing = inferIssuedInvoice({ text: "Bank account 1234567890", warnings: [], engine: "test" });
  assert.equal(missing.invoiceNumber, ""); assert.equal(missing.issueDate, ""); assert.equal(missing.total, 0); assert.ok(missing.warnings.length >= 4);
});
test("outgoing OCR supports Japanese and rejects impossible dates", () => {
  const result = inferIssuedInvoice({ text: "請求書番号：JP-001 発行日：2026年9月15日 支払期限：2026年10月15日 合計金額：12,000円", warnings: [], engine: "test" });
  assert.equal(result.invoiceNumber, "JP-001"); assert.equal(result.issueDate, "2026-09-15"); assert.equal(result.total, 12000);
  assert.equal(inferIssuedInvoice({ text: "発行日：2026年2月30日", warnings: [], engine: "test" }).issueDate, "");
});
test("installed PDF parser reads an actual PDF file", async () => {
  // Use only the local fallback: no real documents or provider credentials.
  const buffer = await new Promise<Buffer>((resolve) => {
    const pdf = new PDFDocument(); const chunks: Buffer[] = [];
    pdf.on("data", (chunk) => chunks.push(Buffer.from(chunk))); pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.text("Invoice Number: PDF-001\nInvoice date: 2026-09-15\nDue date: 2026-10-15\nTotal amount: 12000"); pdf.end();
  });
  const { extractLocalDocumentText } = await import("../src/lib/ocr");
  const extracted = await extractLocalDocumentText("test.pdf", "application/pdf", buffer);
  assert.equal(extracted.engine, "pdf-text");
  assert.equal(inferIssuedInvoice(extracted).invoiceNumber, "PDF-001");
  assert.equal(inferIssuedInvoice(extracted).total, 12000);
});
