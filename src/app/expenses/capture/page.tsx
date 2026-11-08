import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { bankToday } from "@/lib/banking";
import { myCardView } from "@/lib/card-receipts";
import { matchesCompany } from "@/lib/company";
import { expenseCategoryOptions, expenseClaimViews } from "@/lib/expense-claim-edits";
import { can, canAccessCompany, defaultPathForRole } from "@/lib/rbac";
import { readDataForRequest } from "@/lib/store";
import { CaptureApp } from "./capture-app";
import type { MyClaim } from "./model";

export const metadata: Metadata = {
  title: "経費精算 | TRIANGLE",
  manifest: "/expenses.webmanifest",
  appleWebApp: { capable: true, title: "経費精算", statusBarStyle: "default" },
  icons: { apple: "/expenses-icon-180.png" },
};

export const viewport: Viewport = { themeColor: "#111111" };

export default async function ExpenseCapturePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/expenses/capture");
  if (user.role === "GUEST" || !can(user, "submit:expenses")) redirect(defaultPathForRole(user.role));
  const company = "JAPAN" as const;
  if (!canAccessCompany(user, company)) redirect(defaultPathForRole(user.role));
  const params = await searchParams, param = (key: string) => typeof params[key] === "string" ? params[key] as string : "";
  const data = await readDataForRequest(), today = bankToday();
  const mine = expenseClaimViews(data, user, company).filter((row) => row.submittedById === user.id && row.status !== "WITHDRAWN");
  const projects = data.projects.filter((row) => !row.deletedAt && matchesCompany(row, company))
    .sort((a, b) => a.name.localeCompare(b.name, "ja")).map((row) => ({ value: row.id, label: row.name }));
  // The person's own recent projects come first so a regular site is one tap away.
  const recentProjectIds = [...new Set(mine.filter((row) => row.projectId && projects.some((project) => project.value === row.projectId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((row) => row.projectId!))].slice(0, 5);
  const claims: MyClaim[] = mine.slice(0, 100).map((row) => ({
    id: row.id, updatedAt: row.updatedAt, createdAt: row.createdAt,
    submittedAt: row.history.filter((entry) => entry.action === "SUBMIT" || entry.action === "RESUBMIT" || entry.action === "EDIT").at(-1)?.at || row.createdAt,
    spentOn: row.spentOn, payee: row.payee, purpose: row.purpose, amount: row.amount, status: row.status,
    reviewNote: row.reviewNote || "", reviewerName: row.reviewedById ? row.reviewerName : "", reviewedAt: row.reviewedAt || "", paidAt: row.paidAt || "",
    categoryId: row.categoryId || "", categoryName: row.categoryId ? row.categoryName : "", projectId: row.projectId || "", projectName: row.projectId ? row.projectName : "",
    paidWith: row.paidWith || "", memo: row.memo || "", registrationNumber: row.registrationNumber || "",
    tax10: row.taxBreakdown?.rate10 || 0, tax8: row.taxBreakdown?.rate8 || 0, fileUrl: row.fileUrl || "", mimeType: row.mimeType || "", editable: row.editable,
  }));
  return <CaptureApp name={user.name} company={company} today={today} categories={expenseCategoryOptions(data, company)} projects={projects}
    recentProjectIds={recentProjectIds} claims={claims} card={myCardView(data, user, company, today)} initial={{ view: param("view") === "list" ? "list" : undefined, claim: param("claim") || undefined }} />;
}
