import Link from "next/link";
import { redirect } from "next/navigation";
import { updateReceivedInvoiceStatus } from "@/app/actions";
import { CreatableSelect } from "@/components/app/creatable-select";
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
import { can, defaultPathForRole } from "@/lib/rbac";
import { selectOptionsFor } from "@/lib/select-options";
import { paidForReceived, readData } from "@/lib/store";
import { ReceivedInvoiceDropzone } from "./received-invoice-dropzone";

export default async function ReceivedInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const company = companyFromParam(params.company);
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user, "view:receivedInvoices")) redirect(defaultPathForRole(user.role));
  const data = await readData();
  const projects = data.projects
    .filter((project) => !project.deletedAt && matchesCompany(project, company))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, "ja"));
  const projectIds = new Set(projects.map((project) => project.id));
  const vendors = data.vendors
    .filter((vendor) => !vendor.deletedAt && partnerMatchesCompany(vendor, company))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.companyName.localeCompare(b.companyName, "ja"));
  const receivedInvoices = data.receivedInvoices.filter((invoice) => !invoice.deletedAt && projectIds.has(invoice.projectId));
  const receivedStatusOptions = selectOptionsFor(data, "RECEIVED_INVOICE_STATUS", company);
  const mayUpload = user && (can(user, "manage:receivedInvoices") || can(user, "upload:receivedInvoices"));
  const mayApprove = user && (can(user, "manage:receivedInvoices") || can(user, "approve:receivedInvoices"));

  return (
    <AppShell>
      <PageHeader title="受領請求書" description="請求書ファイルを直接ドロップすると、OCRで支払先・案件・日付・金額を仮仕分けします。">
        <Button asChild variant="outline">
          <Link href={`/api/export/received-invoices?company=${company}`}>CSVエクスポート</Link>
        </Button>
      </PageHeader>

      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <div className="space-y-6">
          {mayUpload ? <ReceivedInvoiceDropzone company={company} /> : null}

          <Card>
            <CardHeader>
              <CardTitle>受領請求書一覧</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>請求元</TableHead>
                    <TableHead>案件</TableHead>
                    <TableHead>請求日</TableHead>
                    <TableHead>支払期限</TableHead>
                    <TableHead className="text-right">税込</TableHead>
                    <TableHead className="text-right">支払済み</TableHead>
                    <TableHead>状態</TableHead>
                    <TableHead>ファイル</TableHead>
                    <TableHead>変更</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {receivedInvoices
                    .map((invoice) => (
                      <TableRow key={invoice.id}>
                        <TableCell>{data.vendors.find((vendor) => vendor.id === invoice.vendorId)?.companyName}</TableCell>
                        <TableCell>
                          <Link href={`/projects/${invoice.projectId}?company=${company}`} className="hover:underline">
                            {data.projects.find((project) => project.id === invoice.projectId)?.name}
                          </Link>
                        </TableCell>
                        <TableCell>{formatDate(invoice.issueDate)}</TableCell>
                        <TableCell>{formatDate(invoice.dueDate)}</TableCell>
                        <TableCell className="text-right font-mono">{yen.format(invoice.total)}</TableCell>
                        <TableCell className="text-right font-mono">{yen.format(paidForReceived(data, invoice.id))}</TableCell>
                        <TableCell>
                          <StatusBadge status={invoice.status} />
                        </TableCell>
                        <TableCell>
                          {invoice.fileUrl ? (
                            <a className="text-sm underline" href={invoice.fileUrl} target="_blank">
                              表示
                            </a>
                          ) : (
                            "-"
                          )}
                        </TableCell>
                        <TableCell>
                          {mayApprove ? (
                            <form action={updateReceivedInvoiceStatus} className="flex gap-2">
                              <input type="hidden" name="receivedInvoiceId" value={invoice.id} />
                              <CreatableSelect
                                name="status"
                                defaultValue={invoice.status}
                                options={receivedStatusOptions.map((option) => ({ label: option.label, value: option.value }))}
                                create={{ kind: "select-option", company, group: "RECEIVED_INVOICE_STATUS" }}
                                className="w-36"
                                required
                              />
                              <Button size="sm" variant="outline">
                                保存
                              </Button>
                            </form>
                          ) : (
                            "-"
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        {mayUpload ? (
          <Card>
            <CardHeader>
              <CardTitle>手入力で登録</CardTitle>
            </CardHeader>
            <CardContent>
              <form action="/api/uploads/received-invoices" method="post" encType="multipart/form-data" className="space-y-4">
                <input type="hidden" name="company" value={company} />
                <div className="space-y-2">
                  <Label>ファイル</Label>
                  <Input name="file" type="file" accept="application/pdf,image/jpeg,image/png" required />
                </div>
                <div className="space-y-2">
                  <Label>案件</Label>
                  <Select name="projectId" required>
                    <SelectTrigger>
                      <SelectValue placeholder="案件を選択" />
                    </SelectTrigger>
                    <SelectContent>
                      {projects.map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>支払先</Label>
                  <CreatableSelect
                    name="vendorId"
                    options={vendors.map((vendor) => ({ label: vendor.companyName, value: vendor.id }))}
                    placeholder="支払先を選択"
                    create={{ kind: "vendor", company }}
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>請求日</Label>
                    <Input name="issueDate" type="date" defaultValue={todayIso()} required />
                  </div>
                  <div className="space-y-2">
                    <Label>支払期限</Label>
                    <Input name="dueDate" type="date" required />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-2">
                    <Label>税抜</Label>
                    <Input name="subtotal" type="number" required />
                  </div>
                  <div className="space-y-2">
                    <Label>消費税</Label>
                    <Input name="taxTotal" type="number" required />
                  </div>
                  <div className="space-y-2">
                    <Label>税込</Label>
                    <Input name="total" type="number" required />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>メモ</Label>
                  <Textarea name="memo" />
                </div>
                <Button className="w-full">登録</Button>
              </form>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </AppShell>
  );
}
