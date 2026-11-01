import assert from "node:assert/strict";
import test from "node:test";
import { admin } from "./document-fixture";
import { uxRound1Fixture } from "./ux-round1-fixture";
import { dashboardSummary } from "../src/lib/dashboard";
import { dashboardReviewBreakdown, dashboardTimingBreakdown, dashboardWorkRows } from "../src/lib/dashboard-work";

test("timing breakdown splits amounts by deadline, keeps payment mismatches apart and omits empty buckets", () => {
  const rows = [
    { timing: "overdue" as const, paymentMismatch: false, remaining: 100.1 },
    { timing: "overdue" as const, paymentMismatch: false, remaining: 200.2 },
    { timing: "overdue" as const, paymentMismatch: true, remaining: 50 },
    { timing: "later" as const, paymentMismatch: false, remaining: 10 },
  ];
  assert.deepEqual(dashboardTimingBreakdown(rows), [
    { key: "overdue", count: 2, amount: 300.3 },
    { key: "later", count: 1, amount: 10 },
    { key: "mismatch", count: 1, amount: 50 },
  ]);
  assert.deepEqual(dashboardTimingBreakdown([]), []);
});

test("review breakdown counts each reason and sorts the most common first", () => {
  assert.deepEqual(dashboardReviewBreakdown([{ reasons: ["内容確認", "金額未設定"] }, { reasons: ["内容確認"] }, { reasons: [] }]), [
    { reason: "内容確認", count: 2 },
    { reason: "金額未設定", count: 1 },
  ]);
});

test("the breakdown shown on the metric cards adds up to the dashboard totals and the deadline lists", () => {
  const today = "2026-11-01";
  const summary = dashboardSummary(uxRound1Fixture(today), admin, "JAPAN", today);
  for (const [view, rows, totals] of [["income", summary.receivables, summary.incoming], ["expense", summary.payables, summary.outgoing]] as const) {
    const breakdown = dashboardTimingBreakdown(rows);
    assert.equal(breakdown.reduce((sum, row) => sum + row.count, 0), totals.count);
    assert.equal(breakdown.reduce((sum, row) => sum + row.amount, 0), totals.amount);
    assert.equal(breakdown.find((row) => row.key === "overdue")?.count ?? 0, totals.overdue);
    assert.equal(breakdown.find((row) => row.key === "soon")?.count ?? 0, totals.soon);
    assert.equal(breakdown.find((row) => row.key === "overdue")?.count ?? 0, dashboardWorkRows(summary, view, "overdue").length);
  }
});
