import Link from "next/link";
import { AppShell, PageHeader } from "@/components/app/shell";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth";
import { companyFromParam, matchesCompany, partnerMatchesCompany, type CompanyScope } from "@/lib/company";
import { can } from "@/lib/rbac";
import { selectOptionsFor } from "@/lib/select-options";
import { readData, scopedProjectsForUser } from "@/lib/store";
import { DashboardTable } from "./dashboard-table";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const company: CompanyScope = companyFromParam(params.company);
  const user = await getCurrentUser();
  const data = readData();
  const projects = user ? scopedProjectsForUser(data, user) : [];
  const clients = data.clients
    .filter((client) => !client.deletedAt && partnerMatchesCompany(client, company))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.companyName.localeCompare(b.companyName, "ja"));
  const stageOptions = selectOptionsFor(data, "PROJECT_STAGE", company);
  const rows = projects
    .filter((project) => matchesCompany(project, company))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((project, index) => ({
      id: project.id,
      index: project.sortOrder ?? index + 1,
      name: project.name,
      clientId: project.clientId,
      clientName: data.clients.find((client) => client.id === project.clientId)?.companyName ?? "",
      company: companyFromParam(project.company),
      stage: project.stage ?? "制作资料",
      billingTotal: project.contractAmount ?? 0,
      billingCount: project.billingCount ?? 1,
      createdRounds: data.issuedInvoices
        .filter((invoice) => !invoice.deletedAt && invoice.projectId === project.id && invoice.internalMemo?.startsWith("INSTALLMENT:"))
        .map((invoice) => Number(invoice.internalMemo?.replace("INSTALLMENT:", "")))
        .filter((round) => Number.isFinite(round)),
    }));

  const counts = {
    CHINA: projects.filter((project) => matchesCompany(project, "CHINA")).length,
    JAPAN: projects.filter((project) => matchesCompany(project, "JAPAN")).length,
  };

  return (
    <AppShell>
      <PageHeader title="案件一覧" description="請求総額と請求回数を設定し、各回の請求書を作成できます。">
        <Button asChild size="sm" variant={company === "CHINA" ? "default" : "outline"}>
          <Link href="/dashboard?company=CHINA">中国支社 {counts.CHINA}</Link>
        </Button>
        <Button asChild size="sm" variant={company === "JAPAN" ? "default" : "outline"}>
          <Link href="/dashboard?company=JAPAN">日本本社 {counts.JAPAN}</Link>
        </Button>
      </PageHeader>

      <DashboardTable
        canEdit={Boolean(user && can(user, "manage:projects"))}
        clients={clients.map((client) => ({ id: client.id, companyName: client.companyName }))}
        stageOptions={stageOptions.map((option) => ({ label: option.label, value: option.value }))}
        rows={rows}
      />
    </AppShell>
  );
}
