import test from "node:test";
import assert from "node:assert/strict";
import { documentRows, isBillableIssuedInvoice } from "../src/lib/documents";
import { inferIssuedInvoice } from "../src/lib/ocr";
import PDFDocument from "pdfkit";
import { applyIssuedInvoiceEdits, type IssuedEdit } from "../src/lib/issued-invoice-edits";
import { projectMoney } from "../src/lib/store";
import { fixture, admin, manager } from "./document-fixture";
import { resolveIssuedImportProject } from "../src/lib/issued-import-project";
import { can, canAccessCompany, canEditOptionGroup, companyForUser, defaultPathForRole } from "../src/lib/rbac";

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

const hints = (projectName = "", clientName = "Test customer", text = "") => ({ projectName, clientName, text, fileName: "test-invoice.pdf" });

test("issued OCR extracts project and recipient labels without an AI key", () => {
  for (const text of ["Project name: New shop\nBill to: Example customer", "案件名：New shop\n請求先：Example customer", "项目名称：New shop\n购买方名称：Example customer"]) {
    const result = inferIssuedInvoice({ text, engine: "test", warnings: [] });
    assert.equal(result.projectName, "New shop"); assert.equal(result.clientName, "Example customer");
  }
  assert.equal(inferIssuedInvoice({ text: "株式会社テスト 御中\n請求書", engine: "test", warnings: [] }).clientName, "株式会社テスト");
  const missing = inferIssuedInvoice({ text: "Invoice number: ONE", engine: "test", warnings: [] });
  assert.equal(missing.clientName, ""); assert.equal(missing.projectName, "");
});

test("automatic project resolution matches names and respects manual override", () => {
  const data = fixture();
  assert.equal(resolveIssuedImportProject(data, manager, "JAPAN", "", hints("Ｊａｐａｎ project")).project.id, "japan");
  assert.equal(resolveIssuedImportProject(data, manager, "JAPAN", "", hints("", "", "Invoice\nJapan project\nTotal 12000")).project.id, "japan");
  assert.equal(resolveIssuedImportProject(data, manager, "JAPAN", "japan", hints("Another shop")).projectMatch, "manual");
  assert.equal(data.projects.length, 3); assert.equal(data.clients.length, 1);
});

test("client alone resolves only a unique active project, never an arbitrary visible candidate", () => {
  const data = fixture(); data.projects = [data.projects[0]];
  assert.equal(resolveIssuedImportProject(data, manager, "JAPAN", "", hints()).project.id, "japan");
  const ambiguous = resolveIssuedImportProject(fixture(), manager, "JAPAN", "", hints());
  assert.equal(ambiguous.projectCreated, true); assert.notEqual(ambiguous.project.id, "japan");
});

test("new explicit project names create separate projects for an existing client and then reuse them", () => {
  const data = fixture(); data.projects = [data.projects[0]];
  const first = resolveIssuedImportProject(data, manager, "JAPAN", "", hints("New shop"));
  assert.equal(first.projectCreated, true); assert.equal(first.project.clientId, "client");
  assert.equal(first.project.contractAmount, 0); assert.equal(first.project.managerId, manager.id);
  assert.deepEqual(first.project.memberIds, [manager.id]);
  const second = resolveIssuedImportProject(data, manager, "JAPAN", "", hints("New shop"));
  assert.equal(second.projectCreated, false); assert.equal(first.project.id, second.project.id);
  assert.equal(data.projects.length, 2); assert.equal(data.clients.length, 1);
});

test("unknown recipients create company-scoped clients and projects without changing existing data", () => {
  const data = fixture(); const before = structuredClone(data.projects);
  const result = resolveIssuedImportProject(data, manager, "JAPAN", "", hints("New shop", "New customer 御中"));
  assert.equal(result.projectCreated, true);
  const client = data.clients.find((c) => c.id === result.project.clientId)!;
  assert.equal(client.companyName, "New customer"); assert.equal(client.company, "JAPAN");
  assert.deepEqual(data.projects.slice(1), before);
});

test("automatic matching never exposes or attaches other companies or unassigned projects", () => {
  const data = fixture();
  const result = resolveIssuedImportProject(data, manager, "JAPAN", "", hints("Other project"));
  assert.notEqual(result.project.id, "other"); assert.equal(result.project.managerId, manager.id);
  const china = resolveIssuedImportProject(data, manager, "CHINA", "", hints("Japan project"));
  assert.equal(china.project.company, "CHINA"); assert.notEqual(china.project.clientId, "client");
  assert.throws(() => resolveIssuedImportProject(fixture(), manager, "JAPAN", "other", hints()));
  assert.throws(() => resolveIssuedImportProject(fixture(), manager, "JAPAN", "china", hints()));
  assert.throws(() => resolveIssuedImportProject(fixture(), { id: "mail", role: "MAIL_EDITOR" }, "JAPAN", "", hints()));
});

test("ambiguous names and conflicting recipients do not select a wrong existing project", () => {
  const data = fixture(); data.projects[1].name = "Japan project";
  assert.equal(resolveIssuedImportProject(data, admin, "JAPAN", "", hints("Japan project")).projectCreated, true);
  assert.equal(resolveIssuedImportProject(fixture(), admin, "JAPAN", "", hints("Japan project", "Different customer")).projectCreated, true);
  const deleted = fixture(); deleted.projects[0].deletedAt = "2026-09-15";
  assert.equal(resolveIssuedImportProject(deleted, manager, "JAPAN", "", hints("Japan project")).projectCreated, true);
});

test("unreadable documents stay provisional and unrelated files are not merged", () => {
  const data = fixture();
  const one = resolveIssuedImportProject(data, manager, "JAPAN", "", hints("", ""));
  const two = resolveIssuedImportProject(data, manager, "JAPAN", "", hints("", ""));
  assert.match(one.project.name, /要確認/); assert.notEqual(one.project.id, two.project.id);
  assert.equal(data.clients.find((c) => c.id === one.project.clientId)?.companyName, "請求先未確認");
  assert.equal(one.project.clientId, two.project.clientId);
});

const billing = { id: "billing", role: "BILLING_EDITOR" as const };
test("Japan billing staff see all Japan issued invoices, not receipts, contracts, or China", () => {
  assert.deepEqual(documentRows(fixture(), billing, "JAPAN").map((r) => r.id).sort(), ["issued:issued-1", "issued:issued-2"]);
  assert.deepEqual(documentRows(fixture(), billing, "CHINA"), []);
  assert.equal(companyForUser(billing, "CHINA"), "JAPAN");
  assert.equal(defaultPathForRole(billing.role), "/issued-invoices");
  for (const permission of ["view:documents", "view:projects", "view:dashboard", "view:payments", "view:reports", "view:mailSorter", "view:receivedInvoices", "manage:users", "manage:vendors", "manage:projects", "view:all", "export:csv"]) assert.equal(can(billing, permission), false, permission);
  assert.ok(can(billing, "manage:issuedInvoices")); assert.ok(can(billing, "manage:clients"));
});
test("billing staff can import and edit Japan invoices but cannot cross company boundaries", () => {
  const data = fixture();
  applyIssuedInvoiceEdits(data, billing, "JAPAN", [edit(data)]);
  assert.equal(data.issuedInvoices[0].needsReview, false);
  assert.throws(() => applyIssuedInvoiceEdits(fixture(), billing, "CHINA", [edit()]));
  assert.throws(() => applyIssuedInvoiceEdits(fixture(), billing, "JAPAN", [{ ...edit(), projectId: "china" }]));
  const result = resolveIssuedImportProject(data, billing, "JAPAN", "", hints("Billing shop"));
  assert.equal(result.projectCreated, true); assert.equal(result.project.company, "JAPAN");
  assert.throws(() => resolveIssuedImportProject(data, billing, "CHINA", "", hints("Forbidden")));
  assert.throws(() => resolveIssuedImportProject(data, billing, "JAPAN", "china", hints()));
});
test("billing settings are limited to Japan invoice status and tax options", () => {
  assert.equal(canAccessCompany(billing, "CHINA"), false);
  assert.equal(canEditOptionGroup(billing, "PROJECT_STAGE"), false);
  assert.equal(canEditOptionGroup(billing, "RECEIVED_INVOICE_STATUS"), false);
  assert.equal(canEditOptionGroup(billing, "ISSUED_INVOICE_STATUS"), true);
  assert.equal(canEditOptionGroup(billing, "TAX_RATE"), true);
  assert.equal(canAccessCompany(admin, "CHINA"), true);
});
