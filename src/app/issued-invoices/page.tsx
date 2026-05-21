import Link from "next/link";
import { createIssuedInvoice } from "@/app/actions";
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
import { companyFromParam, matchesCompany, partnerMatchesCompany } from "@/lib/company";
import { formatDate, todayIso, yen } from "@/lib/format";
import { can } from "@/lib/rbac";
import { selectOptionsFor } from "@/lib/select-options";
import { paidForIssued, readData } from "@/lib/store";

export default async function IssuedInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const company = companyFromParam(params.company);
  const user = await getCurrentUser();
  const data = readData();
  const setting = data.invoiceNumberSettings[0];
  const defaultNumber = `${setting.prefix}-${setting.fiscalYear}-${String(setting.nextNumber).padStart(4, "0")}`;
  const projects = data.projects
    .filter((project) => !project.deletedAt && matchesCompany(project, company))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, "ja"));
  const projectIds = new Set(projects.map((project) => project.id));
  const clients = data.clients
    .filter((client) => !client.deletedAt && partnerMatchesCompany(client, company))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.companyName.localeCompare(b.companyName, "ja"));
  const invoices = data.issuedInvoices.filter((invoice) => !invoice.deletedAt && projectIds.has(invoice.projectId));
  const issuedStatusOptions = selectOptionsFor(data, "ISSUED_INVOICE_STATUS", company);
  const taxRateOptions = selectOptionsFor(data, "TAX_RATE", company);

  return (
    <AppShell>
      <PageHeader title="発行請求書" description="自社が発行する請求書の作成、PDF出力、入金状況を管理します。">
        <Button asChild variant="outline"><Link href={`/api/export/issued-invoices?company=${company}`}>CSVエクスポート</Link></Button>
      </PageHeader>

      <div className="grid gap-6 xl:grid-cols-[1fr_440px]">
        <Card>
          <CardHeader><CardTitle>発行請求書一覧</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>番号</TableHead><TableHead>発行日</TableHead><TableHead>期限</TableHead><TableHead>クライアント</TableHead><TableHead>案件</TableHead><TableHead>税抜</TableHead><TableHead>消費税</TableHead><TableHead>税込</TableHead><TableHead>状態</TableHead><TableHead>入金</TableHead><TableHead>PDF</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell className="font-mono text-xs">{invoice.invoiceNumber}</TableCell>
                    <TableCell>{formatDate(invoice.issueDate)}</TableCell>
                    <TableCell>{formatDate(invoice.dueDate)}</TableCell>
                    <TableCell>{data.clients.find((client) => client.id === invoice.clientId)?.companyName}</TableCell>
                    <TableCell><Link href={`/projects/${invoice.projectId}?company=${company}`} className="hover:underline">{data.projects.find((project) => project.id === invoice.projectId)?.name}</Link></TableCell>
                    <TableCell>{yen.format(invoice.subtotal)}</TableCell>
                    <TableCell>{yen.format(invoice.taxTotal)}</TableCell>
                    <TableCell>{yen.format(invoice.total)}</TableCell>
                    <TableCell><StatusBadge status={invoice.status} /></TableCell>
                    <TableCell>{yen.format(paidForIssued(data, invoice.id))}</TableCell>
                    <TableCell><Button asChild size="sm" variant="outline"><a href={`/api/issued-invoices/${invoice.id}/pdf`} target="_blank">PDF</a></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {user && can(user, "manage:issuedInvoices") ? (
          <Card>
            <CardHeader><CardTitle>請求書を作成</CardTitle></CardHeader>
            <CardContent>
              <form action={createIssuedInvoice} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2"><Label>請求書番号</Label><Input name="invoiceNumber" defaultValue={defaultNumber} required /></div>
                  <div className="space-y-2">
                    <Label>ステータス</Label>
                    <Select name="status" defaultValue={issuedStatusOptions.find((option) => option.value === "ISSUED")?.value ?? issuedStatusOptions[0]?.value ?? "ISSUED"}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{issuedStatusOptions.map((option) => <SelectItem key={option.id} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-2"><Label>発行日</Label><Input name="issueDate" type="date" defaultValue={todayIso()} required /></div>
                  <div className="space-y-2"><Label>取引年月日</Label><Input name="transactionDate" type="date" defaultValue={todayIso()} required /></div>
                  <div className="space-y-2"><Label>支払期限</Label><Input name="dueDate" type="date" required /></div>
                </div>
                <div className="space-y-2">
                  <Label>案件名</Label>
                  <Select name="projectId" required><SelectTrigger><SelectValue placeholder="案件を選択" /></SelectTrigger><SelectContent>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent></Select>
                </div>
                <div className="space-y-2">
                  <Label>請求先会社名</Label>
                  <Select name="clientId" required><SelectTrigger><SelectValue placeholder="請求先を選択" /></SelectTrigger><SelectContent>{clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.companyName}</SelectItem>)}</SelectContent></Select>
                </div>
                <div className="rounded-md border p-3">
                  <div className="mb-3 text-sm font-medium">明細行</div>
                  {[0, 1, 2].map((index) => (
                    <div key={index} className="mb-3 grid grid-cols-[1fr_64px_96px_86px] gap-2">
                      <Input name="itemDescription" placeholder="内容" required={index === 0} />
                      <Input name="itemQuantity" type="number" step="0.01" placeholder="数量" defaultValue={index === 0 ? 1 : undefined} />
                      <Input name="itemUnitPrice" type="number" placeholder="単価" />
                      <Select name="itemTaxRate" defaultValue={taxRateOptions.find((option) => option.value === "10")?.value ?? taxRateOptions[0]?.value ?? "10"}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{taxRateOptions.map((option) => <SelectItem key={option.id} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select>
                    </div>
                  ))}
                </div>
                <div className="space-y-2"><Label>備考</Label><Textarea name="notes" placeholder="振込先銀行情報、納品条件など" /></div>
                <div className="space-y-2"><Label>社内メモ</Label><Textarea name="internalMemo" /></div>
                <Button className="w-full">作成する</Button>
              </form>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </AppShell>
  );
}
