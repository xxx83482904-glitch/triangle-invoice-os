import assert from "node:assert/strict";
import test from "node:test";
import { isReconcileTodo, noDocumentExpected, reconcileTodoSince } from "../src/lib/bank-reconcile-todo";

const today = "2026-11-02";
const row = (patch: Partial<Parameters<typeof isReconcileTodo>[0]> = {}) => ({ state: "unmatched", date: "2026-10-15", content: "カ)ゴウセイコウムテン", categoryName: "外注費", invoiceRequirement: "UNDECIDED", ...patch });

test("the todo period is this month and last month, across a year boundary", () => {
  assert.equal(reconcileTodoSince("2026-11-02"), "2026-10-01");
  assert.equal(reconcileTodoSince("2026-01-15"), "2025-12-01");
  assert.equal(reconcileTodoSince("2026-03-31"), "2026-02-01");
});

test("the todo count starts on the first day of last month", () => {
  assert.equal(isReconcileTodo(row({ date: "2026-10-01" }), today), true);
  assert.equal(isReconcileTodo(row({ date: "2026-09-30" }), today), false);
  assert.equal(isReconcileTodo(row({ date: today }), today), true);
});

test("only unmatched rows are todo", () => {
  for (const state of ["matched", "conflict", "not_required", "excluded"]) assert.equal(isReconcileTodo(row({ state }), today), false, state);
});

test("rows that never come with an invoice are left out by their description", () => {
  for (const content of ["振込手数料", "ﾌﾘｺﾐﾃｽｳﾘﾖｳ", "フリコミテスウリョウ", "預金利息", "ﾘｿｸ", "給与振込", "ｷﾕｳﾖ", "ｼﾖｳﾖ", "融資返済", "ﾕｳｼﾍﾝｻｲ", "国庫金", "ｺﾂｺｷﾝ", "品川税務署", "ﾈﾝｷﾝｼﾞﾑｼﾖ", "日本年金機構", "東京都税"]) {
    assert.equal(noDocumentExpected({ content, categoryName: "", invoiceRequirement: "UNDECIDED" }), true, content);
  }
});

test("rows that never come with an invoice are left out by their category", () => {
  for (const categoryName of ["給料手当", "役員報酬", "法定福利費", "租税公課", "法人税等", "支払利息", "長期借入金"]) {
    assert.equal(noDocumentExpected({ content: "ﾌﾘｺﾐ", categoryName, invoiceRequirement: "UNDECIDED" }), true, categoryName);
  }
});

test("ordinary suppliers still count, including rows with no category yet", () => {
  for (const content of ["カ)ゴウセイコウムテン", "東京電力", "合成設計事務所", "ATM"]) assert.equal(noDocumentExpected({ content }), false, content);
  assert.equal(noDocumentExpected({ content: "カ)ゴウセイ", categoryName: "支払手数料" }), false);
});

test("a row marked as needing an invoice always counts", () => {
  assert.equal(noDocumentExpected({ content: "振込手数料", categoryName: "支払手数料", invoiceRequirement: "REQUIRED" }), false);
  assert.equal(isReconcileTodo(row({ content: "振込手数料", invoiceRequirement: "REQUIRED" }), today), true);
  assert.equal(isReconcileTodo(row({ content: "振込手数料" }), today), false);
});
