import { z } from "zod";
import { bankAccountFilter } from "@/lib/bank-account-options";
import { bankPeriodCovered } from "@/lib/bank-analysis";
import { assertBankAccess, isBankDate } from "@/lib/banking";
import { shiftForecastMonth } from "@/lib/bank-forecast";
import type { BankAccount, BankOverviewSettings, BankTransaction } from "@/lib/banking-types";
import type { CompanyScope } from "@/lib/company";
import type { AppData, User } from "@/lib/types";

export type BankOverviewInput = Omit<BankOverviewSettings, "recordedAt">;
const settingsSchema = z.object({
  kind: z.enum(["UNKNOWN", "BANK", "CARD", "OTHER"]),
  balance: z.object({ amount: z.number().int().safe().min(-1e12).max(1e12), asOf: z.string().refine(isBankDate), currency: z.literal("JPY") }).optional(),
}).refine((value) => !value.balance || value.kind === "BANK", "銀行口座だけに預金残高を登録できます");

export function accountKind(account: BankAccount): BankOverviewSettings["kind"] {
  if (account.overviewSettings) return account.overviewSettings.kind;
  const saved = account.forecastSettings?.accountKind;
  if (saved && saved !== "UNKNOWN") return saved;
  const name = `${account.serviceName} ${account.name}`.normalize("NFKC");
  if (/カード|credit|card|UPSIDER|アプラス|AMEX|アメックス/i.test(name)) return "CARD";
  if (/銀行|信用金庫|信用組合|ゆうちょ|bank/i.test(name)) return "BANK";
  return saved || "UNKNOWN";
}

export function saveBankOverview(data: AppData, actor: Pick<User, "id" | "role">, company: CompanyScope, id: string, updatedAt: string, input: BankOverviewInput, today: string) {
  assertBankAccess(actor, company);
  const settings = settingsSchema.parse(input);
  if (!isBankDate(today) || settings.balance && settings.balance.asOf > today) throw new Error("残高確認日に未来の日付は指定できません");
  const account = data.bankAccounts.find((row) => row.company === company && row.id === id);
  if (!account || account.updatedAt !== updatedAt) throw new Error("口座情報が更新されています。画面を更新して再度保存してください");
  if (settings.balance && !account.sourceSubId && data.bankAccounts.some((row) => row.company === company && row.officeCode === account.officeCode && row.sourceId === account.sourceId && row.sourceSubId)) throw new Error("連携元ではなく実際の銀行口座に残高を登録してください");
  const timestamp = new Date(Math.max(Date.now(), Date.parse(account.updatedAt) + 1)).toISOString();
  account.overviewSettings = { ...settings, recordedAt: timestamp };
  account.updatedAt = timestamp;
  return account.overviewSettings;
}

type Movement = { month: string; income: number; expense: number; count: number; covered: boolean };
export type AccountOverviewRow = {
  id: string; name: string; serviceName: string; updatedAt: string; kind: BankOverviewSettings["kind"];
  available: boolean; unspecified: boolean; memberCount: number;
  balance?: BankOverviewSettings["balance"]; estimatedBalance?: number; balanceThrough: string;
  income: number; expense: number; net: number; count: number; unreviewed: number; missing: number; covered: boolean;
  latestDate?: string; lastSyncAt?: string; history: Movement[];
  recent: Array<Pick<BankTransaction, "id" | "transactionDate" | "amount" | "side" | "content" | "reviewed">>;
};

const endOfMonth = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
const nextDate = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
export function bankAccountOverview(data: AppData, company: CompanyScope, requestedMonth: string | undefined, today: string) {
  if (!isBankDate(today)) throw new Error("基準日が不正です");
  const month = requestedMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth) && requestedMonth <= today.slice(0, 7) ? requestedMonth : today.slice(0, 7);
  const through = endOfMonth(month) < today ? endOfMonth(month) : today;
  const accounts = data.bankAccounts.filter((account) => account.company === company);
  const byId = new Map(accounts.map((row) => [row.id, row]));
  const options = bankAccountFilter(accounts, data.bankTransactions, company).options;
  const leafIds = new Set(options.filter((option) => byId.get(option.id)?.sourceSubId).flatMap((option) => option.memberIds));
  const byAccount = new Map<string, BankTransaction[]>();
  for (const row of data.bankTransactions) {
    if (row.company !== company || row.officeCode !== byId.get(row.bankAccountId)?.officeCode) continue;
    const group = byAccount.get(row.bankAccountId);
    if (group) group.push(row); else byAccount.set(row.bankAccountId, [row]);
  }
  const rows: AccountOverviewRow[] = options.map((option) => {
    const account = byId.get(option.id)!;
    // Parent-owned transactions remain visible, but children must never be counted twice.
    const unspecified = !account.sourceSubId && option.memberIds.some((id) => leafIds.has(id));
    const ids = option.memberIds.filter((id) => !unspecified || !leafIds.has(id));
    const members = ids.map((id) => byId.get(id)!);
    const settings = members.filter((row) => row.overviewSettings).sort((a, b) => b.overviewSettings!.recordedAt.localeCompare(a.overviewSettings!.recordedAt))[0]?.overviewSettings;
    const kind = unspecified ? "UNKNOWN" : settings?.kind ?? accountKind(account);
    const balance = !unspecified && kind === "BANK" ? settings?.balance : undefined;
    const all = ids.flatMap((id) => byAccount.get(id) || []);
    const valid = all.filter((row) => !row.sourceMissing && row.transactionDate <= today);
    const state = data.bankSyncStates.find((row) => row.company === company && row.officeCode === account.officeCode);
    const covered = (start: string, end: string) => ids.every((id) => bankPeriodCovered(state, id, start, end));
    const history: Movement[] = Array.from({ length: 6 }, (_, i) => {
      const key = shiftForecastMonth(month, i - 5), items = valid.filter((row) => row.transactionDate.startsWith(key));
      return { month: key, income: items.filter((row) => row.side === "INCOME").reduce((sum, row) => sum + row.amount, 0),
        expense: items.filter((row) => row.side === "EXPENSE").reduce((sum, row) => sum + row.amount, 0), count: items.length,
        covered: covered(`${key}-01`, key === month ? through : endOfMonth(key)) };
    });
    const current = history.at(-1)!;
    const selected = valid.filter((row) => row.transactionDate.startsWith(month)).sort((a, b) => b.transactionDate.localeCompare(a.transactionDate) || a.id.localeCompare(b.id));
    let estimatedBalance: number | undefined;
    if (balance && balance.asOf < through && covered(nextDate(balance.asOf), through) && !all.some((row) => row.sourceMissing && row.transactionDate > balance.asOf && row.transactionDate <= through)) {
      estimatedBalance = balance.amount + valid.filter((row) => row.transactionDate > balance.asOf && row.transactionDate <= through).reduce((sum, row) => sum + (row.side === "INCOME" ? row.amount : -row.amount), 0);
    }
    return { id: account.id, name: unspecified ? `${account.serviceName} / 口座未特定` : account.name, serviceName: account.serviceName, updatedAt: account.updatedAt,
      kind, available: option.available, unspecified, memberCount: ids.length, balance, estimatedBalance, balanceThrough: through,
      income: current.income, expense: current.expense, net: current.income - current.expense, count: current.count, covered: current.covered,
      unreviewed: selected.filter((row) => !row.reviewed).length, missing: all.filter((row) => row.sourceMissing && row.transactionDate.startsWith(month)).length,
      latestDate: selected[0]?.transactionDate, lastSyncAt: state?.lastSuccessAt, history,
      recent: selected.slice(0, 5).map(({ id, transactionDate, amount, side, content, reviewed }) => ({ id, transactionDate, amount, side, content, reviewed })) };
  });
  return { month, through, rows };
}
