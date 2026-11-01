import type { DashboardSummary } from "@/lib/dashboard";

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
