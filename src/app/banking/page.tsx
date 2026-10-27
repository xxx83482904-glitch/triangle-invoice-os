import { redirect } from "next/navigation";
import { AppShell } from "@/components/app/shell";
import { BankingWorkspace } from "@/components/app/banking-workspace";
import { getCurrentUser } from "@/lib/auth";
import { bankDisplayRows, bankFilters, selectBankTransactions } from "@/lib/banking";
import { bankAccountFilter } from "@/lib/bank-account-options";
import { bankSyncBusy } from "@/lib/banking-sync";
import { companyFromParam } from "@/lib/company";
import { moneyForwardConfig } from "@/lib/moneyforward-client";
import { can, defaultPathForRole } from "@/lib/rbac";
import { readDataForRequest } from "@/lib/store";
import { effectiveOcrConfig } from "@/lib/ocr-settings";
import { bankingDataRevision } from "@/lib/banking-revision";

export default async function BankingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user, "view:banking")) redirect(defaultPathForRole(user.role));
  const params = await searchParams;
  const company = companyFromParam(params.company);
  const data = await readDataForRequest();
  const filters = bankFilters({ ...params, page: "1" });
  const accountFilter = bankAccountFilter(data.bankAccounts, data.bankTransactions, company, filters.account);
  const result = selectBankTransactions(data, company, filters);
  const sync = data.bankSyncStates.find((state) => state.company === company);
  const ai = await effectiveOcrConfig();
  return <AppShell><BankingWorkspace key={`${company}:${JSON.stringify(filters)}`} company={company} filters={filters} {...result}
    rows={bankDisplayRows(data, result.rows)}
    revision={bankingDataRevision(data, company)}
    accounts={data.bankAccounts.filter((row) => row.company === company)}
    accountOptions={accountFilter.options}
    selectedAccountOption={accountFilter.selectedId}
    categories={data.accountingCategories.filter((row) => row.company === company).sort((a, b) => a.name.localeCompare(b.name, "ja"))}
    rules={data.bankRules.filter((row) => row.company === company && !row.deletedAt)}
    configured={Boolean(moneyForwardConfig(company))} sync={sync} busy={bankSyncBusy(sync)} admin={user.role === "ADMIN"}
    aiSettings={can(user, "manage:settings") ? { configured: Boolean(ai.openAiApiKey), model: ai.ocrAiModel, keyFromEnv: ai.openAiSource === "env", modelFromEnv: ai.ocrAiModelSource === "env" } : undefined}
  /></AppShell>;
}
