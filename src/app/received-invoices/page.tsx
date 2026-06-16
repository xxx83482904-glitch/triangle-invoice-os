import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Minus } from "lucide-react";
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

function monthKey(dateStr: string) {
  if (!dateStr) return "0000-00";
  return dateStr.slice(0, 7);
}

function monthLabel(key: string) {
  if (!key || key === "0000-00") return "日付なし";
  const [y, m] = key.split("-");
  return `${y}年${Number(m)}月`;
}

type SortKey = "issueDate" | "dueDate" | "total" | "status";
type SortDir = "asc" | "desc";

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
  const receivedStatusOptions = selectOptionsFor(data, "RECEIVED_INVOICE_STATUS", company);
  const mayUpload = user && (can(user, "manage:receivedInvoices") || can(user, "upload:receivedInvoices"));
  const mayApprove = user && (can(user, "manage:receivedInvoices") || can(user, "approve:receivedInvoices"));

  // filters & pagination
  const filterVendorId = params.vendorId && params.vendorId !== "all" ? params.vendorId : null;
  const filterStatus = params.status && params.status !== "all" ? params.status : null;
  const filterUnpaid = params.unpaid === "1";
  const sortKey = (params.sort ?? "issueDate") as SortKey;
  const sortDir = (params.dir ?? "desc") as SortDir;
  const PAGE_SIZE = 50;
  const page = Math.max(1, Number(params.page ?? 1));

  const allInvoices = data.receivedInvoices.filter(
    (invoice) => !invoice.deletedAt && projectIds.has(invoice.projectId),
  );

  const filteredInvoices = allInvoices
    .filter((invoice) => {
      if (filterVendorId && invoice.vendorId !== filterVendorId) return false;
      if (filterStatus && invoice.status !== filterStatus) return false;
      if (filterUnpaid && paidForReceived(data, invoice.id) >= invoice.total) return false;
      return true;
    })
    .sort((a, b) => {
      let av: string | number = a.issueDate;
      let bv: string | number = b.issueDate;
      if (sortKey === "dueDate") { av = a.dueDate; bv = b.dueDate; }
      else if (sortKey === "total") { av = a.total; bv = b.total; }
      else if (sortKey === "status") { av = a.status; bv = b.status; }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

  // pagination slice
  const totalPages = Math.max(1, Math.ceil(filteredInvoices.length / PAGE_SIZE));
  const pagedInvoices = filteredInvoices.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // month grouping (on paged slice)
  const grouped = new Map<string, typeof pagedInvoices>();
  for (const inv of pagedInvoices) {
    const key = monthKey(inv.issueDate);
    grouped.set(key, [...(grouped.get(key) ?? []), inv]);
  }
  const monthGroups = Array.from(grouped.entries()).sort(([a], [b]) => b.localeCompare(a));

  function baseParams(overrides: Record<string, string> = {}) {
    return new URLSearchParams({
      company,
      ...(filterVendorId ? { vendorId: filterVendorId } : {}),
      ...(filterStatus ? { status: filterStatus } : {}),
      ...(filterUnpaid ? { unpaid: "1" } : {}),
      sort: sortKey,
      dir: sortDir,
      ...overrides,
    });
  }

  function sortLink(key: SortKey) {
    const nextDir = sortKey === key && sortDir === "desc" ? "asc" : "desc";
    return `?${baseParams({ sort: key, dir: nextDir }).toString()}`;
  }

  function pageLink(p: number) {
    return `?${baseParams({ page: String(p) }).toString()}`;
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <Minus className="ml-1 inline h-3 w-3 opacity-30" />;
    return sortDir === "asc"
      ? <ChevronUp className="ml-1 inline h-3 w-3" />
      : <ChevronDown className="ml-1 inline h-3 w-3" />;
  }

  const totalAmount = filteredInvoices.reduce((s, i) => s + i.total, 0);
  const paidAmount = filteredInvoices.reduce((s, i) => s + paidForReceived(data, i.id), 0);
  const unpaidAmount = totalAmount - paidAmount;

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

          {/* フィルター */}
          <Card>
            <CardContent className="pt-4">
              <form className="flex flex-wrap gap-3" method="get">
                <input type="hidden" name="company" value={company} />
                <Select name="vendorId" defaultValue={filterVendorId ?? "all"}>
                  <SelectTrigger className="h-8 w-[180px] text-xs"><SelectValue placeholder="支払先" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全支払先</SelectItem>
                    {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.companyName}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select name="status" defaultValue={filterStatus ?? "all"}>
                  <SelectTrigger className="h-8 w-[160px] text-xs"><SelectValue placeholder="状態" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全ステータス</SelectItem>
                    {receivedStatusOptions.map((o) => <SelectItem key={o.id} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select name="unpaid" defaultValue={filterUnpaid ? "1" : "0"}>
                  <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue placeholder="未払い" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">未払い条件なし</SelectItem>
                    <SelectItem value="1">未払いあり</SelectItem>
                  </SelectContent>
                </Select>
                <input type="hidden" name="sort" value={sortKey} />
                <input type="hidden" name="dir" value={sortDir} />
                <Button type="submit" size="sm">絞り込み</Button>
                <Button asChild size="sm" variant="ghost"><Link href={`?company=${company}`}>リセット</Link></Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between gap-4">
              <CardTitle>受領請求書一覧</CardTitle>
              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                <span>{filteredInvoices.length}件</span>
                <span>合計 <span className="font-mono font-medium text-foreground">{yen.format(totalAmount)}</span></span>
                <span>支払済 <span className="font-mono font-medium text-green-700">{yen.format(paidAmount)}</span></span>
                {unpaidAmount > 0 ? <span>未払い <span className="font-mono font-medium text-amber-700">{yen.format(unpaidAmount)}</span></span> : null}
              </div>
            </CardHeader>
            <CardContent>
              {filteredInvoices.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  <p>受領請求書はありません。</p>
                  {mayUpload ? <p className="mt-2 text-xs">上のドロップゾーンからファイルをアップロードするか、右の手入力フォームで登録できます。</p> : null}
                </div>
              ) : (
                <div className="space-y-6">
                  {monthGroups.map(([month, invoices]) => (
                    <div key={month}>
                      <div className="mb-2 flex items-center gap-3">
                        <span className="text-sm font-semibold">{monthLabel(month)}</span>
                        <span className="text-xs text-muted-foreground">{invoices.length}件 / {yen.format(invoices.reduce((s, i) => s + i.total, 0))}</span>
                      </div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>請求元</TableHead>
                            <TableHead>案件</TableHead>
                            <TableHead>
                              <Link href={sortLink("issueDate")} className="inline-flex items-center hover:text-foreground">
                                請求日<SortIcon col="issueDate" />
                              </Link>
                            </TableHead>
                            <TableHead>
                              <Link href={sortLink("dueDate")} className="inline-flex items-center hover:text-foreground">
                                支払期限<SortIcon col="dueDate" />
                              </Link>
                            </TableHead>
                            <TableHead className="text-right">
                              <Link href={sortLink("total")} className="inline-flex items-center justify-end hover:text-foreground">
                                税込<SortIcon col="total" />
                              </Link>
                            </TableHead>
                            <TableHead className="text-right">支払済み</TableHead>
                            <TableHead>
                              <Link href={sortLink("status")} className="inline-flex items-center hover:text-foreground">
                                状態<SortIcon col="status" />
                              </Link>
                            </TableHead>
                            <TableHead>ファイル</TableHead>
                            {mayApprove ? <TableHead>変更</TableHead> : null}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {invoices.map((invoice) => (
                            <TableRow key={invoice.id}>
                              <TableCell>{data.vendors.find((v) => v.id === invoice.vendorId)?.companyName ?? "-"}</TableCell>
                              <TableCell>
                                <Link href={`/projects/${invoice.projectId}?company=${company}`} className="hover:underline">
                                  {data.projects.find((p) => p.id === invoice.projectId)?.name ?? "-"}
                                </Link>
                              </TableCell>
                              <TableCell>{formatDate(invoice.issueDate)}</TableCell>
                              <TableCell>{formatDate(invoice.dueDate)}</TableCell>
                              <TableCell className="text-right font-mono">{yen.format(invoice.total)}</TableCell>
                              <TableCell className="text-right font-mono">{yen.format(paidForReceived(data, invoice.id))}</TableCell>
                              <TableCell><StatusBadge status={invoice.status} /></TableCell>
                              <TableCell>
                                {invoice.fileUrl ? (
                                  <a className="text-sm underline" href={invoice.fileUrl} target="_blank">表示</a>
                                ) : "-"}
                              </TableCell>
                              {mayApprove ? (
                                <TableCell>
                                  <form action={updateReceivedInvoiceStatus} className="flex gap-2">
                                    <input type="hidden" name="receivedInvoiceId" value={invoice.id} />
                                    <CreatableSelect
                                      name="status"
                                      defaultValue={invoice.status}
                                      options={receivedStatusOptions.map((o) => ({ label: o.label, value: o.value }))}
                                      create={{ kind: "select-option", company, group: "RECEIVED_INVOICE_STATUS" }}
                                      className="w-36"
                                      required
                                    />
                                    <Button size="sm" variant="outline">保存</Button>
                                  </form>
                                </TableCell>
                              ) : null}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ))}
                </div>
              )}
              {totalPages > 1 ? (
                <div className="mt-4 flex items-center justify-between gap-3 border-t pt-4 text-sm">
                  <span className="text-muted-foreground">{filteredInvoices.length}件中 {(page - 1) * PAGE_SIZE + 1}〜{Math.min(page * PAGE_SIZE, filteredInvoices.length)}件を表示</span>
                  <div className="flex items-center gap-1">
                    {page > 1 ? (
                      <Button asChild size="sm" variant="outline" className="h-8 w-8 p-0">
                        <Link href={pageLink(page - 1)}><ChevronLeft className="h-4 w-4" /></Link>
                      </Button>
                    ) : null}
                    {Array.from({ length: totalPages }, (_, i) => i + 1).filter((p) => Math.abs(p - page) <= 2 || p === 1 || p === totalPages).map((p, idx, arr) => (
                      <span key={p}>
                        {idx > 0 && arr[idx - 1] !== p - 1 ? <span className="px-1 text-muted-foreground">…</span> : null}
                        <Button asChild={p !== page} size="sm" variant={p === page ? "default" : "outline"} className="h-8 w-8 p-0" disabled={p === page}>
                          {p !== page ? <Link href={pageLink(p)}>{p}</Link> : <span>{p}</span>}
                        </Button>
                      </span>
                    ))}
                    {page < totalPages ? (
                      <Button asChild size="sm" variant="outline" className="h-8 w-8 p-0">
                        <Link href={pageLink(page + 1)}><ChevronRight className="h-4 w-4" /></Link>
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}
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
                  <Label>ファイル <span className="text-destructive">*</span></Label>
                  <Input name="file" type="file" accept="application/pdf,image/jpeg,image/png" required />
                </div>
                <div className="space-y-2">
                  <Label>案件 <span className="text-destructive">*</span></Label>
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
                  <Label>支払先 <span className="text-destructive">*</span></Label>
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
                    <Label>請求日 <span className="text-destructive">*</span></Label>
                    <Input name="issueDate" type="date" defaultValue={todayIso()} required />
                  </div>
                  <div className="space-y-2">
                    <Label>支払期限 <span className="text-destructive">*</span></Label>
                    <Input name="dueDate" type="date" required />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-2">
                    <Label>税抜</Label>
                    <Input name="subtotal" type="number" min="0" defaultValue={0} />
                  </div>
                  <div className="space-y-2">
                    <Label>消費税</Label>
                    <Input name="taxTotal" type="number" min="0" defaultValue={0} />
                  </div>
                  <div className="space-y-2">
                    <Label>税込 <span className="text-destructive">*</span></Label>
                    <Input name="total" type="number" min="0" required />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>メモ</Label>
                  <Textarea name="memo" />
                </div>
                <Button className="w-full" type="submit">登録</Button>
                <p className="text-xs text-muted-foreground"><span className="text-destructive">*</span> は必須項目です。</p>
              </form>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </AppShell>
  );
}
