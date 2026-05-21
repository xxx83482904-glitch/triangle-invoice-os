import { recordExpensePayment, recordIncomePayment } from "@/app/actions";
import { AppShell, PageHeader } from "@/components/app/shell";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { getCurrentUser } from "@/lib/auth";
import { companyFromParam, matchesCompany } from "@/lib/company";
import { formatDate, todayIso, yen } from "@/lib/format";
import { can } from "@/lib/rbac";
import { paidForIssued, paidForReceived, readData } from "@/lib/store";

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const company = companyFromParam(params.company);
  const user = await getCurrentUser();
  const data = readData();
  const projects = data.projects.filter((project) => !project.deletedAt && matchesCompany(project, company));
  const projectIds = new Set(projects.map((project) => project.id));
  const unpaidIssued = data.issuedInvoices.filter((invoice) => !invoice.deletedAt && projectIds.has(invoice.projectId) && paidForIssued(data, invoice.id) < invoice.total);
  const unpaidReceived = data.receivedInvoices.filter((invoice) => !invoice.deletedAt && projectIds.has(invoice.projectId) && paidForReceived(data, invoice.id) < invoice.total);
  const mayIncome = user && can(user, "manage:incomePayments");
  const mayExpense = user && can(user, "manage:expensePayments");

  return (
    <AppShell>
      <PageHeader title="入金・支払い管理" description="発行請求書への入金、受領請求書への支払いを複数回に分けて記録できます。" />

      <section className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>未入金一覧</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>請求書</TableHead><TableHead>クライアント</TableHead><TableHead>期限</TableHead><TableHead>合計</TableHead><TableHead>入金済み</TableHead><TableHead>状態</TableHead></TableRow></TableHeader>
              <TableBody>{unpaidIssued.map((invoice) => <TableRow key={invoice.id}><TableCell>{invoice.invoiceNumber}</TableCell><TableCell>{data.clients.find((client) => client.id === invoice.clientId)?.companyName}</TableCell><TableCell>{formatDate(invoice.dueDate)}</TableCell><TableCell>{yen.format(invoice.total)}</TableCell><TableCell>{yen.format(paidForIssued(data, invoice.id))}</TableCell><TableCell><StatusBadge status={invoice.status} /></TableCell></TableRow>)}</TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>未払い・支払い予定</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>支払先</TableHead><TableHead>案件</TableHead><TableHead>期限</TableHead><TableHead>合計</TableHead><TableHead>支払済み</TableHead><TableHead>状態</TableHead></TableRow></TableHeader>
              <TableBody>{unpaidReceived.map((invoice) => <TableRow key={invoice.id}><TableCell>{data.vendors.find((vendor) => vendor.id === invoice.vendorId)?.companyName}</TableCell><TableCell>{data.projects.find((project) => project.id === invoice.projectId)?.name}</TableCell><TableCell>{formatDate(invoice.dueDate)}</TableCell><TableCell>{yen.format(invoice.total)}</TableCell><TableCell>{yen.format(paidForReceived(data, invoice.id))}</TableCell><TableCell><StatusBadge status={invoice.status} /></TableCell></TableRow>)}</TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-2">
        {mayIncome ? (
          <Card>
            <CardHeader><CardTitle>入金登録</CardTitle></CardHeader>
            <CardContent>
              <form action={recordIncomePayment} className="space-y-4">
                <div className="space-y-2"><Label>対象請求書</Label><Select name="issuedInvoiceId" required><SelectTrigger><SelectValue placeholder="選択" /></SelectTrigger><SelectContent>{unpaidIssued.map((invoice) => <SelectItem key={invoice.id} value={invoice.id}>{invoice.invoiceNumber} / {yen.format(invoice.total - paidForIssued(data, invoice.id))}</SelectItem>)}</SelectContent></Select></div>
                <div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label>入金日</Label><Input name="paymentDate" type="date" defaultValue={todayIso()} required /></div><div className="space-y-2"><Label>入金額</Label><Input name="amount" type="number" required /></div></div>
                <div className="space-y-2"><Label>方法</Label><Input name="method" defaultValue="銀行振込" /></div>
                <div className="space-y-2"><Label>メモ</Label><Textarea name="memo" /></div>
                <Button>入金を登録</Button>
              </form>
            </CardContent>
          </Card>
        ) : null}
        {mayExpense ? (
          <Card>
            <CardHeader><CardTitle>支払い登録</CardTitle></CardHeader>
            <CardContent>
              <form action={recordExpensePayment} className="space-y-4">
                <div className="space-y-2"><Label>対象受領請求書</Label><Select name="receivedInvoiceId" required><SelectTrigger><SelectValue placeholder="選択" /></SelectTrigger><SelectContent>{unpaidReceived.map((invoice) => <SelectItem key={invoice.id} value={invoice.id}>{data.vendors.find((vendor) => vendor.id === invoice.vendorId)?.companyName} / {yen.format(invoice.total - paidForReceived(data, invoice.id))}</SelectItem>)}</SelectContent></Select></div>
                <div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label>支払日</Label><Input name="paymentDate" type="date" defaultValue={todayIso()} required /></div><div className="space-y-2"><Label>支払額</Label><Input name="amount" type="number" required /></div></div>
                <div className="space-y-2"><Label>支払方法</Label><Input name="method" defaultValue="銀行振込" /></div>
                <div className="space-y-2"><Label>メモ</Label><Textarea name="memo" /></div>
                <Button>支払いを登録</Button>
              </form>
            </CardContent>
          </Card>
        ) : null}
      </section>
    </AppShell>
  );
}
