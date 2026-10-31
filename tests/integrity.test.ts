import assert from "node:assert/strict";
import test from "node:test";
import { admin, fixture, timestamp } from "./document-fixture";
import { mergeBankMasters, sourceKey } from "../src/lib/banking";
import { GUESS_ACKNOWLEDGED_PREFIX } from "../src/lib/bank-classification";
import { confirmBankReconciliation } from "../src/lib/bank-reconciliation";
import { filterIntegrityReport, integrityKinds, integrityReport, summarizeIntegrity, type IntegrityKind } from "../src/lib/integrity";
import type { BankTransaction } from "../src/lib/banking-types";
import type { AppData } from "../src/lib/types";

const office = "office", today = "2026-10-08";
const cat = (id: string) => sourceKey("JAPAN", office, "category", id);
const account = sourceKey("JAPAN", office, "account", "bank");
const row = (id: string, patch: Partial<BankTransaction> = {}): BankTransaction => ({ id, company: "JAPAN", officeCode: office, sourceId: id, bankAccountId: account, transactionDate: "2026-10-05", amount: 1000, side: "EXPENSE", content: `明細 ${id}`, sourceMemo: "", sourceStatus: "none", sourceMissing: false, treatment: "NORMAL", classificationSource: "MANUAL", reviewed: false, memo: "", createdAt: timestamp, updatedAt: timestamp, ...patch });
const ids = (report: ReturnType<typeof integrityReport>, kind: IntegrityKind) => report.issues.filter((issue) => issue.kind === kind).map((issue) => issue.id);

function setup() {
  const data = fixture();
  mergeBankMasters(data, "JAPAN", office, [{ id: "bank", name: "テスト 三菱UFJ銀行", serviceName: "三菱UFJ銀行", isManual: false }], [
    { id: "misc", name: "雑費", group: "EXPENSE", available: true }, { id: "supplies", name: "消耗品費", group: "EXPENSE", available: true },
    { id: "sales", name: "売上高", group: "INCOME", available: true }, { id: "other-income", name: "雑収入", group: "INCOME", available: true },
  ]);
  data.bankTransactions = [
    row("guess-legacy", { categoryId: cat("misc"), reviewed: true, classificationConfidence: "GUESS", classificationReason: "候補" }),
    row("guess-acknowledged", { categoryId: cat("misc"), reviewed: true, classificationConfidence: "GUESS", classificationReason: `${GUESS_ACKNOWLEDGED_PREFIX}: 候補` }),
    row("undecided", { categoryId: cat("misc"), reviewed: true, bookkeeping: { invoiceRequirement: "UNDECIDED" } }),
    row("held", { categoryId: cat("misc"), reviewed: true, bookkeeping: { hold: { reason: "OTHER", question: "領収書は？" }, invoiceRequirement: "REQUIRED" } }),
    row("spread-a", { content: "テスト文具 購入", categoryId: cat("misc"), reviewed: true, transactionDate: "2026-10-01" }),
    row("spread-b", { content: "テスト文具 購入", categoryId: cat("supplies"), reviewed: true, transactionDate: "2026-10-03" }),
    row("same-a", { content: "テスト電力", categoryId: cat("misc"), reviewed: true }), row("same-b", { content: "テスト電力", categoryId: cat("misc"), reviewed: true }),
    row("transfer-lonely", { treatment: "TRANSFER", reviewed: true }),
    row("transfer-out", { treatment: "TRANSFER", reviewed: true, amount: 50000 }), row("transfer-in", { treatment: "TRANSFER", reviewed: true, amount: 50000, side: "INCOME" }),
    row("aplus", { treatment: "TRANSFER", reviewed: true, content: "口座振替 APアプラス" }),
    row("income", { side: "INCOME", amount: 12000, content: "Test customer INV-001", transactionDate: today, categoryId: cat("other-income") }),
  ];
  data.bankTransfers = [{ id: "transfer-link", company: "JAPAN", outgoingId: "transfer-out", incomingId: "transfer-in", outgoingEvidence: "stale", incomingEvidence: "stale", previous: [], confirmedById: "admin", createdAt: timestamp, updatedAt: timestamp }];
  data.issuedInvoices.forEach((invoice) => { invoice.status = "ISSUED"; invoice.needsReview = false; });
  const income = data.bankTransactions.find((item) => item.id === "income")!, invoice = data.issuedInvoices[0];
  confirmBankReconciliation(data, admin, "JAPAN", { transactionId: income.id, transactionUpdatedAt: income.updatedAt, invoiceKind: "issued", invoiceId: invoice.id, invoiceUpdatedAt: invoice.updatedAt, amount: 12000, mode: "new", acknowledged: true }, today);
  return data;
}
const report = (data: AppData, fileExists?: (fileUrl?: string) => boolean | undefined) => integrityReport(data, "JAPAN", { today, fileExists });

test("each rule flags only its own rows and leaves the data untouched", () => {
  const data = setup(), before = JSON.stringify(data);
  const result = report(data);
  assert.equal(JSON.stringify(data), before);
  assert.deepEqual(ids(result, "reviewed_guess"), ["reviewed_guess:guess-legacy"]);
  assert.deepEqual(ids(result, "reviewed_undecided").sort(), ["reviewed_undecided:held", "reviewed_undecided:undecided"]);
  assert.equal(result.issues.find((issue) => issue.id === "reviewed_undecided:held")!.severity, "ERROR");
  assert.equal(result.issues.find((issue) => issue.id === "reviewed_undecided:undecided")!.severity, "INFO");
  assert.deepEqual(ids(result, "reconciled_income_not_sales"), ["reconciled_income_not_sales:income"]);
  assert.deepEqual(ids(result, "category_spread").length, 1);
  assert.match(result.issues.find((issue) => issue.kind === "category_spread")!.detail, /雑費 1件 \/ 消耗品費 1件|消耗品費 1件 \/ 雑費 1件/);
  assert.deepEqual(ids(result, "transfer_half").sort(), ["transfer_half:link:transfer-link", "transfer_half:transfer-lonely"]);
  assert.equal(result.issues.find((issue) => issue.id === "transfer_half:link:transfer-link")!.severity, "WARNING");
  // The fixture's received invoice is PAID without any payment record.
  assert.deepEqual(ids(result, "payment_mismatch"), ["payment_mismatch:received:received-1"]);
  assert.deepEqual([ids(result, "reconciliation_conflict"), ids(result, "paid_without_bank"), ids(result, "mail_link")], [[], [], []]);
  assert.equal(result.total, result.issues.length);
  assert.deepEqual(result.severity, { ERROR: 1, WARNING: 3, INFO: 4 });
  assert.ok(result.issues.every((issue) => issue.action === integrityKinds[issue.kind].action && issue.links.length));
  assert.deepEqual(result.issues.map((issue) => issue.severity), [...result.issues].sort((a, b) => ["ERROR", "WARNING", "INFO"].indexOf(a.severity) - ["ERROR", "WARNING", "INFO"].indexOf(b.severity)).map((issue) => issue.severity));
  assert.equal(integrityReport(data, "CHINA", { today }).total, 0);
});

test("changing a reconciled invoice surfaces the conflict, the state mismatch and the unmatched record", () => {
  const data = setup();
  data.issuedInvoices[0].total = 15000;
  const result = report(data);
  const conflict = result.issues.find((issue) => issue.kind === "reconciliation_conflict")!;
  assert.match(conflict.detail, /金額が変わりました/); assert.equal(conflict.severity, "ERROR");
  assert.ok(conflict.links.some((link) => link.href.includes("/banking/reconcile")));
  assert.ok(ids(result, "payment_mismatch").includes("payment_mismatch:issued:issued-1"));
  const unmatched = result.issues.find((issue) => issue.id === "paid_without_bank:issued:issued-1")!;
  assert.equal(unmatched.severity, "INFO"); assert.match(unmatched.detail, /12,000/);
});

test("legacy status payments, overpayment and mail problems are reported with their severity", () => {
  const data = setup();
  data.payments.push({ id: "legacy", type: "EXPENSE", receivedInvoiceId: "received-1", amount: 8000, paymentDate: "2026-09-20", method: "ステータス変更", createdById: "admin", createdAt: timestamp, updatedAt: timestamp });
  let result = report(data);
  assert.deepEqual(ids(result, "payment_mismatch"), []);
  const legacy = result.issues.find((issue) => issue.id === "paid_without_bank:received:received-1")!;
  assert.equal(legacy.severity, "WARNING"); assert.match(legacy.detail, /旧ステータス変更由来の記録が 1件/);
  data.payments.push({ id: "extra", type: "EXPENSE", receivedInvoiceId: "received-1", amount: 500, paymentDate: "2026-09-21", source: "MANUAL", createdById: "admin", createdAt: timestamp, updatedAt: timestamp });
  data.mailDocuments.push({ ...data.mailDocuments[0], id: "mail-broken", relatedReceivedInvoiceId: "gone", fileUrl: "/api/files/lost.pdf", originalFileName: "lost.pdf" });
  result = report(data, (fileUrl) => fileUrl === "/api/files/lost.pdf" ? false : fileUrl ? true : undefined);
  const over = result.issues.find((issue) => issue.id === "payment_mismatch:received:received-1")!;
  assert.equal(over.severity, "ERROR"); assert.match(over.detail, /超えています/);
  assert.deepEqual(ids(result, "mail_link").sort(), ["mail_link:BROKEN_LINK:mail-broken", "mail_link:MISSING_FILE:mail-broken"]);
  assert.deepEqual(result.issues.filter((issue) => issue.kind === "mail_link").map((issue) => issue.severity).sort(), ["ERROR", "WARNING"]);
  assert.ok(result.issues.filter((issue) => issue.kind === "mail_link").every((issue) => issue.links[0].href.startsWith("/mail-sorter")));
});

test("filtering, paging and the summary stay consistent with the report", () => {
  const data = setup();
  const result = report(data);
  const all = filterIntegrityReport(result, undefined, 1, 3);
  assert.deepEqual([all.kind, all.page, all.pages, all.filteredTotal, all.items.length], ["all", 1, Math.ceil(result.total / 3), result.total, 3]);
  const last = filterIntegrityReport(result, "nonsense", 99, 3);
  assert.equal(last.kind, "all"); assert.equal(last.page, all.pages);
  const guesses = filterIntegrityReport(result, "reviewed_guess");
  assert.deepEqual([guesses.kind, guesses.filteredTotal, guesses.items[0].id], ["reviewed_guess", 1, "reviewed_guess:guess-legacy"]);
  const summary = summarizeIntegrity(result);
  assert.equal("issues" in summary, false);
  assert.equal(summary.kinds.reduce((total, kind) => total + kind.count, 0), result.total);
  assert.deepEqual(summary.truncated, []);
  assert.ok(summary.kinds.every((kind) => kind.count === result.counts[kind.kind]));
});

test("more than 500 hits of one kind are counted but only 500 are returned", () => {
  const data = setup();
  data.bankTransactions.push(...Array.from({ length: 505 }, (_, index) => row(`guess-${index}`, { categoryId: cat("misc"), reviewed: true, classificationConfidence: "GUESS", classificationReason: "候補" })));
  const result = report(data);
  assert.equal(result.counts.reviewed_guess, 506);
  assert.equal(ids(result, "reviewed_guess").length, 500);
  assert.deepEqual(result.truncated, ["reviewed_guess"]);
  assert.equal(result.total, result.issues.length + 6);
});
