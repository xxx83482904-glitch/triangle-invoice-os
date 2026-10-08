import assert from "node:assert/strict";
import test from "node:test";
import { admin, fixture } from "./document-fixture";
import { applyBankRules, mergeBankMasters, mergeBankTransactions, saveBankEdits, saveBankRule, sourceKey, type ImportedTransaction } from "../src/lib/banking";
import { restoreUndoState } from "../src/lib/store";
import type { BankEdit, BankTransaction } from "../src/lib/banking-types";

const office = "0000-0001";
const range = { start: "2026-09-01", end: "2026-09-30" };
const category = (id: string) => sourceKey("JAPAN", office, "category", id);
const item = (id: string, content: string, extra: Partial<ImportedTransaction> = {}): ImportedTransaction => ({ id, content, connected_account_id: "bank", date: "2026-09-15", value: 1500, side: "EXPENSE", journalizing_status: "none", ...extra });
const edit = (row: BankTransaction, extra: Partial<BankEdit>): BankEdit => ({ id: row.id, updatedAt: row.updatedAt, categoryId: row.categoryId, subCategoryId: row.subCategoryId, treatment: row.treatment, reviewed: row.reviewed, memo: row.memo, ...extra });
function setup() {
  const data = fixture();
  mergeBankMasters(data, "JAPAN", office, [
    { id: "bank", name: "Test bank", serviceName: "Bank", isManual: false },
    { id: "card", name: "Test card", serviceName: "Card", isManual: false },
  ], [
    { id: "utility", name: "水道光熱費", group: "EXPENSE", available: true },
    { id: "fees", name: "支払手数料", group: "EXPENSE", available: true },
    { id: "travel", name: "旅費交通費", group: "EXPENSE", available: true },
    { id: "supplies", name: "消耗品費", group: "EXPENSE", available: true },
    { id: "office", parentSourceId: "supplies", name: "Office", group: "EXPENSE", available: true },
    { id: "interest", name: "受取利息", group: "INCOME", available: true },
  ]);
  return data;
}
function confirm(data: ReturnType<typeof setup>, row: BankTransaction, categoryId = category("supplies")) {
  saveBankEdits(data, admin, "JAPAN", [edit(row, { categoryId, reviewed: true })]);
}

test("bank and card imports classify known descriptions without rules and remain unreviewed", () => {
  const data = setup();
  const payments = JSON.stringify(data.payments), invoices = JSON.stringify(data.issuedInvoices);
  const items = [item("electric", "東京電力 電気料金"), item("train", "新幹線 東京", { connected_account_id: "card" }), item("fee", "振込手数料"), item("interest", "預金利息", { side: "INCOME" })];
  mergeBankTransactions(data, "JAPAN", office, items, range);
  assert.deepEqual(data.bankTransactions.map((row) => row.categoryId), [category("utility"), category("travel"), category("fees"), category("interest")]);
  assert.ok(data.bankTransactions.every((row) => row.classificationSource === "AUTO" && !row.reviewed && row.classificationReason));
  const versions = data.bankTransactions.map((row) => row.updatedAt);
  mergeBankTransactions(data, "JAPAN", office, items, range);
  assert.deepEqual(data.bankTransactions.map((row) => row.updatedAt), versions);
  assert.equal(JSON.stringify(data.payments), payments); assert.equal(JSON.stringify(data.issuedInvoices), invoices);
});

test("ambiguous merchants, mixed costs, settlements, top-ups and refunds stay unclassified", () => {
  const data = setup();
  mergeBankTransactions(data, "JAPAN", office, ["AMAZON", "楽天市場", "カード引落", "Suica チャージ", "タクシー 返金", "電気料金と電話料金", "新幹線", "売上振込", "保険料"].map((text, i) => item(String(i), text, i === 6 ? { side: "INCOME" } : {})), range);
  assert.ok(data.bankTransactions.every((row) => !row.categoryId && row.classificationSource === "UNASSIGNED" && row.treatment === "NORMAL"));
});

test("missing, unavailable and ambiguous categories are never invented or arbitrarily selected", () => {
  for (const mode of ["missing", "unavailable", "duplicate", "foreign-office"]) {
    const data = setup(), target = data.accountingCategories.find((row) => row.id === category("utility"))!;
    if (mode === "missing") data.accountingCategories = [];
    if (mode === "unavailable") target.available = false;
    if (mode === "duplicate") data.accountingCategories.push({ ...target, id: "duplicate" });
    if (mode === "foreign-office") target.officeCode = "0000-0002";
    mergeBankTransactions(data, "JAPAN", office, [item("one", "東京電力")], range);
    assert.equal(data.bankTransactions[0].categoryId, undefined, mode);
  }
});

test("manual edits, clearing a category, and reviewed or excluded rows remain protected", () => {
  const data = setup(), items = ["manual", "blank", "reviewed", "excluded"].map((id) => item(id, "電気料金", id === "excluded" ? { journalizing_status: "excluded" } : {}));
  mergeBankTransactions(data, "JAPAN", office, items, range);
  saveBankEdits(data, admin, "JAPAN", [edit(data.bankTransactions[0], { categoryId: category("supplies"), memo: "Keep" }), edit(data.bankTransactions[1], { categoryId: undefined })]);
  data.bankTransactions[2].reviewed = true;
  assert.equal(applyBankRules(data, admin, "JAPAN").count, 0);
  mergeBankTransactions(data, "JAPAN", office, items.map((row) => row.id === "manual" ? { ...row, value: 1700, content: "振込手数料" } : row), range);
  assert.equal(data.bankTransactions[0].categoryId, category("supplies")); assert.equal(data.bankTransactions[0].memo, "Keep");
  assert.equal(data.bankTransactions[0].classificationReason, undefined);
  assert.equal(data.bankTransactions[1].categoryId, undefined); assert.equal(data.bankTransactions[3].treatment, "EXCLUDED");
});

test("confirmed manual history reuses the exact account, side and normalized description including subcategory", () => {
  const data = setup(), first = item("old", "ＡＣＭＥ  SUPPLIES");
  mergeBankTransactions(data, "JAPAN", office, [first], range);
  saveBankEdits(data, admin, "JAPAN", [edit(data.bankTransactions[0], { categoryId: category("supplies"), subCategoryId: sourceKey("JAPAN", office, "category", "office", "supplies"), reviewed: true })]);
  mergeBankTransactions(data, "JAPAN", office, [first, item("new", "acme supplies"), item("other-account", "acme supplies", { connected_account_id: "card" }), item("other-side", "acme supplies", { side: "INCOME" }), item("other-merchant", "acme supplies online")], range);
  const row = data.bankTransactions[1];
  assert.equal(row.classificationSource, "HISTORY"); assert.equal(row.categoryId, category("supplies")); assert.ok(row.subCategoryId); assert.equal(row.reviewed, false);
  assert.ok(data.bankTransactions.slice(2).every((row) => !row.categoryId));
});

test("unreviewed manual edits and auto suggestions never teach other rows", () => {
  const data = setup(), first = item("old", "ACME");
  mergeBankTransactions(data, "JAPAN", office, [first], range);
  saveBankEdits(data, admin, "JAPAN", [edit(data.bankTransactions[0], { categoryId: category("supplies") })]);
  mergeBankTransactions(data, "JAPAN", office, [first, item("new", "ACME")], range);
  assert.equal(data.bankTransactions[1].categoryId, undefined);
  Object.assign(data.bankTransactions[0], { classificationSource: "AUTO", reviewed: true });
  assert.equal(applyBankRules(data, admin, "JAPAN").count, 0);
});

test("conflicting confirmed classifications block both history and built-in fallback", () => {
  const data = setup(), items = [item("a", "電気料金"), item("b", "電気料金"), item("c", "電気料金")];
  mergeBankTransactions(data, "JAPAN", office, items, range);
  confirm(data, data.bankTransactions[0]); confirm(data, data.bankTransactions[1], category("utility"));
  applyBankRules(data, admin, "JAPAN");
  assert.equal(data.bankTransactions[2].categoryId, undefined);
});

test("explicit user rules take precedence over history and built-in suggestions", () => {
  const data = setup(), items = [item("old", "電気料金"), item("new", "電気料金")];
  mergeBankTransactions(data, "JAPAN", office, items, range); confirm(data, data.bankTransactions[0]);
  const rule = saveBankRule(data, admin, "JAPAN", { name: "Custom electricity", keyword: "電気料金", match: "EXACT", side: "EXPENSE", treatment: "NORMAL", categoryId: category("fees"), priority: 100, enabled: true });
  applyBankRules(data, admin, "JAPAN");
  assert.equal(data.bankTransactions[1].ruleId, rule.id); assert.equal(data.bankTransactions[1].categoryId, category("fees")); assert.match(data.bankTransactions[1].classificationReason!, /Custom electricity/);
});

test("corrected or missing source history cannot classify peers in the same sync", () => {
  for (const missing of [false, true]) {
    const data = setup(), first = item("old", "ACME");
    mergeBankTransactions(data, "JAPAN", office, [first], range); confirm(data, data.bankTransactions[0]);
    mergeBankTransactions(data, "JAPAN", office, [item("new", "ACME"), ...(missing ? [] : [{ ...first, value: 2000 }])], range);
    assert.equal(data.bankTransactions.find((row) => row.sourceId === "new")!.categoryId, undefined);
  }
});

test("automatic classification is reconsidered when the source changes", () => {
  const data = setup();
  mergeBankTransactions(data, "JAPAN", office, [item("one", "東京電力")], range);
  mergeBankTransactions(data, "JAPAN", office, [item("one", "不明な取引")], range);
  assert.equal(data.bankTransactions[0].categoryId, undefined); assert.equal(data.bankTransactions[0].classificationReason, undefined);
});

test("bulk classification validates selection and permissions atomically and stays company scoped", () => {
  const data = setup();
  mergeBankTransactions(data, "JAPAN", office, [item("a", "Unclassified"), item("b", "Unclassified")], range);
  for (const row of data.bankTransactions) row.content = "電気料金";
  const before = JSON.stringify(data);
  assert.throws(() => applyBankRules(data, admin, "JAPAN", [data.bankTransactions[0].id, "unknown"]), /見つかりません/);
  assert.equal(JSON.stringify(data), before);
  assert.throws(() => applyBankRules(data, admin, "CHINA", [data.bankTransactions[0].id]), /見つかりません/);
  for (const role of ["BILLING_EDITOR", "MAIL_EDITOR", "DESIGNER"] as const) assert.throws(() => applyBankRules(data, { id: "staff", role }, "JAPAN"), /権限/);
  assert.throws(() => applyBankRules(data, admin, "JAPAN", []));
  assert.deepEqual(applyBankRules(data, admin, "JAPAN", [data.bankTransactions[0].id]), { count: 1, unclassified: 0 });
  assert.equal(data.bankTransactions[1].categoryId, undefined);
  assert.equal(applyBankRules(data, admin, "JAPAN").count, 1);
});

test("undo restores classification and reason without rolling back source amounts", () => {
  const data = setup(); mergeBankTransactions(data, "JAPAN", office, [item("one", "電気料金")], range);
  const row = data.bankTransactions[0], before = { ...row };
  confirm(data, row); row.amount = 9000;
  restoreUndoState(data, { format: "triangle-undo-patch-v1", changes: [{ collection: "bankTransactions", id: row.id, index: 0, before }] });
  assert.equal(data.bankTransactions[0].classificationReason, before.classificationReason); assert.equal(data.bankTransactions[0].classificationSource, "AUTO");
  assert.equal(data.bankTransactions[0].amount, 9000); assert.equal(data.bankTransactions[0].reviewed, false);
});

test("ten thousand existing rows are classified in one pass with stable reruns", () => {
  const data = setup();
  mergeBankTransactions(data, "JAPAN", office, [item("one", "Unknown")], range);
  const base = data.bankTransactions[0];
  data.bankTransactions = Array.from({ length: 10000 }, (_, i) => ({ ...base, id: `row-${i}`, sourceId: `row-${i}`, content: "振込手数料" }));
  assert.equal(applyBankRules(data, admin, "JAPAN").count, 10000);
  assert.equal(applyBankRules(data, admin, "JAPAN").count, 0);
});
