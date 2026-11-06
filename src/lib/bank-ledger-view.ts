import type { BankFilters } from "@/lib/banking-types";

export function bankQuickStatus(status: string) {
  return status === "" || status === "unreviewed" || status === "reviewed" ? status : null;
}

export function bankAdvancedFilterCount(filters: Pick<BankFilters, "category" | "status" | "sort" | "queryMode" | "excludeQuery">) {
  return Number(Boolean(filters.category)) + Number(bankQuickStatus(filters.status) === null)
    + Number(Boolean(filters.queryMode && filters.queryMode !== "contains")) + Number(Boolean(filters.excludeQuery?.trim()));
}

export function bankLedgerDate(date: string, month: string) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!parts) return date;
  return month ? `${Number(parts[2])}/${Number(parts[3])}` : `${parts[1]}/${parts[2]}/${parts[3]}`;
}

export function bankLedgerSort(sort: string, column: "date" | "amount") {
  return sort === `${column}-desc` ? `${column}-asc` : `${column}-desc`;
}

export function bankActionBarVisible(selectedCount: number, hasSaveOption: boolean) {
  return selectedCount > 0 || hasSaveOption;
}

// The selectable scope already excludes unselected, excluded transactions.
export function bankLoadedSelection(scope: ReadonlySet<string>, selected: ReadonlySet<string>) {
  const count = [...scope].filter((id) => selected.has(id)).length;
  return { all: scope.size > 0 && count === scope.size, some: count > 0 && count < scope.size };
}
