import assert from "node:assert/strict";
import test from "node:test";
import { admin, fixture, timestamp } from "./document-fixture";
import { mergeBankMasters, sourceKey } from "../src/lib/banking";
import { applyBulkReclassify, previewBulkReclassify } from "../src/lib/bank-bulk-reclassify";
import { payrollPayeeName, payrollSummary } from "../src/lib/payroll-summary";
import { taxObligations } from "../src/lib/tax-obligations";
import { reconciliationCombinations } from "../src/lib/bank-reconciliation-combinations";
import { bankReconciliationOverview } from "../src/lib/bank-reconciliation";
import { bankTransferDetail, bankTransferIssue, confirmBankTransfer, transferFeeDifference } from "../src/lib/bank-transfers";
import type { BankTransaction } from "../src/lib/banking-types";
import type { AppData } from "../src/lib/types";

const office = "office", today = "2026-10-08";
const cat = (id: string) => sourceKey("JAPAN", office, "category", id);
const account = (id: string) => sourceKey("JAPAN", office, "account", id);
const row = (id: string, patch: Partial<BankTransaction> = {}): BankTransaction => ({ id, company: "JAPAN", officeCode: office, sourceId: id, bankAccountId: account("bank"), transactionDate: "2026-10-05", amount: 1000, side: "EXPENSE", content: `明細 ${id}`, sourceMemo: "", sourceStatus: "none", sourceMissing: false, treatment: "NORMAL", classificationSource: "MANUAL", reviewed: false, memo: "", createdAt: timestamp, updatedAt: timestamp, ...patch });

function setup() {
  const data = fixture();
  mergeBankMasters(data, "JAPAN", office, [{ id: "bank", name: "テスト 三菱UFJ銀行", serviceName: "三菱UFJ銀行", isManual: false }, { id: "second", name: "テスト ゆうちょ銀行", serviceName: "ゆうちょ銀行", isManual: false }], [
    { id: "misc", name: "雑費", group: "EXPENSE", available: true }, { id: "outsourcing", name: "外注費", group: "EXPENSE", available: true }, { id: "fees", name: "支払手数料", group: "EXPENSE", available: true },
    { id: "salary", name: "給料手当", group: "EXPENSE", available: true }, { id: "officer", name: "役員報酬", group: "EXPENSE", available: true }, { id: "sales", name: "売上高", group: "INCOME", available: true },
  ]);
  return data;
}

test("bulk reclassify previews the matching rows, skips protected ones and keeps reviewed rows reviewed", () => {
  const data = setup();
  data.bankTransactions = [
    row("a", { content: "テスト制作 振込", categoryId: cat("misc"), reviewed: true }), row("b", { content: "テスト制作　振込", categoryId: cat("misc") }), row("c", { content: "テスト制作 振込", categoryId: cat("outsourcing"), transactionDate: "2026-09-01" }),
    row("income", { content: "テスト制作 振込", side: "INCOME", categoryId: cat("sales") }), row("split", { content: "テスト制作 振込", categoryId: cat("misc"), bookkeeping: { splits: [{ id: "s1", categoryId: cat("misc"), amount: 500, memo: "" }, { id: "s2", categoryId: cat("fees"), amount: 500, memo: "" }] } }),
    row("transfer", { content: "テスト制作 振込", treatment: "TRANSFER" }), row("other", { content: "別の摘要", categoryId: cat("misc") }),
  ];
  const preview = previewBulkReclassify(data, "JAPAN", { content: "テスト制作 振込", side: "EXPENSE" });
  assert.deepEqual([preview.matched, preview.reviewed, preview.unreviewed], [3, 1, 2]);
  assert.deepEqual(preview.categories.map((item) => [item.name, item.count]), [["雑費", 2], ["外注費", 1]]);
  assert.deepEqual(preview.skipped.map((item) => item.id).sort(), ["split", "transfer"]);
  assert.equal(previewBulkReclassify(data, "JAPAN", { content: "テスト制作 振込", side: "INCOME" }).matched, 1);
  assert.equal(previewBulkReclassify(data, "JAPAN", { content: "テスト制作 振込", includeReviewed: false }).matched, 3);
  assert.equal(previewBulkReclassify(data, "JAPAN", { content: "テスト制作 振込" }).matched, 4);
  const before = JSON.stringify(data);
  assert.throws(() => applyBulkReclassify(data, admin, "JAPAN", { content: "テスト制作 振込", side: "EXPENSE", categoryId: cat("outsourcing"), reason: "統一", expectedCount: 2 }), /対象件数が変わりました/);
  assert.throws(() => applyBulkReclassify(data, admin, "JAPAN", { content: "テスト制作 振込", side: "EXPENSE", categoryId: cat("outsourcing"), reason: "" }), /理由/);
  assert.equal(JSON.stringify(data), before);
  const result = applyBulkReclassify(data, admin, "JAPAN", { content: "テスト制作 振込", side: "EXPENSE", categoryId: cat("outsourcing"), reason: "外注費へ統一", expectedCount: 3 });
  assert.deepEqual([result.changed, result.reviewed, result.skipped], [3, 1, 2]);
  for (const id of ["a", "b", "c"]) { const item = data.bankTransactions.find((entry) => entry.id === id)!; assert.equal(item.categoryId, cat("outsourcing")); assert.equal(item.classificationReason, "一括変更（テスト制作 振込）: 外注費へ統一"); }
  assert.equal(data.bankTransactions.find((entry) => entry.id === "a")!.reviewed, true);
  assert.equal(data.bankTransactions.find((entry) => entry.id === "income")!.categoryId, cat("sales"));
  assert.equal(data.bankTransactions.find((entry) => entry.id === "other")!.categoryId, cat("misc"));
});

test("payroll summary groups payroll-category rows by payee across the fiscal year", () => {
  const data = setup();
  data.bankTransactions = [
    row("s1", { content: "振込 ヤマダ タロウ 9月分", categoryId: cat("salary"), transactionDate: "2026-09-25", amount: 250000 }),
    row("s2", { content: "振込 ヤマダ タロウ 10月分", categoryId: cat("salary"), transactionDate: "2026-10-25", amount: 260000 }),
    row("s3", { content: "振込 スズキ ハナコ", categoryId: cat("officer"), transactionDate: "2026-10-25", amount: 400000 }),
    row("s4", { content: "振込 スズキ ハナコ", categoryId: cat("misc"), transactionDate: "2026-10-26", amount: 1000 }),
    row("s5", { content: "振込 ヤマダ タロウ 8月分", categoryId: cat("salary"), transactionDate: "2026-08-25", amount: 240000 }),
  ];
  assert.equal(payrollPayeeName("振込 ヤマダ タロウ 9月分"), "ヤマダ タロウ");
  const summary = payrollSummary(data, "JAPAN", 2027);
  assert.deepEqual(summary.rows.map((item) => [item.payee, item.total, item.count]), [["ヤマダ タロウ", 510000, 2], ["スズキ ハナコ", 400000, 1]]);
  assert.equal(summary.rows[0].months["2026-09"], 250000); assert.equal(summary.rows[0].months["2026-10"], 260000);
  assert.equal(summary.monthTotals["2026-10"], 660000); assert.equal(summary.total, 910000);
  assert.deepEqual(summary.rows[1].categories, ["役員報酬"]);
  assert.equal(payrollSummary(data, "JAPAN", 2026).total, 240000);
});

test("tax and insurance obligations come from matching received invoices and mail, with paid ones listed separately", () => {
  const data = setup();
  const base = data.receivedInvoices[0];
  Object.assign(base, { status: "SCHEDULED", mailProcessed: false, originalFileName: "源泉所得税_納付書.pdf", total: 30000, dueDate: "2026-10-01", issueDate: "2026-09-20" });
  data.mailDocuments[0].mailProcessed = false;
  data.vendors.push({ ...data.vendors[0], id: "pension", companyName: "日本年金機構" });
  data.receivedInvoices.push(
    { ...base, id: "pension", vendorId: "pension", originalFileName: "保険料納入告知書.pdf", total: 120000, dueDate: "2026-10-15", status: "SCHEDULED" },
    { ...base, id: "paid-tax", originalFileName: "消費税_中間納付.pdf", total: 50000, dueDate: "2026-09-30", status: "PAID", paidAt: "2026-09-28" },
    { ...base, id: "plain", originalFileName: "制作費.pdf", total: 8000 },
  );
  data.payments.push({ id: "p1", type: "EXPENSE", receivedInvoiceId: "paid-tax", amount: 50000, paymentDate: "2026-09-28", source: "MANUAL", createdById: "admin", createdAt: timestamp, updatedAt: timestamp });
  data.mailDocuments.push({ ...data.mailDocuments[0], id: "mail-tax", title: "法人税の納付のお知らせ", senderName: "麹町税務署", category: "NOTICE", relatedReceivedInvoiceId: undefined, mailProcessed: false, folderMonth: "2026-10" });
  const summary = taxObligations(data, "JAPAN", today);
  assert.deepEqual(summary.items.map((item) => item.id), ["received:received-1", "received:pension", "mail:mail-tax"]);
  assert.deepEqual([summary.items[0].overdue, summary.items[1].dueSoon, summary.items[2].amount], [true, true, undefined]);
  assert.deepEqual([summary.overdue, summary.dueSoon, summary.unpriced, summary.outstandingTotal], [1, 1, 1, 150000]);
  assert.deepEqual(summary.paidRecently.map((item) => item.id), ["paid-tax"]);
});

test("combination proposals find two or three open invoices that add up to the receipt, same party first", () => {
  const data = setup();
  data.issuedInvoices.forEach((invoice) => { invoice.status = "ISSUED"; invoice.needsReview = false; });
  data.issuedInvoices[1].total = 8000;
  data.issuedInvoices.push({ ...data.issuedInvoices[0], id: "issued-3", invoiceNumber: "INV-003", total: 5000 }, { ...data.issuedInvoices[0], id: "issued-4", invoiceNumber: "INV-004", total: 3000 });
  data.bankTransactions = [row("pair", { side: "INCOME", amount: 20000, content: "Test customer", transactionDate: today }), row("triple", { side: "INCOME", amount: 16000, content: "Test customer", transactionDate: today })];
  const view = bankReconciliationOverview(data, "JAPAN", today);
  const pair = reconciliationCombinations(view.banks.find((item) => item.id === "pair")!, view.invoices);
  assert.deepEqual(pair[0].keys, ["issued:issued-1", "issued:issued-2"]); assert.equal(pair.length, 2);
  assert.equal(pair[0].sameParty, true); assert.equal(pair[0].total, 20000);
  const triple = reconciliationCombinations(view.banks.find((item) => item.id === "triple")!, view.invoices);
  assert.ok(triple.some((combo) => combo.keys.length === 3 && combo.total === 16000));
  assert.deepEqual(reconciliationCombinations({ ...view.banks[0], remaining: 1 }, view.invoices), []);
});

test("transfers can be paired across a small fee: the gap is recorded on the link and the pair stays valid", () => {
  const data = setup();
  const outgoing = row("out", { amount: 100660, content: "振込 ゆうちょへ", transactionDate: today });
  const incoming = row("in", { amount: 100000, side: "INCOME", content: "振込 入金", bankAccountId: account("second"), transactionDate: today });
  const other = row("far", { amount: 98000, side: "INCOME", bankAccountId: account("second"), transactionDate: today });
  data.bankTransactions = [outgoing, incoming, other];
  assert.equal(transferFeeDifference(outgoing, incoming), 660); assert.equal(transferFeeDifference(incoming, outgoing), 660); assert.equal(transferFeeDifference(outgoing, other), -1);
  const detail = bankTransferDetail(data, "JAPAN", outgoing.id, today);
  assert.deepEqual(detail.candidates.map((item) => [item.id, item.feeDifference]), [["in", 660]]);
  assert.throws(() => confirmBankTransfer(data, admin, "JAPAN", { transactionId: outgoing.id, transactionUpdatedAt: outgoing.updatedAt, counterpartId: incoming.id, counterpartUpdatedAt: incoming.updatedAt, acknowledged: true }), /金額が一致しません/);
  assert.throws(() => confirmBankTransfer(data, admin, "JAPAN", { transactionId: outgoing.id, transactionUpdatedAt: outgoing.updatedAt, counterpartId: incoming.id, counterpartUpdatedAt: incoming.updatedAt, acknowledged: true, fee: { amount: 600 } }), /送金手数料と一致しません/);
  confirmBankTransfer(data, admin, "JAPAN", { transactionId: outgoing.id, transactionUpdatedAt: outgoing.updatedAt, counterpartId: incoming.id, counterpartUpdatedAt: incoming.updatedAt, acknowledged: true, fee: { amount: 660 } });
  const link = data.bankTransfers![0];
  assert.deepEqual(link.fee, { amount: 660 }); assert.equal(bankTransferIssue(data, link, today), "");
  assert.match(outgoing.classificationReason!, /送金手数料 660 円/); assert.equal(incoming.treatment, "TRANSFER");
});

export type { AppData };
