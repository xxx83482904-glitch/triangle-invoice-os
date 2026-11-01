import assert from "node:assert/strict";
import test from "node:test";
import { admin, fixture, timestamp } from "./document-fixture";
import { integrityKnownFixture, integrityKnownToday as today, knownBankRow } from "./integrity-known-fixture";
import { acknowledgeIntegrity, revokeIntegrityAcknowledgement, type AcknowledgeIntegrityInput } from "../src/lib/integrity-acknowledgements";
import { filterIntegrityReport, integrityReport, summarizeIntegrity, type IntegrityKind } from "../src/lib/integrity";
import { assertJapanData } from "../src/lib/japan-storage";
import { confirmBankReconciliation } from "../src/lib/bank-reconciliation";
import { confirmBankTransfer } from "../src/lib/bank-transfers";
import type { AppData } from "../src/lib/types";

const options = { today, fileExists: (url?: string) => url ? !url.includes("missing") : undefined };
const report = (data: AppData, includeKnown = false) => integrityReport(data, "JAPAN", { ...options, includeKnown });
const find = (data: AppData, id: string) => report(data, true).issues.find((row) => row.id === id)!;
const input = (data: AppData, kind: IntegrityKind = "reviewed_guess", id?: string): AcknowledgeIntegrityInput => ({ mode: id ? "ISSUE" : "KIND", kind, reason: "合成: 意図を確認済み", targets: report(data).issues.filter((row) => row.kind === kind && (!id || row.id === id)).map(({ id, fingerprint }) => ({ id, fingerprint })) });
const ack = (data: AppData, kind: IntegrityKind = "reviewed_guess", id?: string) => acknowledgeIntegrity(data, admin, "JAPAN", input(data, kind, id), options);
const revoke = (data: AppData, id = data.integrityAcknowledgements![0].id) => { const row = data.integrityAcknowledgements!.find((row) => row.id === id)!; return revokeIntegrityAcknowledgement(data, admin, "JAPAN", { id, updatedAt: row.updatedAt, reason: "合成: 再確認する" }); };

test("individual acknowledgement hides exactly one issue with separate counts and immutable source data", () => {
  const data = integrityKnownFixture(), before = structuredClone(data), initial = report(data);
  ack(data, "reviewed_guess", "reviewed_guess:guess-1");
  const result = report(data), all = report(data, true);
  assert.equal(result.total, initial.total - 1); assert.equal(result.knownTotal, 1); assert.equal(result.totalIncludingKnown, initial.total);
  assert.equal(result.counts.reviewed_guess, 2); assert.equal(result.knownCounts.reviewed_guess, 1);
  assert.equal(result.severity.WARNING, initial.severity.WARNING - 1);
  assert.equal(result.issues.some((row) => row.id === "reviewed_guess:guess-1"), false);
  const known = all.issues.find((row) => row.id === "reviewed_guess:guess-1")!.known!;
  assert.equal(known.createdById, "admin"); assert.equal(known.createdByName, "合成管理者"); assert.equal(known.reason, "合成: 意図を確認済み"); assert.ok(known.createdAt);
  assert.equal(summarizeIntegrity(all).total, result.total); assert.equal(summarizeIntegrity(all).knownTotal, 1);
  const { integrityAcknowledgements: _acks, ...unchanged } = data; void _acks; assert.deepEqual(unchanged, before);
});

test("reviewed_guess fingerprints use classification, amount, date and description but ignore synchronization timestamps and unrelated notes", () => {
  const data = integrityKnownFixture(); ack(data, "reviewed_guess", "reviewed_guess:guess-1");
  const original = structuredClone(data), row = data.bankTransactions[0];
  for (const patch of [{ updatedAt: "2099-01-01T00:00:00Z" }, { memo: "別件のメモ" }, { sourceMemo: "同期情報" }, { createdAt: "2000-01-01" }]) {
    Object.assign(row, patch); assert.ok(find(data, "reviewed_guess:guess-1").known);
  }
  for (const patch of [{ categoryId: "supplies" }, { subCategoryId: "sub" }, { amount: 999 }, { transactionDate: "2026-10-11" }, { content: "合成新摘要" }, { classificationReason: "別の推測根拠" }, { classificationSource: "AUTO" }]) {
    const changed = structuredClone(original); Object.assign(changed.bankTransactions[0], patch); assert.equal(find(changed, "reviewed_guess:guess-1").known, undefined);
  }
  for (const patch of [{ reviewed: false }, { classificationConfidence: "INFERRED" }, { sourceMissing: true }]) {
    const changed = structuredClone(original); Object.assign(changed.bankTransactions[0], patch);
    assert.equal(report(changed, true).issues.some((issue) => issue.id === "reviewed_guess:guess-1"), false);
  }
});

test("kind registration freezes IDs and fingerprints at confirmation; later issues and changed targets are visible", () => {
  const data = integrityKnownFixture(), snapshot = input(data);
  data.bankTransactions.push(knownBankRow("new-guess", { ...data.bankTransactions[0], id: "new-guess" }));
  acknowledgeIntegrity(data, admin, "JAPAN", snapshot, options);
  assert.equal(report(data).knownTotal, 3); assert.deepEqual(report(data).issues.filter((row) => row.kind === "reviewed_guess").map((row) => row.id), ["reviewed_guess:new-guess"]);
  data.bankTransactions[0].amount++;
  assert.equal(report(data).counts.reviewed_guess, 2); assert.equal(report(data).knownCounts.reviewed_guess, 2);
  assert.equal(new Set(data.integrityAcknowledgements!.map((row) => row.batchId)).size, 1);
});

test("cancel requires a reason, restores the issue and cannot revive an older registration", () => {
  const data = integrityKnownFixture(); ack(data, "reviewed_guess", "reviewed_guess:guess-1");
  const first = data.integrityAcknowledgements![0];
  data.bankTransactions[0].amount++; ack(data, "reviewed_guess", "reviewed_guess:guess-1");
  const second = data.integrityAcknowledgements![0]; revoke(data, second.id);
  assert.equal(find(data, "reviewed_guess:guess-1").known, undefined); assert.equal(second.revokedById, "admin"); assert.equal(second.revokeReason, "合成: 再確認する");
  data.bankTransactions[0].amount--; assert.equal(find(data, "reviewed_guess:guess-1").known, undefined);
  assert.throws(() => revoke(data, first.id), /更新/); assert.throws(() => revoke(data, second.id), /更新/);
  assert.throws(() => revokeIntegrityAcknowledgement(data, admin, "JAPAN", { id: second.id, updatedAt: second.updatedAt, reason: " " }), /理由/);
});

test("kind snapshot changes and duplicate registration fail atomically", () => {
  const data = integrityKnownFixture(), snapshot = input(data); data.bankTransactions[2].amount++;
  const before = structuredClone(data);
  assert.throws(() => acknowledgeIntegrity(data, admin, "JAPAN", snapshot, options), /更新/); assert.deepEqual(data, before);
  ack(data); const saved = structuredClone(data);
  assert.throws(() => acknowledgeIntegrity(data, admin, "JAPAN", input(before), options), /更新/); assert.deepEqual(data, saved);
});

test("reason, kind, target snapshot, role and company guards reject without source writes", () => {
  const data = integrityKnownFixture(), valid = input(data), before = structuredClone(data);
  const invalid: unknown[] = [{ ...valid, reason: " " }, { ...valid, reason: "x".repeat(1001) }, { ...valid, kind: "unknown" }, { ...valid, targets: [] }, { ...valid, targets: [valid.targets[0], valid.targets[0]] }, { ...valid, mode: "ISSUE" }, { ...valid, targets: [{ ...valid.targets[0], fingerprint: "fake" }] }, { ...valid, kind: "transfer_half" }, { ...valid, extra: true }];
  for (const value of invalid) assert.throws(() => acknowledgeIntegrity(data, admin, "JAPAN", value as AcknowledgeIntegrityInput, options));
  assert.throws(() => acknowledgeIntegrity(data, { id: "mail-editor", role: "MAIL_EDITOR" }, "JAPAN", valid, options), /権限/);
  assert.throws(() => acknowledgeIntegrity(data, admin, "CHINA", valid, options)); assert.deepEqual(data, before);
  ack(data); const saved = structuredClone(data), row = data.integrityAcknowledgements![0];
  assert.throws(() => revokeIntegrityAcknowledgement(data, admin, "JAPAN", { id: row.id, updatedAt: "stale", reason: "確認" }), /更新/);
  assert.throws(() => revokeIntegrityAcknowledgement(data, { id: "editor", role: "MAIL_EDITOR" }, "JAPAN", { id: row.id, updatedAt: row.updatedAt, reason: "確認" }), /権限/); assert.deepEqual(data, saved);
});

test("known-only and unresolved pagination count the same rows; hidden known entries do not consume 500 slots", () => {
  const data = integrityKnownFixture(); ack(data);
  const all = report(data, true), known = filterIntegrityReport(all, "reviewed_guess", 1, 2, true), open = filterIntegrityReport(all);
  assert.equal(known.filteredTotal, 3); assert.equal(known.pages, 2); assert.equal(known.items.length, 2); assert.equal(open.filteredTotal, all.total);
  assert.equal(known.batches.length, 0); assert.ok(open.items.every((row) => !row.known));
  data.bankTransactions.push(...Array.from({ length: 502 }, (_, index) => ({ ...data.bankTransactions[0], id: `new-${index}` })));
  const large = report(data); assert.equal(large.counts.reviewed_guess, 502); assert.equal(large.issues.filter((row) => row.kind === "reviewed_guess").length, 500);
  ack(data); assert.equal(report(data).counts.reviewed_guess, 2); assert.equal(report(data).knownCounts.reviewed_guess, 503);
  assert.deepEqual(report(data, true).knownTruncated, ["reviewed_guess"]);
});

test("category spread hashes the sorted member IDs and category distribution, not timestamps, amount or array order", () => {
  const data = integrityKnownFixture(), id = report(data).issues.find((row) => row.kind === "category_spread")!.id;
  ack(data, "category_spread"); data.bankTransactions.reverse();
  const row = data.bankTransactions.find((row) => row.id === "spread-1")!; row.updatedAt = "2099"; row.amount++; assert.ok(find(data, id).known);
  row.subCategoryId = "another"; assert.equal(find(data, id).known, undefined);
  delete row.subCategoryId; assert.ok(find(data, id).known);
  data.bankTransactions.push({ ...row, id: "spread-3" }); assert.equal(find(data, id).known, undefined);
});

test("transfer fingerprints include account, date, amount, treatment and pairing; notes are not evidence", () => {
  const data = integrityKnownFixture(); ack(data, "transfer_half", "transfer_half:other-transfer");
  const row = data.bankTransactions.find((row) => row.id === "other-transfer")!, original = structuredClone(data);
  row.updatedAt = "2099"; row.memo = "別件"; row.categoryId = "misc"; assert.ok(find(data, "transfer_half:other-transfer").known);
  for (const patch of [{ amount: 2000 }, { transactionDate: "2026-10-11" }, { bankAccountId: "other" }, { content: "合成別摘要" }]) {
    const changed = structuredClone(original); Object.assign(changed.bankTransactions.find((row) => row.id === "other-transfer")!, patch); assert.equal(find(changed, "transfer_half:other-transfer").known, undefined);
  }
  row.treatment = "NORMAL"; assert.equal(report(data, true).issues.some((issue) => issue.id === "transfer_half:other-transfer"), false);
});

test("invalid transfer pair fingerprints detect changes on either side and ignore synchronization timestamps", () => {
  const data = integrityKnownFixture(); data.bankAccounts.push({ ...data.bankAccounts[0], id: "bank-2", sourceId: "bank-2", name: "合成別銀行" });
  const outgoing = knownBankRow("pair-out"), incoming = knownBankRow("pair-in", { side: "INCOME", bankAccountId: "bank-2" }); data.bankTransactions.push(outgoing, incoming);
  const result = confirmBankTransfer(data, admin, "JAPAN", { transactionId: outgoing.id, transactionUpdatedAt: timestamp, counterpartId: incoming.id, counterpartUpdatedAt: timestamp, acknowledged: true }, today);
  outgoing.amount++; const id = `transfer_half:link:${result.id}`; ack(data, "transfer_half", id);
  incoming.updatedAt = "2099"; assert.ok(find(data, id).known); incoming.amount += 2; assert.equal(find(data, id).known, undefined);
});

test("all document issue kinds fingerprint relevant payment, mail and reconciliation evidence", () => {
  const data = integrityKnownFixture(), original = fixture(); data.receivedInvoices = original.receivedInvoices;
  data.mailDocuments = [{ ...original.mailDocuments[0], id: "missing-mail", relatedReceivedInvoiceId: "gone", fileUrl: "/api/files/missing.pdf" }];
  data.payments = [{ id: "payment", type: "EXPENSE", receivedInvoiceId: "received-1", amount: 1000, paymentDate: "2026-10-01", createdById: "admin", createdAt: timestamp, updatedAt: timestamp }];
  for (const kind of ["payment_mismatch", "mail_processing_mismatch", "paid_without_bank", "mail_link"] as const) ack(data, kind);
  const before = report(data, true); assert.ok(before.knownTotal >= 5);
  data.payments[0].updatedAt = "2099"; data.receivedInvoices[0].memo = "別件"; data.mailDocuments[0].updatedAt = "2099";
  assert.equal(report(data, true).knownTotal, before.knownTotal);
  data.payments[0].amount++;
  for (const kind of ["payment_mismatch", "mail_processing_mismatch", "paid_without_bank"]) assert.ok(report(data).issues.some((row) => row.kind === kind));
  data.mailDocuments[0].fileUrl = "/api/files/missing-new.pdf"; assert.equal(find(data, "mail_link:MISSING_FILE:missing-mail").known, undefined);
  data.mailDocuments[0].relatedReceivedInvoiceId = "other-gone"; assert.equal(find(data, "mail_link:BROKEN_LINK:missing-mail").known, undefined);
});

test("reconciliation conflicts reappear when the underlying evidence changes without depending on timestamps", () => {
  const data = integrityKnownFixture(), original = fixture(); data.issuedInvoices = [{ ...original.issuedInvoices[0], status: "ISSUED", needsReview: false }];
  const row = knownBankRow("income", { side: "INCOME", amount: 12000 }); data.bankTransactions.push(row);
  data.bankAccounts[0].serviceName = "合成 三菱UFJ銀行";
  const linked = confirmBankReconciliation(data, admin, "JAPAN", { transactionId: row.id, transactionUpdatedAt: row.updatedAt, invoiceKind: "issued", invoiceId: "issued-1", invoiceUpdatedAt: timestamp, amount: 12000, mode: "new", acknowledged: true }, today);
  void linked; row.amount++; const id = report(data).issues.find((issue) => issue.kind === "reconciliation_conflict")!.id; ack(data, "reconciliation_conflict", id);
  row.updatedAt = "2099"; data.payments[0].updatedAt = "2099"; assert.ok(find(data, id).known);
  data.payments[0].amount++; assert.equal(find(data, id).known, undefined);
});

test("reviewed undecided fingerprints retain a hold's question and requirement", () => {
  const data = integrityKnownFixture(); data.bankTransactions[0].bookkeeping = { invoiceRequirement: "UNDECIDED", hold: { reason: "OTHER", question: "合成確認" } };
  ack(data, "reviewed_undecided"); const id = "reviewed_undecided:guess-1"; data.bankTransactions[0].updatedAt = "2099"; assert.ok(find(data, id).known);
  data.bankTransactions[0].bookkeeping.hold!.question = "別の確認"; assert.equal(find(data, id).known, undefined);
});

test("reconciled non-sales income fingerprints track selected category and live invoice links", () => {
  const data = integrityKnownFixture(), original = fixture();
  data.issuedInvoices = [{ ...original.issuedInvoices[0], status: "ISSUED", needsReview: false }];
  data.bankAccounts[0].serviceName = "合成 三菱UFJ銀行";
  data.accountingCategories.push({ ...data.accountingCategories[0], id: "sales", name: "売上高", group: "INCOME" });
  const row = knownBankRow("sales-hint", { side: "INCOME", amount: 12000, categoryId: "misc" }); data.bankTransactions.push(row);
  confirmBankReconciliation(data, admin, "JAPAN", { transactionId: row.id, transactionUpdatedAt: row.updatedAt, invoiceKind: "issued", invoiceId: "issued-1", invoiceUpdatedAt: timestamp, amount: 12000, mode: "new", acknowledged: true }, today);
  ack(data, "reconciled_income_not_sales"); const id = "reconciled_income_not_sales:sales-hint";
  row.updatedAt = "2099"; data.bankReconciliations[0].updatedAt = "2099"; assert.ok(find(data, id).known);
  row.categoryId = "supplies"; assert.equal(find(data, id).known, undefined);
  row.categoryId = "misc"; assert.ok(find(data, id).known);
  data.bankReconciliations[0].deletedAt = timestamp; assert.equal(find(data, id), undefined);
});

test("legacy optional collection is not materialized on read and foreign acknowledgement cannot hide a Japanese issue", () => {
  const data = integrityKnownFixture(); report(data); assert.equal(Object.hasOwn(data, "integrityAcknowledgements"), false); assertJapanData(data);
  ack(data); data.integrityAcknowledgements!.forEach((row) => row.company = "CHINA");
  assert.equal(report(data).knownTotal, 0); assert.throws(() => assertJapanData(data), /中国/);
});
