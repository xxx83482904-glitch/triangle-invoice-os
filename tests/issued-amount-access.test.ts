import assert from "node:assert/strict";
import test from "node:test";
import { canSeeIssuedAmounts, estimateForViewer, issuedInvoiceForViewer } from "../src/lib/issued-amount-access";
import { canViewDocumentFile } from "../src/lib/document-file-access";
import { documentOcrText, documentRows } from "../src/lib/documents";
import { convertEstimate, deleteEstimates, saveEstimate, saveEstimateListEdits, updateEstimateStatus } from "../src/lib/estimates";
import { estimateListEditFrom } from "../src/lib/estimate-values";
import { applyEstimatePdfEdits, applyIssuedInvoicePdfEdits } from "../src/lib/invoice-pdf-layout-store";
import { applyIssuedInvoiceDeletion } from "../src/lib/issued-invoice-delete";
import { applyIssuedInvoiceEdits } from "../src/lib/issued-invoice-edits";
import { listAgentResource } from "../src/lib/agent-api";
import { effectiveFeatures, memberFeatures, roleHasFeature } from "../src/lib/member-features";
import { sectionExport } from "../src/lib/section-export";
import type { ApiToken, AppData, User, UserRole } from "../src/lib/types";
import { admin, fixture, timestamp } from "./document-fixture";

// Synthetic people only. issued-1 (Japan project) and the estimates below are made by "admin" unless a test says otherwise.
const billing = { id: "billing", role: "BILLING_EDITOR" as const };
const accounting = { id: "accounting", role: "ACCOUNTING" as const };
const manager = { id: "manager", role: "PROJECT_MANAGER" as const };
const hidden = /管理者と作成した人だけが変更できます/;
const roles: UserRole[] = ["ADMIN", "ACCOUNTING", "CHIEF_DESIGNER", "PROJECT_MANAGER", "MAIL_EDITOR", "BILLING_EDITOR", "DESIGNER", "GUEST"];
const issuedEdit = (data: AppData, id = "issued-1") => {
  const invoice = data.issuedInvoices.find((i) => i.id === id)!;
  return { id, updatedAt: invoice.updatedAt, invoiceNumber: invoice.invoiceNumber, projectId: invoice.projectId, issueDate: invoice.issueDate, dueDate: invoice.dueDate, total: invoice.total, status: invoice.status, needsReview: false };
};
const estimateInput = { projectId: "japan", clientId: "client", issueDate: "2026-09-15", validUntil: "2026-10-15", status: "SENT" as const,
  items: [{ description: "Synthetic work", quantity: 1, unitPrice: 4321987, taxRate: 10 as const }] };
const dates = { issueDate: "2026-09-20", dueDate: "2026-10-20", transactionDate: "2026-09-20" };
const unchanged = (data: AppData, run: () => unknown) => {
  const before = JSON.stringify(data);
  assert.throws(run, hidden);
  assert.equal(JSON.stringify(data), before);
};

test("only administrators, the creator and members switched on see the amounts", () => {
  const record = { createdById: "another-admin" };
  assert.equal(canSeeIssuedAmounts(admin, record), true);
  for (const person of [billing, accounting, manager]) {
    assert.equal(canSeeIssuedAmounts(person, record), false, person.role);
    assert.equal(canSeeIssuedAmounts(person, { createdById: person.id }), true, `${person.role} own`);
    assert.equal(canSeeIssuedAmounts({ ...person, featureAccess: { issuedInvoiceAmounts: true } }, record), true, `${person.role} switched on`);
  }
  assert.equal(canSeeIssuedAmounts({ ...admin, featureAccess: { issuedInvoiceAmounts: false } }, record), false);
  assert.equal(canSeeIssuedAmounts({ ...admin, featureAccess: { issuedInvoiceAmounts: false } }, { createdById: "admin" }), true);
  assert.equal(canSeeIssuedAmounts(billing, {}), false);
  assert.equal(canSeeIssuedAmounts(null, record), false);
});

test("請求書の金額 is a switch after 見積書・発行請求書 and is on by default only for administrators", () => {
  const keys = memberFeatures.map(({ key }) => key);
  assert.equal(keys.indexOf("issuedInvoiceAmounts"), keys.indexOf("issuedInvoices") + 1);
  assert.equal(memberFeatures.find(({ key }) => key === "issuedInvoiceAmounts")?.label, "請求書の金額");
  for (const role of roles) {
    assert.equal(roleHasFeature(role, "issuedInvoiceAmounts"), role === "ADMIN", role);
    assert.equal(effectiveFeatures(role).issuedInvoiceAmounts, role === "ADMIN", role);
  }
});

test("document rows of someone else's invoice carry no money, file, OCR or edit right", () => {
  const data = fixture();
  data.issuedInvoices[0].ocrText = "合計 12000";
  data.attachments.push({ id: "issued-extra", relatedType: "IssuedInvoice", relatedId: "issued-1", fileName: "extra.pdf", fileUrl: "/api/files/issued-extra.pdf", mimeType: "application/pdf", uploadedById: "admin", createdAt: timestamp });
  const row = documentRows(data, billing, "JAPAN").find((r) => r.id === "issued:issued-1")!;
  assert.equal(row.amountsHidden, true);
  for (const key of ["total", "paidAmount", "statusPaymentAmount", "fileUrl", "fileName", "mimeType"] as const) assert.equal(row[key], undefined, key);
  assert.equal(row.editable, false);
  assert.equal(row.title, "INV-001");
  assert.equal(documentOcrText(data, row), "");
  const serialized = JSON.stringify(documentRows(data, billing, "JAPAN"));
  for (const leak of ["12000", "issued.pdf", "issued-extra.pdf"]) assert.ok(!serialized.includes(leak), leak);
  // The administrator still gets everything, including the attachment row.
  const adminRows = documentRows(data, admin, "JAPAN");
  assert.equal(adminRows.find((r) => r.id === "issued:issued-1")?.total, 12000);
  assert.ok(adminRows.some((r) => r.id === "attachment:issued-extra"));
  // Own invoice: everything is back.
  data.issuedInvoices[0].createdById = "billing";
  const own = documentRows(data, billing, "JAPAN").find((r) => r.id === "issued:issued-1")!;
  assert.equal(own.total, 12000);
  assert.equal(own.fileUrl, "/api/files/issued.pdf");
  assert.equal(own.amountsHidden, undefined);
  assert.equal(own.editable, true);
});

test("estimate rows and estimate views follow the same rule", () => {
  const data = fixture();
  const estimate = saveEstimate(data, admin, "JAPAN", estimateInput);
  const row = documentRows(data, billing, "JAPAN").find((r) => r.id === `estimate:${estimate.id}`)!;
  assert.equal(row.amountsHidden, true);
  assert.equal(row.total, undefined);
  assert.equal(row.fileUrl, undefined);
  const view = estimateForViewer(billing, estimate);
  assert.equal(view.amountsHidden, true);
  assert.deepEqual(view.items, []);
  assert.ok(!JSON.stringify(view).includes("4321987"));
  assert.ok(!JSON.stringify(documentRows(data, billing, "JAPAN")).includes("4321987"));
  assert.equal(estimateForViewer(admin, estimate), estimate);
});

test("originals and invoice attachments are refused, even when another record shares the file", () => {
  const data = fixture();
  data.attachments.push({ id: "issued-extra", relatedType: "IssuedInvoice", relatedId: "issued-1", fileName: "extra.pdf", fileUrl: "/api/files/issued-extra.pdf", mimeType: "application/pdf", uploadedById: "admin", createdAt: timestamp });
  data.mailDocuments.push({ ...data.mailDocuments[0], id: "mail-shared", fileUrl: "/api/files/issued.pdf", relatedReceivedInvoiceId: undefined });
  for (const name of ["issued.pdf", "issued-extra.pdf"]) {
    assert.equal(canViewDocumentFile(data, billing, name), false, `billing ${name}`);
    assert.equal(canViewDocumentFile(data, accounting, name), false, `accounting ${name}`);
    assert.equal(canViewDocumentFile(data, admin, name), true, `admin ${name}`);
    assert.equal(canViewDocumentFile(data, { ...accounting, featureAccess: { issuedInvoiceAmounts: true } }, name), true, `switched on ${name}`);
  }
  // Unrelated files keep their old rules.
  assert.equal(canViewDocumentFile(data, accounting, "received.pdf"), true);
  data.issuedInvoices[0].createdById = "billing";
  assert.equal(canViewDocumentFile(data, billing, "issued.pdf"), true);
});

test("someone else's invoice cannot be edited, deleted or re-laid out; one's own can", () => {
  const data = fixture();
  unchanged(data, () => applyIssuedInvoiceEdits(data, billing, "JAPAN", [issuedEdit(data)]));
  unchanged(data, () => applyIssuedInvoiceDeletion(data, billing, "JAPAN", [{ id: "issued-1", updatedAt: timestamp }]));
  unchanged(data, () => applyIssuedInvoicePdfEdits(data, billing, "JAPAN", { id: "issued-1", layout: { density: "compact" } }));
  data.issuedInvoices[0].createdById = "billing";
  applyIssuedInvoiceEdits(data, billing, "JAPAN", [{ ...issuedEdit(data), invoiceNumber: "INV-001-B" }]);
  assert.equal(data.issuedInvoices[0].invoiceNumber, "INV-001-B");
  applyIssuedInvoiceDeletion(data, billing, "JAPAN", [{ id: "issued-1", updatedAt: data.issuedInvoices[0].updatedAt }]);
  assert.ok(data.issuedInvoices[0].deletedAt);
});

test("someone else's estimate cannot be changed in any way; one's own can", () => {
  const data = fixture();
  const theirs = saveEstimate(data, admin, "JAPAN", estimateInput);
  unchanged(data, () => saveEstimate(data, billing, "JAPAN", { ...estimateInput, id: theirs.id, updatedAt: theirs.updatedAt }));
  unchanged(data, () => updateEstimateStatus(data, billing, "JAPAN", { id: theirs.id, updatedAt: theirs.updatedAt, status: "ACCEPTED" }));
  unchanged(data, () => saveEstimateListEdits(data, billing, "JAPAN", [{ ...estimateListEditFrom(theirs), status: "ACCEPTED" }]));
  unchanged(data, () => deleteEstimates(data, billing, "JAPAN", [{ id: theirs.id, updatedAt: theirs.updatedAt }]));
  unchanged(data, () => convertEstimate(data, billing, "JAPAN", { id: theirs.id, updatedAt: theirs.updatedAt, ...dates }));
  unchanged(data, () => applyEstimatePdfEdits(data, billing, "JAPAN", { id: theirs.id, layout: { density: "compact" } }));
  const mine = saveEstimate(data, billing, "JAPAN", estimateInput);
  assert.equal(mine.createdById, "billing");
  const invoice = convertEstimate(data, billing, "JAPAN", { id: mine.id, updatedAt: mine.updatedAt, ...dates });
  assert.equal(invoice.createdById, "billing");
  assert.equal(documentRows(data, billing, "JAPAN").find((r) => r.id === `issued:${invoice.id}`)?.total, invoice.total);
});

test("the agent API removes money and files from someone else's invoices", () => {
  const data = fixture();
  data.issuedInvoices[0].ocrText = "合計 12000";
  const token = { id: "token", userId: "accounting", name: "synthetic", tokenHash: "x", prefix: "tri_x", scopes: ["bank:read"] } as unknown as ApiToken;
  const user = { ...accounting, name: "Synthetic accounting", email: "accounting@example.invalid", passwordHash: "x", createdAt: timestamp, updatedAt: timestamp } as User;
  const read = (person: User) => listAgentResource(data, { token, user: person }, "issued-invoices", { company: "JAPAN" }).items as Record<string, unknown>[];
  const [row] = read(user);
  assert.equal(row.total, null);
  assert.equal(row.subtotal, null);
  assert.equal(row.fileUrl, undefined);
  assert.equal(row.ocrText, undefined);
  assert.equal(row.amountsHidden, true);
  assert.equal(row.invoiceNumber, "INV-001");
  assert.ok(!JSON.stringify(read(user)).includes("12000"));
  assert.equal(read({ ...user, featureAccess: { issuedInvoiceAmounts: true } })[0].total, 12000);
  assert.equal(issuedInvoiceForViewer(admin, data.issuedInvoices[0]), data.issuedInvoices[0]);
});

test("section exports keep the row but neither the amount nor a PDF of someone else's invoice", () => {
  const data = fixture();
  const exporter = { ...billing };
  const result = sectionExport(data, exporter, { company: "JAPAN", scope: "issued", start: "2026-09-01", end: "2026-09-30", basis: "document", undated: "1" });
  const row = result.documents.find((r) => r.id === "issued:issued-1")!;
  assert.equal(row.total, undefined);
  assert.equal(row.fileUrl, undefined);
  assert.equal(row.fileType, "原本なし");
  assert.match(row.warning, /金額・PDFは非表示/);
  const own = fixture();
  own.issuedInvoices[0].createdById = "billing";
  assert.equal(sectionExport(own, exporter, { company: "JAPAN", scope: "issued", start: "2026-09-01", end: "2026-09-30", basis: "document", undated: "1" }).documents.find((r) => r.id === "issued:issued-1")?.total, 12000);
});
