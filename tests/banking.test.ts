import assert from "node:assert/strict";
import test from "node:test";
import { fixture, admin } from "./document-fixture";
import { applyBankRules, bankFilters, deleteBankDefinition, isBankDate, mergeBankMasters, mergeBankTransactions, monthRanges, saveAccountingCategory, saveBankEdits, saveBankRule, selectBankTransactions, sourceKey, type ImportedTransaction } from "../src/lib/banking";
import { canRole } from "../src/lib/rbac";
import { restoreUndoState } from "../src/lib/store";
import type { BankEdit, BankRuleInput, BankTransaction } from "../src/lib/banking-types";

const office = "0000-0001";
const range = { start: "2026-09-01", end: "2026-09-30" };
const source = (id = "t1", extra: Partial<ImportedTransaction> = {}): ImportedTransaction => ({ id, connected_account_id: "bank", connected_sub_account_id: "branch", date: "2026-09-15", value: 12000, side: "INCOME", content: "TEST PAYMENT", memo: null, journalizing_status: "none", ...extra });
function setup() {
  const data = fixture();
  const accounts = [{ id: "bank", name: "Test bank", serviceName: "Test bank", isManual: false }, { id: "bank", subId: "branch", name: "Test bank / Branch", serviceName: "Test bank", isManual: false }, { id: "card", name: "Test card", serviceName: "Test card", isManual: false }];
  const categories = [{ id: "sales", name: "Sales", group: "INCOME", available: true }, { id: "design", parentSourceId: "sales", name: "Design", group: "INCOME", available: true }, { id: "travel", name: "Travel", group: "EXPENSE", available: true }];
  mergeBankMasters(data, "JAPAN", office, accounts, categories);
  return data;
}
const edit = (row: BankTransaction, extra: Partial<BankEdit> = {}): BankEdit => ({ id: row.id, updatedAt: row.updatedAt, categoryId: row.categoryId, subCategoryId: row.subCategoryId, treatment: row.treatment, reviewed: row.reviewed, memo: row.memo, ...extra });
const catId = sourceKey("JAPAN", office, "category", "sales");
const rule = (extra: Partial<BankRuleInput> = {}): BankRuleInput => ({ name: "Auto sales", keyword: "payment", match: "CONTAINS", side: "INCOME", categoryId: catId, treatment: "NORMAL", priority: 100, enabled: true, ...extra });

test("bank and card transactions import once without changing invoice payments", () => {
  const data = setup(), invoices = JSON.stringify(data.issuedInvoices);
  const items = [source(), source("card-charge", { connected_account_id: "card", connected_sub_account_id: null, side: "EXPENSE", value: 5000 }), source("card-refund", { connected_account_id: "card", connected_sub_account_id: null, value: 500 })];
  assert.deepEqual(mergeBankTransactions(data, "JAPAN", office, items, range), { imported: 3, updated: 0 });
  assert.deepEqual(mergeBankTransactions(data, "JAPAN", office, items, range), { imported: 0, updated: 0 });
  assert.equal(data.bankTransactions.length, 3); assert.equal(data.payments.length, 0); assert.equal(JSON.stringify(data.issuedInvoices), invoices);
});
test("month ranges handle leap years, boundaries and invalid dates", () => {
  assert.equal(isBankDate("2026-02-30"), false);
  assert.deepEqual(monthRanges("2024-02-28", "2024-03-01"), [{ start: "2024-02-28", end: "2024-02-29" }, { start: "2024-03-01", end: "2024-03-01" }]);
  assert.equal(monthRanges("2023-01-01", "2026-10-08").length, 46);
  assert.throws(() => monthRanges("2026-03-01", "2026-02-01"));
});
test("source changes preserve manual categories and memos and invalidate review", () => {
  const data = setup(); mergeBankTransactions(data, "JAPAN", office, [source()], range);
  saveBankEdits(data, admin, "JAPAN", [edit(data.bankTransactions[0], { categoryId: catId, reviewed: true, memo: "Kept locally" })]);
  const original = data.bankTransactions[0].id;
  mergeBankTransactions(data, "JAPAN", office, [source("t1", { value: 13500, content: "CORRECTED PAYMENT" })], range);
  const row = data.bankTransactions[0];
  assert.equal(row.id, original); assert.equal(row.amount, 13500); assert.equal(row.categoryId, catId); assert.equal(row.memo, "Kept locally"); assert.equal(row.reviewed, false);
});
test("an incomplete or invalid period cannot partially mutate saved rows", () => {
  const data = setup(); mergeBankTransactions(data, "JAPAN", office, [source()], range);
  const before = JSON.stringify(data);
  assert.throws(() => mergeBankTransactions(data, "JAPAN", office, [source("t1", { value: 2 }), source("bad", { date: "2026-08-01" })], range));
  assert.equal(JSON.stringify(data), before);
  assert.throws(() => mergeBankTransactions(data, "JAPAN", office, [source(), source()], range));
  assert.equal(JSON.stringify(data), before);
});
test("missing source rows stay in history but are excluded from totals", () => {
  const data = setup(); mergeBankTransactions(data, "JAPAN", office, [source()], range);
  mergeBankTransactions(data, "JAPAN", office, [], range);
  assert.equal(data.bankTransactions.length, 1); assert.equal(data.bankTransactions[0].sourceMissing, true);
  assert.equal(selectBankTransactions(data, "JAPAN", bankFilters({})).summary.income, 0);
  mergeBankTransactions(data, "JAPAN", office, [source()], range);
  assert.equal(data.bankTransactions[0].sourceMissing, false);
});
test("batch edits are atomic, version checked and tenant scoped", () => {
  const data = setup(); mergeBankTransactions(data, "JAPAN", office, [source(), source("t2")], range);
  const before = JSON.stringify(data);
  assert.throws(() => saveBankEdits(data, admin, "JAPAN", [edit(data.bankTransactions[0], { categoryId: catId }), edit(data.bankTransactions[1], { updatedAt: "old" })]), /更新/);
  assert.equal(JSON.stringify(data), before);
  assert.throws(() => saveBankEdits(data, admin, "CHINA", [edit(data.bankTransactions[0])]), /見つかりません/);
  assert.throws(() => saveBankEdits(data, admin, "JAPAN", [edit(data.bankTransactions[0], { subCategoryId: sourceKey("JAPAN", office, "category", "design", "sales") })]), /補助科目/);
  assert.deepEqual(saveBankEdits(data, admin, "JAPAN", data.bankTransactions.map((row) => edit(row, { categoryId: catId, reviewed: true }))), { count: 2 });
});
test("unclassified ordinary transactions cannot be marked reviewed", () => {
  const data = setup(); mergeBankTransactions(data, "JAPAN", office, [source()], range);
  assert.throws(() => saveBankEdits(data, admin, "JAPAN", [edit(data.bankTransactions[0], { reviewed: true })]), /勘定科目/);
  saveBankEdits(data, admin, "JAPAN", [edit(data.bankTransactions[0], { treatment: "TRANSFER", reviewed: true })]);
  assert.equal(data.bankTransactions[0].reviewed, true);
});
test("rules match normalized text, side, parent account and priority", () => {
  const data = setup();
  saveBankRule(data, admin, "JAPAN", rule({ name: "lower priority", priority: 200, treatment: "TRANSFER" }));
  const saved = saveBankRule(data, admin, "JAPAN", rule({ bankAccountId: sourceKey("JAPAN", office, "account", "bank"), keyword: "ｐａｙｍｅｎｔ" }));
  mergeBankTransactions(data, "JAPAN", office, [source(), source("expense", { side: "EXPENSE" })], range);
  assert.equal(data.bankTransactions[0].ruleId, saved.id); assert.equal(data.bankTransactions[0].categoryId, catId);
  assert.equal(data.bankTransactions[1].categoryId, undefined); assert.equal(data.bankTransactions[0].reviewed, false);
});
test("rule application never overwrites manual or reviewed classification", () => {
  const data = setup(); mergeBankTransactions(data, "JAPAN", office, [source(), source("t2")], range);
  saveBankEdits(data, admin, "JAPAN", [edit(data.bankTransactions[0], { treatment: "EXCLUDED" })]);
  saveBankRule(data, admin, "JAPAN", rule());
  assert.equal(applyBankRules(data, admin, "JAPAN").count, 1);
  assert.equal(data.bankTransactions[0].treatment, "EXCLUDED");
  assert.equal(applyBankRules(data, admin, "JAPAN").count, 0);
});
test("disabled rules and unavailable categories are not applied", () => {
  const data = setup(); saveBankRule(data, admin, "JAPAN", rule({ enabled: false }));
  mergeBankTransactions(data, "JAPAN", office, [source()], range);
  assert.equal(data.bankTransactions[0].categoryId, undefined);
  data.bankRules[0].enabled = true; data.accountingCategories.find((row) => row.id === catId)!.available = false;
  assert.equal(applyBankRules(data, admin, "JAPAN").count, 0);
});

test("source-excluded records stay excluded even when a normal classification rule matches", () => {
  const data = setup(); saveBankRule(data, admin, "JAPAN", rule());
  mergeBankTransactions(data, "JAPAN", office, [source("t1", { journalizing_status: "excluded" })], range);
  assert.equal(data.bankTransactions[0].treatment, "EXCLUDED");
  assert.equal(applyBankRules(data, admin, "JAPAN").count, 0);
  mergeBankTransactions(data, "JAPAN", office, [source()], range);
  assert.equal(data.bankTransactions[0].treatment, "NORMAL");
  assert.equal(data.bankTransactions[0].categoryId, catId);
  mergeBankTransactions(data, "JAPAN", office, [source("t1", { journalizing_status: "excluded" })], range);
  assert.equal(data.bankTransactions[0].treatment, "EXCLUDED");
  assert.equal(selectBankTransactions(data, "JAPAN", bankFilters({})).summary.income, 0);
});

test("automatic categories are cleared when corrected source text no longer matches", () => {
  const data = setup(); saveBankRule(data, admin, "JAPAN", rule());
  mergeBankTransactions(data, "JAPAN", office, [source()], range);
  assert.equal(data.bankTransactions[0].categoryId, catId);
  mergeBankTransactions(data, "JAPAN", office, [source("t1", { content: "Unrelated corrected source" })], range);
  assert.equal(data.bankTransactions[0].categoryId, undefined);
  assert.equal(data.bankTransactions[0].classificationSource, "UNASSIGNED");
});
test("custom category CRUD and subcategory references are validated", () => {
  const data = setup();
  let category = saveAccountingCategory(data, admin, "JAPAN", { name: "Custom", group: "EXPENSE" });
  assert.throws(() => saveAccountingCategory(data, admin, "JAPAN", { name: " Custom ", group: "EXPENSE" }), /同名/);
  category = saveAccountingCategory(data, admin, "JAPAN", { ...category, name: "Renamed" });
  const sub = saveAccountingCategory(data, admin, "JAPAN", { name: "Detail", group: "EXPENSE", parentId: category.id });
  assert.throws(() => deleteBankDefinition(data, admin, "JAPAN", "category", category.id, category.updatedAt), /使用中/);
  deleteBankDefinition(data, admin, "JAPAN", "category", sub.id, sub.updatedAt);
  deleteBankDefinition(data, admin, "JAPAN", "category", category.id, category.updatedAt);
  assert.ok(data.accountingCategories.find((row) => row.id === category.id)?.deletedAt);
  const imported = data.accountingCategories.find((row) => row.id === catId)!;
  assert.throws(() => saveAccountingCategory(data, admin, "JAPAN", { ...imported, name: "Overwrite" }), /マネーフォワード/);
});
test("transfers, card settlements and excluded source rows are not counted twice", () => {
  const data = setup(); mergeBankTransactions(data, "JAPAN", office, [source("card", { side: "EXPENSE", connected_account_id: "card", connected_sub_account_id: null, value: 8000 }), source("settlement", { side: "EXPENSE", value: 8000 }), source("ignore", { journalizing_status: "excluded", value: 4000 })], range);
  saveBankEdits(data, admin, "JAPAN", [edit(data.bankTransactions[1], { treatment: "TRANSFER" })]);
  assert.deepEqual(selectBankTransactions(data, "JAPAN", bankFilters({})).summary, { income: 0, expense: 8000, excluded: 2, unclassified: 1 });
});
test("pagination, all month folders, filtering and sorting are consistent", () => {
  const data = setup();
  mergeBankTransactions(data, "JAPAN", office, Array.from({ length: 65 }, (_, n) => source(`t${n}`, { value: n + 1, content: `Payment ${n}` })), range);
  mergeBankTransactions(data, "JAPAN", office, [source("aug", { date: "2026-08-20" })], { start: "2026-08-01", end: "2026-08-31" });
  const result = selectBankTransactions(data, "JAPAN", bankFilters({ month: "2026-09", sort: "amount-desc", page: "2" }));
  assert.equal(result.rows.length, 15); assert.equal(result.total, 65); assert.equal(result.rows[0].amount, 15);
  assert.deepEqual(result.months, ["2026-09", "2026-08"]);
  assert.equal(selectBankTransactions(data, "CHINA", bankFilters({})).total, 0);
  assert.equal(selectBankTransactions(data, "JAPAN", bankFilters({ account: sourceKey("JAPAN", office, "account", "bank") })).total, 66);
  assert.equal(selectBankTransactions(data, "JAPAN", bankFilters({ q: "PAYMENT 64" })).total, 1);
});
test("foreign company/office identifiers never collide", () => {
  assert.notEqual(sourceKey("JAPAN", office, "transaction", "x:y"), sourceKey("CHINA", office, "transaction", "x:y"));
  assert.notEqual(sourceKey("JAPAN", office, "account", "x:y", "z"), sourceKey("JAPAN", office, "account", "x", "y:z"));
});
test("only administrators and accounting staff can access banking", () => {
  const data = setup(); mergeBankTransactions(data, "JAPAN", office, [source()], range);
  for (const role of ["BILLING_EDITOR", "MAIL_EDITOR", "PROJECT_MANAGER", "CHIEF_DESIGNER", "DESIGNER", "GUEST"] as const) {
    assert.equal(canRole(role, "view:banking"), false);
    assert.throws(() => saveBankEdits(data, { id: "user", role }, "JAPAN", [edit(data.bankTransactions[0])]), /権限/);
    assert.throws(() => saveBankRule(data, { id: "user", role }, "JAPAN", rule()), /権限/);
  }
  assert.equal(canRole("ACCOUNTING", "view:banking"), true);
});
test("legacy undo snapshots without banking collections remain valid", () => {
  const data = setup(), legacy = fixture() as unknown as Record<string, unknown>;
  for (const key of ["bankAccounts", "bankTransactions", "accountingCategories", "bankRules", "bankSyncStates"]) delete legacy[key];
  restoreUndoState(data, legacy); assert.ok(data.bankAccounts.length > 0);
});

test("undo of a classification keeps newer source data and requires review", () => {
  const data = setup(); mergeBankTransactions(data, "JAPAN", office, [source()], range);
  const row = data.bankTransactions[0];
  const before = { ...row, categoryId: catId, reviewed: true, memo: "Previous memo" };
  saveBankEdits(data, admin, "JAPAN", [edit(row, { treatment: "EXCLUDED", memo: "Changed memo" })]);
  mergeBankTransactions(data, "JAPAN", office, [source("t1", { value: 13500 })], range);
  const version = row.updatedAt;
  restoreUndoState(data, { format: "triangle-undo-patch-v1", changes: [{ collection: "bankTransactions", id: row.id, index: 0, before }] });
  assert.equal(data.bankTransactions[0].amount, 13500);
  assert.equal(data.bankTransactions[0].categoryId, catId);
  assert.equal(data.bankTransactions[0].memo, "Previous memo");
  assert.equal(data.bankTransactions[0].reviewed, false);
  assert.notEqual(data.bankTransactions[0].updatedAt, version);
});
