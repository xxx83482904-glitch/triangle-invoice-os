import assert from "node:assert/strict";
import test from "node:test";
import { bankReconciliationOverview } from "../src/lib/bank-reconciliation";
import { bankDocumentReview } from "../src/lib/bank-review";
import { integrityKinds, integrityReport } from "../src/lib/integrity";
import { applyMailSorterEdits } from "../src/lib/mail-processing";
import { mailInvoiceLinkRequiredHref, mailNeedsReceivedInvoice, mailsNeedingReceivedInvoice, resolveMailLink, linkMailDocumentToReceivedInvoice, unlinkMailDocument, unlinkMailDocumentsForInvoice } from "../src/lib/mail-links";
import type { MailDocumentCategory } from "../src/lib/types";
import { admin, timestamp } from "./document-fixture";
import { unlinkedMailFixture, requiredMailIds, unlinkedMailToday } from "./unlinked-mail-fixture";

const pendingIds = (data: ReturnType<typeof unlinkedMailFixture>) => mailsNeedingReceivedInvoice(data, "JAPAN").map((row) => row.id).sort();
const overview = (data: ReturnType<typeof unlinkedMailFixture>) => bankReconciliationOverview(data, "JAPAN", unlinkedMailToday);

test("19 old unlinked hits include 9 processed mails; the shared task list, banner and review contain only 10", () => {
  const data = unlinkedMailFixture();
  const legacy = data.mailDocuments.filter((mail) => !mail.deletedAt && mail.company !== "CHINA" && ["INVOICE", "RECEIPT"].includes(mail.category) && !resolveMailLink(data, "JAPAN", mail).invoice);
  assert.equal(legacy.length, 19); assert.equal(legacy.filter((row) => row.mailProcessed).length, 9);
  const result = overview(data), review = bankDocumentReview(data, "JAPAN", result, "unlinked_mail");
  assert.deepEqual(pendingIds(data), [...requiredMailIds].sort());
  assert.equal(result.unlinkedMailCount, 10); assert.equal(review.counts.unlinked_mail, 10);
  assert.deepEqual(review.items.map((row) => row.id.replace(/^mail:/, "")).sort(), pendingIds(data));
});

test("only live same-company unprocessed invoice/receipt categories require linkage", () => {
  const data = unlinkedMailFixture(), mail = data.mailDocuments[0];
  for (const category of ["INVOICE", "RECEIPT", "NOTICE", "OTHER", "CONTRACT", "ESTIMATE", "DELIVERY_NOTE"] as MailDocumentCategory[]) {
    for (const mailProcessed of [false, true, undefined]) {
      const candidate = { ...mail, category, mailProcessed };
      const expected = ["INVOICE", "RECEIPT"].includes(category) && mailProcessed !== true;
      assert.equal(mailNeedsReceivedInvoice(data, "JAPAN", candidate), expected, category + ":" + mailProcessed);
      assert.equal(mailNeedsReceivedInvoice(data, "JAPAN", { ...candidate, deletedAt: timestamp }), false);
      assert.equal(mailNeedsReceivedInvoice(data, "JAPAN", { ...candidate, company: "CHINA" }), false);
      assert.equal(mailNeedsReceivedInvoice(data, "JAPAN", { ...candidate, relatedReceivedInvoiceId: "live" }), false);
    }
  }
});

test("missing/deleted invoices and missing/deleted/foreign projects are broken links, independent of status", () => {
  const data = unlinkedMailFixture(), mail = data.mailDocuments[0], target = data.receivedInvoices.find((row) => row.id === "live")!;
  mail.relatedReceivedInvoiceId = target.id;
  assert.equal(mailNeedsReceivedInvoice(data, "JAPAN", mail), false);
  for (const projectId of ["missing-project", "deleted-project", "china"]) {
    target.projectId = projectId; assert.equal(mailNeedsReceivedInvoice(data, "JAPAN", mail), true);
  }
  target.projectId = "japan"; target.deletedAt = timestamp;
  assert.equal(mailNeedsReceivedInvoice(data, "JAPAN", mail), true);
  mail.mailProcessed = true; assert.equal(mailNeedsReceivedInvoice(data, "JAPAN", mail), false);
});

test("archived/rejected invoices, archived/other-owner projects and nonpayable debt documents are still valid links", () => {
  const data = unlinkedMailFixture(), result = overview(data);
  for (const id of ["archived-target", "rejected-target", "other-project-target", "archived-project-target", "group-old", "group-receipt"]) {
    const mail = data.mailDocuments.find((row) => row.id === "linked-" + id)!;
    assert.equal(mailNeedsReceivedInvoice(data, "JAPAN", mail), false, id);
    assert.equal(resolveMailLink(data, "JAPAN", mail).broken, false);
  }
  for (const id of ["archived-target", "rejected-target", "group-old", "group-receipt"]) assert.equal(result.invoices.find((row) => row.id === id)!.eligible, false);
});

test("file absence and duplicate suggestions do not silently discard unresolved work", () => {
  const data = unlinkedMailFixture();
  for (const id of ["missing-file", "no-file-url", "duplicate-a", "duplicate-b"]) assert.ok(pendingIds(data).includes(id));
  const duplicate = data.mailDocuments.find((row) => row.id === "duplicate-b")!;
  duplicate.duplicateOfReceivedInvoiceId = "live";
  assert.ok(pendingIds(data).includes(duplicate.id));
  duplicate.mailProcessed = true;
  assert.ok(!pendingIds(data).includes(duplicate.id)); assert.ok(pendingIds(data).includes("duplicate-a"));
});

test("legacy undefined flags stay unset and are never inferred from another record's processing or payment", () => {
  const data = unlinkedMailFixture(), mail = data.mailDocuments.find((row) => row.id === "legacy-undefined")!;
  const target = data.receivedInvoices.find((row) => row.id === "deleted-target")!;
  target.status = "PAID"; target.mailProcessed = true; mail.relatedReceivedInvoiceId = target.id;
  assert.equal(mailNeedsReceivedInvoice(data, "JAPAN", mail), true);
  assert.equal(mail.mailProcessed, undefined);
  assert.ok(pendingIds(data).includes(mail.id));
});

test("manual processing and classification immediately change all task counts and can be reversed", () => {
  const data = unlinkedMailFixture(), mail = data.mailDocuments[0], financial = structuredClone(data.receivedInvoices);
  applyMailSorterEdits(data, admin, "JAPAN", [{ mailDocumentId: mail.id, mailUpdatedAt: mail.updatedAt, processingStatus: "processed" }]);
  assert.equal(overview(data).unlinkedMailCount, 9); assert.equal(bankDocumentReview(data, "JAPAN").counts.unlinked_mail, 9);
  applyMailSorterEdits(data, admin, "JAPAN", [{ mailDocumentId: mail.id, mailUpdatedAt: mail.updatedAt, processingStatus: "unprocessed" }]);
  assert.equal(overview(data).unlinkedMailCount, 10);
  applyMailSorterEdits(data, admin, "JAPAN", [{ mailDocumentId: mail.id, mailUpdatedAt: mail.updatedAt, category: "NOTICE" }]);
  assert.equal(overview(data).unlinkedMailCount, 9);
  applyMailSorterEdits(data, admin, "JAPAN", [{ mailDocumentId: mail.id, mailUpdatedAt: mail.updatedAt, category: "INVOICE" }]);
  assert.equal(overview(data).unlinkedMailCount, 10); assert.deepEqual(data.receivedInvoices, financial);
});

test("stale or unauthorized processing edits leave the count and source data intact", () => {
  const data = unlinkedMailFixture(), before = structuredClone(data);
  assert.throws(() => applyMailSorterEdits(data, admin, "JAPAN", [{ mailDocumentId: "open-invoice", mailUpdatedAt: "stale", processingStatus: "processed" }]), /更新/);
  assert.throws(() => applyMailSorterEdits(data, { id: "guest", role: "GUEST" }, "JAPAN", [{ mailDocumentId: "open-invoice", processingStatus: "processed" }]), /権限/);
  assert.equal(overview(data).unlinkedMailCount, 10); assert.deepEqual(data, before);
});

test("linking removes a task and unlinking restores it only while the mail remains unprocessed", () => {
  const data = unlinkedMailFixture(), mail = data.mailDocuments[0];
  linkMailDocumentToReceivedInvoice(data, admin, "JAPAN", { mailDocumentId: mail.id, receivedInvoiceId: "live", mailUpdatedAt: mail.updatedAt });
  assert.equal(overview(data).unlinkedMailCount, 9); assert.equal(mail.mailProcessed, false);
  unlinkMailDocument(data, admin, "JAPAN", { mailDocumentId: mail.id, mailUpdatedAt: mail.updatedAt });
  assert.equal(overview(data).unlinkedMailCount, 10);
  mail.mailProcessed = true;
  linkMailDocumentToReceivedInvoice(data, admin, "JAPAN", { mailDocumentId: mail.id, receivedInvoiceId: "live" });
  unlinkMailDocument(data, admin, "JAPAN", { mailDocumentId: mail.id });
  assert.equal(mail.mailProcessed, true); assert.equal(overview(data).unlinkedMailCount, 9);
});

test("deleting an invoice preserves manual processing and only returns unresolved mails to the task list", () => {
  const data = unlinkedMailFixture(), original = data.mailDocuments.find((row) => row.id === "linked-live")!;
  data.mailDocuments.push({ ...original, id: "processed-linked-copy", mailProcessed: true });
  data.receivedInvoices.find((row) => row.id === "live")!.deletedAt = timestamp;
  unlinkMailDocumentsForInvoice(data, "live");
  assert.equal(overview(data).unlinkedMailCount, 11);
  assert.ok(pendingIds(data).includes(original.id)); assert.ok(!pendingIds(data).includes("processed-linked-copy"));
});

test("a narrowed invoice overview cannot turn valid but hidden links into unlinked tasks", () => {
  const data = unlinkedMailFixture(), partialOverview = { ...overview(data), invoices: [] };
  const review = bankDocumentReview(data, "JAPAN", partialOverview, "unlinked_mail");
  assert.equal(review.counts.unlinked_mail, 10);
  assert.deepEqual(review.items.map((row) => row.id.replace(/^mail:/, "")).sort(), pendingIds(data));
});

test("review pagination and the link target describe the same complete set of required mails", () => {
  const data = unlinkedMailFixture(), base = data.mailDocuments[0];
  data.mailDocuments = Array.from({ length: 73 }, (_, i) => ({ ...base, id: "pending-" + i }));
  const result = overview(data), found: string[] = [];
  for (let page = 1; page <= 3; page++) {
    const review = bankDocumentReview(data, "JAPAN", result, "unlinked_mail", page);
    assert.equal(review.filteredTotal, 73); assert.equal(review.counts.unlinked_mail, result.unlinkedMailCount);
    assert.ok(review.items.every((row) => row.links.some((link) => link.href === mailInvoiceLinkRequiredHref("JAPAN"))));
    found.push(...review.items.map((row) => row.id.replace(/^mail:/, "")));
  }
  assert.equal(new Set(found).size, 73); assert.deepEqual(found.sort(), pendingIds(data));
  assert.equal(mailInvoiceLinkRequiredHref("JAPAN"), "/mail-sorter?company=JAPAN&link=required");
});

test("zero actionable mails yield no banner count or unlinked review items", () => {
  const data = unlinkedMailFixture();
  for (const mail of mailsNeedingReceivedInvoice(data, "JAPAN")) mail.mailProcessed = true;
  assert.equal(overview(data).unlinkedMailCount, 0);
  assert.deepEqual(mailsNeedingReceivedInvoice(data, "JAPAN"), []);
  const review = bankDocumentReview(data, "JAPAN", undefined, "unlinked_mail");
  assert.equal(review.filteredTotal, 0); assert.deepEqual(review.items, []);
});

test("integrity remains a structural reference/file check even after a mail no longer requires linkage", () => {
  const data = unlinkedMailFixture();
  const report = () => integrityReport(data, "JAPAN", { today: unlinkedMailToday, fileExists: (url) => url ? !url.endsWith("missing-file.pdf") : undefined });
  const mailIssues = () => report().issues.filter((row) => row.kind === "mail_link").map((row) => row.id).sort();
  const before = mailIssues();
  assert.ok(before.includes("mail_link:BROKEN_LINK:processed-3"));
  assert.ok(before.includes("mail_link:MISSING_FILE:missing-file"));
  data.mailDocuments.find((row) => row.id === "broken-missing")!.mailProcessed = true;
  assert.equal(overview(data).unlinkedMailCount, 9); assert.deepEqual(mailIssues(), before);
  assert.match(integrityKinds.mail_link.description, /処理済みや分類とは別/);
  assert.match(integrityKinds.mail_link.action, /連携の要否/);
});

test("counting and reviewing never mutate financial records, flags, links or duplicate metadata", () => {
  const data = unlinkedMailFixture(), before = structuredClone(data);
  mailsNeedingReceivedInvoice(data, "JAPAN"); overview(data); bankDocumentReview(data, "JAPAN");
  integrityReport(data, "JAPAN", { today: unlinkedMailToday });
  assert.deepEqual(data, before);
});
