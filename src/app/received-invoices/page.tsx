import Link from "next/link";
import { updateReceivedInvoiceStatus } from "@/app/actions";
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
import { formatDate, todayIso, yen } from "@/lib/format";
import { can } from "@/lib/rbac";
import { paidForReceived, readData } from "@/lib/store";

export default async function ReceivedInvoicesPage() {
  const user = await getCurrentUser();
  const data = readData();
  const mayUpload = user && (can(user, "manage:receivedInvoices") || can(user, "upload:receivedInvoices"));
  const mayApprove = user && (can(user, "manage:receivedInvoices") || can(user, "approve:receivedInvoices"));

  return (
    <AppShell>
      <PageHeader title="受領請求書ポスト" description="PDF・画像のアップロード、案件紐づけ、承認・支払い状態を管理します。">
        <Button asChild variant="outline"><Link href="/api/export/received-invoices">CSVエクスポート</Link></Button>
      </PageHeader>

      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <Card>
          <CardHeader><CardTitle>受領請求書一覧</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow><TableHead>請求元</TableHead><TableHead>案件</TableHead><TableHead>請求日</TableHead><TableHead>支払期限</TableHead><TableHead>税抜</TableHead><TableHead>消費税</TableHead><TableHead>税込</TableHead><TableHead>支払済み</TableHead><TableHead>状態</TableHead><TableHead>ファイル</TableHead><TableHead>変更</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {data.receivedInvoices.filter((invoice) => !invoice.deletedAt).map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell>{data.vendors.find((vendor) => vendor.id === invoice.vendorId)?.companyName}</TableCell>
                    <TableCell><Link href={`/projects/${invoice.projectId}`} className="hover:underline">{data.projects.find((project) => project.id === invoice.projectId)?.name}</Link></TableCell>
                    <TableCell>{formatDate(invoice.issueDate)}</TableCell>
                    <TableCell>{formatDate(invoice.dueDate)}</TableCell>
                    <TableCell>{yen.format(invoice.subtotal)}</TableCell>
                    <TableCell>{yen.format(invoice.taxTotal)}</TableCell>
                    <TableCell>{yen.format(invoice.total)}</TableCell>
                    <TableCell>{yen.format(paidForReceived(data, invoice.id))}</TableCell>
                    <TableCell><StatusBadge status={invoice.status} /></TableCell>
                    <TableCell>{invoice.fileUrl ? <a className="text-sm underline" href={invoice.fileUrl} target="_blank">プレビュー</a> : "-"}</TableCell>
                    <TableCell>
                      {mayApprove ? (
                        <form action={updateReceivedInvoiceStatus} className="flex gap-2">
                          <input type="hidden" name="receivedInvoiceId" value={invoice.id} />
                          <Select name="status" defaultValue={invoice.status}>
                            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="RECEIVED">受領済み</SelectItem>
                              <SelectItem value="REVIEWING">確認中</SelectItem>
                              <SelectItem value="APPROVAL_PENDING">承認待ち</SelectItem>
                              <SelectItem value="SCHEDULED">支払予定</SelectItem>
                              <SelectItem value="ON_HOLD">保留</SelectItem>
                              <SelectItem value="REJECTED">差し戻し</SelectItem>
                              <SelectItem value="PAID">支払済み</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button size="sm" variant="outline">保存</Button>
                        </form>
                      ) : "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {mayUpload ? (
          <Card>
            <CardHeader><CardTitle>アップロード</CardTitle></CardHeader>
            <CardContent>
              <form action="/api/uploads/received-invoices" method="post" encType="multipart/form-data" className="space-y-4">
                <div className="space-y-2"><Label>ファイル</Label><Input name="file" type="file" accept="application/pdf,image/jpeg,image/png" required /></div>
                <div className="space-y-2">
                  <Label>案件への紐づけ</Label>
                  <Select name="projectId" required><SelectTrigger><SelectValue placeholder="案件を選択" /></SelectTrigger><SelectContent>{data.projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent></Select>
                </div>
                <div className="space-y-2">
                  <Label>支払先</Label>
                  <Select name="vendorId" required><SelectTrigger><SelectValue placeholder="支払先を選択" /></SelectTrigger><SelectContent>{data.vendors.map((vendor) => <SelectItem key={vendor.id} value={vendor.id}>{vendor.companyName}</SelectItem>)}</SelectContent></Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2"><Label>請求日</Label><Input name="issueDate" type="date" defaultValue={todayIso()} required /></div>
                  <div className="space-y-2"><Label>支払期限</Label><Input name="dueDate" type="date" required /></div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-2"><Label>税抜</Label><Input name="subtotal" type="number" required /></div>
                  <div className="space-y-2"><Label>消費税</Label><Input name="taxTotal" type="number" required /></div>
                  <div className="space-y-2"><Label>税込</Label><Input name="total" type="number" required /></div>
                </div>
                <div className="space-y-2"><Label>メモ</Label><Textarea name="memo" /></div>
                <Button className="w-full">確認待ちとして登録</Button>
              </form>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </AppShell>
  );
}
