import { redirect } from "next/navigation";
import { AppShell } from "@/components/app/shell";
import { BankAccountsWorkspace } from "@/components/app/bank-accounts-workspace";
import { getCurrentUser } from "@/lib/auth";
import { bankAccountOverview } from "@/lib/bank-account-overview";
import { bankToday } from "@/lib/banking";
import { companyFromParam } from "@/lib/company";
import { can, defaultPathForRole } from "@/lib/rbac";
import { readDataForRequest } from "@/lib/store";

export default async function BankAccountsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user, "view:banking")) redirect(defaultPathForRole(user.role));
  const params = await searchParams, company = companyFromParam(params.company);
  const data = await readDataForRequest(), today = bankToday();
  const overview = bankAccountOverview(data, company, params.month, today);
  return <AppShell><BankAccountsWorkspace key={`${company}:${overview.month}`} company={company} today={today} {...overview} /></AppShell>;
}
