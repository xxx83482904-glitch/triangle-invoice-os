import assert from "node:assert/strict";
import test from "node:test";
import { matchesBankSearch } from "../src/lib/bank-search";

test("exact merchant matching does not include unrelated substring transfers", () => {
  const row = { content: "フドウサンシンタクジユタクシヤ", memo: "", sourceMemo: "" };
  assert.equal(matchesBankSearch(row, "タクシ"), true);
  assert.equal(matchesBankSearch(row, "タクシ", "exact"), false);
  assert.equal(matchesBankSearch(row, "タクシ", "contains", "シンタク"), false);
});
test("search normalizes widths and supports multiple explicit exclusions", () => {
  const row = { content: "ＰＡＹＰＡＬ ＺＯＯＭ", memo: "年額", sourceMemo: "" };
  assert.equal(matchesBankSearch(row, "paypal zoom", "exact"), true);
  assert.equal(matchesBankSearch(row, "zoom", "contains", "月額、年額"), false);
  assert.equal(matchesBankSearch(row, "年額", "exact"), false);
});
