import { bankAccountFilter } from "@/lib/bank-account-options";
import type { BankAccount, BankTransaction } from "@/lib/banking-types";
import type { AppData } from "@/lib/types";

type SettlementData = Pick<AppData, "bankAccounts" | "bankTransactions" | "bankReconciliations" | "bankTransfers">;
const normalize = (value: string) => value.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase("ja");

export const APLUS_SETTLEMENT_LABEL = "アプラスカード精算";
export const APLUS_SETTLEMENT_REASON = "口座振替 APアプラスは月次カード精算。カード利用分との経費二重計上を避けるため振替扱い（利用明細・請求期間は未照合）";
export const APLUS_SETTLEMENT_LINK_ISSUE = "アプラスのカード精算です。銀行口座間の資金移動や受領請求書の経費とは照合できません。カード利用明細・請求期間は未照合です";

// Local account evidence only; explicit account settings take precedence over names.
function settlementAccountKind(account: BankAccount) {
  if (account.overviewSettings) return account.overviewSettings.kind;
  const saved = account.forecastSettings?.accountKind;
  if (saved && saved !== "UNKNOWN") return saved;
  const name = normalize(`${account.serviceName} ${account.name}`);
  if (/カード|credit|card|upsider|アプラス|aplus|amex|アメックス/.test(name)) return "CARD";
  if (/銀行|信用金庫|信用組合|ゆうちょ|bank/.test(name)) return "BANK";
  return "UNKNOWN";
}

export function knownBankCardSettlement(data: Pick<AppData, "bankAccounts">, row: BankTransaction) {
  if (row.company !== "JAPAN" || row.side !== "EXPENSE" || !Number.isFinite(row.amount) || row.amount <= 0) return;
  const content = normalize(row.content);
  if (!content.startsWith("口座振替") || !/(?:^|[^a-z])ap[.・()-]*アプラス(?:$|[0-9()・.,:/-])/.test(content)) return;
  if (/返金|返還|返戻|取消|取り消|組戻|払戻|払い戻|手数料|refund|reversal/.test(content)) return;
  const account = data.bankAccounts.find((item) => item.id === row.bankAccountId && item.company === row.company && item.officeCode === row.officeCode);
  if (!account || settlementAccountKind(account) !== "BANK") return;
  return { provider: "アプラス" as const, reason: APLUS_SETTLEMENT_REASON };
}

export function hasConfirmedBankLink(data: Pick<AppData, "bankReconciliations" | "bankTransfers">, row: BankTransaction) {
  return data.bankReconciliations.some((link) => !link.deletedAt && link.transactionId === row.id)
    || (data.bankTransfers || []).some((link) => !link.deletedAt && (link.outgoingId === row.id || link.incomingId === row.id));
}

export function bankSettlementClassificationProtected(data: SettlementData, row: BankTransaction) {
  return row.reviewed || row.classificationSource === "MANUAL" || row.classificationSource === "RULE" || Boolean(row.ruleId) || hasConfirmedBankLink(data, row);
}

export function bankCardSettlementConflict(data: SettlementData, row: BankTransaction): string | undefined {
  if (!knownBankCardSettlement(data, row)) return;
  if (data.bankReconciliations.some((link) => !link.deletedAt && link.transactionId === row.id)) return "アプラスカード精算に請求書照合が残っています。既存の支払い・照合は変更せず、要確認です";
  if ((data.bankTransfers || []).some((link) => !link.deletedAt && (link.outgoingId === row.id || link.incomingId === row.id))) return "アプラスカード精算に銀行口座間の資金移動の照合が残っています。既存の照合は変更せず、要確認です";
  if (row.treatment !== "TRANSFER" && bankSettlementClassificationProtected(data, row)) return "アプラスカード精算と保存済みの手動・確認済み・ルール分類が競合しています。既存分類は変更せず、要確認です";
}

export type BankCardSettlementDetail = {
  provider: "アプラス";
  accounts: Array<{ id: string; name: string }>;
  conflict?: string;
};

export function bankCardSettlementDetail(data: SettlementData, row: BankTransaction): BankCardSettlementDetail | undefined {
  const settlement = knownBankCardSettlement(data, row);
  if (!settlement) return;
  const accounts = data.bankAccounts.filter((account) => account.company === row.company && account.officeCode === row.officeCode
    && settlementAccountKind(account) === "CARD" && /アプラス|aplus/.test(normalize(`${account.serviceName} ${account.name}`)));
  // Candidates identify accounts, not a matched bill, period, amount or purchase line.
  const candidates = bankAccountFilter(accounts, data.bankTransactions, row.company).options.map(({ id, name }) => ({ id, name }));
  return { provider: settlement.provider, accounts: candidates, conflict: bankCardSettlementConflict(data, row) };
}
