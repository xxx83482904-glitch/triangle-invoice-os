import { AppShell, PageHeader } from "@/components/app/shell";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getCurrentUser } from "@/lib/auth";
import { companyFromParam, matchesCompany, partnerMatchesCompany } from "@/lib/company";
import { monthKey, percent, yen } from "@/lib/format";
import { can, defaultPathForRole } from "@/lib/rbac";
import { paidForIssued, paidForReceived, projectMoney, readData } from "@/lib/store";

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
  const issuedInvoices = data.issuedInvoices.filter((invoice) => !invoice.deletedAt && projectIds.has(invoice.projectId));
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
  const months = Array.from(
    new Set([
      ...issuedInvoices.map((invoice) => monthKey(invoice.issueDate)),
      ...payments.map((payment) => monthKey(payment.paymentDate)),
      ...receivedInvoices.map((invoice) => monthKey(invoice.dueDate)),
    ]),
  ).sort();

  return (
    <AppShell>
      <PageHeader title="レポート" description="月別、案件別、クライアント別、支払先別の数字をCSVに落とせる形で確認します。">
        <Button asChild variant="outline"><Link href={`/api/export/projects?company=${company}`}>案件別CSV</Link></Button>
      </PageHeader>

      <section className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>月別集計</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>年月</TableHead><TableHead>売上請求</TableHead><TableHead>入金</TableHead><TableHead>未入金</TableHead><TableHead>支払予定</TableHead><TableHead>支払済み</TableHead></TableRow></TableHeader>
              <TableBody>{months.map((month) => {
                const issued = issuedInvoices.filter((invoice) => monthKey(invoice.issueDate) === month);
                const income = payments.filter((payment) => payment.type === "INCOME" && monthKey(payment.paymentDate) === month);
                const received = receivedInvoices.filter((invoice) => monthKey(invoice.dueDate) === month);
                const expense = payments.filter((payment) => payment.type === "EXPENSE" && monthKey(payment.paymentDate) === month);
                const issuedTotal = issued.reduce((sum, invoice) => sum + invoice.total, 0);
                const incomeTotal = income.reduce((sum, payment) => sum + payment.amount, 0);
                return <TableRow key={month}><TableCell>{month}</TableCell><TableCell>{yen.format(issuedTotal)}</TableCell><TableCell>{yen.format(incomeTotal)}</TableCell><TableCell>{yen.format(Math.max(issuedTotal - incomeTotal, 0))}</TableCell><TableCell>{yen.format(received.reduce((sum, invoice) => sum + invoice.total, 0))}</TableCell><TableCell>{yen.format(expense.reduce((sum, payment) => sum + payment.amount, 0))}</TableCell></TableRow>;
              })}</TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>案件別粗利</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>案件</TableHead><TableHead>入金済み</TableHead><TableHead>支払い</TableHead><TableHead>粗利</TableHead><TableHead>粗利率</TableHead></TableRow></TableHeader>
              <TableBody>{projects.map((project) => {
                const money = projectMoney(data, project.id);
                return <TableRow key={project.id}><TableCell className="font-medium">{project.name}</TableCell><TableCell>{yen.format(money.paidIncomeAmount)}</TableCell><TableCell>{yen.format(money.receivedInvoiceTotal)}</TableCell><TableCell>{yen.format(money.grossProfit)}</TableCell><TableCell>{percent(money.grossProfitRate)}</TableCell></TableRow>;
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
