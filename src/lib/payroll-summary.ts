import type { AppData } from "@/lib/types";
import type { CompanyScope } from "@/lib/company";
import { bankCategoryAllocations } from "@/lib/bank-bookkeeping";
import { bankLedgerMonths } from "@/lib/bank-ledger";
import { bankFiscalYear } from "@/lib/bank-account-overview";
import { isBankDate } from "@/lib/banking";
import { payrollSettingsView } from "@/lib/payroll-settings";

// 従業員別の月次支払一覧: bank rows booked to payroll-like categories, grouped by payee (the normalised description)
// across the fiscal year. Read-only; names come from the bank description, not from an employee master.
export { payrollCategoryPattern } from "@/lib/payroll-settings";
const normalize = (value: string) => value.normalize("NFKC").replace(/\s+/g, " ").trim();
// Strip dates, counters and transfer prefixes so "振込 ヤマダ 10月分" and "振込 ヤマダ 11月分" become one payee.
export const payrollPayeeName = (content: string) => normalize(content).replace(/^(振込|振替|給与振込|給料振込|ｷﾕｰﾖ|キュウヨ|ｼﾞﾕｳﾅｼﾞ|口座振替)\s*/i, "").replace(/\d{1,2}月(分|度)?|\d{4}[/-]\d{1,2}([/-]\d{1,2})?|第?\d+回/g, "").replace(/\s{2,}/g, " ").trim() || normalize(content) || "摘要なし";

export type PayrollRow = { payee: string; months: Record<string, number>; total: number; count: number; categories: string[] };
export type PayrollSummary = { year: number; months: string[]; rows: PayrollRow[]; monthTotals: Record<string, number>; total: number; categoryIds: string[] };

export function payrollSummary(data: AppData, company: CompanyScope, year: number): PayrollSummary {
  const months = bankLedgerMonths(year);
  const selected = new Set(payrollSettingsView(data, company).categoryIds);
  const payroll = new Map(data.accountingCategories.filter((row) => row.company === company && !row.deletedAt && !row.parentId && selected.has(row.id)).map((row) => [row.id, row.name]));
  const rows = new Map<string, PayrollRow>();
  const monthTotals = Object.fromEntries(months.map((month) => [month, 0])) as Record<string, number>;
  for (const row of data.bankTransactions) {
    if (row.company !== company || row.side !== "EXPENSE" || row.sourceMissing || row.treatment !== "NORMAL" || !isBankDate(row.transactionDate)) continue;
    const month = row.transactionDate.slice(0, 7);
    if (!months.includes(month)) continue;
    for (const allocation of bankCategoryAllocations(row)) {
      const name = allocation.categoryId && payroll.get(allocation.categoryId);
      if (!name || !Number.isFinite(allocation.amount) || allocation.amount <= 0) continue;
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

export function parsePayrollYear(value?: string) {
  return typeof value === "string" && /^\d{4}$/.test(value) && Number(value) >= 1901 && Number(value) <= 2200 ? Number(value) : undefined;
}
export const payrollYearCookieName = (userId: string, company: CompanyScope) => `triangle-payroll-year-${encodeURIComponent(userId)}-${company}`;
export type PayrollYearSource = "URL" | "REMEMBERED" | "LATEST_PAYROLL" | "LATEST_BANK" | "CURRENT";

export function payrollPeriod(data: AppData, company: CompanyScope, today: string, requestedYear?: string, rememberedYear?: string) {
  const current = bankFiscalYear(today), selected = new Set(payrollSettingsView(data, company).categoryIds);
  const valid = data.bankTransactions.filter((row) => row.company === company && !row.sourceMissing && row.sourceStatus !== "excluded" && isBankDate(row.transactionDate)
    && row.transactionDate >= "1900-09-01" && row.transactionDate <= today);
  const bankYears = [...new Set(valid.map((row) => bankFiscalYear(row.transactionDate)))].filter((year) => parsePayrollYear(String(year)) !== undefined).sort((a, b) => b - a);
  const payrollYears = valid.filter((row) => row.side === "EXPENSE" && row.treatment === "NORMAL" && bankCategoryAllocations(row).some((part) => selected.has(part.categoryId || "") && Number.isFinite(part.amount) && part.amount > 0)).map((row) => bankFiscalYear(row.transactionDate));
  const latestPayroll = payrollYears.length ? payrollYears.reduce((latest, year) => Math.max(latest, year), 0) : undefined;
  const url = parsePayrollYear(requestedYear), remembered = parsePayrollYear(rememberedYear);
  const year = url ?? remembered ?? latestPayroll ?? bankYears[0] ?? current;
  const source: PayrollYearSource = url !== undefined ? "URL" : remembered !== undefined ? "REMEMBERED" : latestPayroll !== undefined ? "LATEST_PAYROLL" : bankYears.length ? "LATEST_BANK" : "CURRENT";
  return { year, source, years: [...new Set([current, year, ...bankYears])].sort((a, b) => b - a) };
}
