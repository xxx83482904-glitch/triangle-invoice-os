import { createProject } from "@/app/actions";
import { ProjectsTable } from "@/app/projects/projects-table";
import { AppShell, PageHeader } from "@/components/app/shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getCurrentUser } from "@/lib/auth";
import { companyFromParam, matchesCompany, partnerMatchesCompany } from "@/lib/company";
import { can } from "@/lib/rbac";
import { projectMoney, readData, scopedProjectsForUser } from "@/lib/store";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const company = companyFromParam(params.company);
  const user = await getCurrentUser();
  const data = readData();
  const projects = user ? scopedProjectsForUser(data, user) : [];
  const clients = data.clients.filter((client) => !client.deletedAt && partnerMatchesCompany(client, company));
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
  const rows = filtered.map((project) => {
    const money = projectMoney(data, project.id);
    return {
      id: project.id,
      name: project.name,
      company: companyFromParam(project.company),
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

  return (
    <AppShell>
      <PageHeader title="案件一覧" description="請求総額、請求回数、入金、支払い、粗利を案件単位で見ます。" />

      <Card className="mb-6">
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
                <SelectItem value="PLANNING">計画中</SelectItem>
                <SelectItem value="IN_PROGRESS">進行中</SelectItem>
                <SelectItem value="WAITING">保留/待機</SelectItem>
                <SelectItem value="COMPLETED">完了</SelectItem>
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
            <ProjectsTable canEdit={canEdit} rows={rows} />
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
                  <Select name="clientId" required>
                    <SelectTrigger><SelectValue placeholder="選択" /></SelectTrigger>
                    <SelectContent>{clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.companyName}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>ステータス</Label>
                  <Select name="status" defaultValue="IN_PROGRESS">
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PLANNING">計画中</SelectItem>
                      <SelectItem value="IN_PROGRESS">進行中</SelectItem>
                      <SelectItem value="WAITING">保留/待機</SelectItem>
                      <SelectItem value="COMPLETED">完了</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <input type="hidden" name="stage" value="制作资料" />
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
