import assert from "node:assert/strict";
import test from "node:test";
import { bankEditFrom, bankMatchingSelection, bankRenderWindow, bankSaveChanges, bankSaveIds, patchBankDraft, removeSavedBankDrafts, type BankDrafts } from "../src/lib/bank-workspace-drafts";
import { BankLoadGuard, bankWorkspaceRevision, mergeBankWorkspaceRows } from "../src/lib/bank-workspace-loading";
import { bankSearchHighlights } from "../src/lib/bank-search-highlight";
import { bankFilters, saveBankEdits, selectBankTransactions, type BankDisplayRow } from "../src/lib/banking";
import { reviewBankDrafts } from "../src/lib/bank-ledger";
import { fixture, admin } from "./document-fixture";
import type { BankTransaction } from "../src/lib/banking-types";

function transaction(id = "a", patch: Partial<BankTransaction> = {}): BankTransaction {
  return { id, company: "JAPAN", officeCode: "office", sourceId: id, bankAccountId: "account", transactionDate: "2026-10-30", side: "EXPENSE", amount: 1000, content: `Merchant ${id}`, memo: "", sourceMemo: "", sourceStatus: "none", sourceMissing: false, treatment: "NORMAL", reviewed: false, classificationSource: "UNASSIGNED", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", ...patch };
}
const predicted = (row: BankTransaction): BankDisplayRow => ({ ...row, categoryId: "predicted", treatment: "NORMAL", classificationSource: "AUTO", predictionPending: true });

test("loading predictions creates no manual or reviewed save scope", () => {
  const rows = [predicted(transaction()), predicted(transaction("b"))];
  assert.deepEqual(bankSaveIds(rows, {}, new Set(), "edited"), []);
  assert.deepEqual(bankSaveIds(rows, {}, new Set(rows.map((row) => row.id)), "reviewed"), []);
  assert.deepEqual(bankSaveChanges(rows.map((row) => transaction(row.id)), rows, {}, new Set(), "edited"), []);
});

test("memo edits never adopt automatic category or treatment predictions", () => {
  const before = transaction("a", { treatment: "EXCLUDED" });
  const shown = predicted(before);
  const drafts = { a: patchBankDraft({}, shown, { memo: "checked receipt" }) };
  const [change] = bankSaveChanges([before], [shown], drafts, new Set(), "edited");
  assert.equal(change.after.categoryId, undefined);
  assert.equal(change.after.treatment, "EXCLUDED");
  assert.equal(change.after.memo, "checked receipt");
  assert.equal(change.prediction, false);
});

test("Save Selected adopts only explicitly selected predictions, not excluded or unselected rows", () => {
  const originals = [transaction(), transaction("b"), transaction("excluded", { treatment: "EXCLUDED" })];
  const rows = [predicted(originals[0]), predicted(originals[1]), originals[2]];
  const changes = bankSaveChanges(originals, rows, {}, new Set(["a"]), "selected");
  assert.deepEqual(changes.map((row) => row.after.id), ["a"]);
  assert.equal(changes[0].after.reviewed, false);
  assert.equal(originals[2].treatment, "EXCLUDED");
});

test("explicit review adopts the inspected prediction without confirming others", () => {
  const before = transaction();
  const shown = predicted(before);
  const reviewed = reviewBankDrafts([shown], {}, true);
  const drafts = { a: patchBankDraft({}, shown, bankEditFrom(reviewed.a)) };
  const [change] = bankSaveChanges([before], [shown], drafts, new Set(), "reviewed");
  assert.equal(change.after.reviewed, true);
  assert.equal(change.after.categoryId, "predicted");
});

test("manual category patches preserve persisted linked treatment", () => {
  const before = transaction("a", { treatment: "TRANSFER" });
  const shown = predicted(before);
  const drafts = { a: patchBankDraft({}, shown, { categoryId: "manual", reviewed: false }) };
  assert.equal(bankSaveChanges([before], [shown], drafts, new Set(), "edited")[0].after.treatment, "TRANSFER");
});

test("partial saves remove acknowledged IDs only and retain hidden drafts", () => {
  const a = transaction(), b = transaction("b"), hidden = transaction("hidden");
  const drafts: BankDrafts = Object.fromEntries([a, b, hidden].map((row) => [row.id, patchBankDraft({}, row, { memo: "edit" })]));
  const remaining = removeSavedBankDrafts(drafts, [bankEditFrom(a)]);
  assert.deepEqual(Object.keys(remaining), ["b", "hidden"]);
  assert.deepEqual(Object.keys(drafts), ["a", "b", "hidden"]);
  assert.deepEqual(bankSaveIds([b], remaining, new Set(), "edited"), ["b", "hidden"]);
});

test("stale edits fail closed, but an already-applied lost-response edit is a no-op", () => {
  const before = transaction();
  const drafts = { a: patchBankDraft({}, before, { memo: "desired" }) };
  assert.throws(() => bankSaveChanges([{ ...before, updatedAt: "newer", memo: "other" }], [before], drafts, new Set(), "edited"), /更新/);
  assert.deepEqual(bankSaveChanges([{ ...before, updatedAt: "newer", memo: "desired", classificationSource: "MANUAL" }], [before], drafts, new Set(), "edited"), []);
});

test("reviewed and edited scopes do not expand to untouched predictions", () => {
  const a = transaction(), b = transaction("b"), c = transaction("c");
  const drafts = { a: patchBankDraft({}, a, { memo: "a" }), b: patchBankDraft({}, b, { memo: "b", reviewed: true, categoryId: "manual" }) };
  const rows = [a, b, predicted(c)];
  assert.deepEqual(bankSaveIds(rows, drafts, new Set(["c"]), "reviewed"), ["b"]);
  assert.deepEqual(bankSaveIds(rows, drafts, new Set(["c"]), "edited"), ["a", "b"]);
});

test("held review and invalid single-category changes on split rows stop at preview", () => {
  const held = transaction("held", { bookkeeping: { hold: { reason: "CATEGORY_UNCLEAR", question: "Receipt?" } } });
  const split = transaction("split", { bookkeeping: { splits: [{ id: "1", categoryId: "one", amount: 500, memo: "" }, { id: "2", categoryId: "two", amount: 500, memo: "" }] } });
  assert.throws(() => bankSaveChanges([held], [held], { held: patchBankDraft({}, held, { reviewed: true }) }, new Set(), "edited"), /保留/);
  assert.throws(() => bankSaveChanges([split], [split], { split: patchBankDraft({}, split, { categoryId: "one" }) }, new Set(), "edited"), /分割/);
  const memo = bankSaveChanges([split], [split], { split: patchBankDraft({}, split, { memo: "note" }) }, new Set(), "edited");
  assert.equal(memo.length, 1);
  assert.equal(memo[0].after.categoryId, undefined);
});

test("all matching selection spans 700 rows, respects exclusions and is independent of render windows", () => {
  const rows = Array.from({ length: 700 }, (_, i) => transaction(String(i), { treatment: i === 50 ? "EXCLUDED" : "NORMAL", sourceStatus: i === 51 ? "excluded" : "none" }));
  const selected = bankMatchingSelection(rows, new Set());
  assert.equal(selected.size, 698);
  assert.equal(selected.has("699"), true);
  assert.equal(selected.has("50"), false);
  assert.equal(selected.has("51"), false);
  selected.delete("699");
  assert.equal(bankRenderWindow(rows, 650).rows.length, 50);
  assert.equal(selected.has("699"), false);
  assert.equal(bankMatchingSelection(rows, new Set(["50"])).has("50"), true);
  assert.equal(bankRenderWindow(rows, 10000).offset, 650);
  assert.equal(bankRenderWindow([], 900).rows.length, 0);
});

test("server full selection honors exact and excluded search filters, tenant and stable ordering", () => {
  const data = fixture();
  data.bankTransactions = Array.from({ length: 700 }, (_, i) => transaction(String(i), { content: i % 2 ? "タクシー" : "信託タクシー" }));
  data.bankTransactions.push(transaction("foreign", { company: "CHINA", content: "タクシー" }));
  const filters = bankFilters({ q: "ﾀｸｼｰ", queryMode: "exact", excludeQuery: "信託" });
  const all = selectBankTransactions(data, "JAPAN", filters, { all: true });
  assert.equal(all.rows.length, 350);
  assert.equal(all.total, 350);
  assert.equal(all.rows.some((row) => row.company !== "JAPAN"), false);
  assert.equal(selectBankTransactions(data, "JAPAN", filters).rows.length, 50);
});

test("persisted memo save leaves unselected excluded row byte-for-byte unchanged", () => {
  const data = fixture();
  const before = transaction(), excluded = transaction("excluded", { treatment: "EXCLUDED", reviewed: true });
  data.bankTransactions = [before, excluded];
  const excludedBefore = structuredClone(excluded);
  const shown = predicted(before);
  const changes = bankSaveChanges([before], [shown], { a: patchBankDraft({}, shown, { memo: "safe" }) }, new Set(), "edited");
  saveBankEdits(data, admin, "JAPAN", changes.map((row) => row.after));
  assert.equal(before.categoryId, undefined);
  assert.equal(before.memo, "safe");
  assert.deepEqual(excluded, excludedBefore);
});

test("stale load completion cannot release a newer request or apply rows from old filters", () => {
  const guard = new BankLoadGuard();
  const old = guard.begin()!;
  assert.equal(guard.begin(), null);
  guard.invalidate();
  const next = guard.begin()!;
  assert.equal(guard.isCurrent(old), false);
  assert.equal(guard.finish(old), false);
  assert.equal(guard.begin(), null);
  assert.equal(guard.isCurrent(next), true);
  assert.equal(guard.finish(next), true);
  assert.notEqual(guard.begin(), null);
});

test("retry accepts a new generation without changing drafts or selection", () => {
  const guard = new BankLoadGuard();
  const drafts = { a: patchBankDraft({}, transaction(), { memo: "kept" }) };
  const selected = new Set(["a"]);
  const first = guard.begin()!;
  guard.finish(first);
  const retry = guard.begin()!;
  assert.equal(guard.isCurrent(first), false);
  assert.equal(guard.isCurrent(retry), true);
  assert.equal(drafts.a.memo, "kept");
  assert.deepEqual([...selected], ["a"]);
});

test("fresh streams win timestamp ties without overwriting a newer server row", () => {
  const original = transaction();
  const refreshed = { ...original, memo: "fresh" };
  assert.equal(mergeBankWorkspaceRows([original], [refreshed])[0].memo, "fresh");
  const newer = { ...original, updatedAt: "2026-10-31T00:00:00.000Z", memo: "newer" };
  assert.equal(mergeBankWorkspaceRows([newer], [refreshed])[0].memo, "newer");
  assert.equal(mergeBankWorkspaceRows([original], [refreshed], [newer])[0].memo, "newer");
});

test("fresh reads and later RSC revisions each advance the effective snapshot revision", () => {
  const stream = { revision: "fresh-read", baseRevision: "initial-props" };
  assert.equal(bankWorkspaceRevision("initial-props", stream), "fresh-read");
  assert.equal(bankWorkspaceRevision("after-save", stream), "after-save");
  assert.equal(bankWorkspaceRevision("fresh-read", stream), "fresh-read");
});

test("search highlight maps normalized kana and repeated matches back to original text", () => {
  const text = "振込 ｶﾞｽ  ガス";
  const parts = bankSearchHighlights(text, "ガス");
  assert.deepEqual(parts.filter((part) => part.matched).map((part) => part.text), ["ｶﾞｽ", "ガス"]);
  assert.equal(parts.map((part) => part.text).join(""), text);
  assert.deepEqual(bankSearchHighlights("ＴＡＸＩ  Fee", "taxi fee").filter((part) => part.matched).map((part) => part.text), ["ＴＡＸＩ  Fee"]);
});
