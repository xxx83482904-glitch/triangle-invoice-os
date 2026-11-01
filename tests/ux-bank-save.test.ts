import assert from "node:assert/strict";
import test from "node:test";
import { availableBankSaveOption, bankSaveOptions } from "../src/lib/bank-save-options";
import { bankSaveChanges, bankSaveIds, patchBankDraft, removeSavedBankDrafts } from "../src/lib/bank-workspace-drafts";
import type { BankTransaction } from "../src/lib/banking-types";
import { bankDisplayRows, saveBankEdits, type BankDisplayRow } from "../src/lib/banking";
import { fixture, admin, timestamp } from "./document-fixture";
import { uxRound1Fixture } from "./ux-round1-fixture";
import { assertJapanData } from "../src/lib/japan-storage";

const row = (id: string): BankTransaction => ({ id, company: "JAPAN", officeCode: "office", sourceId: id, bankAccountId: "bank", transactionDate: "2026-10-30", amount: 1000, side: "EXPENSE", content: `合成明細 ${id}`, sourceMemo: "", sourceStatus: "", sourceMissing: false, treatment: "NORMAL", reviewed: false, classificationSource: "UNASSIGNED", memo: "", createdAt: timestamp, updatedAt: timestamp });
function sample() {
  const originals = [row("manual"), row("reviewed"), row("prediction"), row("unselected"), row("hidden")];
  const displayed: BankDisplayRow[] = originals.filter((r) => r.id !== "hidden").map((r) => r.id === "prediction" || r.id === "unselected" ? { ...r, categoryId: "expense", classificationSource: "AUTO", classificationConfidence: "GUESS", predictionPending: true } : r);
  const drafts = {
    manual: patchBankDraft({}, originals[0], { memo: "合成手動編集" }),
    reviewed: patchBankDraft({}, originals[1], { treatment: "EXCLUDED", reviewed: true }),
    hidden: patchBankDraft({}, originals[4], { memo: "合成表示外の編集" }),
  };
  return { originals, displayed, drafts, selected: new Set(["manual", "prediction"]) };
}

test("unified save offers the existing scopes without automatically adopting predictions", () => {
  const { originals, displayed, drafts, selected } = sample();
  const before = structuredClone({ originals, displayed, drafts, selected });
  const options = bankSaveOptions(displayed, drafts, selected);
  const expected = { all: ["manual", "reviewed", "hidden"], selected: ["manual", "prediction"], reviewed: ["reviewed"], edited: ["manual", "reviewed", "hidden"] };
  assert.equal(availableBankSaveOption(options)?.value, "all");
  for (const option of options) {
    assert.deepEqual(bankSaveIds(displayed, drafts, selected, option.scope), expected[option.value]);
    const changes = bankSaveChanges(originals, displayed, drafts, selected, option.scope);
    assert.deepEqual(changes.map((change) => change.after.id), expected[option.value]);
    assert.equal(option.count, changes.length);
    assert.deepEqual(changes.filter((change) => change.prediction).map((change) => change.after.id), option.value === "selected" ? ["prediction"] : []);
  }
  assert.deepEqual({ originals, displayed, drafts, selected }, before);
});

test("zero-count options cannot be selected, even when their value is supplied directly", () => {
  const { displayed } = sample();
  const empty = bankSaveOptions(displayed, {}, new Set());
  assert.ok(empty.every((option) => option.disabled && option.count === 0));
  assert.equal(availableBankSaveOption(empty), undefined);
  for (const option of empty) assert.equal(availableBankSaveOption(empty, option.value), undefined);
  const predictionsOnly = bankSaveOptions(displayed, {}, new Set(["prediction"]));
  assert.equal(availableBankSaveOption(predictionsOnly)?.value, "selected");
  assert.equal(availableBankSaveOption(predictionsOnly, "all"), undefined);
  assert.equal(availableBankSaveOption(predictionsOnly, "forged"), undefined);
});

test("each scope saves only its IDs and clears only acknowledged drafts", () => {
  for (const value of ["all", "selected", "reviewed", "edited"] as const) {
    const { originals, displayed, drafts, selected } = sample(), data = fixture();
    data.bankTransactions = originals;
    data.accountingCategories = [{ id: "expense", company: "JAPAN", name: "合成経費", group: "EXPENSE", available: true, createdAt: timestamp, updatedAt: timestamp }];
    const option = availableBankSaveOption(bankSaveOptions(displayed, drafts, selected), value)!;
    const changes = bankSaveChanges(originals, displayed, drafts, selected, option.scope);
    const before = structuredClone(originals), ids = new Set(changes.map((change) => change.after.id));
    saveBankEdits(data, admin, "JAPAN", changes.map((change) => change.after));
    for (const unchanged of before.filter((r) => !ids.has(r.id))) assert.deepEqual(data.bankTransactions.find((r) => r.id === unchanged.id), unchanged);
    assert.deepEqual(Object.keys(removeSavedBankDrafts(drafts, changes.map((change) => change.after))), Object.keys(drafts).filter((id) => !ids.has(id)));
    // No confirmation/acknowledgement from a failed request: keep every draft.
    assert.deepEqual(removeSavedBankDrafts(drafts, []), drafts);
    if (changes.length > 1) assert.deepEqual(Object.keys(removeSavedBankDrafts(drafts, [changes[0].after])), Object.keys(drafts).filter((id) => id !== changes[0].after.id));
  }
});

test("a zero-change recovered save does not send the same edit twice", () => {
  const { originals, displayed, drafts, selected } = sample();
  const persisted = { ...originals[0], memo: drafts.manual.memo, updatedAt: "new-version" };
  assert.deepEqual(bankSaveChanges([persisted], displayed, drafts, selected, "edited"), []);
  const remaining = removeSavedBankDrafts(drafts, [persisted]);
  assert.equal(bankSaveOptions(displayed, remaining, new Set([persisted.id])).find((o) => o.value === "selected")?.disabled, true);
  assert.ok(remaining.reviewed && remaining.hidden);
});

test("screen fixture produces two predictions and all four save choices after explicit edits", () => {
  const data = uxRound1Fixture(), before = structuredClone(data);
  assertJapanData(data);
  const displayed = bankDisplayRows(data, data.bankTransactions);
  assert.deepEqual(displayed.filter((r) => r.predictionPending).map((r) => r.id), ["ux-03-prediction", "ux-04-unselected"]);
  const manual = displayed.find((r) => r.id === "ux-01-manual")!, review = displayed.find((r) => r.id === "ux-02-review")!;
  const drafts = { [manual.id]: patchBankDraft({}, manual, { memo: "合成編集" }), [review.id]: patchBankDraft({}, review, { reviewed: true }) };
  const options = bankSaveOptions(displayed, drafts, new Set(["ux-03-prediction"]));
  assert.deepEqual(options.map((o) => [o.value, o.count, o.disabled]), [["all", 2, false], ["selected", 1, false], ["reviewed", 1, false], ["edited", 2, false]]);
  assert.deepEqual(data, before);
});
