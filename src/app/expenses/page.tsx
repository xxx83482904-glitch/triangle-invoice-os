import { redirect } from "next/navigation";
import { AppShell, PageHeader } from "@/components/app/shell";
import { getCurrentUser } from "@/lib/auth";
import { bankToday } from "@/lib/banking";
import { companyFromParam, matchesCompany } from "@/lib/company";
import { expenseCategoryOptions, expenseClaimViews, expenseSettlementSummary } from "@/lib/expense-claim-edits";
import { expenseStatuses } from "@/lib/expense-claims";
import { can, canAccessCompany } from "@/lib/rbac";
import { defaultPathForUser } from "@/lib/app-navigation";
import { readDataForRequest } from "@/lib/store";
import { ExpensesWorkspace } from "./expenses-workspace";

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user, "submit:expenses")) redirect(defaultPathForUser(user));
  const params = await searchParams;
  const param = (key: string) => typeof params[key] === "string" ? params[key] : undefined;
  const company = companyFromParam(param("company"));
  if (!canAccessCompany(user, company)) redirect(defaultPathForUser(user));
  const data = await readDataForRequest(), today = bankToday(), canManage = can(user, "manage:expenses");
  const views = expenseClaimViews(data, user, company);
  const summary = { all: expenseSettlementSummary(views, today), mine: expenseSettlementSummary(views.filter((row) => row.submittedById === user.id), today) };
  const projects = data.projects.filter((row) => !row.deletedAt && matchesCompany(row, company))
    .sort((a, b) => a.name.localeCompare(b.name, "ja")).map((row) => ({ value: row.id, label: row.name }));
  const historyActors = new Set(views.flatMap((row) => row.history.map((entry) => entry.byId)));
  const actors = Object.fromEntries(data.users.filter((row) => historyActors.has(row.id)).map((row) => [row.id, row.name]));
  const initialStatus = expenseStatuses.find((status) => status !== "WITHDRAWN" && status === param("status")) || "all";
  const initialView = canManage && param("view") !== "mine" ? "all" : "mine";
  return <AppShell>
    <PageHeader title="経費精算" description="立て替えた経費の領収書を提出し、承認と精算をここでまとめます。" />
    <ExpensesWorkspace key={`${company}:${initialStatus}:${initialView}:${param("claim") || ""}`} company={company} views={views} summary={summary}
      projects={projects} categories={expenseCategoryOptions(data, company)} canManage={canManage} canReconcile={can(user, "manage:banking")} today={today} currentUserId={user.id}
      actors={actors} initialStatus={initialStatus} initialView={initialView} initialId={param("claim")} />
  </AppShell>;
}
