import { redirect } from "next/navigation";
import { AppShell } from "@/components/app/shell";
import { getCurrentUser } from "@/lib/auth";
import { bankToday } from "@/lib/banking";
import { companyFromParam } from "@/lib/company";
import { dashboardSummary } from "@/lib/dashboard";
import { dashboardNextSteps } from "@/lib/dashboard-next-steps";
import { uploadedFileExists } from "@/lib/files";
import { can, defaultPathForRole } from "@/lib/rbac";
import { readDataForRequest } from "@/lib/store";
import { DashboardWorkspace } from "./dashboard-workspace";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user, "view:dashboard")) redirect(defaultPathForRole(user.role));
  const company = companyFromParam(params.company);
  const data = await readDataForRequest();
  const summary = dashboardSummary(data, user, company, bankToday(), params.year);
  const nextSteps = dashboardNextSteps(data, user, summary, uploadedFileExists);
  return <AppShell>
    <DashboardWorkspace key={`${company}:${summary.period.year}`} summary={summary} nextSteps={nextSteps} companyLabel={company === "JAPAN" ? "日本" : "中国"} />
  </AppShell>;
}
