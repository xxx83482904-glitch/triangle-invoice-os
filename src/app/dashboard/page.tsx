import Link from "next/link";
import { AppShell, PageHeader } from "@/components/app/shell";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth";
import { formatDate, yen } from "@/lib/format";
import { can } from "@/lib/rbac";
import { paidForIssued, paidForReceived, projectMoney, readData, scopedProjectsForUser } from "@/lib/store";
import { DashboardTable } from "./dashboard-table";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  const data = readData();
  const projects = user ? scopedProjectsForUser(data, user) : [];

  const rows = projects.map((project) => {
    const money = projectMoney(data, project.id);
    const client = data.clients.find((item) => item.id === project.clientId);
    const issued = data.issuedInvoices.filter((invoice) => !invoice.deletedAt && invoice.projectId === project.id);
    const received = data.receivedInvoices.filter((invoice) => !invoice.deletedAt && invoice.projectId === project.id);
    const overdue = issued.filter((invoice) => invoice.status === "OVERDUE");
    const nextIncomeDue = issued
      .filter((invoice) => paidForIssued(data, invoice.id) < invoice.total)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
    const nextPaymentDue = received
      .filter((invoice) => paidForReceived(data, invoice.id) < invoice.total)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];

    return {
      id: project.id,
      name: project.name,
      clientId: project.clientId,
      clientName: client?.companyName ?? "-",
      status: project.status,
      issuedCount: issued.length,
      receivedCount: received.length,
      invoicedAmount: money.invoicedAmount,
      paidIncomeAmount: money.paidIncomeAmount,
      unpaidIncomeAmount: money.unpaidIncomeAmount,
      receivedInvoiceTotal: money.receivedInvoiceTotal,
      paidExpenseAmount: money.paidExpenseAmount,
      unpaidExpenseAmount: money.unpaidExpenseAmount,
      grossProfit: money.grossProfit,
      grossProfitRate: money.grossProfitRate,
      overdueAmount: overdue.reduce((sum, invoice) => sum + Math.max(invoice.total - paidForIssued(data, invoice.id), 0), 0),
      nextIncomeDue: nextIncomeDue ? formatDate(nextIncomeDue.dueDate) : "-",
      nextPaymentDue: nextPaymentDue ? formatDate(nextPaymentDue.dueDate) : "-",
    };
  });

  const totals = rows.reduce(
    (sum, row) => ({
      invoiced: sum.invoiced + row.invoicedAmount,
      income: sum.income + row.paidIncomeAmount,
      unpaidIncome: sum.unpaidIncome + row.unpaidIncomeAmount,
      received: sum.received + row.receivedInvoiceTotal,
      expense: sum.expense + row.paidExpenseAmount,
      unpaidExpense: sum.unpaidExpense + row.unpaidExpenseAmount,
      profit: sum.profit + row.grossProfit,
    }),
    { invoiced: 0, income: 0, unpaidIncome: 0, received: 0, expense: 0, unpaidExpense: 0, profit: 0 },
  );

  return (
    <AppShell>
      <PageHeader title="案件別 一覧" description="ヘッダーで並べ替え、案件名・クライアント・状態は行内で直接編集できます。">
        <Button asChild size="sm">
          <Link href="/issued-invoices">請求書作成</Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href="/received-invoices">受領請求書登録</Link>
        </Button>
      </PageHeader>

      <div className="mb-4 grid gap-2 text-sm md:grid-cols-4">
        <Summary label="請求済み" value={yen.format(totals.invoiced)} />
        <Summary label="入金済み" value={yen.format(totals.income)} />
        <Summary label="未入金" value={yen.format(totals.unpaidIncome)} attention />
        <Summary label="未払い" value={yen.format(totals.unpaidExpense)} attention />
      </div>

      <DashboardTable
        canEdit={Boolean(user && can(user, "manage:projects"))}
        clients={data.clients.filter((client) => !client.deletedAt).map((client) => ({ id: client.id, name: client.companyName }))}
        rows={rows}
        totals={totals}
      />
    </AppShell>
  );
}

function Summary({ label, value, attention }: { label: string; value: string; attention?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-md border bg-background px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={attention ? "font-semibold text-amber-700" : "font-semibold"}>{value}</span>
    </div>
  );
}
