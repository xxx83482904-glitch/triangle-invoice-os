import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { bankToday } from "@/lib/banking";
import { matchesCompany } from "@/lib/company";
import { expenseCategoryOptions, expenseClaimViews, expenseSettlementSummary } from "@/lib/expense-claim-edits";
import { can, canAccessCompany, defaultPathForRole } from "@/lib/rbac";
import { readDataForRequest } from "@/lib/store";
import { CaptureApp } from "./capture-app";

export const metadata: Metadata = {
  title: "経費精算 | TRIANGLE",
  manifest: "/expenses.webmanifest",
  appleWebApp: { capable: true, title: "経費精算", statusBarStyle: "default" },
  icons: { apple: "/expenses-icon-180.png" },
};

export const viewport: Viewport = { themeColor: "#111111" };

export default async function ExpenseCapturePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/expenses/capture");
  if (user.role === "GUEST" || !can(user, "submit:expenses")) redirect(defaultPathForRole(user.role));
  const company = "JAPAN" as const;
  if (!canAccessCompany(user, company)) redirect(defaultPathForRole(user.role));
  const data = await readDataForRequest(), today = bankToday();
  const mine = expenseClaimViews(data, user, company).filter((row) => row.submittedById === user.id);
  const summary = expenseSettlementSummary(mine, today).totals;
  const projects = data.projects.filter((row) => !row.deletedAt && matchesCompany(row, company))
    .sort((a, b) => a.name.localeCompare(b.name, "ja")).map((row) => ({ value: row.id, label: row.name }));
  // The person's own recent projects come first so a regular site is one tap away.
  const recentProjectIds = [...new Set(mine.filter((row) => row.projectId && projects.some((project) => project.value === row.projectId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((row) => row.projectId!))].slice(0, 5);
  const claims = mine.filter((row) => row.status !== "WITHDRAWN").slice(0, 30).map((row) => ({ id: row.id, spentOn: row.spentOn, payee: row.payee, purpose: row.purpose,
    amount: row.amount, status: row.status, reviewNote: row.reviewNote || "", paidAt: row.paidAt || "" }));
  return <CaptureApp name={user.name} company={company} today={today} categories={expenseCategoryOptions(data, company)} projects={projects}
    recentProjectIds={recentProjectIds} claims={claims} returnedCount={mine.filter((row) => row.status === "RETURNED").length}
    summary={{ submittedAmount: summary.submittedAmount, submittedCount: summary.submittedCount, approvedAmount: summary.approvedAmount, approvedCount: summary.approvedCount }} />;
}
