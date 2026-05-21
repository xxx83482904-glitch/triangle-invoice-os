import { redirect } from "next/navigation";
import { FileText, LogOut } from "lucide-react";
import { createGuestIssuedInvoice, logoutAction } from "@/app/actions";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { getCurrentUser } from "@/lib/auth";
import { formatDate, todayIso, yen } from "@/lib/format";
import { readData } from "@/lib/store";

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
}

export default async function GuestInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "GUEST") redirect("/issued-invoices");

  const data = readData();
  const projects = data.projects.filter((project) => !project.deletedAt);
  const invoices = data.issuedInvoices.filter((invoice) => !invoice.deletedAt && invoice.createdById === user.id);
  const today = todayIso();

  return (
    <main className="min-h-screen bg-muted/20">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          <div>
            <div className="text-sm font-semibold">TRIANGLE Invoice OS</div>
            <div className="text-xs text-muted-foreground">ゲスト請求書発行</div>
          </div>
          <form action={logoutAction}>
            <Button variant="outline" size="sm" className="gap-2">
              <LogOut className="h-4 w-4" />
              ログアウト
            </Button>
          </form>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-5 px-4 py-5 xl:grid-cols-[1fr_430px]">
        <section className="space-y-5">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">請求書だけを発行</h1>
            <p className="mt-1 text-sm text-muted-foreground">案件を選んで明細を入力すると、発行済み請求書とPDFが作成されます。</p>
          </div>

          {params.created ? (
            <Card className="border-emerald-200 bg-emerald-50">
              <CardContent className="py-3 text-sm text-emerald-800">請求書を作成しました。左の一覧からPDFを確認できます。</CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader><CardTitle>自分が発行した請求書</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>番号</TableHead>
                    <TableHead>案件</TableHead>
                    <TableHead>発行日</TableHead>
                    <TableHead>期限</TableHead>
                    <TableHead className="text-right">合計</TableHead>
                    <TableHead>状態</TableHead>
                    <TableHead>PDF</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell className="font-mono text-xs">{invoice.invoiceNumber}</TableCell>
                      <TableCell>{data.projects.find((project) => project.id === invoice.projectId)?.name}</TableCell>
                      <TableCell>{formatDate(invoice.issueDate)}</TableCell>
                      <TableCell>{formatDate(invoice.dueDate)}</TableCell>
                      <TableCell className="text-right">{yen.format(invoice.total)}</TableCell>
                      <TableCell><StatusBadge status={invoice.status} /></TableCell>
                      <TableCell>
                        <Button asChild size="sm" variant="outline">
                          <a href={`/api/issued-invoices/${invoice.id}/pdf`} target="_blank">
                            PDF
                          </a>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {invoices.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                        まだ請求書はありません。
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </section>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              請求書を作成
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createGuestIssuedInvoice} className="space-y-4">
              <div className="space-y-2">
                <Label>案件</Label>
                <Select name="projectId" required>
                  <SelectTrigger><SelectValue placeholder="案件を選択" /></SelectTrigger>
                  <SelectContent>
                    {projects.map((project) => {
                      const client = data.clients.find((item) => item.id === project.clientId);
                      return (
                        <SelectItem key={project.id} value={project.id}>
                          {project.name} / {client?.companyName}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2"><Label>発行日</Label><Input name="issueDate" type="date" defaultValue={today} required /></div>
                <div className="space-y-2"><Label>取引日</Label><Input name="transactionDate" type="date" defaultValue={today} required /></div>
                <div className="space-y-2"><Label>期限</Label><Input name="dueDate" type="date" defaultValue={addDays(today, 30)} required /></div>
              </div>

              <div className="rounded-md border p-3">
                <div className="mb-3 text-sm font-medium">明細</div>
                {[0, 1, 2, 3].map((index) => (
                  <div key={index} className="mb-3 grid grid-cols-[1fr_58px_92px_82px] gap-2">
                    <Input name="itemDescription" placeholder="内容" required={index === 0} />
                    <Input name="itemQuantity" type="number" step="0.01" placeholder="数量" defaultValue={index === 0 ? 1 : undefined} />
                    <Input name="itemUnitPrice" type="number" min="0" step="1" placeholder="単価" required={index === 0} />
                    <Select name="itemTaxRate" defaultValue="10">
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="10">10%</SelectItem>
                        <SelectItem value="8">8%</SelectItem>
                        <SelectItem value="0">非課税</SelectItem>
                        <SelectItem value="-1">対象外</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <Label>備考</Label>
                <Textarea name="notes" placeholder="振込先、補足事項など" />
              </div>

              <Button className="w-full">請求書を発行</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
