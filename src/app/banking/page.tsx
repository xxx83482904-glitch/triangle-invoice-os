import { redirect } from "next/navigation";
import { AppShell } from "@/components/app/shell";
import { BankingWorkspace } from "@/components/app/banking-workspace";
import { getCurrentUser } from "@/lib/auth";
import { bankFilters, selectBankTransactions } from "@/lib/banking";
import { bankSyncBusy } from "@/lib/banking-sync";
import { companyFromParam } from "@/lib/company";
import { moneyForwardConfig } from "@/lib/moneyforward-client";
import { can, defaultPathForRole } from "@/lib/rbac";
import { readDataForRequest } from "@/lib/store";

export default async function BankingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user, "view:banking")) redirect(defaultPathForRole(user.role));
  const params = await searchParams;
  const company = companyFromParam(params.company);
  const data = await readDataForRequest();
  const filters = bankFilters(params);
  const result = selectBankTransactions(data, company, filters);
  const sync = data.bankSyncStates.find((state) => state.company === company);
  return <AppShell><BankingWorkspace key={`${company}:${JSON.stringify(filters)}`} company={company} filters={filters} {...result}
    accounts={data.bankAccounts.filter((row) => row.company === company)}
    categories={data.accountingCategories.filter((row) => row.company === company).sort((a, b) => a.name.localeCompare(b.name, "ja"))}
    rules={data.bankRules.filter((row) => row.company === company && !row.deletedAt)}
    configured={Boolean(moneyForwardConfig(company))} sync={sync} busy={bankSyncBusy(sync)} admin={user.role === "ADMIN"}
  /></AppShell>;
}
