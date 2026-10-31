import Link from "next/link";
import { SectionExportDialog } from "@/components/app/section-export-dialog";
import { BankReconciliationLink } from "@/components/app/bank-reconciliation-link";
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
import { readDataForRequest as readData } from "@/lib/store";
import { paymentRecordsFor, receivedPaymentSummary } from "@/lib/payment-records";
import { debtGroupView } from "@/lib/debt-groups";
import { ReceivedInvoiceDropzone } from "./received-invoice-dropzone";
import { ReceivedAmountFields } from "./received-amount-fields";
import { reconciliationIssue } from "@/lib/bank-reconciliation";
import type { ReceivedInvoiceAmounts } from "@/lib/received-invoice-review";
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
      const summary = receivedPaymentSummary(data, invoice);
      const debt = debtGroupView(data, company, invoice);
      const amounts: ReceivedInvoiceAmounts = invoice;
      const linkedMail = data.mailDocuments.find((m) => !m.deletedAt && m.relatedReceivedInvoiceId === invoice.id);
      return {
        createdAt: invoice.createdAt,
        updatedAt: invoice.updatedAt,
        debt,
        grossAmount: amounts.grossAmount,
        withholdingAmount: amounts.withholdingAmount,
        mailProcessed: invoice.mailProcessed === true || linkedMail?.mailProcessed === true,
        bankReconciledAmount: (data.bankReconciliations ?? []).filter((link) => !link.deletedAt && link.company === company && link.invoiceKind === "received" && link.invoiceId === invoice.id && !reconciliationIssue(data, link)).reduce((sum, link) => sum + link.amount, 0),
        dueDate: invoice.dueDate,
        fileUrl: invoice.fileUrl || linkedMail?.fileUrl,
        folderMonth: invoice.folderMonth,
        id: invoice.id,
        issueDate: invoice.issueDate,
        memo: invoice.memo,
        mimeType: invoice.mimeType || linkedMail?.mimeType,
        ocrText: invoice.ocrText || linkedMail?.ocrText,
        originalFileName: invoice.originalFileName || linkedMail?.originalFileName,
        paidAmount: summary.paid,
        payments: paymentRecordsFor(data, company, "received", invoice.id),
        projectId: invoice.projectId,
        projectName: project?.name ?? "案件未設定",
        status: invoice.status,
        statusMismatch: summary.statusMismatch,
        subtotal: invoice.subtotal,
        taxTotal: invoice.taxTotal,
        total: invoice.total,
        unpaidAmount: debt.payable ? summary.outstanding : 0,
        vendorId: invoice.vendorId,
        vendorName: vendor?.companyName ?? "支払先未設定",
      };
    });

  return (
    <AppShell>
      <PageHeader title="受領請求書" description="請求書ファイルを直接ドロップすると、OCRで支払先・案件・日付・金額を仮仕分けします。">
        {can(user, "view:banking") ? <BankReconciliationLink company={company} invoices /> : null}
        <Button asChild variant="outline"><Link href={`/documents?company=${company}`}>全書類</Link></Button>
        <SectionExportDialog scope="received" role={user.role} />
      </PageHeader>

      <div className="space-y-6">
        {mayUpload ? <ReceivedInvoiceDropzone company={company} /> : null}
        <ReceivedInvoicesWorkspace
          key={`${company}:${params.document || ""}`}
          initialId={params.document}
          showTotals={can(user, "view:dashboard")}
          canApprove={mayApprove}
          canEdit={mayEdit}
          canRecordPayments={can(user, "manage:expensePayments")}
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
                    <Label>請求元（発行者） <span className="text-destructive">*</span></Label>
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
                    <Label>請求日</Label>
                    <Input name="issueDate" type="date" defaultValue={todayIso()} />
                  </div>
                  <div className="space-y-2">
                    <Label>支払期限</Label>
                    <Input name="dueDate" type="date" />
                  </div>
                </div>
                <ReceivedAmountFields />
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
