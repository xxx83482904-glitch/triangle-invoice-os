import { createProject } from "@/app/actions";
import { ProjectFilter } from "@/app/projects/project-filter";
import { ProjectsTable } from "@/app/projects/projects-table";
import { CreatableSelect } from "@/components/app/creatable-select";
import { AppShell, PageHeader } from "@/components/app/shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getCurrentUser } from "@/lib/auth";
import { companyFromParam, matchesCompany, partnerMatchesCompany } from "@/lib/company";
import { can } from "@/lib/rbac";
import { selectOptionsFor } from "@/lib/select-options";
import { projectMoney, readData, scopedProjectsForUser } from "@/lib/store";

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
  const filtered = projects.filter((project) => {
    if (!matchesCompany(project, company)) return false;
    if (params.status && params.status !== "all" && project.status !== params.status) return false;
    if (params.clientId && params.clientId !== "all" && project.clientId !== params.clientId) return false;
    const money = projectMoney(data, project.id);
    if (params.unpaidIncome === "1" && money.unpaidIncomeAmount <= 0) return false;
    if (params.unpaidExpense === "1" && money.unpaidExpenseAmount <= 0) return false;
    return true;
  });
  const canEdit = Boolean(user && can(user, "manage:projects"));
  const rows = filtered.map((project, index) => {
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
      billingTotal: money.contractAmount,
      billingCount: project.billingCount ?? 1,
      contractFileUrl: project.contractFileUrl,
      contractOriginalFileName: project.contractOriginalFileName,
      contractExtractedAmount: project.contractExtractedAmount,
      contractExtractedBillingCount: project.contractExtractedBillingCount,
      contractUploadedAt: project.contractUploadedAt,
      invoicedAmount: money.invoicedAmount,
      paidIncomeAmount: money.paidIncomeAmount,
      unpaidIncomeAmount: money.unpaidIncomeAmount,
      paidExpenseAmount: money.paidExpenseAmount,
      grossProfit: money.grossProfit,
      updatedAt: project.updatedAt,
    };
  });

  return (
    <AppShell>
      <PageHeader title="案件一覧" description="請求総額、請求回数、入金、支払い、粗利を案件単位で見ます。" />

      <Card className="mb-6">
        <CardContent className="pt-4">
          <ProjectFilter
            company={company}
            clients={clients.map((c) => ({ id: c.id, companyName: c.companyName }))}
            statusOptions={projectStatusOptions}
            current={{
              clientId: params.clientId,
              status: params.status,
              unpaidIncome: params.unpaidIncome,
              unpaidExpense: params.unpaidExpense,
            }}
          />
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader><CardTitle>案件</CardTitle></CardHeader>
          <CardContent>
            <ProjectsTable
              canEdit={canEdit}
              clients={clients.map((client) => ({ id: client.id, companyName: client.companyName }))}
              stageOptions={stageOptions.map((option) => ({ label: option.label, value: option.value }))}
              rows={rows}
            />
          </CardContent>
        </Card>

        {canEdit ? (
          <Card>
            <CardHeader><CardTitle>案件を追加</CardTitle></CardHeader>
            <CardContent>
              <form action={createProject} className="space-y-4">
                <input type="hidden" name="company" value={company} />
                <div className="space-y-2"><Label>案件名</Label><Input name="name" required /></div>
                <div className="space-y-2">
                  <Label>クライアント</Label>
                  <CreatableSelect
                    name="clientId"
                    options={clients.map((client) => ({ label: client.companyName, value: client.id }))}
                    placeholder="選択"
                    create={{ kind: "client", company }}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>ステータス</Label>
                  <CreatableSelect
                    name="status"
                    defaultValue={projectStatusOptions.find((option) => option.value === "IN_PROGRESS")?.value ?? projectStatusOptions[0]?.value ?? "IN_PROGRESS"}
                    options={projectStatusOptions.map((option) => ({ label: option.label, value: option.value }))}
                    create={{ kind: "select-option", company, group: "PROJECT_STATUS" }}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>段階</Label>
                  <CreatableSelect
                    name="stage"
                    defaultValue={stageOptions[0]?.value ?? "制作资料"}
                    options={stageOptions.map((option) => ({ label: option.label, value: option.value }))}
                    create={{ kind: "select-option", company, group: "PROJECT_STAGE" }}
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2"><Label>請求総額</Label><Input name="contractAmount" type="number" min="0" step="1" required /></div>
                  <div className="space-y-2"><Label>請求回数</Label><Input name="billingCount" type="number" min="1" max="12" step="1" defaultValue={1} required /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2"><Label>開始日</Label><Input name="startDate" type="date" /></div>
                  <div className="space-y-2"><Label>終了日</Label><Input name="endDate" type="date" /></div>
                </div>
                <div className="space-y-2"><Label>メモ</Label><Textarea name="memo" /></div>
                <Button className="w-full">追加</Button>
              </form>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </AppShell>
  );
}
