import { redirect } from "next/navigation";
import { AppShell } from "@/components/app/shell";
import { BankingWorkspace } from "@/components/app/banking-workspace";
import { getCurrentUser } from "@/lib/auth";
import { bankDisplayRows, bankFilters, bankToday, selectBankTransactions } from "@/lib/banking";
import { bankAccountOverview } from "@/lib/bank-account-overview";
import { bankAccountFilter } from "@/lib/bank-account-options";
import { bankSyncBusy } from "@/lib/banking-sync";
import { pendingBankSyncReviewCount } from "@/lib/bank-sync-runs";
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
  const balanceRow = accountFilter.selectedId ? bankAccountOverview(data, company, undefined, bankToday()).rows.find((row) => row.id === accountFilter.selectedId) : undefined;
  const result = selectBankTransactions(data, company, filters);
  const sync = data.bankSyncStates.find((state) => state.company === company);
  const ai = await effectiveOcrConfig();
  return <AppShell banking><BankingWorkspace key={`${company}:${JSON.stringify(filters)}`} role={user.role} company={company} filters={filters} {...result}
    rows={bankDisplayRows(data, result.rows)}
    revision={bankingDataRevision(data, company)}
    accounts={data.bankAccounts.filter((row) => row.company === company)}
    accountOptions={accountFilter.options}
    selectedAccountOption={accountFilter.selectedId}
    selectedBalance={balanceRow ? { id: balanceRow.id, name: balanceRow.name, kind: balanceRow.kind, unspecified: balanceRow.unspecified, balance: balanceRow.balance, balanceCalculation: balanceRow.balanceCalculation } : undefined}
    categories={data.accountingCategories.filter((row) => row.company === company).sort((a, b) => a.name.localeCompare(b.name, "ja"))}
    rules={data.bankRules.filter((row) => row.company === company && !row.deletedAt)}
    configured={Boolean(moneyForwardConfig(company))} sync={sync} busy={bankSyncBusy(sync)} admin={user.role === "ADMIN"} syncImpact={{ pending: pendingBankSyncReviewCount(data, company) }}
    aiSettings={can(user, "manage:settings") ? { configured: Boolean(ai.openAiApiKey), model: ai.ocrAiModel, keyFromEnv: ai.openAiSource === "env", modelFromEnv: ai.ocrAiModelSource === "env" } : undefined}
  /></AppShell>;
}
