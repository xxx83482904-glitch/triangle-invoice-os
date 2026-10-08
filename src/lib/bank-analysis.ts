import type { BankSyncState } from "@/lib/banking-types";
import type { CompanyScope } from "@/lib/company";
import type { AppData } from "@/lib/types";

// Analysis never adds parent accounts to their children or combines currencies.
export function bankAnalysisAccounts(data: AppData, company: CompanyScope, requested?: string) {
  const all = data.bankAccounts.filter((row) => row.company === company);
  const used = new Set(data.bankTransactions.filter((row) => row.company === company).map((row) => row.bankAccountId));
  const parents = new Set(all.filter((row) => row.sourceSubId).map((row) => JSON.stringify([row.officeCode, row.sourceId])));
  const accounts = all.filter((row) => row.sourceSubId || used.has(row.id) || !parents.has(JSON.stringify([row.officeCode, row.sourceId])));
  const parent = all.find((row) => row.id === requested && !row.sourceSubId);
  const account = requested ? accounts.find((row) => row.id === requested) || (parent && accounts.find((row) => row.officeCode === parent.officeCode && row.sourceId === parent.sourceId && row.sourceSubId)) : accounts.find((row) => row.available && used.has(row.id)) || accounts[0];
  return { accounts, account };
}

export function bankPeriodCovered(state: BankSyncState | undefined, accountId: string, start: string, end: string) {
  const ranges = (state?.coverage || []).filter((range) => range.accountIds.includes(accountId)).sort((a, b) => a.start.localeCompare(b.start));
  let through = Date.parse(start) - 86400000;
  for (const range of ranges) if (Date.parse(range.start) <= through + 86400000) through = Math.max(through, Date.parse(range.end));
  return through >= Date.parse(end);
}
