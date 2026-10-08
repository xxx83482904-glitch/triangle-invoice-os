import { z } from "zod";
import { assertBankAccess, isBankDate } from "@/lib/banking";
import { bankPeriodCovered } from "@/lib/bank-analysis";
import type { BankAccount, BankForecastSettings, BankSyncState } from "@/lib/banking-types";
import type { CompanyScope } from "@/lib/company";
import type { AppData, User } from "@/lib/types";

const amount = z.number().int().safe().min(-1e12).max(1e12);
const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const forecastSettingsSchema = z.object({
  accountKind: z.enum(["UNKNOWN", "BANK", "CARD", "OTHER"]), balanceMonth: monthSchema,
  openingBalance: amount.optional(), minimumBalance: amount.nonnegative(),
  incomePercent: z.number().int().min(-100).max(200), expensePercent: z.number().int().min(-100).max(200),
}).refine((value) => value.accountKind === "BANK" || value.openingBalance === undefined, "銀行口座以外の残高は予測できません");

export function forecastDefaults(account: BankAccount, month: string): BankForecastSettings {
  const saved = account.forecastSettings;
  return { accountKind: saved?.accountKind || "UNKNOWN", balanceMonth: month,
    openingBalance: saved?.balanceMonth === month && saved.accountKind === "BANK" ? saved.openingBalance : undefined,
    minimumBalance: saved?.minimumBalance ?? 0, incomePercent: saved?.incomePercent ?? 0, expensePercent: saved?.expensePercent ?? 0 };
}

export function saveBankForecastSettings(data: AppData, actor: Pick<User, "id" | "role">, company: CompanyScope, id: string, updatedAt: string, input: BankForecastSettings, today: string) {
  assertBankAccess(actor, company);
  const settings = forecastSettingsSchema.parse(input);
  if (!isBankDate(today) || settings.balanceMonth !== today.slice(0, 7)) throw new Error("月が変わりました。画面を更新して月初残高を確認してください");
  const account = data.bankAccounts.find((row) => row.id === id && row.company === company);
  if (!account || account.updatedAt !== updatedAt) throw new Error("口座情報が更新されています。画面を更新して再度保存してください");
  account.forecastSettings = settings;
  account.updatedAt = new Date(Math.max(Date.now(), Date.parse(account.updatedAt) + 1)).toISOString();
  return { settings, updatedAt: account.updatedAt };
}

export function shiftForecastMonth(month: string, offset: number) {
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + offset, 1)).toISOString().slice(0, 7);
}
const monthEnd = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const mean = (values: number[]) => Math.round(sum(values) / values.length);
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return Math.round((sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2); };
const normalized = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("ja");

export type ForecastMonth = { month: string; income: number; expense: number; count: number; coverage: "FETCHED" | "OBSERVED" | "UNKNOWN" };
export type BankForecastEvidence = {
  asOf: string; history: ForecastMonth[]; current: ForecastMonth;
  baseline: { income: number; expense: number } | null;
  sampleMonths: number; fetchedMonths: number; lastSyncAt?: string; stale: boolean;
  currentFetched: boolean; missingRows: number; futureRows: number; manualAccount: boolean;
  backtest: { count: number; meanAbsoluteError: number } | null;
  recurring: Array<{ key: string; content: string; side: "INCOME" | "EXPENSE"; amount: number; nextDate: string; observations: number }>;
};

export function recordBankCoverage(state: BankSyncState, start: string, end: string, accountIds: string[]) {
  if (!isBankDate(start) || !isBankDate(end) || start > end) throw new Error("取得範囲が不正です");
  const ids = [...new Set(accountIds)].sort();
  // Coalesce only ranges with the exact same account population.
  const key = JSON.stringify(ids);
  const others = (state.coverage || []).filter((range) => JSON.stringify([...range.accountIds].sort()) !== key);
  const same = [...(state.coverage || []).filter((range) => JSON.stringify([...range.accountIds].sort()) === key), { start, end, accountIds: ids }].sort((a, b) => a.start.localeCompare(b.start));
  const merged: NonNullable<BankSyncState["coverage"]> = [];
  for (const range of same) {
    const previous = merged.at(-1);
    if (previous && Date.parse(range.start) <= Date.parse(previous.end) + 86400000) previous.end = previous.end > range.end ? previous.end : range.end;
    else merged.push({ ...range, accountIds: [...ids] });
  }
  state.coverage = [...others, ...merged];
}

export function bankForecastEvidence(data: AppData, company: CompanyScope, accountId: string, today: string): BankForecastEvidence {
  if (!isBankDate(today)) throw new Error("基準日が不正です");
  const account = data.bankAccounts.find((row) => row.id === accountId && row.company === company);
  if (!account) throw new Error("口座が見つかりません");
  const month = today.slice(0, 7), firstMonth = shiftForecastMonth(month, -6);
  const state = data.bankSyncStates.find((row) => row.company === company && row.officeCode === account.officeCode);
  const covered = (start: string, end: string) => bankPeriodCovered(state, accountId, start, end);
  const all = data.bankTransactions.filter((row) => row.company === company && row.officeCode === account.officeCode && row.bankAccountId === accountId);
  // Cash movement includes transfers and non-journalized rows, not just expenses.
  const rows = all.filter((row) => !row.sourceMissing && row.transactionDate <= today && row.transactionDate >= `${firstMonth}-01`);
  const monthly = (key: string): ForecastMonth => {
    const items = rows.filter((row) => row.transactionDate.startsWith(key));
    return { month: key, income: sum(items.filter((row) => row.side === "INCOME").map((row) => row.amount)), expense: sum(items.filter((row) => row.side === "EXPENSE").map((row) => row.amount)), count: items.length,
      coverage: covered(`${key}-01`, key === month ? today : monthEnd(key)) ? "FETCHED" : items.length ? "OBSERVED" : "UNKNOWN" };
  };
  const history = Array.from({ length: 6 }, (_, index) => monthly(shiftForecastMonth(month, index - 6))), current = monthly(month);
  const samples = history.filter((row) => row.coverage !== "UNKNOWN");
  const ready = samples.length >= 3 && history.at(-1)!.coverage !== "UNKNOWN";
  const errors: number[] = [];
  for (let index = 3; index < history.length; index++) {
    const previous = history.slice(0, index).filter((row) => row.coverage !== "UNKNOWN"), actual = history[index];
    if (previous.length >= 3 && actual.coverage !== "UNKNOWN" && history[index - 1].coverage !== "UNKNOWN") errors.push(Math.abs(actual.income - actual.expense - (mean(previous.map((row) => row.income)) - mean(previous.map((row) => row.expense)))));
  }
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!normalized(row.content) || row.amount <= 0) continue;
    const key = JSON.stringify([row.side, normalized(row.content)]);
    const group = groups.get(key);
    if (group) group.push(row); else groups.set(key, [row]);
  }
  const recurring: BankForecastEvidence["recurring"] = [];
  for (const [key, group] of groups) {
    const recent = [-3, -2, -1].map((offset) => group.filter((row) => row.transactionDate.startsWith(shiftForecastMonth(month, offset))));
    if (recent.some((items) => items.length !== 1)) continue;
    const observations = recent.flat(), values = observations.map((row) => row.amount), expected = median(values);
    if (Math.max(...values) - Math.min(...values) > expected * 0.25) continue;
    const days = observations.map((row) => Number(row.transactionDate.slice(8))), atEnd = observations.every((row) => row.transactionDate === monthEnd(row.transactionDate.slice(0, 7)));
    const dateFor = (key: string) => `${key}-${String(atEnd ? Number(monthEnd(key).slice(8)) : Math.min(median(days), Number(monthEnd(key).slice(8)))).padStart(2, "0")}`;
    let nextDate = dateFor(month);
    if (nextDate <= today || group.some((row) => row.transactionDate.startsWith(month))) nextDate = dateFor(shiftForecastMonth(month, 1));
    recurring.push({ key, content: observations[2].content, side: observations[2].side, amount: expected, nextDate, observations: observations.length });
  }
  return { asOf: today, history, current, baseline: ready ? { income: mean(samples.map((row) => row.income)), expense: mean(samples.map((row) => row.expense)) } : null,
    sampleMonths: samples.length, fetchedMonths: history.filter((row) => row.coverage === "FETCHED").length,
    lastSyncAt: state?.lastSuccessAt, stale: !state?.lastSuccessAt || Date.parse(`${today}T23:59:59Z`) - Date.parse(state.lastSuccessAt) > 7 * 86400000,
    currentFetched: current.coverage === "FETCHED", missingRows: all.filter((row) => row.sourceMissing).length, futureRows: all.filter((row) => !row.sourceMissing && row.transactionDate > today).length,
    manualAccount: account.isManual, backtest: errors.length ? { count: errors.length, meanAbsoluteError: mean(errors) } : null,
    recurring: recurring.sort((a, b) => a.nextDate.localeCompare(b.nextDate) || b.amount - a.amount) };
}

export function projectBankForecast(evidence: BankForecastEvidence, input: BankForecastSettings, horizon: 3 | 6) {
  const settings = forecastSettingsSchema.parse(input);
  if (!evidence.baseline || ![3, 6].includes(horizon)) return [];
  const month = evidence.asOf.slice(0, 7);
  let balance = settings.accountKind === "BANK" && settings.balanceMonth === month ? settings.openingBalance : undefined;
  let cautiousBalance = balance;
  const income = Math.round(evidence.baseline.income * (1 + settings.incomePercent / 100));
  const expense = Math.round(evidence.baseline.expense * (1 + settings.expensePercent / 100));
  return Array.from({ length: horizon }, (_, index) => {
    const actualIncome = index === 0 ? evidence.current.income : 0, actualExpense = index === 0 ? evidence.current.expense : 0;
    const predictedIncome = Math.max(income - actualIncome, 0), predictedExpense = Math.max(expense - actualExpense, 0);
    const totalIncome = actualIncome + predictedIncome, totalExpense = actualExpense + predictedExpense;
    const cautiousIncome = Math.max(Math.round(income * 0.8), actualIncome), cautiousExpense = Math.max(Math.round(expense * 1.2), actualExpense);
    if (balance !== undefined) balance += totalIncome - totalExpense;
    if (cautiousBalance !== undefined) cautiousBalance += cautiousIncome - cautiousExpense;
    return { month: shiftForecastMonth(month, index), actualIncome, actualExpense, predictedIncome, predictedExpense, income: totalIncome, expense: totalExpense,
      net: totalIncome - totalExpense, cautiousNet: cautiousIncome - cautiousExpense, balance, cautiousBalance,
      belowMinimum: balance !== undefined && balance < settings.minimumBalance, cautiousBelowMinimum: cautiousBalance !== undefined && cautiousBalance < settings.minimumBalance };
  });
}
