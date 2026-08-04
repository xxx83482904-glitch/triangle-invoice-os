import { ProjectsWorkspace, type ProjectWorkspaceRow } from "@/app/projects/projects-workspace";
import { AppShell, PageHeader } from "@/components/app/shell";
import { getCurrentUser } from "@/lib/auth";
import { companyFromParam, matchesCompany, partnerMatchesCompany } from "@/lib/company";
import { can } from "@/lib/rbac";
import { selectOptionsFor } from "@/lib/select-options";
import { projectMoney, readDataForRequest as readData, scopedProjectsForUser } from "@/lib/store";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const company = companyFromParam(params.company);
  const user = await getCurrentUser();
  const data = await readData();
  const projects = user ? scopedProjectsForUser(data, user) : [];
  const clients = data.clients
    .filter((client) => !client.deletedAt && partnerMatchesCompany(client, company))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.companyName.localeCompare(b.companyName, "ja"));
  const projectStatusOptions = selectOptionsFor(data, "PROJECT_STATUS", company);
  const stageOptions = selectOptionsFor(data, "PROJECT_STAGE", company);
  const canEdit = Boolean(user && can(user, "manage:projects"));
  const showFinancials = Boolean(user && can(user, "view:dashboard"));

  const rows: ProjectWorkspaceRow[] = projects
    .filter((project) => matchesCompany(project, company))
    .map((project, index) => {
      const money = projectMoney(data, project.id);
      return {
        id: project.id,
        index: project.sortOrder ?? index + 1,
        name: project.name,
        company: companyFromParam(project.company),
        clientId: project.clientId,
        clientName: data.clients.find((client) => client.id === project.clientId)?.companyName ?? "",
        stage: project.stage ?? "",
        status: project.status,
        contractAmount: money.contractAmount,
        billingCount: project.billingCount ?? 1,
        contractFileUrl: project.contractFileUrl,
        contractOriginalFileName: project.contractOriginalFileName,
        contractExtractedAmount: project.contractExtractedAmount,
        contractExtractedBillingCount: project.contractExtractedBillingCount,
        contractUploadedAt: project.contractUploadedAt,
        startDate: project.startDate,
        endDate: project.endDate,
        memo: project.memo,
        invoicedAmount: money.invoicedAmount,
        paidIncomeAmount: money.paidIncomeAmount,
        unpaidIncomeAmount: money.unpaidIncomeAmount,
        receivedInvoiceTotal: money.receivedInvoiceTotal,
        paidExpenseAmount: money.paidExpenseAmount,
        unpaidExpenseAmount: money.unpaidExpenseAmount,
        grossProfit: money.grossProfit,
        grossProfitRate: money.grossProfitRate,
        issuedCount: data.issuedInvoices.filter((invoice) => invoice.projectId === project.id && !invoice.deletedAt).length,
        receivedCount: data.receivedInvoices.filter((invoice) => invoice.projectId === project.id && !invoice.deletedAt).length,
        updatedAt: project.updatedAt,
      };
    });

  return (
    <AppShell>
      <PageHeader title="案件" description="案件を探して、請求・入金・支払い・契約書の次アクションを一画面で確認します。" />
      <ProjectsWorkspace
        canEdit={canEdit}
        clients={clients.map((client) => ({ label: client.companyName, value: client.id }))}
        company={company}
        rows={rows}
        showFinancials={showFinancials}
        stageOptions={stageOptions.map((option) => ({ label: option.label, value: option.value }))}
        statusOptions={projectStatusOptions.map((option) => ({ label: option.label, value: option.value }))}
      />
    </AppShell>
  );
}
