import Link from "next/link";
import { AppShell, PageHeader } from "@/components/app/shell";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getCurrentUser } from "@/lib/auth";
import { formatDate, percent, yen } from "@/lib/format";
import { paidForIssued, paidForReceived, projectMoney, readData, scopedProjectsForUser } from "@/lib/store";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  const data = readData();
  const projects = user ? scopedProjectsForUser(data, user) : [];

  const rows = projects.map((project) => {
    const money = projectMoney(data, project.id);
    const client = data.clients.find((item) => item.id === project.clientId);
    const manager = data.users.find((item) => item.id === project.managerId);
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
      project,
      client,
      manager,
      money,
      issuedCount: issued.length,
      receivedCount: received.length,
      overdueAmount: overdue.reduce((sum, invoice) => sum + Math.max(invoice.total - paidForIssued(data, invoice.id), 0), 0),
      overdueCount: overdue.length,
      nextIncomeDue,
      nextPaymentDue,
    };
  });

  const totals = rows.reduce(
    (sum, row) => ({
      contract: sum.contract + row.money.contractAmount,
      invoiced: sum.invoiced + row.money.invoicedAmount,
      income: sum.income + row.money.paidIncomeAmount,
      unpaidIncome: sum.unpaidIncome + row.money.unpaidIncomeAmount,
      received: sum.received + row.money.receivedInvoiceTotal,
      expense: sum.expense + row.money.paidExpenseAmount,
      unpaidExpense: sum.unpaidExpense + row.money.unpaidExpenseAmount,
      profit: sum.profit + row.money.grossProfit,
    }),
    { contract: 0, invoiced: 0, income: 0, unpaidIncome: 0, received: 0, expense: 0, unpaidExpense: 0, profit: 0 },
  );

  return (
    <AppShell>
      <PageHeader title="案件別 一覧" description="請求、入金、受領請求書、支払い、粗利を1つの表で確認します。">
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

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-64">案件</TableHead>
                  <TableHead className="min-w-44">クライアント</TableHead>
                  <TableHead>担当</TableHead>
                  <TableHead>状態</TableHead>
                  <TableHead className="text-right">契約額</TableHead>
                  <TableHead className="text-right">請求済み</TableHead>
                  <TableHead className="text-right">入金済み</TableHead>
                  <TableHead className="text-right">未入金</TableHead>
                  <TableHead className="text-right">期限超過</TableHead>
                  <TableHead className="text-right">受領請求</TableHead>
                  <TableHead className="text-right">支払済み</TableHead>
                  <TableHead className="text-right">未払い</TableHead>
                  <TableHead className="text-right">粗利</TableHead>
                  <TableHead className="text-right">粗利率</TableHead>
                  <TableHead>次の入金期限</TableHead>
                  <TableHead>次の支払期限</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.project.id}>
                    <TableCell>
                      <Link href={`/projects/${row.project.id}`} className="font-medium hover:underline">
                        {row.project.name}
                      </Link>
                      <div className="mt-1 text-xs text-muted-foreground">
                        発行 {row.issuedCount}件 / 受領 {row.receivedCount}件
                      </div>
                    </TableCell>
                    <TableCell>{row.client?.companyName ?? "-"}</TableCell>
                    <TableCell>{row.manager?.name ?? "-"}</TableCell>
                    <TableCell>
                      <StatusBadge status={row.project.status} />
                    </TableCell>
                    <MoneyCell value={row.money.contractAmount} />
                    <MoneyCell value={row.money.invoicedAmount} />
                    <MoneyCell value={row.money.paidIncomeAmount} />
                    <MoneyCell value={row.money.unpaidIncomeAmount} attention={row.money.unpaidIncomeAmount > 0} />
                    <MoneyCell value={row.overdueAmount} attention={row.overdueAmount > 0} />
                    <MoneyCell value={row.money.receivedInvoiceTotal} />
                    <MoneyCell value={row.money.paidExpenseAmount} />
                    <MoneyCell value={row.money.unpaidExpenseAmount} attention={row.money.unpaidExpenseAmount > 0} />
                    <MoneyCell value={row.money.grossProfit} attention={row.money.grossProfit < 0} />
                    <TableCell className="text-right font-mono text-sm">{percent(row.money.grossProfitRate)}</TableCell>
                    <TableCell>{row.nextIncomeDue ? formatDate(row.nextIncomeDue.dueDate) : "-"}</TableCell>
                    <TableCell>{row.nextPaymentDue ? formatDate(row.nextPaymentDue.dueDate) : "-"}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/50 font-medium">
                  <TableCell>合計</TableCell>
                  <TableCell />
                  <TableCell />
                  <TableCell />
                  <MoneyCell value={totals.contract} />
                  <MoneyCell value={totals.invoiced} />
                  <MoneyCell value={totals.income} />
                  <MoneyCell value={totals.unpaidIncome} attention={totals.unpaidIncome > 0} />
                  <TableCell />
                  <MoneyCell value={totals.received} />
                  <MoneyCell value={totals.expense} />
                  <MoneyCell value={totals.unpaidExpense} attention={totals.unpaidExpense > 0} />
                  <MoneyCell value={totals.profit} attention={totals.profit < 0} />
                  <TableCell />
                  <TableCell />
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
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

function MoneyCell({ value, attention }: { value: number; attention?: boolean }) {
  return (
    <TableCell className={`text-right font-mono text-sm ${attention ? "font-semibold text-amber-700" : ""}`}>
      {yen.format(value)}
    </TableCell>
  );
}
