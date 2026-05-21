import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, PageHeader } from "@/components/app/shell";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, percent, yen } from "@/lib/format";
import { paidForIssued, paidForReceived, projectMoney, readData } from "@/lib/store";

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = readData();
  const project = data.projects.find((item) => item.id === id && !item.deletedAt);
  if (!project) notFound();
  const client = data.clients.find((item) => item.id === project.clientId);
  const money = projectMoney(data, project.id);
  const issued = data.issuedInvoices.filter((item) => item.projectId === project.id && !item.deletedAt);
  const received = data.receivedInvoices.filter((item) => item.projectId === project.id && !item.deletedAt);
  const logs = data.auditLogs.filter((log) => log.targetId === project.id || issued.some((invoice) => invoice.id === log.targetId) || received.some((invoice) => invoice.id === log.targetId));

  return (
    <AppShell>
      <PageHeader title={project.name} description={client?.companyName ?? ""}>
        <StatusBadge status={project.status} />
        <Button asChild variant="outline"><Link href="/projects">一覧へ</Link></Button>
      </PageHeader>

      <section className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
        {[
          ["請求総額", money.contractAmount],
          ["請求済み", money.invoicedAmount],
          ["入金済み", money.paidIncomeAmount],
          ["未入金", money.unpaidIncomeAmount],
          ["受領請求書合計", money.receivedInvoiceTotal],
          ["支払い済み", money.paidExpenseAmount],
          ["未払い", money.unpaidExpenseAmount],
          ["案件粗利", money.grossProfit],
        ].map(([label, value]) => (
          <Card key={label as string}>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{label}</CardTitle></CardHeader>
            <CardContent className="text-xl font-semibold">{yen.format(value as number)}</CardContent>
          </Card>
        ))}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">案件粗利率</CardTitle></CardHeader>
          <CardContent className="text-xl font-semibold">{percent(money.grossProfitRate)}</CardContent>
        </Card>
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>発行請求書一覧</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>番号</TableHead><TableHead>発行日</TableHead><TableHead>期限</TableHead><TableHead>合計</TableHead><TableHead>入金</TableHead><TableHead>状態</TableHead><TableHead>PDF</TableHead></TableRow></TableHeader>
                <TableBody>{issued.map((invoice) => <TableRow key={invoice.id}><TableCell>{invoice.invoiceNumber}</TableCell><TableCell>{formatDate(invoice.issueDate)}</TableCell><TableCell>{formatDate(invoice.dueDate)}</TableCell><TableCell>{yen.format(invoice.total)}</TableCell><TableCell>{yen.format(paidForIssued(data, invoice.id))}</TableCell><TableCell><StatusBadge status={invoice.status} /></TableCell><TableCell><Button asChild size="sm" variant="outline"><a href={`/api/issued-invoices/${invoice.id}/pdf`} target="_blank">PDF</a></Button></TableCell></TableRow>)}</TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>受領請求書・支払い状況</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>請求元</TableHead><TableHead>請求日</TableHead><TableHead>期限</TableHead><TableHead>合計</TableHead><TableHead>支払済み</TableHead><TableHead>状態</TableHead><TableHead>ファイル</TableHead></TableRow></TableHeader>
                <TableBody>{received.map((invoice) => <TableRow key={invoice.id}><TableCell>{data.vendors.find((vendor) => vendor.id === invoice.vendorId)?.companyName}</TableCell><TableCell>{formatDate(invoice.issueDate)}</TableCell><TableCell>{formatDate(invoice.dueDate)}</TableCell><TableCell>{yen.format(invoice.total)}</TableCell><TableCell>{yen.format(paidForReceived(data, invoice.id))}</TableCell><TableCell><StatusBadge status={invoice.status} /></TableCell><TableCell>{invoice.fileUrl ? <a className="text-sm underline" href={invoice.fileUrl} target="_blank">表示</a> : "-"}</TableCell></TableRow>)}</TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>案件基本情報</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between gap-4"><span className="text-muted-foreground">クライアント</span><span>{client?.companyName}</span></div>
              <div className="flex justify-between gap-4"><span className="text-muted-foreground">請求回数</span><span>{project.billingCount ?? 1}回</span></div>
              <div className="flex justify-between gap-4"><span className="text-muted-foreground">期間</span><span>{formatDate(project.startDate)} - {formatDate(project.endDate)}</span></div>
              <Separator />
              <p className="whitespace-pre-wrap text-muted-foreground">{project.memo || "メモはありません。"}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>変更履歴</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {logs.slice(0, 8).map((log) => <div key={log.id} className="text-sm"><div className="font-medium">{log.action}</div><div className="text-xs text-muted-foreground">{formatDate(log.createdAt)} / {data.users.find((user) => user.id === log.userId)?.name}</div></div>)}
              {logs.length === 0 ? <p className="text-sm text-muted-foreground">履歴はまだありません。</p> : null}
            </CardContent>
          </Card>
        </div>
      </section>
    </AppShell>
  );
}
