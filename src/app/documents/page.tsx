import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell, PageHeader } from "@/components/app/shell";
import { DocumentsWorkspace } from "@/components/app/documents-workspace";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth";
import { companyFromParam } from "@/lib/company";
import { documentRows, visibleProjects } from "@/lib/documents";
import { can, defaultPathForRole } from "@/lib/rbac";
import { readDataForRequest } from "@/lib/store";

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user, "view:documents")) redirect(defaultPathForRole(user.role));
  const params = await searchParams;
  const company = user.role === "MAIL_EDITOR" ? "JAPAN" : companyFromParam(params.company);
  const data = await readDataForRequest();
  return <AppShell>
    <PageHeader title="全書類">
      {can(user, "view:mailSorter") ? <Button variant="outline" asChild><Link prefetch={false} href="/mail-sorter?company=JAPAN">郵便物</Link></Button> : null}
      {can(user, "view:receivedInvoices") ? <Button variant="outline" asChild><Link prefetch={false} href={`/received-invoices?company=${company}`}>受領請求書</Link></Button> : null}
      {can(user, "view:issuedInvoices") ? <Button variant="outline" asChild><Link prefetch={false} href={`/issued-invoices?company=${company}`}>発行請求書</Link></Button> : null}
    </PageHeader>
    <DocumentsWorkspace key={company} company={company} rows={documentRows(data, user, company)} initialId={params.document} canExport={can(user, "export:csv")}
      projects={visibleProjects(data, user).filter((p) => companyFromParam(p.company) === company).map((p) => ({ value: p.id, label: p.name, clientName: data.clients.find((c) => c.id === p.clientId)?.companyName }))} />
  </AppShell>;
}
