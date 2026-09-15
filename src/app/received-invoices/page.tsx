import Link from "next/link";
import { redirect } from "next/navigation";
import { CreatableSelect } from "@/components/app/creatable-select";
import { AppShell, PageHeader } from "@/components/app/shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getCurrentUser } from "@/lib/auth";
import { companyFromParam, matchesCompany, partnerMatchesCompany } from "@/lib/company";
import { todayIso } from "@/lib/format";
import { receivedStatusLabels, visibleProjects } from "@/lib/documents";
import { can, defaultPathForRole } from "@/lib/rbac";
import { selectOptionsFor } from "@/lib/select-options";
import { paidForReceived, readDataForRequest as readData } from "@/lib/store";
import { ReceivedInvoiceDropzone } from "./received-invoice-dropzone";
import { ReceivedInvoicesWorkspace, type ReceivedInvoiceWorkspaceItem } from "./received-invoices-workspace";

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
  const mayUpload = can(user, "manage:receivedInvoices") || can(user, "upload:receivedInvoices");
  const mayApprove = can(user, "manage:receivedInvoices") || can(user, "approve:receivedInvoices");
  const mayEdit = can(user, "manage:receivedInvoices");

  const projects = visibleProjects(data, user)
    .filter((project) => !project.deletedAt && matchesCompany(project, company))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, "ja"));
  const projectIds = new Set(projects.map((project) => project.id));
  const vendors = data.vendors
    .filter((vendor) => !vendor.deletedAt && partnerMatchesCompany(vendor, company))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.companyName.localeCompare(b.companyName, "ja"));
  const statusOptions = selectOptionsFor(data, "RECEIVED_INVOICE_STATUS", company).map((option) => ({
    label: option.label,
    value: option.value,
  }));
  for (const invoice of data.receivedInvoices.filter((i) => !i.deletedAt && projectIds.has(i.projectId))) {
    if (!statusOptions.some((s) => s.value === invoice.status)) statusOptions.push({ value: invoice.status, label: receivedStatusLabels[invoice.status] || invoice.status });
  }

  const invoices = data.receivedInvoices
    .filter((invoice) => !invoice.deletedAt && projectIds.has(invoice.projectId))
    .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.createdAt.localeCompare(a.createdAt))
    .map<ReceivedInvoiceWorkspaceItem>((invoice) => {
      const vendor = vendors.find((item) => item.id === invoice.vendorId);
      const project = projects.find((item) => item.id === invoice.projectId);
      const paidAmount = paidForReceived(data, invoice.id);
      const linkedMail = data.mailDocuments.find((m) => !m.deletedAt && m.relatedReceivedInvoiceId === invoice.id);
      return {
        createdAt: invoice.createdAt,
        dueDate: invoice.dueDate,
        fileUrl: invoice.fileUrl || linkedMail?.fileUrl,
        folderMonth: invoice.folderMonth,
        id: invoice.id,
        issueDate: invoice.issueDate,
        memo: invoice.memo,
        mimeType: invoice.mimeType || linkedMail?.mimeType,
        ocrText: invoice.ocrText || linkedMail?.ocrText,
        originalFileName: invoice.originalFileName || linkedMail?.originalFileName,
        paidAmount,
        projectId: invoice.projectId,
        projectName: project?.name ?? "案件未設定",
        status: invoice.status,
        subtotal: invoice.subtotal,
        taxTotal: invoice.taxTotal,
        total: invoice.total,
        unpaidAmount: Math.max(0, invoice.total - paidAmount),
        vendorId: invoice.vendorId,
        vendorName: vendor?.companyName ?? "支払先未設定",
      };
    });

  return (
    <AppShell>
      <PageHeader title="受領請求書" description="請求書ファイルを直接ドロップすると、OCRで支払先・案件・日付・金額を仮仕分けします。">
        <Button asChild variant="outline"><Link href={`/documents?company=${company}`}>全書類</Link></Button>
        <Button asChild variant="outline">
          <Link href={`/api/export/received-invoices?company=${company}`} prefetch={false}>CSVエクスポート</Link>
        </Button>
      </PageHeader>

      <div className="space-y-6">
        {mayUpload ? <ReceivedInvoiceDropzone company={company} /> : null}
        <ReceivedInvoicesWorkspace
          key={`${company}:${params.document || ""}`}
          initialId={params.document}
          showTotals={can(user, "view:dashboard")}
          canApprove={mayApprove}
          canEdit={mayEdit}
          company={company}
          invoices={invoices}
          projects={projects.map((project) => ({ label: project.name, value: project.id }))}
          statusOptions={statusOptions}
          vendors={vendors.map((vendor) => ({ label: vendor.companyName, value: vendor.id }))}
        />

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
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="space-y-2">
                    <Label>案件 <span className="text-destructive">*</span></Label>
                    <Select name="projectId" required>
                      <SelectTrigger>
                        <SelectValue placeholder="案件を選択" />
                      </SelectTrigger>
                      <SelectContent>
                        {projects.map((project) => (
                          <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
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
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>請求日 <span className="text-destructive">*</span></Label>
                    <Input name="issueDate" type="date" defaultValue={todayIso()} required />
                  </div>
                  <div className="space-y-2">
                    <Label>支払期限 <span className="text-destructive">*</span></Label>
                    <Input name="dueDate" type="date" required />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
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
