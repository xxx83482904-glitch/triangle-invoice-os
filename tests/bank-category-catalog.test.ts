import assert from "node:assert/strict";
import test from "node:test";
import { applyBankCategoryDrafts, bankCategoryCatalog, bankCategorySection } from "../src/lib/bank-category-catalog";
import type { AccountingCategory, BankEdit, BankTransaction } from "../src/lib/banking-types";

const base = { company: "JAPAN" as const, createdAt: "2026-10-01", updatedAt: "2026-10-01" };
const category = (id: string, patch: Partial<AccountingCategory> = {}): AccountingCategory => ({ ...base, id, name: id, group: "EXPENSE", available: true, ...patch });
const transaction = (id: string, patch: Partial<BankTransaction> = {}): BankTransaction => ({ ...base, id, officeCode: "office-a", sourceId: id, bankAccountId: "bank", transactionDate: "2026-10-01", amount: 100, side: "EXPENSE", content: "Test", sourceMemo: "", sourceStatus: "", sourceMissing: false, treatment: "NORMAL", classificationSource: "HISTORY", reviewed: true, memo: "Keep memo", ...patch });

test("MF revenue and capital categories join the existing broad groups", () => {
  assert.equal(bankCategorySection("REVENUE").id, "INCOME");
  assert.equal(bankCategorySection("CAPITAL").id, "EQUITY");
  assert.equal(bankCategorySection("unknown").id, "OTHER");
  const list = bankCategoryCatalog([category("sales", { group: "REVENUE" }), category("fees"), category("capital", { group: "CAPITAL" })]);
  assert.deepEqual(list.map((item) => item.id), ["EXPENSE", "INCOME", "EQUITY"]);
});

test("search includes matching children and Japanese group labels", () => {
  const categories = [category("parent", { name: "通信費" }), category("child", { parentId: "parent", name: "ＳＡＡＳ" }), category("other", { parentId: "parent", name: "電話" })];
  const search = bankCategoryCatalog(categories, [], "saas");
  assert.equal(search[0].entries[0].category.id, "parent");
  assert.deepEqual(search[0].entries[0].children.map((row) => row.id), ["child"]);
  assert.equal(bankCategoryCatalog(categories, [], "経費")[0].entries[0].children.length, 2);
  assert.equal(bankCategoryCatalog(categories, [], "存在しない").length, 0);
});

test("only active categories compatible with every selected company and office are offered", () => {
  const categories = [category("common"), category("office", { officeCode: "office-a" }), category("china", { company: "CHINA" }), category("disabled", { available: false }), category("deleted", { deletedAt: "2026-10-01" }), category("orphan", { parentId: "missing" })];
  const rows = [transaction("a"), transaction("b", { officeCode: "office-b" })];
  assert.deepEqual(bankCategoryCatalog(categories, rows)[0].entries.map((entry) => entry.category.id), ["common"]);
});

test("bulk selection creates drafts only, preserves unrelated edits and resets review", () => {
  const rows = [transaction("a", { subCategoryId: "old" }), transaction("b", { treatment: "TRANSFER" })];
  const old = { a: { ...rows[0], memo: "Draft memo", updatedAt: "previous-version" }, other: { ...transaction("other") } };
  const snapshot = JSON.stringify({ rows, old });
  const next = applyBankCategoryDrafts(rows, old, category("travel"));
  assert.equal(next.a.memo, "Draft memo");
  assert.equal(next.a.updatedAt, "previous-version");
  assert.equal(next.a.subCategoryId, undefined);
  assert.equal(next.b.treatment, "TRANSFER");
  assert.equal(next.b.reviewed, false);
  assert.equal(next.b.classificationSource, "MANUAL");
  assert.equal(next.other, old.other);
  assert.equal(JSON.stringify({ rows, old }), snapshot);
});

test("supplementary categories require a valid parent and matching office", () => {
  const rows = [transaction("a")];
  const parent = category("fees");
  const child = category("sub", { parentId: "fees" });
  const drafts: Record<string, BankEdit> = {};
  assert.equal(applyBankCategoryDrafts(rows, drafts, parent, child).a.subCategoryId, "sub");
  assert.throws(() => applyBankCategoryDrafts(rows, drafts, parent, { ...child, parentId: "wrong" }));
  assert.throws(() => applyBankCategoryDrafts(rows, drafts, parent, { ...child, officeCode: "office-b" }));
  assert.throws(() => applyBankCategoryDrafts(rows, drafts, { ...parent, company: "CHINA" }));
  assert.throws(() => applyBankCategoryDrafts(rows, drafts, { ...parent, available: false }));
  assert.throws(() => applyBankCategoryDrafts(rows, drafts, child));
  assert.deepEqual(drafts, {});
});
