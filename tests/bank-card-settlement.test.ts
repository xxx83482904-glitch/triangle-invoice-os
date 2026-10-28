import assert from "node:assert/strict";
import test from "node:test";
import { admin, fixture, timestamp } from "./document-fixture";
import { APLUS_SETTLEMENT_LABEL, bankCardSettlementDetail, knownBankCardSettlement } from "../src/lib/bank-card-settlement";
import { bankDisplayRows, bankFilters, classifyBankTransaction, mergeBankTransactions, previewBankRules, saveBankEdits, saveBankRule, selectBankTransactions, sourceKey } from "../src/lib/banking";
import { createBankSuggester } from "../src/lib/bank-classification";
import { prepareClassificationAi, validateClassificationAi } from "../src/lib/bank-classification-ai";
import { bankTransferDetail, bankTransferIssue, confirmBankTransfer } from "../src/lib/bank-transfers";
import { bankReconciliationOverview, confirmBankReconciliation, reconciliationCandidates, reconciliationIssue } from "../src/lib/bank-reconciliation";
import { bankForecastEvidence } from "../src/lib/bank-forecast";
import type { BankAccount, BankTransaction } from "../src/lib/banking-types";

const today = "2026-10-28";
const content = "口座振替 APアプラス";
function setup() {
  const data = fixture();
  data.users.push({ ...admin, name: "Admin", email: "admin@example.invalid", passwordHash: "test-only", accessStatus: "ACTIVE", createdAt: timestamp, updatedAt: timestamp });
  const bank: BankAccount = { id: "bank", company: "JAPAN", officeCode: "office", sourceId: "bank", name: "三菱UFJ銀行 1234567", serviceName: "三菱UFJ銀行", isManual: false, available: true, createdAt: timestamp, updatedAt: timestamp };
  data.bankAccounts = [bank, { ...bank, id: "card", sourceId: "card", name: "アプラス 1234567", serviceName: "アプラス" }, { ...bank, id: "other", sourceId: "other", name: "三菱UFJ銀行 7654321" }];
  data.accountingCategories = [{ id: "expense", company: "JAPAN", name: "雑費", group: "EXPENSE", available: true, createdAt: timestamp, updatedAt: timestamp }];
  const row: BankTransaction = { id: "settlement", company: "JAPAN", officeCode: "office", sourceId: "settlement", bankAccountId: "bank", transactionDate: "2026-10-20", amount: 12000, side: "EXPENSE", content, sourceMemo: "", sourceStatus: "none", sourceMissing: false, treatment: "NORMAL", classificationSource: "UNASSIGNED", reviewed: false, memo: "", createdAt: timestamp, updatedAt: timestamp };
  data.bankTransactions = [row];
  data.bankTransfers = [];
  data.receivedInvoices[0].status = "SCHEDULED";
  data.receivedInvoices[0].total = row.amount;
  return data;
}

test("known Aplus settlement detection normalizes AP width, case, kana and spaces with debit semantics", () => {
  const data = setup(), row = data.bankTransactions[0];
  for (const text of [content, "口座振替　ＡＰアプラス", "口座振替 ＡＰｱﾌﾟﾗｽ", "口座振替 ap ｱﾌﾟﾗｽ", "口座振替 1234 Ａ Ｐ アプラス", "口座振替 (10月分) AP(アプラス)", "  口座振替\tAP アプラス 1234  "]) {
    assert.equal(knownBankCardSettlement(data, { ...row, content: text })?.provider, "アプラス", text);
  }
  for (const text of ["アプラス", "APアプラス 商品購入", "振込 APアプラス", "口座振替 アプラス", "口座振替 MAPアプラス", "口座振替 APアプラスショップ", "口座振替 APアプラス 返金", "口座振替 返還 APアプラス", "口座振替 返戻 APアプラス", "口座振替 払戻 APアプラス", "口座振替 取消 APアプラス", "口座振替 手数料 APアプラス", "口座振替 refund APアプラス"]) {
    assert.equal(knownBankCardSettlement(data, { ...row, content: text }), undefined, text);
  }
});

test("settlement identification requires positive Japanese BANK expenses with a matching account", () => {
  const data = setup(), row = data.bankTransactions[0];
  for (const patch of [{ company: "CHINA" }, { side: "INCOME" }, { bankAccountId: "card" }, { bankAccountId: "missing" }, { officeCode: "other-office" }, { amount: 0 }, { amount: -12000 }, { amount: NaN }] as Array<Partial<BankTransaction>>) {
    assert.equal(knownBankCardSettlement(data, { ...row, ...patch }), undefined);
  }
  const account = data.bankAccounts[0];
  for (const kind of ["CARD", "OTHER", "UNKNOWN"] as const) {
    account.overviewSettings = { kind, recordedAt: timestamp };
    assert.equal(knownBankCardSettlement(data, row), undefined, kind);
  }
  account.overviewSettings = { kind: "BANK", recordedAt: timestamp };
  account.serviceName = "External account"; account.name = "Main account";
  assert.ok(knownBankCardSettlement(data, row));
  account.overviewSettings = undefined;
  assert.equal(knownBankCardSettlement(data, row), undefined);
  account.forecastSettings = { accountKind: "BANK", balanceMonth: "2026-10", minimumBalance: 0, incomePercent: 0, expensePercent: 0 };
  assert.ok(knownBankCardSettlement(data, row));
  account.forecastSettings.accountKind = "CARD";
  assert.equal(knownBankCardSettlement(data, row), undefined);
});

test("known settlements override stale AUTO/HISTORY expense guesses without categories, writes or review", () => {
  for (const source of ["UNASSIGNED", "AUTO", "HISTORY"] as const) {
    const data = setup(), row = data.bankTransactions[0];
    Object.assign(row, { classificationSource: source, categoryId: "expense", subCategoryId: "stale-sub", classificationReason: "Stale guess", classificationConfidence: "GUESS" });
    const before = structuredClone(data);
    for (const allowGuesses of [false, true]) {
      const suggestion = createBankSuggester(data, { allowGuesses })(row)!;
      assert.equal(suggestion.treatment, "TRANSFER"); assert.equal(suggestion.categoryId, undefined); assert.equal(suggestion.subCategoryId, undefined);
      const preview = previewBankRules(data, admin, "JAPAN", [row.id], allowGuesses);
      assert.equal(preview.count, 1); assert.equal(preview.rows[0].treatment, "TRANSFER");
      assert.equal(preview.rows[0].predictionPending, true); assert.equal(preview.rows[0].updatedAt, row.updatedAt);
    }
    const display = bankDisplayRows(data, [row])[0];
    assert.equal(display.treatment, "TRANSFER"); assert.equal(display.categoryId, undefined); assert.equal(display.subCategoryId, undefined);
    assert.equal(display.predictionPending, true); assert.equal(display.linkLabel, APLUS_SETTLEMENT_LABEL);
    assert.equal(display.reviewed, false); assert.equal(display.updatedAt, timestamp);
    assert.match(display.classificationReason!, /未照合/);
    assert.deepEqual(data, before);
    data.accountingCategories = [];
    assert.equal(bankDisplayRows(data, [row])[0].treatment, "TRANSFER");
  }
});

test("manual, reviewed and user RULE classifications remain unchanged with visible settlement conflicts", () => {
  for (const patch of [{ classificationSource: "MANUAL" }, { classificationSource: "RULE" }, { classificationSource: "AUTO", reviewed: true }, { ruleId: "legacy-user-rule" }] as Array<Partial<BankTransaction>>) {
    const data = setup(), row = data.bankTransactions[0];
    Object.assign(row, { categoryId: "expense", ...patch });
    const before = structuredClone(data);
    assert.equal(classifyBankTransaction(data, row), false);
    for (const allowGuesses of [false, true]) {
      assert.equal(createBankSuggester(data, { allowGuesses })(row), undefined);
      assert.equal(previewBankRules(data, admin, "JAPAN", undefined, allowGuesses).count, 0);
    }
    const display = bankDisplayRows(data, [row])[0];
    assert.equal(display.treatment, "NORMAL"); assert.equal(display.categoryId, row.categoryId); assert.equal(display.predictionPending, undefined);
    assert.match(display.settlementConflict!, /競合/);
    assert.match(bankCardSettlementDetail(data, row)!.conflict!, /競合/);
    assert.deepEqual(data, before);
  }
});

test("active user rules take precedence and categoryless transfer rules survive display fallback", () => {
  for (const treatment of ["NORMAL", "TRANSFER"] as const) {
    const data = setup(), row = data.bankTransactions[0];
    saveBankRule(data, admin, "JAPAN", { name: "User choice", keyword: "アプラス", match: "CONTAINS", side: "EXPENSE", treatment, categoryId: treatment === "NORMAL" ? "expense" : undefined, priority: 1, enabled: true });
    const before = structuredClone(data), display = bankDisplayRows(data, [row])[0];
    assert.equal(display.treatment, treatment); assert.equal(display.classificationSource, "RULE");
    assert.equal(display.predictionPending, true);
    assert.equal(Boolean(display.settlementConflict), treatment === "NORMAL");
    assert.equal(previewBankRules(data, admin, "JAPAN", undefined, true).rows[0].treatment, treatment);
    assert.deepEqual(data, before);
  }
  const data = setup(); data.bankTransactions[0].content = "Other transfer";
  saveBankRule(data, admin, "JAPAN", { name: "Explicit transfer", keyword: "Other transfer", match: "EXACT", side: "EXPENSE", treatment: "TRANSFER", priority: 1, enabled: true });
  const display = bankDisplayRows(data, data.bankTransactions)[0];
  assert.equal(display.treatment, "TRANSFER"); assert.equal(display.categoryId, undefined); assert.equal(display.predictionPending, true);
});

test("missing and provider-excluded settlement rows are never revived by a preview", () => {
  for (const patch of [{ sourceMissing: true }, { sourceStatus: "excluded", treatment: "EXCLUDED" }] as Array<Partial<BankTransaction>>) {
    const data = setup(), row = data.bankTransactions[0]; Object.assign(row, patch);
    const before = structuredClone(data);
    assert.equal(previewBankRules(data, admin, "JAPAN", undefined, true).count, 0);
    assert.equal(bankDisplayRows(data, [row])[0].predictionPending, undefined);
    assert.deepEqual(data, before);
  }
});

test("import and resync keep settlements unsaved until explicit SaveAll and reject stale predictions", () => {
  const data = setup(); data.bankTransactions = [];
  data.bankAccounts[0].id = sourceKey("JAPAN", "office", "account", "bank");
  const imported = { id: "settlement", connected_account_id: "bank", date: "2026-10-20", value: 12000, side: "EXPENSE" as const, content, journalizing_status: "none" };
  const range = { start: "2026-10-01", end: "2026-10-28" };
  mergeBankTransactions(data, "JAPAN", "office", [imported], range);
  const row = data.bankTransactions[0];
  assert.equal(row.treatment, "NORMAL"); assert.equal(row.classificationSource, "UNASSIGNED");
  Object.assign(row, { classificationSource: "HISTORY", categoryId: "expense" });
  const before = structuredClone(row);
  mergeBankTransactions(data, "JAPAN", "office", [imported], range);
  assert.deepEqual(row, before);
  const candidate = bankDisplayRows(data, [row])[0];
  mergeBankTransactions(data, "JAPAN", "office", [{ ...imported, value: 13000 }], range);
  const corrected = structuredClone(data);
  assert.throws(() => saveBankEdits(data, admin, "JAPAN", [candidate]), /更新/);
  assert.deepEqual(data, corrected);
  saveBankEdits(data, admin, "JAPAN", bankDisplayRows(data, [row]));
  assert.equal(row.treatment, "TRANSFER"); assert.equal(row.categoryId, undefined); assert.equal(row.reviewed, false);
  assert.equal(bankDisplayRows(data, [row])[0].predictionPending, undefined);
});

test("Aplus candidate accounts are company/office scoped and reconnect-deduplicated without period guesses", () => {
  const data = setup(), row = data.bankTransactions[0], card = data.bankAccounts[1];
  card.available = false;
  data.bankAccounts.push({ ...card, id: "reconnected", sourceId: "reconnected", available: true }, { ...card, id: "foreign-office", officeCode: "another" }, { ...card, id: "foreign-company", company: "CHINA" }, { ...card, id: "other-card", name: "UPSIDER", serviceName: "UPSIDER" });
  data.bankTransactions.push({ ...row, id: "old-card-purchase", bankAccountId: card.id, transactionDate: "2025-09-01", content: "Supplies" });
  const before = structuredClone(data), detail = bankCardSettlementDetail(data, row)!;
  assert.deepEqual(detail, { provider: "アプラス", accounts: [{ id: "reconnected", name: "アプラス 1234567" }], conflict: undefined });
  assert.deepEqual(bankTransferDetail(data, "JAPAN", row.id, today).settlement, detail);
  assert.deepEqual(data, before);
  data.bankAccounts = data.bankAccounts.filter((account) => account.id === "bank");
  assert.deepEqual(bankCardSettlementDetail(data, row)!.accounts, []);
});

test("generic transfer suggestions and confirmation reject Aplus debits from either side without mutation", () => {
  const data = setup(), row = data.bankTransactions[0];
  const incoming = { ...row, id: "incoming", bankAccountId: "other", side: "INCOME" as const, content: "Unrelated payment" };
  data.bankTransactions.push(incoming);
  const before = structuredClone(data);
  for (const [first, second] of [[row, incoming], [incoming, row]]) {
    assert.deepEqual(bankTransferDetail(data, "JAPAN", first.id, today).candidates, []);
    assert.throws(() => confirmBankTransfer(data, admin, "JAPAN", { transactionId: first.id, transactionUpdatedAt: first.updatedAt, counterpartId: second.id, counterpartUpdatedAt: second.updatedAt, acknowledged: true }, today), /アプラス/);
  }
  assert.match(bankTransferDetail(data, "JAPAN", row.id, today).issue, /アプラス/);
  assert.deepEqual(data, before);
});

test("settlements cannot suggest or confirm received invoices even with matching payee, date and amount", () => {
  for (const treatment of ["NORMAL", "TRANSFER"] as const) {
    const data = setup(), row = data.bankTransactions[0], invoice = data.receivedInvoices[0];
    row.treatment = treatment; data.vendors[0].companyName = "アプラス";
    const before = structuredClone(data), overview = bankReconciliationOverview(data, "JAPAN", today);
    assert.match(overview.banks[0].issue, /アプラス/);
    assert.deepEqual(reconciliationCandidates(overview.banks[0], overview.invoices), []);
    assert.throws(() => confirmBankReconciliation(data, admin, "JAPAN", { transactionId: row.id, transactionUpdatedAt: row.updatedAt, invoiceKind: "received", invoiceId: invoice.id, invoiceUpdatedAt: invoice.updatedAt, mode: "new", amount: row.amount, acknowledged: true }, today), /アプラス/);
    assert.deepEqual(data, before);
  }
});

test("existing invoice and transfer confirmations remain intact and expose conflicts", () => {
  for (const kind of ["invoice", "transfer"] as const) {
    const data = setup(), row = data.bankTransactions[0]; row.content = "Supplier payment";
    if (kind === "invoice") {
      const invoice = data.receivedInvoices[0];
      confirmBankReconciliation(data, admin, "JAPAN", { transactionId: row.id, transactionUpdatedAt: row.updatedAt, invoiceKind: "received", invoiceId: invoice.id, invoiceUpdatedAt: invoice.updatedAt, mode: "new", amount: row.amount, acknowledged: true }, today);
    } else {
      const incoming = { ...row, id: "incoming", bankAccountId: "other", side: "INCOME" as const };
      data.bankTransactions.push(incoming);
      confirmBankTransfer(data, admin, "JAPAN", { transactionId: row.id, transactionUpdatedAt: row.updatedAt, counterpartId: incoming.id, counterpartUpdatedAt: incoming.updatedAt, acknowledged: true }, today);
      // A legacy automatic row is still protected by its confirmed link.
      row.classificationSource = "AUTO"; row.reviewed = false;
    }
    row.content = content;
    const before = structuredClone(data);
    assert.equal(classifyBankTransaction(data, row), false);
    assert.equal(previewBankRules(data, admin, "JAPAN", [row.id], true).count, 0);
    assert.equal(bankDisplayRows(data, [row])[0].predictionPending, undefined);
    assert.match(bankDisplayRows(data, [row])[0].settlementConflict!, /要確認/);
    assert.match(bankCardSettlementDetail(data, row)!.conflict!, /要確認/);
    assert.match(bankTransferDetail(data, "JAPAN", row.id, today).issue, /アプラス/);
    if (kind === "invoice") {
      assert.match(reconciliationIssue(data, data.bankReconciliations[0], today), /アプラス/);
      assert.equal(bankReconciliationOverview(data, "JAPAN", today).banks[0].conflict, true);
    } else {
      assert.match(bankTransferIssue(data, data.bankTransfers![0], today), /アプラス/);
      assert.ok(bankTransferDetail(data, "JAPAN", row.id, today).link);
    }
    assert.deepEqual(data, before);
  }
});

test("AI standard/history classification excludes known settlements and never learns their expense history", () => {
  const data = setup(), row = data.bankTransactions[0];
  data.bankTransactions.push({ ...row, id: "stale-auto", categoryId: "expense", classificationSource: "AUTO" }, { ...row, id: "stale-history", categoryId: "expense", classificationSource: "HISTORY" },
    { ...row, id: "manual-history", categoryId: "expense", classificationSource: "MANUAL", reviewed: false, classificationConfidence: "GUESS", classificationReason: "AI候補: prior" },
    { ...row, id: "confirmed-expense", categoryId: "expense", classificationSource: "MANUAL", reviewed: true, transactionDate: "2026-09-20" },
    { ...row, id: "ordinary", content: "Office supplies" });
  const before = structuredClone(data);
  for (const history of [false, true]) {
    const prepared = prepareClassificationAi(data, admin.id, "JAPAN", { batch: 0, history });
    assert.deepEqual(prepared.rows.map((item) => item.id), ["ordinary"]);
    assert.equal(prepared.preview.payload.history?.length || 0, 0);
    assert.equal(JSON.stringify(prepared.preview.payload).includes("アプラス"), false);
    const result = validateClassificationAi(prepared, { decisions: [{ bankRef: "B1", categoryRef: "C1", confidence: "low", reason: "Purchase details unknown", quote: "Office supplies", historyRef: null }] }, "test-model");
    assert.deepEqual(result.rows.map((item) => item.id), ["ordinary"]);
  }
  assert.equal(createBankSuggester(data, { allowGuesses: true })(row)!.treatment, "TRANSFER");
  assert.deepEqual(data, before);
});

test("saving settlements avoids double expense with card usage while retaining the actual bank debit", () => {
  const data = setup(), row = data.bankTransactions[0];
  data.bankTransactions.push({ ...row, id: "card-purchase", bankAccountId: "card", content: "Office supplies", transactionDate: "2026-09-20", categoryId: "expense", classificationSource: "MANUAL", reviewed: true });
  const raw = data.bankTransactions.map((item) => [item.id, item.bankAccountId, item.amount, item.side, item.transactionDate, item.content]);
  const documents = structuredClone([data.payments, data.receivedInvoices, data.issuedInvoices, data.mailDocuments]);
  const cash = bankForecastEvidence(data, "JAPAN", "bank", today);
  const preview = bankDisplayRows(data, [row])[0];
  const projected = { ...data, bankTransactions: [preview, data.bankTransactions[1]] };
  assert.equal(selectBankTransactions(projected, "JAPAN", bankFilters({})).summary.expense, 12000);
  saveBankEdits(data, admin, "JAPAN", [preview]);
  assert.equal(selectBankTransactions(data, "JAPAN", bankFilters({})).summary.expense, 12000);
  assert.equal(selectBankTransactions(data, "JAPAN", bankFilters({ account: "bank" })).summary.expense, 0);
  assert.deepEqual(bankForecastEvidence(data, "JAPAN", "bank", today), cash);
  assert.equal(cash.current.expense, 12000);
  assert.deepEqual(data.bankTransactions.map((item) => [item.id, item.bankAccountId, item.amount, item.side, item.transactionDate, item.content]), raw);
  assert.deepEqual([data.payments, data.receivedInvoices, data.issuedInvoices, data.mailDocuments], documents);
});
