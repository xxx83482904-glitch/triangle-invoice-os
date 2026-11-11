import { Money } from "@/components/app/money";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell, PageHeader } from "@/components/app/shell";
import { StatusBadge } from "@/components/app/status-badge";
import { invoicePaymentSummary } from "@/lib/invoice-status";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { companyFromParam } from "@/lib/company";
import { formatDate, percent } from "@/lib/format";
import { can } from "@/lib/rbac";
import { defaultPathForUser } from "@/lib/app-navigation";
import { paidForIssued, paidForReceived, projectMoney, readDataForRequest as readData, scopedProjectsForUser } from "@/lib/store";
import { getCurrentUser } from "@/lib/auth";
import { canSeeIssuedAmounts } from "@/lib/issued-amount-access";
import { HiddenAmount } from "@/components/app/hidden-amount";

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user, "view:projects")) redirect(defaultPathForUser(user));
  const data = await readData();
  const project = scopedProjectsForUser(data, user).find((item) => item.id === id && !item.deletedAt);
  if (!project) notFound();
  const company = companyFromParam(project.company);
  const client = data.clients.find((item) => item.id === project.clientId);
  const money = projectMoney(data, project.id);
  const issued = data.issuedInvoices.filter((item) => item.projectId === project.id && !item.deletedAt);
  const received = data.receivedInvoices.filter((item) => item.projectId === project.id && !item.deletedAt);
  const logs = data.auditLogs.filter((log) => log.targetId === project.id || issued.some((invoice) => invoice.id === log.targetId) || received.some((invoice) => invoice.id === log.targetId));
  const showTotals = can(user, "view:dashboard");

  return (
    <AppShell>
      <PageHeader title={project.name} description={client?.companyName ?? ""}>
        <StatusBadge status={project.status} />
        <Button asChild variant="outline"><Link href={`/projects?company=${company}`} prefetch={false}>一覧へ</Link></Button>
      </PageHeader>

      {showTotals ? (
        <section className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
          {[
            ["請求総額", money.contractAmount],
            ["請求済み", money.invoicedAmount],
            ["入金済み", money.paidIncomeAmount],
            ["未入金", money.unpaidIncomeAmount],
            ["受領請求書合計", money.receivedInvoiceTotal],
            ["支払い済み", money.paidExpenseAmount],
            ["未払い", money.unpaidExpenseAmount],
            ["請求差額（税込）", money.grossProfit],
            ["入出金差額", money.paidIncomeAmount - money.paidExpenseAmount],
          ].map(([label, value]) => (
            <Card variant="section" key={label as string}>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{label}</CardTitle></CardHeader>
              <CardContent className="text-xl font-medium">{value === null ? "—" : <Money value={value as number} />}</CardContent>
            </Card>
          ))}
          <Card variant="section">
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">請求差額率</CardTitle></CardHeader>
            <CardContent className="text-xl font-semibold">{money.invoicedAmount > 0 ? percent(money.grossProfitRate) : "-"}</CardContent>
          </Card>
        </section>
      ) : null}

      <section className="mt-6 grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card variant="section">
            <CardHeader><CardTitle>発行請求書一覧</CardTitle></CardHeader>
            <CardContent>
              <Table className="record-cards record-cards-stack record-cards-compact">
                <TableHeader><TableRow><TableHead>番号</TableHead><TableHead>発行日</TableHead><TableHead>期限</TableHead><TableHead className="text-right">合計</TableHead><TableHead className="text-right">入金</TableHead><TableHead>状態</TableHead><TableHead>PDF</TableHead></TableRow></TableHeader>
                <TableBody>{issued.map((invoice) => { const shown = canSeeIssuedAmounts(user, invoice); return <TableRow key={invoice.id}><TableCell className="record-card-title">{invoice.invoiceNumber}</TableCell><TableCell data-label="発行日">{formatDate(invoice.issueDate)}</TableCell><TableCell data-label="期限">{formatDate(invoice.dueDate)}</TableCell><TableCell className="lg:text-right" data-label="合計">{shown ? <Money value={invoice.total} /> : <HiddenAmount className="text-muted-foreground" />}</TableCell><TableCell className="lg:text-right" data-label="入金">{shown ? <Money value={paidForIssued(data, invoice.id)} /> : <HiddenAmount className="text-muted-foreground" />}</TableCell><TableCell data-label="状態"><StatusBadge kind="issued" status={invoicePaymentSummary(data, invoice).status} /></TableCell><TableCell data-label="PDF">{shown ? <Button asChild size="sm" variant="outline"><a href={`/api/issued-invoices/${invoice.id}/pdf`} target="_blank">PDF</a></Button> : <span className="text-muted-foreground">—</span>}</TableCell></TableRow>; })}</TableBody>
              </Table>
            </CardContent>
          </Card>
          {showTotals ? <Card variant="section">
            <CardHeader><CardTitle>受領請求書・支払い状況</CardTitle></CardHeader>
            <CardContent>
              <Table className="record-cards record-cards-stack record-cards-compact">
                <TableHeader><TableRow><TableHead>請求元</TableHead><TableHead>請求日</TableHead><TableHead>期限</TableHead><TableHead className="text-right">合計</TableHead><TableHead className="text-right">支払済み</TableHead><TableHead>状態</TableHead><TableHead>ファイル</TableHead></TableRow></TableHeader>
                <TableBody>{received.map((invoice) => <TableRow key={invoice.id}><TableCell className="record-card-title">{data.vendors.find((vendor) => vendor.id === invoice.vendorId)?.companyName}</TableCell><TableCell data-label="請求日">{formatDate(invoice.issueDate)}</TableCell><TableCell data-label="期限">{formatDate(invoice.dueDate)}</TableCell><TableCell className="lg:text-right" data-label="合計"><Money value={invoice.total} /></TableCell><TableCell className="lg:text-right" data-label="支払済み"><Money value={paidForReceived(data, invoice.id)} /></TableCell><TableCell data-label="状態"><StatusBadge kind="received" status={invoice.status} /></TableCell><TableCell data-label="ファイル">{invoice.fileUrl ? <Button asChild variant="soft" size="sm" className="h-auto max-w-full whitespace-normal break-words py-2 text-left lg:h-auto lg:min-h-8 lg:py-1.5"><a href={invoice.fileUrl} target="_blank">表示<ArrowUpRight aria-hidden="true" className="size-4 shrink-0" /></a></Button> : "-"}</TableCell></TableRow>)}</TableBody>
              </Table>
            </CardContent>
          </Card> : null}
        </div>
        <div className="space-y-6">
          <Card variant="section">
            <CardHeader><CardTitle>案件基本情報</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between gap-4"><span className="text-muted-foreground">クライアント</span><span>{client?.companyName}</span></div>
              <div className="flex justify-between gap-4"><span className="text-muted-foreground">請求回数</span><span>{project.billingCount ?? 1}回</span></div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">契約書</span>
                <span>
                  {project.contractFileUrl ? (
                    <Button asChild variant="soft" size="sm" className="h-auto max-w-full whitespace-normal break-words py-2 text-left lg:h-auto lg:min-h-8 lg:py-1.5"><a href={project.contractFileUrl} target="_blank">
                      表示
                    <ArrowUpRight aria-hidden="true" className="size-4 shrink-0" /></a></Button>
                  ) : (
                    "-"
                  )}
                </span>
              </div>
              {project.contractExtractedAmount || project.contractExtractedBillingCount ? (
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">契約書読取</span>
                  <span>
                    {project.contractExtractedAmount ? <Money value={project.contractExtractedAmount} /> : "-"} /{" "}
                    {project.contractExtractedBillingCount ?? project.billingCount ?? 1}回
                  </span>
                </div>
              ) : null}
              <div className="flex justify-between gap-4"><span className="text-muted-foreground">期間</span><span>{formatDate(project.startDate)} - {formatDate(project.endDate)}</span></div>
              <Separator />
              <p className="whitespace-pre-wrap text-muted-foreground">{project.memo || "メモはありません。"}</p>
            </CardContent>
          </Card>
          <Card variant="section">
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
