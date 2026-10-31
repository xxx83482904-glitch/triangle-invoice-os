import assert from "node:assert/strict";
import test from "node:test";
import { admin, fixture, timestamp } from "./document-fixture";
import { linkMailDocumentToReceivedInvoice, mailIntegrityReport, mailLinkCandidates, resolveMailLink, unlinkMailDocument, unlinkMailDocumentsForInvoice } from "../src/lib/mail-links";

function setup() {
  const data = fixture();
  data.users.push({ id: "admin", name: "Admin", email: "admin@example.invalid", passwordHash: "unused", role: "ADMIN", createdAt: timestamp, updatedAt: timestamp });
  return data;
}

test("a link only counts when the received invoice is live; deleted or moved targets are broken", () => {
  const data = setup(), mail = data.mailDocuments[0];
  assert.equal(resolveMailLink(data, "JAPAN", mail).invoice?.id, "received-1");
  data.receivedInvoices[0].deletedAt = timestamp;
  assert.deepEqual([resolveMailLink(data, "JAPAN", mail).broken, resolveMailLink(data, "JAPAN", mail).targetId], [true, "received-1"]);
  data.receivedInvoices[0].deletedAt = undefined; data.receivedInvoices[0].projectId = "china";
  assert.equal(resolveMailLink(data, "JAPAN", mail).broken, true);
  mail.relatedReceivedInvoiceId = undefined;
  assert.deepEqual(resolveMailLink(data, "JAPAN", mail), { broken: false });
});

test("deleting a received invoice returns its mail documents to unlinked", () => {
  const data = setup();
  data.mailDocuments.push({ ...data.mailDocuments[0], id: "mail-deleted", deletedAt: timestamp });
  assert.equal(unlinkMailDocumentsForInvoice(data, "received-1"), 1);
  const mail = data.mailDocuments[0];
  assert.deepEqual([mail.relatedReceivedInvoiceId, mail.mailProcessed], [undefined, false]);
  assert.ok(mail.updatedAt > timestamp);
  assert.equal(data.mailDocuments[1].relatedReceivedInvoiceId, "received-1");
  assert.equal(unlinkMailDocumentsForInvoice(data, "received-1"), 0);
});

test("candidates rank the same file, the same file name and a matching vendor; unrelated documents are left out", () => {
  const data = setup(), mail = data.mailDocuments[0];
  mail.relatedReceivedInvoiceId = undefined; mail.originalFileName = "oct-invoice.pdf"; mail.title = "テスト制作 請求書"; mail.senderName = "Test supplier";
  data.vendors.push({ ...data.vendors[0], id: "other-vendor", companyName: "Unrelated Co" });
  data.receivedInvoices.push(
    { ...data.receivedInvoices[0], id: "same-file", fileUrl: mail.fileUrl, originalFileName: "x.pdf" },
    { ...data.receivedInvoices[0], id: "same-name", fileUrl: "/api/files/other.pdf", originalFileName: "oct-invoice.pdf", vendorId: "other-vendor" },
    { ...data.receivedInvoices[0], id: "vendor-only", fileUrl: "/api/files/third.pdf", originalFileName: "third.pdf" },
    { ...data.receivedInvoices[0], id: "unrelated", fileUrl: "/api/files/fourth.pdf", originalFileName: "fourth.pdf", vendorId: "other-vendor", folderMonth: "2025-01", issueDate: "2025-01-05" },
    { ...data.receivedInvoices[0], id: "gone", fileUrl: mail.fileUrl, deletedAt: timestamp },
  );
  data.receivedInvoices[0].fileUrl = "/api/files/original.pdf"; data.receivedInvoices[0].originalFileName = "original.pdf";
  const candidates = mailLinkCandidates(data, "JAPAN", mail);
  assert.deepEqual(candidates.map((row) => row.id), ["same-file", "same-name", "received-1", "vendor-only"]);
  assert.ok(candidates[0].reasons.includes("同じ原本ファイル")); assert.ok(candidates[1].reasons.includes("同じファイル名"));
  assert.ok(candidates.every((row) => row.id !== "unrelated" && row.id !== "gone"));
});

test("re-linking validates permission, company, target, current link and version, then follows payment completion", () => {
  const data = setup(), mail = data.mailDocuments[0];
  data.receivedInvoices.push({ ...data.receivedInvoices[0], id: "received-2", status: "SCHEDULED", fileUrl: "/api/files/second.pdf" }, { ...data.receivedInvoices[0], id: "received-gone", deletedAt: timestamp });
  assert.throws(() => linkMailDocumentToReceivedInvoice(data, { id: "guest", role: "GUEST" }, "JAPAN", { mailDocumentId: mail.id, receivedInvoiceId: "received-2" }), /権限/);
  assert.throws(() => linkMailDocumentToReceivedInvoice(data, admin, "CHINA", { mailDocumentId: mail.id, receivedInvoiceId: "received-2" }), /権限/);
  assert.throws(() => linkMailDocumentToReceivedInvoice(data, admin, "JAPAN", { mailDocumentId: mail.id, receivedInvoiceId: "received-gone" }), /見つかりません/);
  assert.throws(() => linkMailDocumentToReceivedInvoice(data, admin, "JAPAN", { mailDocumentId: mail.id, receivedInvoiceId: "received-2" }), /連携済み/);
  assert.throws(() => linkMailDocumentToReceivedInvoice(data, admin, "JAPAN", { mailDocumentId: mail.id, receivedInvoiceId: "received-1", mailUpdatedAt: "stale" }), /更新されています/);
  // The former target was deleted: the dangling reference does not block a new link.
  data.receivedInvoices[0].deletedAt = timestamp;
  mail.category = "OTHER";
  const result = linkMailDocumentToReceivedInvoice(data, admin, "JAPAN", { mailDocumentId: mail.id, receivedInvoiceId: "received-2", mailUpdatedAt: mail.updatedAt });
  assert.deepEqual([result.receivedInvoiceId, result.mailProcessed, mail.relatedReceivedInvoiceId, mail.category, mail.mailProcessed], ["received-2", false, "received-2", "INVOICE", false]);
  data.payments.push({ id: "pay", type: "EXPENSE", receivedInvoiceId: "received-2", amount: 8000, paymentDate: "2026-10-01", createdById: "admin", createdAt: timestamp, updatedAt: timestamp });
  assert.equal(linkMailDocumentToReceivedInvoice(data, admin, "JAPAN", { mailDocumentId: mail.id, receivedInvoiceId: "received-2" }).mailProcessed, true);
  assert.deepEqual(unlinkMailDocument(data, admin, "JAPAN", { mailDocumentId: mail.id }), { mailDocumentId: mail.id, previousReceivedInvoiceId: "received-2" });
  assert.deepEqual([mail.relatedReceivedInvoiceId, mail.mailProcessed], [undefined, false]);
  assert.throws(() => unlinkMailDocument(data, admin, "JAPAN", { mailDocumentId: mail.id }), /未連携/);
  assert.throws(() => unlinkMailDocument(data, { id: "guest", role: "GUEST" }, "JAPAN", { mailDocumentId: mail.id }), /権限/);
});

test("the integrity report lists broken links and missing files without touching data", () => {
  const data = setup();
  data.mailDocuments.push({ ...data.mailDocuments[0], id: "mail-broken", relatedReceivedInvoiceId: "missing-invoice", fileUrl: "/api/files/lost.pdf", originalFileName: "lost.pdf" }, { ...data.mailDocuments[0], id: "mail-deleted", deletedAt: timestamp, relatedReceivedInvoiceId: "missing-invoice" });
  data.receivedInvoices.push({ ...data.receivedInvoices[0], id: "invoice-lost", fileUrl: "/api/files/invoice-lost.pdf" });
  const before = JSON.stringify(data);
  const report = mailIntegrityReport(data, "JAPAN", (fileUrl) => fileUrl === "/api/files/lost.pdf" || fileUrl === "/api/files/invoice-lost.pdf" ? false : fileUrl ? true : undefined);
  assert.deepEqual([report.brokenLinks, report.missingMailFiles, report.missingInvoiceFiles], [1, 1, 1]);
  assert.deepEqual(report.issues.map((row) => [row.kind, row.mailDocumentId || row.receivedInvoiceId]), [["BROKEN_LINK", "mail-broken"], ["MISSING_FILE", "mail-broken"], ["MISSING_FILE", "invoice-lost"]]);
  assert.equal(mailIntegrityReport(data, "JAPAN").issues.length, 1);
  assert.equal(JSON.stringify(data), before);
});
