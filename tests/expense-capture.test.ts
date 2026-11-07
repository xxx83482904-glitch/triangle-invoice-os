import assert from "node:assert/strict";
import test from "node:test";
import { expenseAccountant, expenseAdmin, expenseDesigner, expensesFixture } from "./expense-claims-fixture";
import { timestamp } from "./document-fixture";
import { applyExpenseMutation } from "../src/lib/expense-claim-edits";
import { mergeReceiptReading, readExpenseReceipt, receiptPaidWith, receiptRegistrationNumber, type AiReceipt } from "../src/lib/expense-receipt-reading";
import { expensePayoutDetail, linkExpensePayout, payoutEvidence, unlinkExpensePayout } from "../src/lib/expense-payouts";
import { bankReconciliationOverview, confirmBankReconciliation } from "../src/lib/bank-reconciliation";
import { confirmBankTransfer } from "../src/lib/bank-transfers";
import { safeNextPath } from "../src/lib/safe-next-path";
import type { BankTransaction } from "../src/lib/banking-types";
import type { ExpenseClaim } from "../src/lib/types";

const today = "2026-10-25";
const ocr = (text: string) => ({ engine: "test", text, warnings: [] });
const receiptText = "合成コーヒー店\n2026年10月12日\nブレンド 2点\n合計 ¥1,320\n(内消費税等 ¥120)\nお預り ¥2,000\nお釣り ¥680\n登録番号 T1-2345-6789-0123";

test("receipt numbers and payment hints are read from noisy OCR text", () => {
  assert.equal(receiptRegistrationNumber("登録番号：Ｔ１２３４ ５６７８ ９０１２３"), "T1234567890123");
  assert.equal(receiptRegistrationNumber("T12345"), "");
  assert.equal(receiptPaidWith("お預り 2,000 お釣り 680"), "CASH");
  assert.equal(receiptPaidWith("VISA ****1234 クレジット"), "PERSONAL_CARD");
  assert.equal(receiptPaidWith("合計 500"), "");
});

test("AI values win but are validated against the company's accounts, today and the paid total", () => {
  const data = expensesFixture();
  const ai: AiReceipt = { spentOn: "2026-10-12", amount: "1,320", payee: " 合成コーヒー店 ", purpose: "打ち合わせのコーヒー代", categoryId: "sales",
    paidWith: "CASH", registrationNumber: "T1234567890123", tax10: 120, tax8: 5000, warnings: ["一部がかすれています"] };
  const reading = mergeReceiptReading(data, expenseDesigner, "JAPAN", ocr(receiptText), ai, today);
  assert.equal(reading.amount, 1320); assert.equal(reading.payee, "合成コーヒー店"); assert.equal(reading.spentOn, "2026-10-12");
  assert.equal(reading.purpose, "打ち合わせのコーヒー代"); assert.equal(reading.paidWith, "CASH");
  // 売上高 is not an expense account, so the model's pick is ignored instead of reaching the form.
  assert.equal(reading.categoryId, "");
  assert.deepEqual(reading.taxBreakdown, { rate10: 120 });
  assert.equal(reading.registrationNumber, "T1234567890123");
  assert.equal(reading.sources.amount, "ai"); assert.equal(reading.sources.categoryId, undefined);
  assert.ok(reading.warnings.includes("一部がかすれています"));
  assert.ok(reading.aiUsed);

  const future = mergeReceiptReading(data, expenseDesigner, "JAPAN", ocr(""), { spentOn: "2026-12-01", amount: -5, categoryId: "travel" }, today);
  assert.equal(future.spentOn, ""); assert.equal(future.amount, null); assert.equal(future.categoryId, "travel");
  assert.ok(future.warnings.some((row) => row.includes("未来")));
});

test("without AI the OCR rules fill the basics and the person's own history fills purpose and account", () => {
  const data = expensesFixture();
  const reading = mergeReceiptReading(data, expenseDesigner, "JAPAN", ocr(`合成交通店\n${receiptText}`), null, today);
  assert.equal(reading.amount, 1320); assert.equal(reading.spentOn, "2026-10-12"); assert.equal(reading.paidWith, "CASH");
  assert.equal(reading.registrationNumber, "T1234567890123"); assert.equal(reading.sources.registrationNumber, "ocr");
  assert.equal(reading.aiUsed, false);
  const withPayee = mergeReceiptReading(data, expenseDesigner, "JAPAN", ocr(receiptText), { payee: "合成交通店" }, today);
  assert.equal(withPayee.purpose, "合成案件の打ち合わせ・備品購入"); assert.equal(withPayee.sources.purpose, "history");
  assert.equal(withPayee.categoryId, "travel"); assert.equal(withPayee.sources.categoryId, "history");
  // Another person's claims at the same payee never leak into the form.
  data.expenseClaims = data.expenseClaims!.filter((row) => row.submittedById !== "des");
  const fresh = mergeReceiptReading(data, expenseDesigner, "JAPAN", ocr(receiptText), { payee: "合成交通店" }, today);
  assert.equal(fresh.purpose, ""); assert.equal(fresh.categoryId, "");
});

test("a receipt with the same date and amount as an earlier claim is flagged as a possible duplicate", () => {
  const data = expensesFixture();
  const reading = mergeReceiptReading(data, expenseDesigner, "JAPAN", ocr(""), { spentOn: "2026-10-10", amount: 1200 }, today);
  assert.ok(reading.warnings.some((row) => row.includes("同じ日付・金額") && row.includes("申請中")));
  assert.ok(!mergeReceiptReading(data, expenseAccountant, "JAPAN", ocr(""), { spentOn: "2026-10-10", amount: 1200 }, today).warnings.some((row) => row.includes("同じ日付")));
});

test("photos go to the AI with the OCR text, PDFs as text only, and an AI failure falls back with a note", async () => {
  const data = expensesFixture(), seen: Array<{ image: boolean; text: string }> = [];
  const extract = async () => ocr(receiptText);
  const ai = async (input: { text: string; image?: unknown }) => { seen.push({ image: Boolean(input.image), text: input.text }); return { purpose: "コーヒー代" }; };
  const photo = await readExpenseReceipt(data, expenseDesigner, "JAPAN", { name: "r.jpg", type: "image/jpeg", buffer: Buffer.from("jpeg") }, today, { extract, ai });
  await readExpenseReceipt(data, expenseDesigner, "JAPAN", { name: "r.pdf", type: "application/pdf", buffer: Buffer.from("pdf") }, today, { extract, ai });
  assert.deepEqual(seen.map((row) => row.image), [true, false]); assert.equal(seen[0].text, receiptText);
  assert.equal(photo.purpose, "コーヒー代"); assert.equal(photo.amount, 1320);
  const failed = await readExpenseReceipt(data, expenseDesigner, "JAPAN", { name: "r.jpg", type: "image/jpeg", buffer: Buffer.from("jpeg") }, today,
    { extract, ai: async () => { throw new Error("timeout"); } });
  assert.equal(failed.amount, 1320); assert.equal(failed.aiUsed, false);
  assert.ok(failed.warnings.some((row) => row.includes("AIでの読み取りに失敗")));
});

test("submitted claims keep the registration number and tax, which are validated", () => {
  const data = expensesFixture();
  const base = { action: "submit" as const, spentOn: "2026-10-12", amount: 1320, payee: "合成コーヒー店", purpose: "打ち合わせ" };
  const { id } = applyExpenseMutation(data, expenseDesigner, "JAPAN", { ...base, registrationNumber: "T1234567890123", taxBreakdown: { rate10: 120, rate8: 0 } }, "with-tax") as { id: string };
  const claim = data.expenseClaims!.find((row) => row.id === id)!;
  assert.equal(claim.registrationNumber, "T1234567890123"); assert.deepEqual(claim.taxBreakdown, { rate10: 120 });
  assert.throws(() => applyExpenseMutation(data, expenseDesigner, "JAPAN", { ...base, registrationNumber: "1234567890123" }, "bad-number"), /登録番号/);
  assert.throws(() => applyExpenseMutation(data, expenseDesigner, "JAPAN", { ...base, taxBreakdown: { rate10: 1320 } }, "bad-tax"), /消費税額/);
  assert.throws(() => applyExpenseMutation(data, expenseDesigner, "JAPAN", { ...base, taxBreakdown: { rate10: 1.5 } }, "fraction-tax"), /整数/);
});

function payoutSetup() {
  const data = expensesFixture();
  data.bankAccounts = [{ id: "bank", company: "JAPAN", officeCode: "office", sourceId: "bank", name: "合成銀行", serviceName: "三菱UFJ銀行", isManual: false, available: true, createdAt: timestamp, updatedAt: timestamp },
    { id: "card", company: "JAPAN", officeCode: "office", sourceId: "card", name: "合成カード", serviceName: "合成カード", isManual: false, available: true, createdAt: timestamp, updatedAt: timestamp }];
  const row = (id: string, amount: number, date: string, patch: Partial<BankTransaction> = {}): BankTransaction => ({ id, company: "JAPAN", officeCode: "office", sourceId: id, bankAccountId: "bank", side: "EXPENSE", amount, content: `フリコミ ${id}`, transactionDate: date,
    sourceMemo: "", sourceStatus: "none", sourceMissing: false, treatment: "NORMAL", classificationSource: "UNASSIGNED", reviewed: false, memo: "", createdAt: timestamp, updatedAt: timestamp, ...patch });
  // Two claims paid back to the same person on one day form one transfer of 9,100.
  const second: ExpenseClaim = { ...structuredClone(data.expenseClaims!.find((claim) => claim.id === "paid-pm")!), id: "paid-pm-2", amount: 3500, spentOn: "2026-10-06" };
  data.expenseClaims!.push(second);
  data.bankTransactions = [
    row("exact", 9100, "2026-10-21"), row("far", 9100, "2026-12-30"), row("partial", 5600, "2026-10-20"), row("income", 9100, "2026-10-20", { side: "INCOME" }),
    row("card-row", 9100, "2026-10-20", { bankAccountId: "card" }), row("invoiced", 9100, "2026-10-19"), row("later", 9100, "2026-10-24"),
  ];
  return data;
}
const items = (data: ReturnType<typeof expensesFixture>) => data.expenseClaims!.filter((row) => row.id.startsWith("paid-pm")).map((row) => ({ id: row.id, version: row.updatedAt }));

test("payout candidates are outgoing bank rows equal to the whole transfer, near the payment date, nearest first", () => {
  const data = payoutSetup(), received = data.receivedInvoices[0];
  received.status = "SCHEDULED"; received.total = 9100;
  const bank = data.bankTransactions.find((row) => row.id === "invoiced")!;
  confirmBankReconciliation(data, expenseAdmin, "JAPAN", { transactionId: bank.id, transactionUpdatedAt: bank.updatedAt, invoiceKind: "received", invoiceId: received.id, invoiceUpdatedAt: received.updatedAt, amount: 9100, mode: "new", acknowledged: true }, today);
  const detail = expensePayoutDetail(data, expenseAccountant, "JAPAN", "paid-pm-2", today);
  assert.equal(detail.total, 9100); assert.equal(detail.items.length, 2); assert.equal(detail.submitterName, "合成担当");
  assert.deepEqual(detail.candidates.map((row) => [row.id, row.days]), [["exact", 1], ["later", 4]]);
  assert.throws(() => expensePayoutDetail(data, expenseDesigner, "JAPAN", "paid-pm", today), /権限/);
  assert.throws(() => expensePayoutDetail(data, expenseAccountant, "JAPAN", "approved-pm", today), /精算済み/);
});

test("linking covers the whole transfer, leaves the bank row untouched and blocks other matches until unlinked", () => {
  const data = payoutSetup(), before = structuredClone(data.bankTransactions.find((row) => row.id === "exact")!);
  const bank = data.bankTransactions.find((row) => row.id === "exact")!;
  assert.throws(() => linkExpensePayout(data, expenseAccountant, "JAPAN", { claimId: "paid-pm", items: items(data).slice(0, 1), transactionId: bank.id, transactionUpdatedAt: bank.updatedAt }, today), /すべて/);
  assert.throws(() => linkExpensePayout(data, expenseAccountant, "JAPAN", { claimId: "paid-pm", items: items(data), transactionId: "partial", transactionUpdatedAt: timestamp }, today), /一致しません/);
  assert.throws(() => linkExpensePayout(data, expenseAccountant, "JAPAN", { claimId: "paid-pm", items: items(data), transactionId: "income", transactionUpdatedAt: timestamp }, today), /出金/);
  linkExpensePayout(data, expenseAccountant, "JAPAN", { claimId: "paid-pm", items: items(data), transactionId: bank.id, transactionUpdatedAt: bank.updatedAt }, today);
  assert.deepEqual(data.bankTransactions.find((row) => row.id === "exact"), before);
  for (const claim of data.expenseClaims!.filter((row) => row.id.startsWith("paid-pm"))) {
    assert.equal(claim.payout?.transactionId, "exact"); assert.equal(claim.payout?.evidence, payoutEvidence(bank)); assert.equal(claim.history.at(-1)?.action, "LINK_BANK");
  }
  const detail = expensePayoutDetail(data, expenseAccountant, "JAPAN", "paid-pm", today);
  assert.equal(detail.linked?.id, "exact"); assert.equal(detail.issue, ""); assert.deepEqual(detail.candidates, []);

  // The bank side shows the row as matched to the staff payout and refuses invoices or transfers on it.
  const overview = bankReconciliationOverview(data, "JAPAN", today).banks.find((row) => row.id === "exact")!;
  assert.equal(overview.state, "matched"); assert.equal(overview.expensePayout?.count, 2); assert.equal(overview.expensePayout?.total, 9100);
  assert.match(overview.issue, /経費精算/);
  const received = data.receivedInvoices[0]; received.status = "SCHEDULED"; received.total = 9100;
  assert.throws(() => confirmBankReconciliation(data, expenseAdmin, "JAPAN", { transactionId: bank.id, transactionUpdatedAt: bank.updatedAt, invoiceKind: "received", invoiceId: received.id, invoiceUpdatedAt: received.updatedAt, amount: 9100, mode: "new", acknowledged: true }, today), /経費精算/);
  data.bankTransactions.push({ ...structuredClone(bank), id: "incoming", sourceId: "incoming", side: "INCOME", bankAccountId: "card" });
  assert.throws(() => confirmBankTransfer(data, expenseAdmin, "JAPAN", { transactionId: bank.id, transactionUpdatedAt: bank.updatedAt, counterpartId: "incoming", counterpartUpdatedAt: bank.updatedAt, acknowledged: true }, today), /経費精算/);

  // Settlement can't be undone while the transfer is matched.
  const paid = data.expenseClaims!.find((row) => row.id === "paid-pm")!;
  assert.throws(() => applyExpenseMutation(data, expenseAccountant, "JAPAN", { action: "unpay", id: paid.id, version: paid.updatedAt }), /照合を解除/);
  unlinkExpensePayout(data, expenseAccountant, "JAPAN", { claimId: "paid-pm", items: items(data) });
  assert.ok(data.expenseClaims!.every((row) => !row.payout));
  assert.equal(paid.history.at(-1)?.action, "UNLINK_BANK");
  applyExpenseMutation(data, expenseAccountant, "JAPAN", { action: "unpay", id: paid.id, version: paid.updatedAt });
  assert.equal(paid.status, "APPROVED");
});

test("a bank row edited after matching surfaces on both sides, and stale or reused rows are refused", () => {
  const data = payoutSetup(), bank = data.bankTransactions.find((row) => row.id === "exact")!;
  linkExpensePayout(data, expenseAccountant, "JAPAN", { claimId: "paid-pm", items: items(data), transactionId: bank.id, transactionUpdatedAt: bank.updatedAt }, today);
  assert.throws(() => linkExpensePayout(data, expenseAccountant, "JAPAN", { claimId: "paid-pm", items: items(data), transactionId: "later", transactionUpdatedAt: timestamp }, today), /照合済み/);
  bank.content = "フリコミ 変更後";
  assert.match(expensePayoutDetail(data, expenseAccountant, "JAPAN", "paid-pm", today).issue, /変更されました/);
  const overview = bankReconciliationOverview(data, "JAPAN", today).banks.find((row) => row.id === "exact")!;
  assert.equal(overview.state, "conflict"); assert.match(overview.issue, /変更されました/);
  assert.throws(() => unlinkExpensePayout(data, expenseAccountant, "JAPAN", { claimId: "paid-pm", items: items(data).map((row) => ({ ...row, version: timestamp })) }), /更新されています/);
});

test("after sign-in only same-site app paths are followed", () => {
  assert.equal(safeNextPath("/expenses/capture"), "/expenses/capture");
  assert.equal(safeNextPath("/expenses?view=mine&claim=a-1"), "/expenses?view=mine&claim=a-1");
  for (const bad of ["//evil.example", "/\\evil.example", "https://evil.example", "/login", "/api/files/x", "expenses", "/x\ny", ""]) assert.equal(safeNextPath(bad), "", bad);
});

test("a stalled or failing OCR engine still returns a reading the person can complete by hand", async () => {
  const data = expensesFixture();
  const stalled = await readExpenseReceipt(data, expenseDesigner, "JAPAN", { name: "r.jpg", type: "image/jpeg", buffer: Buffer.from("jpeg") }, today,
    { ai: null, extract: () => new Promise(() => {}), extractTimeoutMs: 20 });
  assert.equal(stalled.amount, null); assert.ok(stalled.warnings.some((row) => row.includes("手入力")));
  const failed = await readExpenseReceipt(data, expenseDesigner, "JAPAN", { name: "r.jpg", type: "image/jpeg", buffer: Buffer.from("jpeg") }, today,
    { ai: async () => ({ amount: 980, payee: "合成売店" }), extract: async () => { throw new Error("wasm missing"); } });
  assert.equal(failed.amount, 980); assert.equal(failed.payee, "合成売店");
});
