import type { BankAccount, BankTransaction } from "@/lib/banking-types";
import type { CompanyScope } from "@/lib/company";

export type BankAccountOption = { id: string; name: string; available: boolean; memberIds: string[] };
const normalize = (value: string) => value.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase("ja");
const family = (account: BankAccount) => JSON.stringify([account.company, account.officeCode, account.sourceId]);

export function bankAccountFilter(
  all: BankAccount[], transactions: Pick<BankTransaction, "company" | "bankAccountId">[], company: CompanyScope, selected = "",
) {
  const accounts = all.filter((account) => account.company === company);
  const used = new Set(transactions.filter((row) => row.company === company).map((row) => row.bankAccountId));
  const children = new Set(accounts.filter((account) => account.sourceSubId).map(family));
  const groups = new Map<string, BankAccount[]>();
  for (const account of accounts) {
    // Connection headers are not extra accounts. Keep headers that own actual transactions.
    if (!account.sourceSubId && children.has(family(account)) && !used.has(account.id)) continue;
    const name = normalize(account.name);
    // Full account numbers plus the entire bank/branch label may identify reconnects.
    // Short card suffixes and unnumbered names alone are not sufficient evidence.
    const identity = !account.sourceSubId || /(?<!\d)\d{7,}(?!\d)/u.test(name) ? name : account.id;
    const key = JSON.stringify([company, account.officeCode, normalize(account.serviceName), account.isManual, Boolean(account.sourceSubId), identity]);
    const group = groups.get(key);
    if (group) group.push(account); else groups.set(key, [account]);
  }
  const representatives = new Map<string, string>();
  const options: BankAccountOption[] = [...groups.values()].map((group) => {
    const representative = [...group].sort((a, b) => Number(b.available) - Number(a.available) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))[0];
    const families = new Set(group.map(family));
    for (const account of group) representatives.set(account.id, representative.id);
    const memberIds = !representative.sourceSubId
      ? accounts.filter((account) => families.has(family(account))).map((account) => account.id)
      : group.map((account) => account.id);
    return { id: representative.id, name: representative.name + (!representative.sourceSubId && children.has(family(representative)) ? "（全口座）" : ""), available: group.some((account) => account.available), memberIds };
  });
  let current = options.find((option) => option.id === representatives.get(selected));
  // Preserve bookmarked parent filters without exposing every empty connection header.
  const parent = accounts.find((account) => account.id === selected && !account.sourceSubId);
  if (!current && parent) {
    current = { id: parent.id, name: `${parent.name}（全口座）`, available: parent.available, memberIds: accounts.filter((account) => family(account) === family(parent)).map((account) => account.id) };
    options.push(current);
  }
  return { options, selectedId: current?.id || selected, memberIds: new Set(current?.memberIds || (selected ? [selected] : accounts.map((account) => account.id))) };
}
