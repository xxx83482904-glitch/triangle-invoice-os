import Link from "next/link";
import { redirect } from "next/navigation";
import { createIssuedInvoice } from "@/app/actions";
import { CreatableSelect } from "@/components/app/creatable-select";
import { AppShell, PageHeader } from "@/components/app/shell";
import { DocumentsWorkspace } from "@/components/app/documents-workspace";
import { InvoiceDropzone } from "@/components/app/invoice-dropzone";
import { InvoiceCreateDialog, InvoiceCreateSubmit } from "@/components/app/invoice-create-dialog";
import { documentRows } from "@/lib/documents";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getCurrentUser } from "@/lib/auth";
import { matchesCompany, partnerMatchesCompany } from "@/lib/company";
import { todayIso } from "@/lib/format";
import { can, companyForUser, defaultPathForRole } from "@/lib/rbac";
import { defaultSelectOptions, selectOptionsFor } from "@/lib/select-options";
import { readDataForRequest as readData, scopedProjectsForUser } from "@/lib/store";

export default async function IssuedInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user, "view:issuedInvoices")) redirect(defaultPathForRole(user.role));
  const company = companyForUser(user, params.company);
  const data = await readData();
  const setting = data.invoiceNumberSettings[0] ?? { prefix: "TRI", fiscalYear: new Date().getFullYear(), nextNumber: data.issuedInvoices.length + 1 };
  const defaultNumber = `${setting.prefix}-${setting.fiscalYear}-${String(setting.nextNumber).padStart(4, "0")}`;
  const projects = scopedProjectsForUser(data, user)
    .filter((project) => !project.deletedAt && matchesCompany(project, company))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, "ja"));
  const clients = data.clients
    .filter((client) => !client.deletedAt && partnerMatchesCompany(client, company))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.companyName.localeCompare(b.companyName, "ja"));
  const documents = documentRows(data, user, company).filter((row) => row.kind === "issued");
  const fallbackOptions = defaultSelectOptions(todayIso());
  const statuses = selectOptionsFor(data, "ISSUED_INVOICE_STATUS", company);
  const issuedStatusOptions = (statuses.length ? statuses : fallbackOptions.filter((o) => o.group === "ISSUED_INVOICE_STATUS"))
    .filter((option) => user.role !== "BILLING_EDITOR" || ["DRAFT", "ISSUED", "SENT", "WAITING_PAYMENT"].includes(option.value));
  const taxes = selectOptionsFor(data, "TAX_RATE", company);
  const taxRateOptions = taxes.length ? taxes : fallbackOptions.filter((o) => o.group === "TAX_RATE");

  return (
    <AppShell>
      <PageHeader title="発行請求書">
        <Button asChild variant="outline"><Link href={`/estimates?company=${company}`} prefetch={false}>見積書</Link></Button>
        {can(user, "view:documents") ? <Button asChild variant="outline"><Link href={`/documents?company=${company}`} prefetch={false}>全書類</Link></Button> : null}
        {user && can(user, "manage:issuedInvoices") ? (
          <InvoiceCreateDialog key={params.created || "new"}>
              <form action={createIssuedInvoice} className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2"><Label htmlFor="new-invoice-number">請求書番号</Label><Input id="new-invoice-number" name="invoiceNumber" defaultValue={defaultNumber} required /></div>
                  <div className="space-y-2">
                    <Label>ステータス</Label>
                    <CreatableSelect
                      name="status"
                      defaultValue={issuedStatusOptions.find((option) => option.value === "ISSUED")?.value ?? issuedStatusOptions[0]?.value ?? "ISSUED"}
                      options={issuedStatusOptions.map((option) => ({ label: option.label, value: option.value }))}
                      create={{ kind: "select-option", company, group: "ISSUED_INVOICE_STATUS" }}
                      required
                    />
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-2"><Label htmlFor="new-issue-date">発行日</Label><Input id="new-issue-date" name="issueDate" type="date" defaultValue={todayIso()} required /></div>
                  <div className="space-y-2"><Label htmlFor="new-transaction-date">取引年月日</Label><Input id="new-transaction-date" name="transactionDate" type="date" defaultValue={todayIso()} required /></div>
                  <div className="space-y-2"><Label htmlFor="new-due-date">支払期限</Label><Input id="new-due-date" name="dueDate" type="date" required /></div>
                </div>
                <div className="space-y-2">
                  <Label>案件名</Label>
                  <Select name="projectId" required><SelectTrigger aria-label="案件名" className="w-full"><SelectValue placeholder="案件を選択" /></SelectTrigger><SelectContent>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent></Select>
                </div>
                <div className="space-y-2">
                  <Label>請求先会社名</Label>
                  <CreatableSelect
                    name="clientId"
                    options={clients.map((client) => ({ label: client.companyName, value: client.id }))}
                    placeholder="請求先を選択"
                    create={{ kind: "client", company }}
                    required
                  />
                </div>
                <div className="rounded-md border p-3">
                  <div className="mb-3 text-sm font-medium">明細行</div>
                  {[0, 1, 2].map((index) => (
                    <div key={index} className="mb-3 grid gap-2 md:grid-cols-[1fr_64px_96px_86px]">
                      <Input name="itemDescription" aria-label={`明細${index + 1} 内容`} placeholder="内容" required={index === 0} />
                      <Input name="itemQuantity" aria-label={`明細${index + 1} 数量`} type="number" step="0.01" placeholder="数量" defaultValue={index === 0 ? 1 : undefined} />
                      <Input name="itemUnitPrice" aria-label={`明細${index + 1} 単価`} type="number" placeholder="単価" />
                      <CreatableSelect
                        name="itemTaxRate"
                        defaultValue={taxRateOptions.find((option) => option.value === "10")?.value ?? taxRateOptions[0]?.value ?? "10"}
                        options={taxRateOptions.map((option) => ({ label: option.label, value: option.value }))}
                        create={{ kind: "select-option", company, group: "TAX_RATE" }}
                        required={index === 0}
                      />
                    </div>
                  ))}
                </div>
                <div className="space-y-2"><Label htmlFor="new-notes">備考</Label><Textarea id="new-notes" name="notes" /></div>
                <div className="space-y-2"><Label htmlFor="new-internal-memo">社内メモ</Label><Textarea id="new-internal-memo" name="internalMemo" /></div>
                <InvoiceCreateSubmit />
              </form>
          </InvoiceCreateDialog>
        ) : null}
      </PageHeader>
      <div className="space-y-5">
        {params.created && documents.some((row) => row.sourceId === params.created) ? <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">請求書を作成しました</p> : null}
        {can(user, "manage:issuedInvoices") ? <InvoiceDropzone key={`drop:${company}`} company={company} kind="issued" projects={projects.map((p) => ({ value: p.id, label: p.name }))} /> : null}
        <DocumentsWorkspace key={`${company}:${params.document || params.created || ""}`} company={company} rows={documents} issuedOnly initialId={params.document || (params.created ? `issued:${params.created}` : undefined)} canExport={can(user, "export:csv") || can(user, "export:issuedInvoices")} projects={projects.map((p) => ({ value: p.id, label: p.name, clientName: clients.find((c) => c.id === p.clientId)?.companyName }))} />
      </div>
    </AppShell>
  );
}
