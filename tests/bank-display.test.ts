import assert from "node:assert/strict";
import test from "node:test";
import { admin, fixture } from "./document-fixture";
import { bankDisplayRows, bankFilters, mergeBankMasters, mergeBankTransactions, previewBankRules, saveBankEdits, saveBankRule, selectBankTransactions } from "../src/lib/banking";
import { bankClassificationLabel } from "../src/lib/bank-classification";
import { bankingDataRevision } from "../src/lib/banking-revision";
import { restoreUndoState } from "../src/lib/store";

function setup(count = 1) {
  const data = fixture();
  mergeBankMasters(data, "JAPAN", "office", [{ id: "bank", name: "Test bank", serviceName: "Bank", isManual: false }], [
    { id: "misc", name: "雑費", group: "EXPENSE", available: true },
    { id: "fees", name: "支払手数料", group: "EXPENSE", available: true },
  ]);
  mergeBankTransactions(data, "JAPAN", "office", Array.from({ length: count }, (_, index) => ({ id: `row-${index}`, connected_account_id: "bank", date: `2026-10-${String(index % 27 + 1).padStart(2, "0")}`, value: index + 1, side: "EXPENSE" as const, content: `用途不明 ${index}`, journalizing_status: "none" })), { start: "2026-10-01", end: "2026-10-27" });
  return data;
}

test("display predictions fill blanks without changing data, timestamps or review status", () => {
  const data = setup(), before = JSON.stringify(data);
  const rows = bankDisplayRows(data, data.bankTransactions);
  assert.equal(JSON.stringify(data), before);
  assert.ok(rows[0].categoryId); assert.equal(rows[0].predictionPending, true);
  assert.equal(rows[0].updatedAt, data.bankTransactions[0].updatedAt);
  assert.equal(rows[0].reviewed, false);
  assert.equal(bankClassificationLabel(rows[0]).kind, "GUESS");
});

test("saving an unconfirmed guess keeps red provenance; explicit confirmation alone turns it blue; undo restores", () => {
  const data = setup(), candidate = bankDisplayRows(data, data.bankTransactions)[0];
  saveBankEdits(data, admin, "JAPAN", [candidate]);
  const saved = data.bankTransactions[0], before = { ...saved };
  assert.equal(bankClassificationLabel(saved).kind, "GUESS");
  assert.equal(saved.classificationSource, "MANUAL");
  assert.equal(saved.reviewed, false);
  saveBankEdits(data, admin, "JAPAN", [{ ...saved, reviewed: true }]);
  assert.equal(bankClassificationLabel(saved).kind, "CONFIRMED");
  restoreUndoState(data, { format: "triangle-undo-patch-v1", changes: [{ collection: "bankTransactions", id: saved.id, index: 0, before }] });
  assert.equal(bankClassificationLabel(data.bankTransactions[0]).kind, "GUESS");
});

test("guess-enabled preview retains existing categories and only proposes unassigned eligible rows", () => {
  const data = setup(5);
  const fee = data.accountingCategories.find((row) => row.name === "支払手数料")!.id;
  Object.assign(data.bankTransactions[0], { categoryId: fee, classificationSource: "AUTO", classificationConfidence: "INFERRED" });
  data.bankTransactions[1].treatment = "TRANSFER";
  data.bankTransactions[2].sourceMissing = true;
  data.bankTransactions[3].sourceStatus = "excluded";
  const before = JSON.stringify(data);
  const preview = previewBankRules(data, admin, "JAPAN", undefined, true);
  assert.equal(JSON.stringify(data), before);
  assert.equal(preview.rows.length, 1);
  assert.equal(preview.rows[0].id, data.bankTransactions[4].id);
  assert.ok(preview.rows[0].categoryId);
});

test("progressive reads reach all 137 filtered rows without duplication or changing draft versions", () => {
  const data = setup(137), before = JSON.stringify(data);
  const results = [1, 2, 3].map((page) => selectBankTransactions(data, "JAPAN", bankFilters({ month: "2026-10", page: String(page) })));
  const rows = results.flatMap((result) => bankDisplayRows(data, result.rows));
  assert.deepEqual(results.map((result) => result.rows.length), [50, 50, 37]);
  assert.equal(rows.length, 137); assert.equal(new Set(rows.map((row) => row.id)).size, 137);
  assert.ok(rows.every((row) => row.categoryId && !row.reviewed));
  assert.ok(rows.every((row, index) => !index || rows[index - 1].transactionDate >= row.transactionDate));
  assert.equal(JSON.stringify(data), before);
  assert.equal(selectBankTransactions(data, "CHINA", bankFilters({})).total, 0);
});

test("stale predictions and foreign-office categories are rejected before any data changes", () => {
  const data = setup(), candidate = bankDisplayRows(data, data.bankTransactions)[0];
  const category = data.accountingCategories.find((row) => row.id === candidate.categoryId)!;
  category.officeCode = "other";
  const before = JSON.stringify(data);
  assert.throws(() => saveBankEdits(data, admin, "JAPAN", [candidate]), /事業者/);
  assert.equal(JSON.stringify(data), before);
  category.officeCode = "office";
  data.bankTransactions[0].updatedAt = "2030-01-01T00:00:00Z";
  assert.throws(() => saveBankEdits(data, admin, "JAPAN", [candidate]), /更新/);
});

test("foreign-office rule categories cannot leak into display or explicit predictions", () => {
  const data = setup(), foreign = { ...data.accountingCategories[0], id: "foreign", officeCode: "another-office" };
  data.accountingCategories.push(foreign);
  saveBankRule(data, admin, "JAPAN", { name: "Wrong office", keyword: "用途不明", match: "CONTAINS", side: "ALL", categoryId: foreign.id, treatment: "NORMAL", priority: 1, enabled: true });
  assert.notEqual(bankDisplayRows(data, data.bankTransactions)[0].categoryId, foreign.id);
  assert.notEqual(previewBankRules(data, admin, "JAPAN", undefined, true).rows[0].categoryId, foreign.id);
});

test("legacy history remains yellow after a memo-only save", () => {
  const data = setup(), row = data.bankTransactions[0];
  Object.assign(row, { categoryId: data.accountingCategories[0].id, classificationSource: "HISTORY", classificationReason: "過去明細" });
  saveBankEdits(data, admin, "JAPAN", [{ ...row, memo: "Memo edit" }]);
  assert.equal(bankClassificationLabel(row).kind, "HISTORY");
});

test("scroll revision changes for source/category edits but not foreign company or read-only predictions", () => {
  const data = setup(), before = bankingDataRevision(data, "JAPAN");
  bankDisplayRows(data, data.bankTransactions);
  assert.equal(bankingDataRevision(data, "JAPAN"), before);
  data.bankTransactions.push({ ...data.bankTransactions[0], id: "foreign", company: "CHINA" });
  assert.equal(bankingDataRevision(data, "JAPAN"), before);
  data.bankTransactions[0].content = "Updated description";
  assert.notEqual(bankingDataRevision(data, "JAPAN"), before);
  const after = bankingDataRevision(data, "JAPAN");
  data.accountingCategories[0].available = false;
  assert.notEqual(bankingDataRevision(data, "JAPAN"), after);
});
