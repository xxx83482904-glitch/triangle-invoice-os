import { bankPeriodCovered } from "@/lib/bank-analysis";
import { shiftForecastMonth } from "@/lib/bank-forecast";
import { isBankDate } from "@/lib/banking";
import type { BankTransaction } from "@/lib/banking-types";
import type { CompanyScope } from "@/lib/company";
import type { AppData } from "@/lib/types";

const normalize = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("ja");
const sum = (rows: BankTransaction[]) => rows.reduce((total, row) => total + row.amount, 0);
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2; };
const endOfMonth = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
const sample = (row: BankTransaction) => ({ id: row.id, date: row.transactionDate, content: row.content, amount: row.amount });
export type SpendingSample = ReturnType<typeof sample>;
export type SpendingAlert = {
  id: string; kind: "DUPLICATE" | "LARGE" | "RECURRING_INCREASE";
  content: string; amount: number; baseline?: number; observations: number;
  rows: SpendingSample[]; previous: SpendingSample[];
};
export type SpendingPeriod = { month: string; start: string; end: string; amount: number; count: number; known: boolean; covered: boolean };
export type BankSpendingInsights = ReturnType<typeof bankSpendingInsights>;

export function spendingMonth(requested: string | undefined, today: string) {
  return requested && /^\d{4}-(0[1-9]|1[0-2])$/.test(requested) && requested >= "1900-01" && isBankDate(`${requested}-01`) && requested <= today.slice(0, 7) ? requested : today.slice(0, 7);
}

export function bankSpendingInsights(data: AppData, company: CompanyScope, accountId: string, month: string, today: string) {
  if (!isBankDate(today) || spendingMonth(month, today) !== month) throw new Error("集計月が不正です");
  const account = data.bankAccounts.find((row) => row.company === company && row.id === accountId);
  if (!account) throw new Error("口座が見つかりません");
  const state = data.bankSyncStates.find((row) => row.company === company && row.officeCode === account.officeCode);
  const partial = month === today.slice(0, 7) && today !== endOfMonth(month);
  const periodEnd = (key: string) => partial ? `${key}-${String(Math.min(Number(today.slice(8)), Number(endOfMonth(key).slice(8)))).padStart(2, "0")}` : endOfMonth(key);
  const start = `${month}-01`, end = periodEnd(month), first = `${shiftForecastMonth(month, -6)}-01`;
  const scoped = data.bankTransactions.filter((row) => row.company === company && row.officeCode === account.officeCode && row.bankAccountId === accountId && row.transactionDate >= first && row.transactionDate <= end);
  const valid = scoped.filter((row) => !row.sourceMissing && row.side === "EXPENSE" && row.amount > 0);
  const normal = valid.filter((row) => row.treatment === "NORMAL");
  const selected = normal.filter((row) => row.transactionDate >= start);
  const history = normal.filter((row) => row.transactionDate < start);
  const periodRows = (key: string) => normal.filter((row) => row.transactionDate >= `${key}-01` && row.transactionDate <= periodEnd(key));
  const periods: SpendingPeriod[] = Array.from({ length: 7 }, (_, i) => shiftForecastMonth(month, i - 6)).map((key) => {
    const rows = periodRows(key), covered = bankPeriodCovered(state, accountId, `${key}-01`, periodEnd(key));
    return { month: key, start: `${key}-01`, end: periodEnd(key), amount: sum(rows), count: rows.length, known: covered || rows.length > 0, covered };
  });
  const current = periods.at(-1)!, previous = periods.at(-2)!;
  const comparable = current.known && previous.known;
  const delta = comparable ? current.amount - previous.amount : null;
  const percent = delta !== null && previous.amount > 0 ? delta / previous.amount * 100 : null;
  const categories = new Map<string, { id: string; name: string; amount: number; previous: number; count: number; unreviewed: number }>();
  const categoryNames = new Map(data.accountingCategories.filter((row) => row.company === company).map((row) => [row.id, row.name]));
  for (const [rows, prior] of [[selected, false], [periodRows(previous.month), true]] as const) for (const row of rows) {
    const key = row.categoryId || "", value = categories.get(key) || { id: key, name: key ? categoryNames.get(key) || "削除済み科目" : "未分類", amount: 0, previous: 0, count: 0, unreviewed: 0 };
    if (prior) value.previous += row.amount;
    else { value.amount += row.amount; value.count++; if (!row.reviewed) value.unreviewed++; }
    categories.set(key, value);
  }
  const groups = new Map<string, BankTransaction[]>();
  for (const row of normal) {
    const key = normalize(row.content);
    // Generic bank labels cannot identify a payee reliably.
    if (key.length < 3 || /^(振込|振替|出金|支払[い]?|利用|口座振替|カード利用|atm|payment|withdrawal|transfer)$/.test(key)) continue;
    const group = groups.get(key); if (group) group.push(row); else groups.set(key, [row]);
  }
  const alerts: SpendingAlert[] = [];
  for (const [key, rows] of groups) {
    const present = rows.filter((row) => row.transactionDate >= start);
    if (!present.length) continue;
    const past = rows.filter((row) => row.transactionDate < start);
    const duplicates = new Map<string, BankTransaction[]>();
    const duplicateIds = new Set<string>();
    for (const row of present) {
      const signature = JSON.stringify([row.transactionDate, row.amount]);
      const group = duplicates.get(signature); if (group) group.push(row); else duplicates.set(signature, [row]);
    }
    for (const [signature, items] of duplicates) {
      const unique = [...new Map(items.map((row) => [row.sourceId, row])).values()];
      if (unique.length < 2) continue;
      unique.forEach((row) => duplicateIds.add(row.id));
      alerts.push({ id: `duplicate:${key}:${signature}`, kind: "DUPLICATE", content: unique[0].content, amount: sum(unique), observations: unique.length, rows: unique.slice(0, 8).map(sample), previous: [] });
    }
    const recent = [-3, -2, -1].map((offset) => past.filter((row) => row.transactionDate.startsWith(shiftForecastMonth(month, offset))));
    let recurringId: string | undefined;
    if (present.length === 1 && recent.every((items) => items.length === 1)) {
      const observations = recent.flat(), baseline = median(observations.map((row) => row.amount));
      const stable = observations.every((row) => Math.abs(row.amount - baseline) <= baseline * 0.1);
      if (stable && present[0].amount >= baseline * 1.2) {
        recurringId = present[0].id;
        alerts.push({ id: `recurring:${key}`, kind: "RECURRING_INCREASE", content: present[0].content, amount: present[0].amount, baseline, observations: 3, rows: present.map(sample), previous: observations.map(sample) });
      }
    }
    if (past.length < 5 || new Set(past.map((row) => row.transactionDate.slice(0, 7))).size < 3) continue;
    const baseline = median(past.map((row) => row.amount)), mad = median(past.map((row) => Math.abs(row.amount - baseline)));
    const previousSamples = [...past].sort((a, b) => b.transactionDate.localeCompare(a.transactionDate)).slice(0, 5).map(sample);
    for (const row of present) if (!duplicateIds.has(row.id) && row.id !== recurringId && row.amount >= baseline * 2 && row.amount > baseline + mad * 3) {
      alerts.push({ id: `large:${row.id}`, kind: "LARGE", content: row.content, amount: row.amount, baseline, observations: past.length, rows: [sample(row)], previous: previousSamples });
    }
  }
  alerts.sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id));
  const selectedOther = valid.filter((row) => row.transactionDate >= start && row.treatment !== "NORMAL");
  return {
    month, asOf: today, partial, current, previous, periods, delta, percent,
    comparisonConfirmed: current.covered && previous.covered,
    categories: [...categories.values()].map((row) => ({ ...row, delta: comparable ? row.amount - row.previous : null, share: current.amount ? row.amount / current.amount * 100 : 0 })).sort((a, b) => (b.delta ?? b.amount) - (a.delta ?? a.amount) || b.amount - a.amount || a.name.localeCompare(b.name)),
    alerts: alerts.slice(0, 50), alertCount: alerts.length,
    unclassified: { count: selected.filter((row) => !row.categoryId).length, amount: sum(selected.filter((row) => !row.categoryId)) },
    unreviewed: selected.filter((row) => !row.reviewed).length,
    excluded: { transfer: sum(selectedOther.filter((row) => row.treatment === "TRANSFER")), excluded: sum(selectedOther.filter((row) => row.treatment === "EXCLUDED")), missing: scoped.filter((row) => row.sourceMissing && row.transactionDate >= start && row.side === "EXPENSE").length },
    lastSyncAt: state?.lastSuccessAt,
    stale: !state?.lastSuccessAt || Date.parse(`${today}T23:59:59Z`) - Date.parse(state.lastSuccessAt) > 7 * 86400000,
    historyCount: history.length,
    historyFetchedMonths: Array.from({ length: 6 }, (_, i) => shiftForecastMonth(month, i - 6)).filter((key) => bankPeriodCovered(state, accountId, `${key}-01`, endOfMonth(key))).length,
  };
}
