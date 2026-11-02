import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { countByMonth, monthTabsView } from "../src/lib/month-tabs";

test("month tabs run September to August of the selected month's fiscal year", () => {
  const view = monthTabsView("2026-10", ["2026-10", "2025-03"]);
  assert.equal(view.year, 2027);
  assert.equal(view.tabs[0], "2026-09");
  assert.equal(view.tabs[11], "2027-08");
  assert.equal(view.tabs.length, 12);
});

test("month tabs open on the newest month's year when all periods are shown", () => {
  assert.equal(monthTabsView("", ["2024-02", "2026-08", "2025-11"]).year, 2026);
});

test("year steps skip years without data and stop at both ends", () => {
  const view = monthTabsView("2024-01", ["2026-01", "2024-01", "2020-01"]);
  assert.deepEqual(view.years, [2026, 2024, 2020]);
  assert.equal(view.previousYear, 2020);
  assert.equal(view.nextYear, 2026);
  assert.equal(monthTabsView("2020-01", ["2026-01", "2020-01"]).previousYear, null);
  assert.equal(monthTabsView("2026-01", ["2026-01", "2020-01"]).nextYear, null);
});

test("today keeps the current year reachable when it has no data yet", () => {
  const view = monthTabsView("", ["2024-01"], "2026-10-05");
  assert.equal(view.year, 2024);
  assert.deepEqual(view.years, [2027, 2024]);
  assert.equal(view.nextYear, 2027);
});

test("undated keys stay out of the fiscal months and never produce a broken year", () => {
  for (const key of ["undated", "0000-00"]) {
    const view = monthTabsView(key, [key, "2026-01"]);
    assert.deepEqual(view.undated, [key]);
    assert.equal(view.year, 2026);
    assert.deepEqual(view.years, [2026]);
    assert.ok(!view.tabs.includes(key));
  }
});

test("a list with only undated rows has no fiscal tabs, and an empty list has nothing", () => {
  assert.deepEqual(monthTabsView("", ["undated"]).tabs, []);
  assert.equal(monthTabsView("", []).year, null);
  assert.deepEqual(monthTabsView("", []).undated, []);
});

test("month counts add up each row's month", () => {
  assert.deepEqual([...countByMonth(["2026-01", "2026-02", "2026-01"])], [["2026-01", 2], ["2026-02", 1]]);
});

for (const file of ["src/app/mail-sorter/ocr-documents-table.tsx", "src/app/received-invoices/received-invoices-workspace.tsx", "src/components/app/documents-workspace.tsx", "src/components/app/estimates-list.tsx", "src/components/app/banking-workspace.tsx"]) {
  test(`${file} picks months with the horizontal tabs`, () => {
    const source = readFileSync(file, "utf8");
    assert.match(source, /<MonthTabs\b/);
    assert.doesNotMatch(source, /月で絞り込み|月フォルダー欄の幅|collapsedMonths/);
  });
}
