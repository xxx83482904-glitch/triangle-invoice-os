import Link from "next/link";
import { AlertCircle, CheckCircle2, Clock3, FileWarning, ReceiptText, WalletCards } from "lucide-react";
import { AppShell, PageHeader } from "@/components/app/shell";
import { StatusBadge } from "@/components/app/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getCurrentUser } from "@/lib/auth";
import { formatDate, monthKey, yen, percent } from "@/lib/format";
import { projectMoney, readData, scopedProjectsForUser, paidForIssued, paidForReceived } from "@/lib/store";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  const data = readData();
  const scopedProjects = user ? scopedProjectsForUser(data, user) : [];
  const projectIds = new Set(scopedProjects.map((project) => project.id));
  const currentMonth = monthKey(new Date());
  const issued = data.issuedInvoices.filter((invoice) => !invoice.deletedAt && projectIds.has(invoice.projectId));
  const received = data.receivedInvoices.filter((invoice) => !invoice.deletedAt && projectIds.has(invoice.projectId));
  const payments = data.payments.filter((payment) => !payment.deletedAt);

  const monthIssued = issued
    .filter((invoice) => monthKey(invoice.issueDate) === currentMonth)
    .reduce((sum, invoice) => sum + invoice.total, 0);
  const monthIncome = payments
    .filter((payment) => payment.type === "INCOME" && monthKey(payment.paymentDate) === currentMonth)
    .reduce((sum, payment) => sum + payment.amount, 0);
  const unpaid = issued.reduce((sum, invoice) => sum + Math.max(invoice.total - paidForIssued(data, invoice.id), 0), 0);
  const overdue = issued.filter((invoice) => invoice.status === "OVERDUE");
  const monthScheduled = received
    .filter((invoice) => monthKey(invoice.dueDate) === currentMonth && invoice.status !== "PAID")
    .reduce((sum, invoice) => sum + invoice.total, 0);
  const monthExpensePaid = payments
    .filter((payment) => payment.type === "EXPENSE" && monthKey(payment.paymentDate) === currentMonth)
    .reduce((sum, payment) => sum + payment.amount, 0);
  const unpaidExpense = received.reduce(
    (sum, invoice) => sum + Math.max(invoice.total - paidForReceived(data, invoice.id), 0),
    0,
  );
  const approvalPending = received.filter((invoice) => invoice.status === "APPROVAL_PENDING");

  const cards = [
    { label: "今月の発行済み請求額", value: yen.format(monthIssued), icon: ReceiptText },
    { label: "今月の入金済み金額", value: yen.format(monthIncome), icon: CheckCircle2 },
    { label: "未入金合計", value: yen.format(unpaid), icon: AlertCircle, tone: "text-amber-700" },
    { label: "期限超過", value: `${overdue.length}件 / ${yen.format(overdue.reduce((s, i) => s + i.total, 0))}`, icon: FileWarning, tone: "text-red-700" },
    { label: "今月の支払い予定額", value: yen.format(monthScheduled), icon: Clock3 },
    { label: "支払い済み金額", value: yen.format(monthExpensePaid), icon: WalletCards },
    { label: "未払い合計", value: yen.format(unpaidExpense), icon: AlertCircle, tone: "text-amber-700" },
    { label: "承認待ちの受領請求書", value: `${approvalPending.length}件`, icon: FileWarning, tone: "text-red-700" },
  ];

  return (
    <AppShell>
      <PageHeader title="ダッシュボード" description="案件ごとの売上・入金・支払いの現在地を確認します。">
        <Button asChild>
          <Link href="/issued-invoices">請求書を作成</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/received-invoices">受領請求書を登録</Link>
        </Button>
      </PageHeader>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.label}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{card.label}</CardTitle>
                <Icon className={`h-4 w-4 ${card.tone ?? "text-muted-foreground"}`} />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold tracking-tight">{card.value}</div>
              </CardContent>
            </Card>
          );
        })}
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>案件別サマリー</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>案件</TableHead>
                  <TableHead>契約</TableHead>
                  <TableHead>入金済み</TableHead>
                  <TableHead>支払い</TableHead>
                  <TableHead>粗利</TableHead>
                  <TableHead>粗利率</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scopedProjects.map((project) => {
                  const money = projectMoney(data, project.id);
                  return (
                    <TableRow key={project.id}>
                      <TableCell>
                        <Link className="font-medium hover:underline" href={`/projects/${project.id}`}>
                          {project.name}
                        </Link>
                        <div className="mt-1">
                          <StatusBadge status={project.status} />
                        </div>
                      </TableCell>
                      <TableCell>{yen.format(money.contractAmount)}</TableCell>
                      <TableCell>{yen.format(money.paidIncomeAmount)}</TableCell>
                      <TableCell>{yen.format(money.receivedInvoiceTotal)}</TableCell>
                      <TableCell className={money.grossProfit < 0 ? "text-red-700" : ""}>
                        {yen.format(money.grossProfit)}
                      </TableCell>
                      <TableCell>{percent(money.grossProfitRate)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>今日確認すべき項目</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {overdue.slice(0, 4).map((invoice) => (
              <div key={invoice.id} className="rounded-md border p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{invoice.invoiceNumber}</span>
                  <Badge variant="destructive">期限超過</Badge>
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {formatDate(invoice.dueDate)} / {yen.format(invoice.total)}
                </div>
              </div>
            ))}
            {approvalPending.slice(0, 4).map((invoice) => (
              <div key={invoice.id} className="rounded-md border p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">
                    {data.vendors.find((vendor) => vendor.id === invoice.vendorId)?.companyName}
                  </span>
                  <StatusBadge status={invoice.status} />
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  支払期限 {formatDate(invoice.dueDate)} / {yen.format(invoice.total)}
                </div>
              </div>
            ))}
            {overdue.length === 0 && approvalPending.length === 0 ? (
              <div className="rounded-md border bg-muted/40 p-4 text-sm text-muted-foreground">
                緊急対応が必要な請求・承認待ちはありません。
              </div>
            ) : null}
          </CardContent>
        </Card>
      </section>
    </AppShell>
  );
}
