import { z } from "zod";
import { assertBankAccess, bankToday, isBankDate } from "@/lib/banking";
import { bankAccountFilter } from "@/lib/bank-account-options";
import type { BankTransaction, BankTransfer } from "@/lib/banking-types";
import type { AppData, User } from "@/lib/types";
import type { CompanyScope } from "@/lib/company";

const cents = (amount: number) => Math.round(amount * 100);
const stamp = (old: string) => new Date(Math.max(Date.now(), Date.parse(old) + 1)).toISOString();
const evidence = (row: BankTransaction) => JSON.stringify([row.company, row.officeCode, row.bankAccountId, row.sourceId, row.side, row.amount, row.transactionDate, row.content]);
const active = (data: AppData) => (data.bankTransfers || []).filter((link) => !link.deletedAt);
const linked = (data: AppData, id: string) => active(data).some((link) => link.outgoingId === id || link.incomingId === id);
const invoiced = (data: AppData, id: string) => data.bankReconciliations.some((link) => !link.deletedAt && link.transactionId === id);

function rowIssue(data: AppData, company: CompanyScope, row: BankTransaction, today: string) {
  const account = data.bankAccounts.find((item) => item.id === row.bankAccountId && item.company === company && item.officeCode === row.officeCode);
  if (!account || row.company !== company) return "同じ会社・事業者の口座を選択してください";
  const kind = account.overviewSettings?.kind || account.forecastSettings?.accountKind;
  if (kind === "CARD" || kind === "OTHER" || (!kind || kind === "UNKNOWN") && /カード|card|upsider/i.test(account.serviceName)) return "銀行口座間の資金移動のみ対象です。カード利用とは照合できません";
  if (row.sourceMissing || row.sourceStatus === "excluded" || row.treatment === "EXCLUDED") return "元明細なし・対象外の明細は選択できません";
  if (!isBankDate(row.transactionDate) || row.transactionDate > today || !Number.isFinite(row.amount) || row.amount <= 0 || row.amount > 1e12 || Math.abs(row.amount * 100 - cents(row.amount)) > 0.001) return "取引日・金額を確認してください";
  if (invoiced(data, row.id)) return "請求書と照合済みです。先に請求書照合を解除してください";
  return "";
}

function pairIssue(data: AppData, company: CompanyScope, from: BankTransaction, to: BankTransaction, today: string) {
  const issue = rowIssue(data, company, from, today) || rowIssue(data, company, to, today);
  if (issue) return issue;
  if (from.side === to.side || from.id === to.id) return "出金と入金を一つずつ選択してください";
  if (from.officeCode !== to.officeCode) return "異なる事業者の資金移動は照合できません";
  if (cents(from.amount) !== cents(to.amount)) return "金額が一致しません。手数料・為替差額を自動消込しません";
  const accountGroup = bankAccountFilter(data.bankAccounts, data.bankTransactions, company, from.bankAccountId);
  if (accountGroup.memberIds.has(to.bankAccountId)) return "同じ口座の明細とは照合できません";
  return "";
}

export function bankTransferIssue(data: AppData, link: BankTransfer, today = bankToday()) {
  const from = data.bankTransactions.find((row) => row.id === link.outgoingId), to = data.bankTransactions.find((row) => row.id === link.incomingId);
  if (!from || !to) return "資金移動の明細が見つかりません";
  const issue = pairIssue(data, link.company, from, to, today);
  if (issue) return issue;
  if (evidence(from) !== link.outgoingEvidence || evidence(to) !== link.incomingEvidence || from.treatment !== "TRANSFER" || to.treatment !== "TRANSFER") return "照合後に資金移動の明細が変更されました。解除して再確認してください";
  return "";
}

export const transferSchema = z.object({
  transactionId: z.string().min(1).max(1000), transactionUpdatedAt: z.string(),
  counterpartId: z.string().min(1).max(1000), counterpartUpdatedAt: z.string(),
  acknowledged: z.literal(true),
}).strict();
export type TransferInput = z.infer<typeof transferSchema>;

export function confirmBankTransfer(data: AppData, actor: Pick<User, "id" | "role">, company: CompanyScope, input: TransferInput, today = bankToday()) {
  assertBankAccess(actor, company);
  const value = transferSchema.parse(input);
  const first = data.bankTransactions.find((row) => row.id === value.transactionId), second = data.bankTransactions.find((row) => row.id === value.counterpartId);
  if (!first || !second || first.updatedAt !== value.transactionUpdatedAt || second.updatedAt !== value.counterpartUpdatedAt) throw new Error("明細が更新されています。画面を更新してください");
  if (linked(data, first.id) || linked(data, second.id)) throw new Error("この明細は資金移動と照合済みです");
  const issue = pairIssue(data, company, first, second, today);
  if (issue) throw new Error(issue);
  const from = first.side === "EXPENSE" ? first : second, to = first.side === "INCOME" ? first : second;
  const timestamp = new Date().toISOString();
  const link: BankTransfer = { id: crypto.randomUUID(), company, outgoingId: from.id, incomingId: to.id,
    outgoingEvidence: evidence(from), incomingEvidence: evidence(to), confirmedById: actor.id, createdAt: timestamp, updatedAt: timestamp,
    previous: [from, to].map((row) => ({ id: row.id, updatedAt: row.updatedAt, categoryId: row.categoryId, subCategoryId: row.subCategoryId, treatment: row.treatment, reviewed: row.reviewed, memo: row.memo, classificationSource: row.classificationSource, classificationReason: row.classificationReason, classificationConfidence: row.classificationConfidence, ruleId: row.ruleId })),
  };
  for (const row of [from, to]) Object.assign(row, { treatment: "TRANSFER", reviewed: true, classificationSource: "MANUAL", classificationConfidence: undefined, classificationReason: "自社口座間の資金移動を照合済み", ruleId: undefined, updatedAt: stamp(row.updatedAt) });
  (data.bankTransfers ||= []).unshift(link);
  return { id: link.id };
}

export function removeBankTransfer(data: AppData, actor: Pick<User, "id" | "role">, company: CompanyScope, id: string, updatedAt: string) {
  assertBankAccess(actor, company);
  const link = active(data).find((row) => row.id === id && row.company === company);
  if (!link || link.updatedAt !== updatedAt) throw new Error("照合記録が更新されています");
  const rows = [link.outgoingId, link.incomingId].map((id) => data.bankTransactions.find((row) => row.id === id));
  if (rows.some((row) => !row || row.company !== company)) throw new Error("資金移動の明細が見つかりません");
  for (const row of rows as BankTransaction[]) {
    const previous = link.previous.find((item) => item.id === row.id)!;
    const unchanged = evidence(row) === (row.id === link.outgoingId ? link.outgoingEvidence : link.incomingEvidence) && !row.sourceMissing && row.sourceStatus !== "excluded";
    // Keep synchronized source fields and any later memo/category edits intact.
    Object.assign(row, { treatment: row.sourceStatus === "excluded" ? "EXCLUDED" : previous.treatment, reviewed: unchanged && previous.reviewed,
      classificationSource: previous.classificationSource, classificationConfidence: previous.classificationConfidence,
      classificationReason: previous.classificationReason, ruleId: previous.ruleId, updatedAt: stamp(row.updatedAt) });
  }
  link.deletedAt = new Date().toISOString(); link.updatedAt = stamp(link.updatedAt);
  return { id };
}

export function bankTransferDetail(data: AppData, company: CompanyScope, id: string, today = bankToday()) {
  const row = data.bankTransactions.find((item) => item.id === id && item.company === company);
  if (!row) throw new Error("明細が見つかりません");
  const link = active(data).find((item) => item.company === company && [item.outgoingId, item.incomingId].includes(id));
  const display = (item: BankTransaction) => ({ id: item.id, updatedAt: item.updatedAt, date: item.transactionDate, amount: item.amount, side: item.side, content: item.content, account: data.bankAccounts.find((account) => account.id === item.bankAccountId)?.name || "口座不明" });
  const counterpart = link && data.bankTransactions.find((item) => item.id === (link.outgoingId === id ? link.incomingId : link.outgoingId));
  return { row: display(row), issue: link ? bankTransferIssue(data, link, today) : rowIssue(data, company, row, today),
    link: link ? { id: link.id, updatedAt: link.updatedAt, counterpart: counterpart ? display(counterpart) : undefined } : undefined,
    candidates: link ? [] : data.bankTransactions.filter((other) => other.company === company && other.officeCode === row.officeCode && other.side !== row.side && cents(other.amount) === cents(row.amount) && !linked(data, other.id) && !pairIssue(data, company, row, other, today))
      .sort((a, b) => Math.abs(Date.parse(a.transactionDate) - Date.parse(row.transactionDate)) - Math.abs(Date.parse(b.transactionDate) - Date.parse(row.transactionDate)) || b.transactionDate.localeCompare(a.transactionDate)).map(display),
  };
}
