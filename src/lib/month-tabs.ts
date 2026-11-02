import { bankFiscalYear } from "@/lib/bank-account-overview";
import { bankLedgerMonths } from "@/lib/bank-ledger";

const datedMonth = /^\d{4}-(0[1-9]|1[0-2])$/;

export function countByMonth(months: string[]) {
  const counts = new Map<string, number>();
  for (const month of months) counts.set(month, (counts.get(month) ?? 0) + 1);
  return counts;
}

// Keys without a usable date ("undated", "0000-00") get their own tab beside the fiscal months.
export function monthTabsView(value: string, months: string[], today?: string) {
  const dated = months.filter((month) => datedMonth.test(month));
  const undated = [...new Set(months.filter((month) => !datedMonth.test(month)))];
  const anchor = datedMonth.test(value) ? value : [...dated].sort().at(-1) || today;
  if (!anchor) return { undated, year: null, years: [], tabs: [], previousYear: null, nextYear: null };
  const year = bankFiscalYear(anchor);
  const years = [...new Set([year, ...(today ? [bankFiscalYear(today)] : []), ...dated.map(bankFiscalYear)])].sort((a, b) => b - a);
  const index = years.indexOf(year);
  return { undated, year, years, tabs: bankLedgerMonths(year), previousYear: years[index + 1] ?? null, nextYear: years[index - 1] ?? null };
}
