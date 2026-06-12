import { redirect } from "next/navigation";
import { AlertTriangle, CircleDollarSign, FolderKanban, TrendingUp, type LucideIcon } from "lucide-react";
import { createProject } from "@/app/actions";
import { ProjectsTable } from "@/app/projects/projects-table";
import { CreatableSelect } from "@/components/app/creatable-select";
import { AppShell, PageHeader } from "@/components/app/shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getCurrentUser } from "@/lib/auth";
import { companyFromParam, matchesCompany, partnerMatchesCompany } from "@/lib/company";
import { yen } from "@/lib/format";
import { can, defaultPathForRole } from "@/lib/rbac";
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
  if (!user) redirect("/login");
  if (!can(user, "view:projects")) redirect(defaultPathForRole(user.role));
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
  const showFinancials = Boolean(user && can(user, "view:dashboard"));
  const rows = filtered.map((project, index) => {
    const money = projectMoney(data, project.id);
    return {
      id: project.id,
      index: project.sortOrder ?? index + 1,
      name: project.name,
      company: companyFromParam(project.company),
      clientId: project.clientId,
      clientName: data.clients.find((client) => client.id === project.clientId)?.companyName ?? "",
      stage: project.stage ?? "制作资料",
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
  const totalBilling = rows.reduce((sum, row) => sum + row.billingTotal, 0);
  const unpaidIncomeTotal = rows.reduce((sum, row) => sum + row.unpaidIncomeAmount, 0);
  const grossProfitTotal = rows.reduce((sum, row) => sum + row.grossProfit, 0);
  const attentionCount = rows.filter((row) => row.unpaidIncomeAmount > 0 || row.paidExpenseAmount > 0).length;

  return (
    <AppShell>
      <PageHeader
        title="案件一覧"
        description={showFinancials ? "請求総額、請求回数、入金、支払い、粗利を案件単位で見ます。" : "案件と発行請求書の作成状況を管理します。"}
      />

      <div className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <ProjectMetric icon={FolderKanban} label="Projects" value={`${rows.length}`} tone="blue" helper={`${attentionCount} need attention`} />
        <ProjectMetric icon={CircleDollarSign} label="Billing" value={showFinancials ? yen.format(totalBilling) : `${rows.length} items`} tone="slate" helper="contract total" />
        <ProjectMetric icon={AlertTriangle} label="Unpaid income" value={showFinancials ? yen.format(unpaidIncomeTotal) : "-"} tone="amber" helper="follow-up queue" />
        <ProjectMetric icon={TrendingUp} label="Gross profit" value={showFinancials ? yen.format(grossProfitTotal) : "-"} tone="emerald" helper="current margin" />
      </div>

      <Card className="mb-6 border-muted-foreground/10 shadow-sm">
        <CardContent className="pt-6">
          <form className="grid gap-3 md:grid-cols-5">
            <input type="hidden" name="company" value={company} />
            <Select name="clientId" defaultValue={params.clientId ?? "all"}>
              <SelectTrigger><SelectValue placeholder="クライアント" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全クライアント</SelectItem>
                {clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.companyName}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select name="status" defaultValue={params.status ?? "all"}>
              <SelectTrigger><SelectValue placeholder="ステータス" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全ステータス</SelectItem>
                {projectStatusOptions.map((option) => <SelectItem key={option.id} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select name="unpaidIncome" defaultValue={params.unpaidIncome ?? "0"}>
              <SelectTrigger><SelectValue placeholder="未入金" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="0">未入金条件なし</SelectItem>
                <SelectItem value="1">未入金あり</SelectItem>
              </SelectContent>
            </Select>
            <Select name="unpaidExpense" defaultValue={params.unpaidExpense ?? "0"}>
              <SelectTrigger><SelectValue placeholder="未払い" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="0">未払い条件なし</SelectItem>
                <SelectItem value="1">未払いあり</SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit">絞り込み</Button>
          </form>
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
              showFinancials={showFinancials}
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
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2"><Label>請求総額</Label><Input name="contractAmount" type="number" min="0" step="1" required /></div>
                  <div className="space-y-2"><Label>請求回数</Label><Input name="billingCount" type="number" min="1" max="12" step="1" defaultValue={1} required /></div>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
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

function ProjectMetric({
  helper,
  icon: Icon,
  label,
  tone,
  value,
}: {
  helper: string;
  icon: LucideIcon;
  label: string;
  tone: "amber" | "blue" | "emerald" | "slate";
  value: string;
}) {
  const tones = {
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
    slate: "border-slate-200 bg-slate-50 text-slate-700",
  }[tone];

  return (
    <Card className="border-muted-foreground/10 shadow-sm">
      <CardContent className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase text-muted-foreground">{label}</div>
          <div className="mt-2 truncate text-xl font-semibold">{value}</div>
          <div className="mt-1 text-xs text-muted-foreground">{helper}</div>
        </div>
        <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border ${tones}`}>
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}
