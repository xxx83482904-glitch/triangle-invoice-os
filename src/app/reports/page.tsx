import { Money } from "@/components/app/money";
import { AppShell, PageHeader } from "@/components/app/shell";
import { isPayableReceivedInvoice } from "@/lib/debt-groups";
import { SectionExportDialog } from "@/components/app/section-export-dialog";
import Link from "next/link";
import { redirect } from "next/navigation";
import { isBillableIssuedInvoice } from "@/lib/documents";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getCurrentUser } from "@/lib/auth";
import { companyFromParam, matchesCompany, partnerMatchesCompany } from "@/lib/company";
import { percent } from "@/lib/format";
import { monthlyInvoiceSummary } from "@/lib/accounting-summary";
import { can, defaultPathForRole } from "@/lib/rbac";
import { paidForIssued, paidForReceived, projectMoney, readDataForRequest as readData } from "@/lib/store";
import { importMonthlySummary, importShipmentViews } from "@/lib/import-shipment-views";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const company = companyFromParam(params.company);
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user, "view:reports")) redirect(defaultPathForRole(user.role));
  const data = await readData();
  const projects = data.projects.filter((project) => !project.deletedAt && matchesCompany(project, company));
  const projectIds = new Set(projects.map((project) => project.id));
  const issuedInvoices = data.issuedInvoices.filter((invoice) => isBillableIssuedInvoice(invoice) && projectIds.has(invoice.projectId));
  const receivedInvoices = data.receivedInvoices.filter((invoice) => !invoice.deletedAt && projectIds.has(invoice.projectId) && isPayableReceivedInvoice(data, invoice));
  const issuedIds = new Set(issuedInvoices.map((invoice) => invoice.id));
  const receivedIds = new Set(receivedInvoices.map((invoice) => invoice.id));
  const payments = data.payments.filter(
    (payment) =>
      !payment.deletedAt &&
      ((payment.type === "INCOME" && payment.issuedInvoiceId && issuedIds.has(payment.issuedInvoiceId)) ||
        (payment.type === "EXPENSE" && payment.receivedInvoiceId && receivedIds.has(payment.receivedInvoiceId))),
  );
  const clients = data.clients.filter((client) => !client.deletedAt && partnerMatchesCompany(client, company));
  const vendors = data.vendors.filter((vendor) => !vendor.deletedAt && partnerMatchesCompany(vendor, company));
  const months = monthlyInvoiceSummary(issuedInvoices, receivedInvoices, payments);
  const importMonths = importMonthlySummary(importShipmentViews(data, company));

  return (
    <AppShell>
      <PageHeader title="レポート" description="月別、案件別、クライアント別、支払先別の数字をCSVに落とせる形で確認します。">
        <SectionExportDialog scope="all" role={user.role} />
        <Button asChild variant="outline"><Link href={`/api/export/projects?company=${company}`} prefetch={false}>案件別CSV</Link></Button>
      </PageHeader>

      <section className="grid min-w-0 gap-6">
        <Card variant="section">
          <CardHeader><CardTitle>月別集計（税込）</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>年月</TableHead><TableHead className="text-right">発行請求</TableHead><TableHead className="text-right">入金</TableHead><TableHead className="text-right">発行分の未入金（現在）</TableHead><TableHead className="text-right">支払期限の請求額</TableHead><TableHead className="text-right">支払済み</TableHead><TableHead className="text-right">入出金差額</TableHead></TableRow></TableHeader>
              <TableBody>{months.map((row) => <TableRow key={row.month}><TableCell>{row.month}</TableCell><TableCell className="text-right"><Money value={row.issuedTotal} /></TableCell><TableCell className="text-right"><Money value={row.incomeTotal} /></TableCell><TableCell className="text-right"><Money value={row.unpaidIssuedAmount} /></TableCell><TableCell className="text-right"><Money value={row.receivedDueTotal} /></TableCell><TableCell className="text-right"><Money value={row.expenseTotal} /></TableCell><TableCell className="text-right"><Money value={row.incomeTotal - row.expenseTotal} /></TableCell></TableRow>)}</TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card variant="section">
          <CardHeader><CardTitle>案件別 請求差額・入出金（税込）</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>案件</TableHead><TableHead className="text-right">発行請求</TableHead><TableHead className="text-right">受領請求</TableHead><TableHead className="text-right">請求差額</TableHead><TableHead>差額率</TableHead><TableHead className="text-right">入出金差額</TableHead></TableRow></TableHeader>
              <TableBody>{projects.map((project) => {
                const money = projectMoney(data, project.id);
                return <TableRow key={project.id}><TableCell className="font-medium">{project.name}</TableCell><TableCell className="text-right"><Money value={money.invoicedAmount} /></TableCell><TableCell className="text-right"><Money value={money.receivedInvoiceTotal} /></TableCell><TableCell className="text-right"><Money value={money.grossProfit} /></TableCell><TableCell>{money.invoicedAmount > 0 ? percent(money.grossProfitRate) : "-"}</TableCell><TableCell className="text-right"><Money value={money.paidIncomeAmount - money.paidExpenseAmount} /></TableCell></TableRow>;
              })}</TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card variant="section">
          <CardHeader><CardTitle>クライアント別売上</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>クライアント</TableHead><TableHead className="text-right">請求額</TableHead><TableHead className="text-right">入金額</TableHead></TableRow></TableHeader>
              <TableBody>{clients.map((client) => {
                const invoices = issuedInvoices.filter((invoice) => invoice.clientId === client.id);
                return <TableRow key={client.id}><TableCell className="font-medium">{client.companyName}</TableCell><TableCell className="text-right"><Money value={invoices.reduce((sum, invoice) => sum + invoice.total, 0)} /></TableCell><TableCell className="text-right"><Money value={invoices.reduce((sum, invoice) => sum + paidForIssued(data, invoice.id), 0)} /></TableCell></TableRow>;
              })}</TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card variant="section">
          <CardHeader><CardTitle>支払先別支払い額</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>支払先</TableHead><TableHead className="text-right">受領請求額</TableHead><TableHead className="text-right">支払済み</TableHead></TableRow></TableHeader>
              <TableBody>{vendors.map((vendor) => {
                const invoices = receivedInvoices.filter((invoice) => invoice.vendorId === vendor.id);
                return <TableRow key={vendor.id}><TableCell className="font-medium">{vendor.companyName}</TableCell><TableCell className="text-right"><Money value={invoices.reduce((sum, invoice) => sum + invoice.total, 0)} /></TableCell><TableCell className="text-right"><Money value={invoices.reduce((sum, invoice) => sum + paidForReceived(data, invoice.id), 0)} /></TableCell></TableRow>;
              })}</TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card variant="section">
          <CardHeader><CardTitle>輸入の関税・消費税（月別）</CardTitle></CardHeader>
          <CardContent>
            {importMonths.length ? <Table>
              <TableHeader><TableRow><TableHead>月</TableHead><TableHead>便数</TableHead><TableHead className="text-right">課税価格</TableHead><TableHead className="text-right">関税</TableHead><TableHead className="text-right">輸入消費税</TableHead><TableHead className="text-right">通関手数料・その他</TableHead><TableHead className="text-right">諸費用合計</TableHead></TableRow></TableHeader>
              <TableBody>{importMonths.map((row) => <TableRow key={row.month}><TableCell className="font-medium">{row.month}</TableCell><TableCell>{row.count}</TableCell><TableCell className="text-right"><Money value={row.goodsValue} /></TableCell><TableCell className="text-right"><Money value={row.dutyAmount} /></TableCell><TableCell className="text-right"><Money value={row.importTax} /></TableCell><TableCell className="text-right"><Money value={row.brokerFee + row.otherCost} /></TableCell><TableCell className="text-right"><Money value={row.costTotal} /></TableCell></TableRow>)}</TableBody>
            </Table> : <p className="text-sm text-muted-foreground">輸入便の登録はまだありません。<Link href={`/imports?company=${company}`} className="underline underline-offset-4">輸入</Link>から登録できます。</p>}
          </CardContent>
        </Card>
      </section>
    </AppShell>
  );
}
