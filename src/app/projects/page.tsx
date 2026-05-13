import Link from "next/link";
import { createProject } from "@/app/actions";
import { AppShell, PageHeader } from "@/components/app/shell";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { getCurrentUser } from "@/lib/auth";
import { formatDate, yen } from "@/lib/format";
import { can } from "@/lib/rbac";
import { projectMoney, readData, scopedProjectsForUser } from "@/lib/store";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();
  const data = readData();
  const projects = user ? scopedProjectsForUser(data, user) : [];
  const filtered = projects.filter((project) => {
    if (params.status && params.status !== "all" && project.status !== params.status) return false;
    if (params.clientId && params.clientId !== "all" && project.clientId !== params.clientId) return false;
    const money = projectMoney(data, project.id);
    if (params.unpaidIncome === "1" && money.unpaidIncomeAmount <= 0) return false;
    if (params.unpaidExpense === "1" && money.unpaidExpenseAmount <= 0) return false;
    return true;
  });

  return (
    <AppShell>
      <PageHeader title="案件一覧" description="契約額、請求、入金、支払い、粗利を案件単位で見ます。" />

      <Card className="mb-6">
        <CardContent className="pt-6">
          <form className="grid gap-3 md:grid-cols-5">
            <Select name="clientId" defaultValue={params.clientId ?? "all"}>
              <SelectTrigger><SelectValue placeholder="クライアント" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全クライアント</SelectItem>
                {data.clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.companyName}</SelectItem>)}
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>案件名</TableHead>
                  <TableHead>クライアント</TableHead>
                  <TableHead>担当者</TableHead>
                  <TableHead>契約</TableHead>
                  <TableHead>請求済み</TableHead>
                  <TableHead>入金済み</TableHead>
                  <TableHead>未入金</TableHead>
                  <TableHead>支払い済み</TableHead>
                  <TableHead>粗利</TableHead>
                  <TableHead>更新日</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((project) => {
                  const money = projectMoney(data, project.id);
                  return (
                    <TableRow key={project.id}>
                      <TableCell>
                        <Link href={`/projects/${project.id}`} className="font-medium hover:underline">{project.name}</Link>
                        <div className="mt-1"><StatusBadge status={project.status} /></div>
                      </TableCell>
                      <TableCell>{data.clients.find((client) => client.id === project.clientId)?.companyName}</TableCell>
                      <TableCell>{data.users.find((item) => item.id === project.managerId)?.name}</TableCell>
                      <TableCell>{yen.format(money.contractAmount)}</TableCell>
                      <TableCell>{yen.format(money.invoicedAmount)}</TableCell>
                      <TableCell>{yen.format(money.paidIncomeAmount)}</TableCell>
                      <TableCell className={money.unpaidIncomeAmount > 0 ? "font-medium text-amber-700" : ""}>{yen.format(money.unpaidIncomeAmount)}</TableCell>
                      <TableCell>{yen.format(money.paidExpenseAmount)}</TableCell>
                      <TableCell>{yen.format(money.grossProfit)}</TableCell>
                      <TableCell>{formatDate(project.updatedAt)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {user && can(user, "manage:projects") ? (
          <Card>
            <CardHeader><CardTitle>案件を追加</CardTitle></CardHeader>
            <CardContent>
              <form action={createProject} className="space-y-4">
                <div className="space-y-2"><Label>案件名</Label><Input name="name" required /></div>
                <div className="space-y-2">
                  <Label>クライアント</Label>
                  <Select name="clientId" required>
                    <SelectTrigger><SelectValue placeholder="選択" /></SelectTrigger>
                    <SelectContent>{data.clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.companyName}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>担当者</Label>
                  <Select name="managerId" required>
                    <SelectTrigger><SelectValue placeholder="選択" /></SelectTrigger>
                    <SelectContent>{data.users.map((member) => <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>)}</SelectContent>
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
                <div className="space-y-2"><Label>契約金額</Label><Input name="contractAmount" type="number" required /></div>
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
