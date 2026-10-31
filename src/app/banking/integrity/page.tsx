import { redirect } from "next/navigation";
import { AppShell } from "@/components/app/shell";
import { BankIntegrityWorkspace } from "@/components/app/bank-integrity-workspace";
import { getCurrentUser } from "@/lib/auth";
import { companyFromParam } from "@/lib/company";
import { uploadedFileExists } from "@/lib/files";
import { filterIntegrityReport, integrityReport, summarizeIntegrity } from "@/lib/integrity";
import { can, canAccessCompany, defaultPathForRole } from "@/lib/rbac";
import { readDataForRequest } from "@/lib/store";

export default async function BankIntegrityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user, "view:banking")) redirect(defaultPathForRole(user.role));
  const params = await searchParams, company = companyFromParam(params.company);
  if (!canAccessCompany(user, company)) redirect(defaultPathForRole(user.role));
  const data = await readDataForRequest();
  const report = integrityReport(data, company, { fileExists: uploadedFileExists });
  const view = filterIntegrityReport(report, params.kind, Number(params.page) || 1);
  return <AppShell><BankIntegrityWorkspace key={`${company}:${view.kind}:${view.page}`} company={company} summary={summarizeIntegrity(report)} view={view} /></AppShell>;
}
