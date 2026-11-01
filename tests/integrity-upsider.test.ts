import assert from "node:assert/strict";
import test from "node:test";
import { integrityKnownFixture, knownBankRow } from "./integrity-known-fixture";
import { integrityBankCardSettlement, knownBankCardSettlement, bankCardSettlementDetail, bankSettlementClassificationProtected } from "../src/lib/bank-card-settlement";
import { integrityReport } from "../src/lib/integrity";
import { createBankSuggester } from "../src/lib/bank-classification";
import { bankDisplayRows, classifyBankTransaction, mergeBankTransactions, sourceKey } from "../src/lib/banking";
import { previewBulkReclassify } from "../src/lib/bank-bulk-reclassify";
import { prepareClassificationAi } from "../src/lib/bank-classification-ai";

test("UPSIDER integrity recognition normalizes half-width kana, Latin/full-width names and exact corporate payees", () => {
  const data = integrityKnownFixture(), row = knownBankRow("upsider", { treatment: "TRANSFER" });
  for (const content of ["振込 ｶ)ｱｯﾌﾟｻｲﾀﾞｰ", "UPSIDER", "アップサイダー", "振込 ＵＰＳＩＤＥＲ", "フリコミ (カ) アップサイダー", "口座振替 株式会社UPSIDER", "振込み アップサイダー", "  upsider  "]) {
    const result = integrityBankCardSettlement(data, { ...row, content }); assert.equal(result?.provider, "UPSIDER", content); assert.equal(result?.label, "UPSIDERカード精算");
    assert.equal(knownBankCardSettlement(data, { ...row, content }), undefined, "shared classifier must not change");
  }
  const before = structuredClone(data), report = integrityReport(data, "JAPAN");
  assert.ok(!report.issues.some((issue) => issue.kind === "transfer_half" && issue.target.id.startsWith("settlement-")));
  assert.deepEqual(report.cardSettlements, [{ provider: "アプラス", label: "アプラスカード精算", count: 1 }, { provider: "UPSIDER", label: "UPSIDERカード精算", count: 4 }]); assert.deepEqual(data, before);
});

test("refunds, reversals, fees, deposits and unrelated names/accounts remain outside UPSIDER recognition", () => {
  const data = integrityKnownFixture(), row = knownBankRow("upsider", { content: "UPSIDER", treatment: "TRANSFER" });
  for (const content of ["UPSIDER 返金", "振込 UPSIDER 手数料", "UPSIDER 取消", "UPSIDER 返還", "UPSIDER 返戻", "UPSIDER 組戻", "UPSIDER 払い戻し", "UPSIDER refund", "UPSIDER reversal", "UPSIDER fee", "UPSIDERショップ", "MYUPSIDER", "UPSIDERPAY", "アップサイダーズ", "UPSIDER 商品購入", "合成UPSIDER別会社"]) assert.equal(integrityBankCardSettlement(data, { ...row, content }), undefined, content);
  for (const patch of [{ side: "INCOME" as const }, { amount: 0 }, { amount: -1 }, { amount: NaN }, { company: "CHINA" as const }, { bankAccountId: "missing" }, { officeCode: "other" }, { sourceMissing: true }, { sourceStatus: "excluded" }]) assert.equal(integrityBankCardSettlement(data, { ...row, ...patch }), undefined);
  data.bankAccounts[0].company = "CHINA"; assert.equal(integrityBankCardSettlement(data, row), undefined);
  data.bankAccounts[0].company = "JAPAN";
  for (const kind of ["CARD", "OTHER", "UNKNOWN"] as const) { data.bankAccounts[0].overviewSettings = { kind, recordedAt: "2026-10-01" }; assert.equal(integrityBankCardSettlement(data, row), undefined); }
});

test("recognition is read-only and does not change classification previews, protection, AI, bulk edits or reconciliation details", () => {
  for (const treatment of ["NORMAL", "TRANSFER"] as const) {
    const data = integrityKnownFixture(); data.bankTransactions = [knownBankRow("upsider", { content: "UPSIDER", treatment, reviewed: true, categoryId: "misc", classificationSource: "MANUAL", classificationConfidence: "GUESS", classificationReason: "保存された根拠" })];
    const row = data.bankTransactions[0], before = structuredClone(data);
    assert.ok(integrityBankCardSettlement(data, row)); assert.equal(knownBankCardSettlement(data, row), undefined); assert.equal(bankCardSettlementDetail(data, row), undefined);
    assert.equal(bankSettlementClassificationProtected(data, row), true); const suggestion = createBankSuggester(data)(row); if (suggestion) { assert.equal(suggestion.categoryId, "misc"); assert.equal(suggestion.treatment, treatment); } assert.equal(classifyBankTransaction(data, row), false);
    const display = bankDisplayRows(data, [row])[0]; assert.equal(display.categoryId, "misc"); assert.equal(display.treatment, treatment); assert.equal(display.reviewed, true); assert.equal(display.classificationConfidence, "GUESS");
    assert.equal(previewBulkReclassify(data, "JAPAN", { content: row.content }).matched, treatment === "NORMAL" ? 1 : 0);
    prepareClassificationAi(data, "admin", "JAPAN", { ids: [row.id], batch: 0 }); integrityReport(data, "JAPAN"); assert.deepEqual(data, before);
  }
});

test("UPSIDER detection adds no synchronization auto-reclassification of previously saved reviewed rows", () => {
  const data = integrityKnownFixture(); data.bankAccounts[0].id = sourceKey("JAPAN", "office", "account", "bank"); data.bankTransactions = [];
  const imported = { id: "upsider-sync", connected_account_id: "bank", date: "2026-10-10", value: 12000, side: "EXPENSE" as const, content: "振込 ｶ)ｱｯﾌﾟｻｲﾀﾞｰ", journalizing_status: "none" };
  const range = { start: "2026-10-01", end: "2026-10-31" }; mergeBankTransactions(data, "JAPAN", "office", [imported], range);
  const row = data.bankTransactions[0]; Object.assign(row, { categoryId: "misc", classificationConfidence: "GUESS", classificationSource: "AUTO", classificationReason: "以前の推測", reviewed: true, treatment: "TRANSFER" });
  const before = structuredClone(row); assert.ok(integrityBankCardSettlement(data, row)); integrityReport(data, "JAPAN");
  mergeBankTransactions(data, "JAPAN", "office", [imported], range); assert.deepEqual(row, before);
});
