import assert from "node:assert/strict";
import test from "node:test";
import { bankActionBarVisible, bankAdvancedFilterCount, bankLedgerDate, bankLedgerSort, bankLoadedSelection, bankQuickStatus } from "../src/lib/bank-ledger-view";

const defaults = { category: "", status: "", sort: "date-desc", queryMode: "contains", excludeQuery: "" } as const;

test("quick statuses do not count as advanced filters", () => {
  for (const status of ["", "unreviewed", "reviewed"]) {
    assert.equal(bankQuickStatus(status), status);
    assert.equal(bankAdvancedFilterCount({ ...defaults, status }), 0);
  }
});

test("each other status leaves the quick choices unselected and counts once", () => {
  for (const status of ["unclassified", "held", "no-invoice", "transfer", "excluded", "missing"]) {
    assert.equal(bankQuickStatus(status), null);
    assert.equal(bankAdvancedFilterCount({ ...defaults, status }), 1);
  }
});

test("advanced filters count category, match mode and excluded words, but not ordering", () => {
  assert.equal(bankAdvancedFilterCount({ category: "travel", sort: "amount-asc", status: "held", queryMode: "exact", excludeQuery: "送料,手数料" }), 4);
  assert.equal(bankAdvancedFilterCount({ ...defaults, sort: "amount-asc" }), 0);
  assert.equal(bankAdvancedFilterCount({ ...defaults, excludeQuery: "  " }), 0);
});

test("ledger dates keep the year in all periods without timezone conversion", () => {
  assert.equal(bankLedgerDate("2026-10-30", "2026-10"), "10/30");
  assert.equal(bankLedgerDate("2026-01-05", "2026-01"), "1/5");
  assert.equal(bankLedgerDate("2026-09-05", "2026-09"), "9/5");
  assert.equal(bankLedgerDate("2026-10-30", ""), "2026/10/30");
  assert.equal(bankLedgerDate("", ""), "");
  assert.equal(bankLedgerDate("unknown", "2026-10"), "unknown");
});

test("sortable headings toggle the same column and start another column descending", () => {
  assert.equal(bankLedgerSort("date-desc", "date"), "date-asc");
  assert.equal(bankLedgerSort("date-asc", "date"), "date-desc");
  assert.equal(bankLedgerSort("date-desc", "amount"), "amount-desc");
  assert.equal(bankLedgerSort("amount-desc", "amount"), "amount-asc");
});

test("the action bar needs a selection or a saveable change", () => {
  assert.equal(bankActionBarVisible(0, false), false);
  assert.equal(bankActionBarVisible(1, false), true);
  assert.equal(bankActionBarVisible(0, true), true);
  assert.equal(bankActionBarVisible(1, true), true);
});

test("the header checkbox covers none, some and all of the eligible loaded scope", () => {
  const scope = new Set(["a", "b"]);
  assert.deepEqual(bankLoadedSelection(scope, new Set()), { all: false, some: false });
  assert.deepEqual(bankLoadedSelection(scope, new Set(["a"])), { all: false, some: true });
  assert.deepEqual(bankLoadedSelection(scope, scope), { all: true, some: false });
  assert.deepEqual(bankLoadedSelection(new Set(), new Set()), { all: false, some: false });
});
