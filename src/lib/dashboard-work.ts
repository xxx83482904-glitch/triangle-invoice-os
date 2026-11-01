import type { DashboardDocument, DashboardSummary } from "@/lib/dashboard";

export type DashboardWorkView = "income" | "expense" | "review";

// Shared by the action counts and the existing document panel they open.
export function dashboardWorkRows(summary: DashboardSummary, view: DashboardWorkView, timing = "all") {
  return (view === "income" ? summary.receivables : view === "expense" ? summary.payables : summary.review)
    .filter((row) => view === "review" || timing === "all" || row.timing === timing && !row.paymentMismatch);
}

export type DashboardNextStep = {
  id: string; label: string; count: number; amount?: number; reason: string; caveat?: string;
  target: { view: DashboardWorkView; timing: string } | { href: string };
};

export type DashboardTimingKey = DashboardDocument["timing"] | "mismatch";
const timingOrder: DashboardTimingKey[] = ["overdue", "soon", "later", "undated", "mismatch"];

// Same split as dashboardWorkRows: a payment mismatch never counts toward a deadline bucket.
export function dashboardTimingBreakdown(rows: Pick<DashboardDocument, "timing" | "paymentMismatch" | "remaining">[]) {
  const buckets = new Map(timingOrder.map((key) => [key, { key, count: 0, cents: 0 }]));
  for (const row of rows) {
    const bucket = buckets.get(row.paymentMismatch ? "mismatch" : row.timing)!;
    bucket.count++; bucket.cents += Math.round(row.remaining * 100);
  }
  return timingOrder.map((key) => buckets.get(key)!).filter((bucket) => bucket.count > 0).map(({ key, count, cents }) => ({ key, count, amount: cents / 100 }));
}

export function dashboardReviewBreakdown(rows: Pick<DashboardDocument, "reasons">[]) {
  const counts = new Map<string, number>();
  for (const row of rows) for (const reason of row.reasons) counts.set(reason, (counts.get(reason) || 0) + 1);
  return [...counts].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason, "ja"));
}
