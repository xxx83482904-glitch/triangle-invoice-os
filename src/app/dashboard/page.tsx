import { redirect } from "next/navigation";
import { AppShell, PageHeader } from "@/components/app/shell";
import { getCurrentUser } from "@/lib/auth";
import { bankToday } from "@/lib/banking";
import { companyFromParam } from "@/lib/company";
import { dashboardSummary } from "@/lib/dashboard";
import { can, defaultPathForRole } from "@/lib/rbac";
import { readDataForRequest } from "@/lib/store";
import { DashboardActions, DashboardWorkspace } from "./dashboard-workspace";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user, "view:dashboard")) redirect(defaultPathForRole(user.role));
  const company = companyFromParam(params.company);
  const summary = dashboardSummary(await readDataForRequest(), user, company, bankToday(), params.year);
  return <AppShell>
    <PageHeader title="ダッシュボード" description={`${summary.today} 現在 / ${company === "JAPAN" ? "日本" : "中国"}`}><DashboardActions company={company} /></PageHeader>
    <DashboardWorkspace key={`${company}:${summary.period.year}`} summary={summary} />
  </AppShell>;
}
