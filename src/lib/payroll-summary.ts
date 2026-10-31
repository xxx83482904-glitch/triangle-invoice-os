import type { AppData } from "@/lib/types";
import type { CompanyScope } from "@/lib/company";
import { bankCategoryAllocations } from "@/lib/bank-bookkeeping";
import { bankLedgerMonths } from "@/lib/bank-ledger";

// 従業員別の月次支払一覧: bank rows booked to payroll-like categories, grouped by payee (the normalised description)
// across the fiscal year. Read-only; names come from the bank description, not from an employee master.
export const payrollCategoryPattern = /給与|給料|賞与|役員報酬|報酬|退職金|通勤手当|源泉所得税|住民税|社会保険料|法定福利/;
const normalize = (value: string) => value.normalize("NFKC").replace(/\s+/g, " ").trim();
// Strip dates, counters and transfer prefixes so "振込 ヤマダ 10月分" and "振込 ヤマダ 11月分" become one payee.
export const payrollPayeeName = (content: string) => normalize(content).replace(/^(振込|振替|給与振込|給料振込|ｷﾕｰﾖ|キュウヨ|ｼﾞﾕｳﾅｼﾞ|口座振替)\s*/i, "").replace(/\d{1,2}月(分|度)?|\d{4}[/-]\d{1,2}([/-]\d{1,2})?|第?\d+回/g, "").replace(/\s{2,}/g, " ").trim() || normalize(content) || "摘要なし";

export type PayrollRow = { payee: string; months: Record<string, number>; total: number; count: number; categories: string[] };
export type PayrollSummary = { year: number; months: string[]; rows: PayrollRow[]; monthTotals: Record<string, number>; total: number; categoryIds: string[] };

export function payrollSummary(data: AppData, company: CompanyScope, year: number): PayrollSummary {
  const months = bankLedgerMonths(year);
  const payroll = new Map(data.accountingCategories.filter((row) => row.company === company && !row.deletedAt && payrollCategoryPattern.test(row.name)).map((row) => [row.id, row.name]));
  const rows = new Map<string, PayrollRow>();
  const monthTotals = Object.fromEntries(months.map((month) => [month, 0])) as Record<string, number>;
  for (const row of data.bankTransactions) {
    if (row.company !== company || row.side !== "EXPENSE" || row.sourceMissing || row.treatment !== "NORMAL") continue;
    const month = row.transactionDate.slice(0, 7);
    if (!months.includes(month)) continue;
    for (const allocation of bankCategoryAllocations(row)) {
      const name = allocation.categoryId && payroll.get(allocation.categoryId);
      if (!name) continue;
      const payee = payrollPayeeName(row.content);
      const entry = rows.get(payee) || { payee, months: Object.fromEntries(months.map((item) => [item, 0])) as Record<string, number>, total: 0, count: 0, categories: [] };
      entry.months[month] += allocation.amount; entry.total += allocation.amount; entry.count++;
      if (!entry.categories.includes(name)) entry.categories.push(name);
      monthTotals[month] += allocation.amount;
      rows.set(payee, entry);
    }
  }
  const list = [...rows.values()].sort((a, b) => b.total - a.total || a.payee.localeCompare(b.payee, "ja"));
  return { year, months, rows: list, monthTotals, total: list.reduce((sum, row) => sum + row.total, 0), categoryIds: [...payroll.keys()] };
}
