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
      money,
      issuedCount: issued.length,
      receivedCount: received.length,
      overdueAmount: overdue.reduce((sum, invoice) => sum + Math.max(invoice.total - paidForIssued(data, invoice.id), 0), 0),
      nextIncomeDue,
      nextPaymentDue,
    };
  });

  const totals = rows.reduce(
    (sum, row) => ({
      invoiced: sum.invoiced + row.money.invoicedAmount,
      income: sum.income + row.money.paidIncomeAmount,
      unpaidIncome: sum.unpaidIncome + row.money.unpaidIncomeAmount,
      received: sum.received + row.money.receivedInvoiceTotal,
      expense: sum.expense + row.money.paidExpenseAmount,
      unpaidExpense: sum.unpaidExpense + row.money.unpaidExpenseAmount,
      profit: sum.profit + row.money.grossProfit,
    }),
    { invoiced: 0, income: 0, unpaidIncome: 0, received: 0, expense: 0, unpaidExpense: 0, profit: 0 },
  );

  return (
    <AppShell>
      <PageHeader title="案件別 一覧" description="担当列を外し、案件ごとの請求・入金・支払い・粗利を横スクロールなしで見やすくしました。">
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
          <Table className="w-full table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[20%]">案件</TableHead>
                <TableHead className="w-[15%]">クライアント</TableHead>
                <TableHead className="w-[9%]">状態</TableHead>
                <TableHead className="w-[14%] text-right">売上</TableHead>
                <TableHead className="w-[11%] text-right">未入金</TableHead>
                <TableHead className="w-[14%] text-right">支払い</TableHead>
                <TableHead className="w-[11%] text-right">未払い</TableHead>
                <TableHead className="w-[10%] text-right">粗利</TableHead>
                <TableHead className="w-[12%]">次の期限</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.project.id}>
                  <TableCell className="align-top">
                    <Link href={`/projects/${row.project.id}`} className="font-medium leading-snug hover:underline">
                      {row.project.name}
                    </Link>
                    <div className="mt-1 text-xs text-muted-foreground">
                      発行 {row.issuedCount}件 / 受領 {row.receivedCount}件
                    </div>
                  </TableCell>
                  <TableCell className="align-top text-sm">{row.client?.companyName ?? "-"}</TableCell>
                  <TableCell className="align-top">
                    <StatusBadge status={row.project.status} />
                  </TableCell>
                  <TableCell className="align-top text-right">
                    <AmountStack
                      primary={row.money.invoicedAmount}
                      primaryLabel="請求"
                      secondary={row.money.paidIncomeAmount}
                      secondaryLabel="入金"
                    />
                  </TableCell>
                  <MoneyCell value={row.money.unpaidIncomeAmount} attention={row.money.unpaidIncomeAmount > 0} />
                  <TableCell className="align-top text-right">
                    <AmountStack
                      primary={row.money.receivedInvoiceTotal}
                      primaryLabel="受領"
                      secondary={row.money.paidExpenseAmount}
                      secondaryLabel="支払"
                    />
                  </TableCell>
                  <MoneyCell value={row.money.unpaidExpenseAmount} attention={row.money.unpaidExpenseAmount > 0} />
                  <TableCell className="align-top text-right">
                    <div className={`font-mono text-sm font-medium ${row.money.grossProfit < 0 ? "text-red-700" : ""}`}>
                      {yen.format(row.money.grossProfit)}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">{percent(row.money.grossProfitRate)}</div>
                  </TableCell>
                  <TableCell className="align-top text-xs leading-5">
                    <DueLine label="入金" value={row.nextIncomeDue ? formatDate(row.nextIncomeDue.dueDate) : "-"} />
                    <DueLine label="支払" value={row.nextPaymentDue ? formatDate(row.nextPaymentDue.dueDate) : "-"} />
                    {row.overdueAmount > 0 ? (
                      <div className="font-medium text-red-700">超過 {yen.format(row.overdueAmount)}</div>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/50 font-medium">
                <TableCell>合計</TableCell>
                <TableCell />
                <TableCell />
                <TableCell className="text-right">
                  <AmountStack primary={totals.invoiced} primaryLabel="請求" secondary={totals.income} secondaryLabel="入金" />
                </TableCell>
                <MoneyCell value={totals.unpaidIncome} attention={totals.unpaidIncome > 0} />
                <TableCell className="text-right">
                  <AmountStack primary={totals.received} primaryLabel="受領" secondary={totals.expense} secondaryLabel="支払" />
                </TableCell>
                <MoneyCell value={totals.unpaidExpense} attention={totals.unpaidExpense > 0} />
                <MoneyCell value={totals.profit} attention={totals.profit < 0} />
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
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

function AmountStack({
  primary,
  primaryLabel,
  secondary,
  secondaryLabel,
}: {
  primary: number;
  primaryLabel: string;
  secondary: number;
  secondaryLabel: string;
}) {
  return (
    <div className="space-y-1">
      <div className="font-mono text-sm">{yen.format(primary)}</div>
      <div className="text-xs text-muted-foreground">
        {secondaryLabel}: {yen.format(secondary)}
      </div>
      <div className="sr-only">{primaryLabel}</div>
    </div>
  );
}

function DueLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-muted-foreground">{label}: </span>
      {value}
    </div>
  );
}

function MoneyCell({ value, attention }: { value: number; attention?: boolean }) {
  return (
    <TableCell className={`align-top text-right font-mono text-sm ${attention ? "font-semibold text-amber-700" : ""}`}>
      {yen.format(value)}
    </TableCell>
  );
}
