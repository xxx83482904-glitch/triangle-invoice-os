import Link from "next/link";
import { AppShell, PageHeader } from "@/components/app/shell";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { readData, scopedProjectsForUser } from "@/lib/store";
import { DashboardTable } from "./dashboard-table";

type Company = "CHINA" | "JAPAN";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const company: Company = params.company === "JAPAN" ? "JAPAN" : "CHINA";
  const user = await getCurrentUser();
  const data = readData();
  const projects = user ? scopedProjectsForUser(data, user) : [];
  const rows = projects
    .filter((project) => (project.company ?? "CHINA") === company)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((project, index) => ({
      id: project.id,
      index: project.sortOrder ?? index + 1,
      name: project.name,
      company: project.company ?? "CHINA",
      stage: project.stage ?? "制作资料",
      billingTotal: project.contractAmount ?? 0,
      billingCount: project.billingCount ?? 1,
      createdRounds: data.issuedInvoices
        .filter((invoice) => !invoice.deletedAt && invoice.projectId === project.id && invoice.internalMemo?.startsWith("INSTALLMENT:"))
        .map((invoice) => Number(invoice.internalMemo?.replace("INSTALLMENT:", "")))
        .filter((round) => Number.isFinite(round)),
    }));

  const counts = {
    CHINA: projects.filter((project) => (project.company ?? "CHINA") === "CHINA").length,
    JAPAN: projects.filter((project) => project.company === "JAPAN").length,
  };

  return (
    <AppShell>
      <PageHeader title="案件一覧" description="請求総額と請求回数を設定し、各回の請求書を作成できます。">
        <Button asChild size="sm" variant={company === "CHINA" ? "default" : "outline"}>
          <Link href="/dashboard?company=CHINA">中国 {counts.CHINA}</Link>
        </Button>
        <Button asChild size="sm" variant={company === "JAPAN" ? "default" : "outline"}>
          <Link href="/dashboard?company=JAPAN">日本 {counts.JAPAN}</Link>
        </Button>
      </PageHeader>

      <DashboardTable canEdit={Boolean(user && can(user, "manage:projects"))} rows={rows} />
    </AppShell>
  );
}
