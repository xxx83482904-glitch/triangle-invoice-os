import Link from "next/link";
import { redirect } from "next/navigation";
import { createIssuedInvoice } from "@/app/actions";
import { CreatableSelect } from "@/components/app/creatable-select";
import { AppShell, PageHeader } from "@/components/app/shell";
import { DocumentsWorkspace } from "@/components/app/documents-workspace";
import { InvoiceDropzone } from "@/components/app/invoice-dropzone";
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
import { selectOptionsFor } from "@/lib/select-options";
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
  const issuedStatusOptions = selectOptionsFor(data, "ISSUED_INVOICE_STATUS", company)
    .filter((option) => user.role !== "BILLING_EDITOR" || ["DRAFT", "ISSUED", "SENT", "WAITING_PAYMENT"].includes(option.value));
  const taxRateOptions = selectOptionsFor(data, "TAX_RATE", company);

  return (
    <AppShell>
      <PageHeader title="発行請求書">
        {can(user, "view:documents") ? <Button asChild variant="outline"><Link href={`/documents?company=${company}`} prefetch={false}>全書類</Link></Button> : null}
      </PageHeader>

      <div className="space-y-5">
        {can(user, "manage:issuedInvoices") ? <InvoiceDropzone key={`drop:${company}`} company={company} kind="issued" projects={projects.map((p) => ({ value: p.id, label: p.name }))} /> : null}
        <DocumentsWorkspace key={company} company={company} rows={documents} issuedOnly initialId={params.document} canExport={can(user, "export:csv") || can(user, "export:issuedInvoices")} projects={projects.map((p) => ({ value: p.id, label: p.name, clientName: clients.find((c) => c.id === p.clientId)?.companyName }))} />

        {user && can(user, "manage:issuedInvoices") ? (
          <details className="border-y py-4">
            <summary className="cursor-pointer py-2 font-medium">手入力で作成</summary>
            <div className="max-w-3xl pt-4">
              <form action={createIssuedInvoice} className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2"><Label>請求書番号</Label><Input name="invoiceNumber" defaultValue={defaultNumber} required /></div>
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
                      <Input name="itemDescription" placeholder="内容" required={index === 0} />
                      <Input name="itemQuantity" type="number" step="0.01" placeholder="数量" defaultValue={index === 0 ? 1 : undefined} />
                      <Input name="itemUnitPrice" type="number" placeholder="単価" />
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
                <div className="space-y-2"><Label>備考</Label><Textarea name="notes" placeholder="振込先銀行情報、納品条件など" /></div>
                <div className="space-y-2"><Label>社内メモ</Label><Textarea name="internalMemo" /></div>
                <Button className="w-full">作成する</Button>
              </form>
            </div>
          </details>
        ) : null}
      </div>
    </AppShell>
  );
}
