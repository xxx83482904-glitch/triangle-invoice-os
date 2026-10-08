import { AppShell, PageHeader } from "@/components/app/shell";
import Link from "next/link";
import { redirect } from "next/navigation";
import { isBillableIssuedInvoice } from "@/lib/documents";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getCurrentUser } from "@/lib/auth";
import { companyFromParam, matchesCompany, partnerMatchesCompany } from "@/lib/company";
import { percent, yen } from "@/lib/format";
import { monthlyInvoiceSummary } from "@/lib/accounting-summary";
import { can, defaultPathForRole } from "@/lib/rbac";
import { paidForIssued, paidForReceived, projectMoney, readDataForRequest as readData } from "@/lib/store";

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
  const receivedInvoices = data.receivedInvoices.filter((invoice) => !invoice.deletedAt && projectIds.has(invoice.projectId));
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

  return (
    <AppShell>
      <PageHeader title="レポート" description="月別、案件別、クライアント別、支払先別の数字をCSVに落とせる形で確認します。">
        <Button asChild variant="outline"><Link href={`/api/export/projects?company=${company}`} prefetch={false}>案件別CSV</Link></Button>
      </PageHeader>

      <section className="grid min-w-0 gap-6">
        <Card>
          <CardHeader><CardTitle>月別集計（税込）</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>年月</TableHead><TableHead>発行請求</TableHead><TableHead>入金</TableHead><TableHead>発行分の未入金（現在）</TableHead><TableHead>支払期限の請求額</TableHead><TableHead>支払済み</TableHead><TableHead>入出金差額</TableHead></TableRow></TableHeader>
              <TableBody>{months.map((row) => <TableRow key={row.month}><TableCell>{row.month}</TableCell><TableCell>{yen.format(row.issuedTotal)}</TableCell><TableCell>{yen.format(row.incomeTotal)}</TableCell><TableCell>{yen.format(row.unpaidIssuedAmount)}</TableCell><TableCell>{yen.format(row.receivedDueTotal)}</TableCell><TableCell>{yen.format(row.expenseTotal)}</TableCell><TableCell>{yen.format(row.incomeTotal - row.expenseTotal)}</TableCell></TableRow>)}</TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>案件別 請求差額・入出金（税込）</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>案件</TableHead><TableHead>発行請求</TableHead><TableHead>受領請求</TableHead><TableHead>請求差額</TableHead><TableHead>差額率</TableHead><TableHead>入出金差額</TableHead></TableRow></TableHeader>
              <TableBody>{projects.map((project) => {
                const money = projectMoney(data, project.id);
                return <TableRow key={project.id}><TableCell className="font-medium">{project.name}</TableCell><TableCell>{yen.format(money.invoicedAmount)}</TableCell><TableCell>{yen.format(money.receivedInvoiceTotal)}</TableCell><TableCell>{yen.format(money.grossProfit)}</TableCell><TableCell>{money.invoicedAmount > 0 ? percent(money.grossProfitRate) : "-"}</TableCell><TableCell>{yen.format(money.paidIncomeAmount - money.paidExpenseAmount)}</TableCell></TableRow>;
              })}</TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>クライアント別売上</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>クライアント</TableHead><TableHead>請求額</TableHead><TableHead>入金額</TableHead></TableRow></TableHeader>
              <TableBody>{clients.map((client) => {
                const invoices = issuedInvoices.filter((invoice) => invoice.clientId === client.id);
                return <TableRow key={client.id}><TableCell className="font-medium">{client.companyName}</TableCell><TableCell>{yen.format(invoices.reduce((sum, invoice) => sum + invoice.total, 0))}</TableCell><TableCell>{yen.format(invoices.reduce((sum, invoice) => sum + paidForIssued(data, invoice.id), 0))}</TableCell></TableRow>;
              })}</TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>支払先別支払い額</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>支払先</TableHead><TableHead>受領請求額</TableHead><TableHead>支払済み</TableHead></TableRow></TableHeader>
              <TableBody>{vendors.map((vendor) => {
                const invoices = receivedInvoices.filter((invoice) => invoice.vendorId === vendor.id);
                return <TableRow key={vendor.id}><TableCell className="font-medium">{vendor.companyName}</TableCell><TableCell>{yen.format(invoices.reduce((sum, invoice) => sum + invoice.total, 0))}</TableCell><TableCell>{yen.format(invoices.reduce((sum, invoice) => sum + paidForReceived(data, invoice.id), 0))}</TableCell></TableRow>;
              })}</TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>
    </AppShell>
  );
}
