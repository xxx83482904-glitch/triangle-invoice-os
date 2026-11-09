import { redirect } from "next/navigation";
import { AppShell } from "@/components/app/shell";
import { BankIntegrityWorkspace } from "@/components/app/bank-integrity-workspace";
import { getCurrentUser } from "@/lib/auth";
import { companyFromParam } from "@/lib/company";
import { uploadedFileExists } from "@/lib/files";
import { filterIntegrityReport, integrityReport, summarizeIntegrity } from "@/lib/integrity";
import { can, canAccessCompany } from "@/lib/rbac";
import { defaultPathForUser } from "@/lib/app-navigation";
import { readDataForRequest } from "@/lib/store";

export default async function BankIntegrityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user, "view:banking")) redirect(defaultPathForUser(user));
  const params = await searchParams, company = companyFromParam(params.company);
  if (!canAccessCompany(user, company)) redirect(defaultPathForUser(user));
  const data = await readDataForRequest();
  const report = integrityReport(data, company, { fileExists: uploadedFileExists, includeKnown: params.known === "1" });
  const view = filterIntegrityReport(report, params.kind, Number(params.page) || 1, 50, params.known === "1");
  return <AppShell><BankIntegrityWorkspace key={company} company={company} mayEdit={can(user, "manage:banking")} summary={summarizeIntegrity(report)} view={view} /></AppShell>;
}
