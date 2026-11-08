import { z } from "zod";
import { assertBankAccess, bankToday, isBankDate } from "@/lib/banking";
import { knownBankCardSettlement } from "@/lib/bank-card-settlement";
import type { BankTransaction } from "@/lib/banking-types";
import type { CompanyScope } from "@/lib/company";
import { assertCan } from "@/lib/rbac";
import type { AppData, ExpenseClaim, User } from "@/lib/types";

// Settled claims are paid back in one transfer per person and payment date. That transfer is matched to one
// outgoing bank row; the bank row itself is left untouched so bookkeeping and sync keep working as before.
type Actor = Pick<User, "id" | "role">;
const cents = (value: number) => Math.round(value * 100);
const stamp = (previous?: string) => new Date(Math.max(Date.now(), previous ? Date.parse(previous) + 1 : 0)).toISOString();
const DAY = 86_400_000;
export const PAYOUT_WINDOW_DAYS = 31;

export const payoutEvidence = (row: BankTransaction) => JSON.stringify([row.officeCode, row.bankAccountId, row.sourceId, row.side, row.transactionDate, row.amount, row.content]);
const groupKey = (row: Pick<ExpenseClaim, "submittedById" | "paidAt">) => `${row.submittedById}|${row.paidAt}`;
const settled = (data: AppData, company: CompanyScope) => (data.expenseClaims || []).filter((row) => !row.deletedAt && row.company === company && row.status === "PAID" && row.paidAt);

export function expensePayoutTransactionIds(data: Pick<AppData, "expenseClaims">) {
  return new Set((data.expenseClaims || []).filter((row) => !row.deletedAt && row.status === "PAID" && row.payout).map((row) => row.payout!.transactionId));
}

export function payoutBankIssue(data: AppData, company: CompanyScope, row: BankTransaction, today = bankToday()) {
  const account = data.bankAccounts.find((item) => item.id === row.bankAccountId);
  if (!account || account.company !== company || row.company !== company || account.officeCode !== row.officeCode) return "口座が見つかりません";
  const kind = account.overviewSettings?.kind || account.forecastSettings?.accountKind;
  if (kind === "CARD" || kind === "OTHER" || (!kind || kind === "UNKNOWN") && /カード|card|upsider/i.test(`${account.serviceName} ${account.name}`)) return "カード利用・その他口座の明細とは照合できません";
  if (row.side !== "EXPENSE") return "出金の明細を選択してください";
  if (row.sourceMissing) return "元明細がなくなっています";
  if (row.sourceStatus === "excluded" || row.treatment !== "NORMAL") return "振替・対象外の明細です";
  if (!isBankDate(row.transactionDate) || row.transactionDate > today || !Number.isFinite(row.amount) || row.amount <= 0) return "取引日・金額を確認してください";
  if (knownBankCardSettlement(data, row)) return "カード精算の明細です";
  if (data.bankReconciliations.some((link) => !link.deletedAt && link.transactionId === row.id)) return "請求書と照合済みの明細です";
  if ((data.bankTransfers || []).some((link) => !link.deletedAt && [link.outgoingId, link.incomingId].includes(row.id))) return "口座間の資金移動と照合済みの明細です";
  return "";
}

export function expensePayoutIssue(data: AppData, claim: ExpenseClaim, today = bankToday()) {
  if (!claim.payout) return "";
  const row = data.bankTransactions.find((item) => item.id === claim.payout!.transactionId);
  if (!row) return "照合した口座明細が見つかりません。解除して照合し直してください";
  if (payoutEvidence(row) !== claim.payout.evidence) return "照合後に口座明細が変更されました。解除して照合し直してください";
  const issue = payoutBankIssue(data, claim.company, row, today);
  return issue ? `${issue}。解除して照合し直してください` : "";
}

function display(data: AppData, row: BankTransaction) {
  return { id: row.id, updatedAt: row.updatedAt, date: row.transactionDate, amount: row.amount, content: row.content, account: data.bankAccounts.find((item) => item.id === row.bankAccountId)?.name || "口座不明" };
}
export type PayoutBankRow = ReturnType<typeof display>;

function group(data: AppData, company: CompanyScope, claimId: string) {
  const claim = settled(data, company).find((row) => row.id === claimId);
  if (!claim) throw new Error("精算済みの申請が見つかりません");
  const claims = settled(data, company).filter((row) => groupKey(row) === groupKey(claim)).sort((a, b) => a.spentOn.localeCompare(b.spentOn) || a.id.localeCompare(b.id));
  return { claim, claims, total: claims.reduce((sum, row) => sum + cents(row.amount), 0) / 100 };
}

export function expensePayoutDetail(data: AppData, actor: Actor, company: CompanyScope, claimId: string, today = bankToday()) {
  assertCan(actor, "manage:expenses"); assertBankAccess(actor, company);
  const { claim, claims, total } = group(data, company, claimId);
  const linkedIds = [...new Set(claims.map((row) => row.payout?.transactionId).filter(Boolean))] as string[];
  const linkedRow = linkedIds.length === 1 ? data.bankTransactions.find((row) => row.id === linkedIds[0]) : undefined;
  const items = claims.map((row) => ({ id: row.id, updatedAt: row.updatedAt, spentOn: row.spentOn, payee: row.payee, amount: row.amount, linked: Boolean(row.payout) }));
  const name = data.users.find((row) => row.id === claim.submittedById)?.name || claim.submittedById;
  const base = { submitterName: name, paidAt: claim.paidAt!, total, items };
  if (linkedIds.length) {
    const partial = claims.some((row) => !row.payout) || linkedIds.length > 1;
    const issue = partial ? "同じ振込の一部だけが照合されています。解除して照合し直してください" : claims.map((row) => expensePayoutIssue(data, row, today)).find(Boolean) || "";
    return { ...base, linked: linkedRow ? display(data, linkedRow) : undefined, issue, candidates: [] as Array<PayoutBankRow & { days: number }> };
  }
  const taken = expensePayoutTransactionIds(data), paidAt = Date.parse(claim.paidAt!);
  const candidates = data.bankTransactions.filter((row) => row.company === company && row.side === "EXPENSE" && cents(row.amount) === cents(total) && !taken.has(row.id)
      && Math.abs(Date.parse(row.transactionDate) - paidAt) <= PAYOUT_WINDOW_DAYS * DAY && !payoutBankIssue(data, company, row, today))
    .map((row) => ({ ...display(data, row), days: Math.round((Date.parse(row.transactionDate) - paidAt) / DAY) }))
    .sort((a, b) => Math.abs(a.days) - Math.abs(b.days) || b.date.localeCompare(a.date)).slice(0, 20);
  return { ...base, linked: undefined, issue: "", candidates };
}
export type ExpensePayoutDetail = ReturnType<typeof expensePayoutDetail>;

const reference = z.string().min(1).max(1000), version = z.string().min(1).max(100);
const linkSchema = z.object({ claimId: reference, items: z.array(z.object({ id: reference, version }).strict()).min(1).max(500), transactionId: reference, transactionUpdatedAt: version }).strict();
const unlinkSchema = z.object({ claimId: reference, items: z.array(z.object({ id: reference, version }).strict()).min(1).max(500) }).strict();
export type ExpensePayoutLinkInput = z.input<typeof linkSchema>;
export type ExpensePayoutUnlinkInput = z.input<typeof unlinkSchema>;

function fresh(claims: ExpenseClaim[], items: Array<{ id: string; version: string }>) {
  if (items.length !== claims.length || new Set(items.map((row) => row.id)).size !== items.length) throw new Error("同じ振込の申請がすべて選ばれていません。再読込してください");
  for (const claim of claims) {
    const item = items.find((row) => row.id === claim.id);
    if (!item || item.version !== claim.updatedAt) throw new Error("経費の申請が更新されています。再読込してください");
  }
}

export function linkExpensePayout(data: AppData, actor: Actor, company: CompanyScope, input: ExpensePayoutLinkInput, today = bankToday()) {
  assertCan(actor, "manage:expenses"); assertBankAccess(actor, company);
  const value = linkSchema.parse(input);
  const { claims, total } = group(data, company, value.claimId);
  fresh(claims, value.items);
  if (claims.some((row) => row.payout)) throw new Error("この振込はすでに口座明細と照合済みです");
  const row = data.bankTransactions.find((item) => item.id === value.transactionId);
  if (!row || row.updatedAt !== value.transactionUpdatedAt) throw new Error("口座明細が更新されています。再読込してください");
  if (expensePayoutTransactionIds(data).has(row.id)) throw new Error("この口座明細は別の経費精算と照合済みです");
  const issue = payoutBankIssue(data, company, row, today);
  if (issue) throw new Error(issue);
  if (cents(row.amount) !== cents(total)) throw new Error("口座明細の金額が精算額の合計と一致しません");
  const at = stamp(claims.reduce((latest, item) => item.updatedAt > latest ? item.updatedAt : latest, ""));
  for (const claim of claims) {
    claim.payout = { transactionId: row.id, evidence: payoutEvidence(row), linkedAt: at, linkedById: actor.id };
    claim.updatedAt = at; claim.history.push({ action: "LINK_BANK", at, byId: actor.id, note: `${row.transactionDate} ${row.content}`.slice(0, 200) });
  }
  return { ids: claims.map((item) => item.id), updatedAt: at };
}

export function unlinkExpensePayout(data: AppData, actor: Actor, company: CompanyScope, input: ExpensePayoutUnlinkInput) {
  assertCan(actor, "manage:expenses"); assertBankAccess(actor, company);
  const value = unlinkSchema.parse(input);
  const { claims } = group(data, company, value.claimId);
  fresh(claims, value.items);
  const linked = claims.filter((row) => row.payout);
  if (!linked.length) throw new Error("口座明細と照合されていません");
  const at = stamp(claims.reduce((latest, item) => item.updatedAt > latest ? item.updatedAt : latest, ""));
  for (const claim of linked) {
    delete claim.payout;
    claim.updatedAt = at; claim.history.push({ action: "UNLINK_BANK", at, byId: actor.id });
  }
  return { ids: linked.map((item) => item.id), updatedAt: at };
}

// For the bank side: which outgoing rows repay staff, and whose claims they cover.
export function expensePayoutsByTransaction(data: AppData, company: CompanyScope, today = bankToday()) {
  const result = new Map<string, { submitterName: string; claimIds: string[]; total: number; issue: string }>();
  for (const claim of settled(data, company)) {
    if (!claim.payout) continue;
    const entry = result.get(claim.payout.transactionId) || { submitterName: data.users.find((row) => row.id === claim.submittedById)?.name || claim.submittedById, claimIds: [], total: 0, issue: "" };
    entry.claimIds.push(claim.id); entry.total = (cents(entry.total) + cents(claim.amount)) / 100;
    entry.issue ||= expensePayoutIssue(data, claim, today);
    result.set(claim.payout.transactionId, entry);
  }
  return result;
}
