import { z } from "zod";
import { accountKind } from "@/lib/bank-account-overview";
import { knownBankCardSettlement } from "@/lib/bank-card-settlement";
import { BANK_RECEIPT_TYPE, type BankTransaction } from "@/lib/banking-types";
import { bankToday, isBankDate } from "@/lib/banking";
import { matchesCompany, type CompanyScope } from "@/lib/company";
import { expenseCategoryOptions } from "@/lib/expense-claim-edits";
import { uploadedFileNameFromUrl } from "@/lib/files";
import { assertCan, assertCompanyAccess, can } from "@/lib/rbac";
import type { AppData, Attachment, CardReceipt, User } from "@/lib/types";
import { isActiveUser } from "@/lib/user-access";

// Company card receipts: each person has their own card account. A receipt is attached to a use on that card,
// automatically when exactly one use has the same amount within a week of the receipt date. Nothing is reimbursed.
type Actor = Pick<User, "id" | "role">;
const DAY = 86_400_000;
export const CARD_MATCH_DAYS = 7;
export const CARD_USE_LOOKBACK_DAYS = 120;
export const CARD_RECEIPT_SOURCE = "CardReceipt" as const;
const cents = (value: number) => Math.round(value * 100);
const days = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / DAY);
const stamp = (previous?: string) => new Date(Math.max(Date.now(), previous ? Date.parse(previous) + 1 : 0)).toISOString();

export function companyCardAccounts(data: AppData, company: CompanyScope) {
  return data.bankAccounts.filter((row) => row.company === company && accountKind(row) === "CARD")
    .sort((a, b) => `${a.serviceName} ${a.name}`.localeCompare(`${b.serviceName} ${b.name}`, "ja"));
}

export function cardAccountLabel(account: { serviceName: string; name: string }) {
  return account.name.includes(account.serviceName) || !account.serviceName ? account.name : `${account.serviceName} ${account.name}`;
}

export function userCardAccount(data: AppData, user: Pick<User, "id">, company: CompanyScope) {
  const id = data.users.find((row) => row.id === user.id)?.companyCardAccountId;
  return id ? companyCardAccounts(data, company).find((row) => row.id === id) : undefined;
}

// Administrators give each person one card; a card belongs to one person.
export function assignCompanyCard(data: AppData, actor: Actor, company: CompanyScope, input: { userId: string; accountId: string }) {
  assertCan(actor, "manage:users"); assertCompanyAccess(actor, company);
  const user = data.users.find((row) => row.id === input.userId && isActiveUser(row));
  if (!user) throw new Error("利用者が見つかりません");
  if (input.accountId) {
    if (!companyCardAccounts(data, company).some((row) => row.id === input.accountId)) throw new Error("カードの口座を選んでください");
    const holder = data.users.find((row) => row.id !== user.id && !row.deletedAt && row.companyCardAccountId === input.accountId);
    if (holder) throw new Error(`このカードは${holder.name}さんに登録されています。先にそちらを外してください`);
    user.companyCardAccountId = input.accountId;
  } else delete user.companyCardAccountId;
  user.updatedAt = stamp(user.updatedAt);
  return { userId: user.id, accountId: user.companyCardAccountId || "" };
}

const live = (data: AppData) => (data.cardReceipts || []).filter((row) => !row.deletedAt);
const receiptAttachment = (data: AppData, receipt: CardReceipt) =>
  receipt.attachmentId ? data.attachments.find((row) => row.id === receipt.attachmentId && !row.deletedAt && row.relatedType === BANK_RECEIPT_TYPE) : undefined;
export const isLinked = (data: AppData, receipt: CardReceipt) => Boolean(receipt.transactionId && receiptAttachment(data, receipt));

// A use already has its evidence when any receipt is attached or it is matched to an invoice.
function documented(data: AppData, transactionId: string) {
  return data.attachments.some((row) => !row.deletedAt && row.relatedType === BANK_RECEIPT_TYPE && row.relatedId === transactionId)
    || data.bankReconciliations.some((row) => !row.deletedAt && row.transactionId === transactionId);
}

export function isCardUse(data: AppData, accountId: string, row: BankTransaction) {
  return row.bankAccountId === accountId && row.side === "EXPENSE" && !row.sourceMissing && row.sourceStatus !== "excluded" && row.treatment === "NORMAL"
    && Number.isFinite(row.amount) && row.amount > 0 && !knownBankCardSettlement(data, row);
}

export function cardCandidates(data: AppData, receipt: Pick<CardReceipt, "accountId" | "amount" | "spentOn"> & { excludedTransactionIds?: string[] }) {
  return data.bankTransactions.filter((row) => isCardUse(data, receipt.accountId, row) && cents(row.amount) === cents(receipt.amount)
      && Math.abs(days(row.transactionDate, receipt.spentOn)) <= CARD_MATCH_DAYS && !documented(data, row.id) && !receipt.excludedTransactionIds?.includes(row.id))
    .sort((a, b) => Math.abs(days(a.transactionDate, receipt.spentOn)) - Math.abs(days(b.transactionDate, receipt.spentOn)) || a.id.localeCompare(b.id));
}

function link(data: AppData, receipt: CardReceipt, row: BankTransaction, by: "AUTO" | "SELF", now: string) {
  const attachment: Attachment = { id: `card-receipt-${receipt.id}-${Date.parse(now)}`, relatedType: BANK_RECEIPT_TYPE, relatedId: row.id, fileUrl: receipt.fileUrl,
    fileName: `${receipt.payee}（${receipt.purpose}）`.slice(0, 200), mimeType: receipt.mimeType, uploadedById: receipt.submittedById, createdAt: now,
    sourceType: CARD_RECEIPT_SOURCE, sourceId: receipt.id };
  data.attachments.unshift(attachment);
  Object.assign(receipt, { transactionId: row.id, attachmentId: attachment.id, linkedAt: now, linkedBy: by, updatedAt: now });
}

const toUseView = (row: BankTransaction) => ({ id: row.id, date: row.transactionDate, content: row.content, amount: row.amount });
export type CardUseView = ReturnType<typeof toUseView>;
export type CardReceiptView = {
  id: string; updatedAt: string; createdAt: string; spentOn: string; amount: number; payee: string; purpose: string; projectName: string; fileUrl: string; mimeType: string;
  status: "LINKED" | "CHOOSE" | "WAITING"; linkedBy?: "AUTO" | "SELF"; use?: CardUseView; candidates: CardUseView[];
};

const required = (label: string, max: number) => z.string().trim().min(1, `${label}を入力してください`).max(max, `${label}は${max}文字以内にしてください`);
const reference = required("対象", 1000), version = required("更新情報", 20000);
const submitSchema = z.object({
  spentOn: z.string().refine((value) => isBankDate(value) && value <= bankToday(), "支払日は今日以前の実在する日付にしてください"),
  amount: z.number().finite().int("金額は整数円で入力してください").positive("金額は1円以上にしてください"),
  payee: required("お店", 100), purpose: required("用途", 200), categoryId: reference.optional(), projectId: reference.optional(),
  memo: z.string().trim().max(1000, "メモは1000文字以内にしてください").optional(),
  registrationNumber: z.string().trim().regex(/^T\d{13}$/, "登録番号はTと13桁の数字で入力してください").optional(),
  taxBreakdown: z.object({ rate10: z.number().int().nonnegative().optional(), rate8: z.number().int().nonnegative().optional() }).strict().optional(),
  file: z.object({ fileUrl: required("領収書", 2000), originalFileName: required("ファイル名", 1000), mimeType: z.enum(["application/pdf", "image/jpeg", "image/png"]), ocrText: z.string().max(4000).optional() }).strict(),
  transactionId: reference.optional(),
}).strict();
export type CardReceiptSubmit = z.input<typeof submitSchema>;

function ownAccount(data: AppData, actor: Actor, company: CompanyScope) {
  assertCompanyAccess(actor, company); assertCan(actor, "submit:expenses");
  const account = userCardAccount(data, actor, company);
  if (!account) throw new Error("会社カードが登録されていません。管理者に登録を依頼してください");
  return account;
}

// A use the person picked themselves: any unreceipted use on their own card, whatever the amount.
function ownUse(data: AppData, accountId: string, transactionId: string, receipt?: CardReceipt) {
  const row = data.bankTransactions.find((item) => item.id === transactionId);
  if (!row || !isCardUse(data, accountId, row)) throw new Error("あなたのカードの利用が見つかりません。画面を更新してください");
  if (documented(data, row.id) || receipt?.excludedTransactionIds?.includes(row.id)) throw new Error("この利用にはすでに領収書が付いています");
  return row;
}

export function submitCardReceipt(data: AppData, actor: Actor, company: CompanyScope, input: CardReceiptSubmit, id: string, now = new Date().toISOString()) {
  const account = ownAccount(data, actor, company), value = submitSchema.parse(input);
  if (value.projectId && !data.projects.some((row) => row.id === value.projectId && !row.deletedAt && matchesCompany(row, company))) throw new Error("この会社の案件を選択してください");
  if (value.categoryId && !expenseCategoryOptions(data, company).some((row) => row.value === value.categoryId)) throw new Error("利用できる経費の勘定科目を選択してください");
  const tax = value.taxBreakdown && Object.fromEntries(Object.entries(value.taxBreakdown).filter(([, amount]) => amount)) as NonNullable<typeof value.taxBreakdown>;
  if (tax && (tax.rate10 || 0) + (tax.rate8 || 0) >= value.amount) throw new Error("消費税額は金額より小さくしてください");
  const picked = value.transactionId ? ownUse(data, account.id, value.transactionId) : undefined;
  const receipt: CardReceipt = { id, company, submittedById: actor.id, accountId: account.id, spentOn: value.spentOn, amount: value.amount, payee: value.payee, purpose: value.purpose,
    projectId: value.projectId, categoryId: value.categoryId, memo: value.memo || undefined, registrationNumber: value.registrationNumber,
    taxBreakdown: tax && Object.keys(tax).length ? tax : undefined, ...value.file, createdAt: now, updatedAt: now };
  data.cardReceipts ??= [];
  data.cardReceipts.unshift(receipt);
  let candidates: BankTransaction[] = [];
  if (picked) link(data, receipt, picked, "SELF", now);
  else {
    candidates = cardCandidates(data, receipt);
    if (candidates.length === 1) { link(data, receipt, candidates[0], "AUTO", now); candidates = []; }
  }
  const use = receipt.transactionId ? data.bankTransactions.find((row) => row.id === receipt.transactionId) : undefined;
  return { id, updatedAt: receipt.updatedAt, status: (use ? "LINKED" : candidates.length > 1 ? "CHOOSE" : "WAITING") as CardReceiptView["status"],
    use: use ? toUseView(use) : undefined, candidates: candidates.map(toUseView) };
}

const pickSchema = z.object({ id: reference, version, transactionId: reference }).strict();
const removeSchema = z.object({ id: reference, version }).strict();

function ownReceipt(data: AppData, actor: Actor, company: CompanyScope, id: string, version: string) {
  const receipt = live(data).find((row) => row.id === id && row.company === company && row.submittedById === actor.id);
  if (!receipt) throw new Error("会社カードの領収書が見つかりません");
  if (receipt.updatedAt !== version) throw new Error("会社カードの領収書が更新されています。画面を更新してください");
  return receipt;
}

export function pickCardUse(data: AppData, actor: Actor, company: CompanyScope, input: z.input<typeof pickSchema>, now = new Date().toISOString()) {
  ownAccount(data, actor, company);
  const value = pickSchema.parse(input), receipt = ownReceipt(data, actor, company, value.id, value.version);
  if (isLinked(data, receipt)) throw new Error("この領収書はすでにカードの利用に付いています");
  link(data, receipt, ownUse(data, receipt.accountId, value.transactionId, receipt), "SELF", stamp(receipt.updatedAt) > now ? stamp(receipt.updatedAt) : now);
  return { id: receipt.id, updatedAt: receipt.updatedAt };
}

export function removeCardReceipt(data: AppData, actor: Actor, company: CompanyScope, input: z.input<typeof removeSchema>) {
  assertCompanyAccess(actor, company); assertCan(actor, "submit:expenses");
  const value = removeSchema.parse(input), receipt = ownReceipt(data, actor, company, value.id, value.version), at = stamp(receipt.updatedAt);
  const attachment = receiptAttachment(data, receipt);
  if (attachment) attachment.deletedAt = at;
  receipt.deletedAt = at; receipt.updatedAt = at;
  return { id: receipt.id };
}

// Accounting detached a card receipt from a bank row: remember it so automatic matching never puts it back.
export function detachCardReceipt(data: AppData, attachment: Attachment, at: string) {
  if (attachment.sourceType !== CARD_RECEIPT_SOURCE || !attachment.sourceId) return;
  const receipt = live(data).find((row) => row.id === attachment.sourceId);
  if (!receipt || receipt.attachmentId !== attachment.id) return;
  receipt.excludedTransactionIds = [...new Set([...(receipt.excludedTransactionIds || []), attachment.relatedId])];
  delete receipt.transactionId; delete receipt.attachmentId; delete receipt.linkedAt; delete receipt.linkedBy;
  receipt.updatedAt = stamp(receipt.updatedAt > at ? receipt.updatedAt : at);
}

// Runs after card statements sync: receipts photographed before the use reached the statement find it now.
export function autoLinkCardReceipts(data: AppData, company: CompanyScope, now = new Date().toISOString()) {
  let linked = 0;
  for (const receipt of live(data).filter((row) => row.company === company && !isLinked(data, row)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const holder = data.users.find((row) => row.id === receipt.submittedById && !row.deletedAt);
    if (!holder || holder.companyCardAccountId !== receipt.accountId) continue;
    const candidates = cardCandidates(data, receipt);
    if (candidates.length !== 1) continue;
    link(data, receipt, candidates[0], "AUTO", stamp(receipt.updatedAt) > now ? stamp(receipt.updatedAt) : now);
    linked++;
  }
  return linked;
}

// Everything the phone app shows about the person's own card. Only that card's uses are ever returned.
export function myCardView(data: AppData, actor: Actor, company: CompanyScope, today = bankToday()) {
  if (!can(actor, "submit:expenses")) return null;
  const account = userCardAccount(data, actor, company);
  if (!account) return null;
  const since = new Date(Date.parse(today) - CARD_USE_LOOKBACK_DAYS * DAY).toISOString().slice(0, 10);
  const projects = new Map(data.projects.filter((row) => matchesCompany(row, company)).map((row) => [row.id, row.name]));
  const receipts: CardReceiptView[] = live(data).filter((row) => row.company === company && row.submittedById === actor.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100).map((row) => {
      const linked = isLinked(data, row), use = linked ? data.bankTransactions.find((item) => item.id === row.transactionId) : undefined;
      const candidates = linked || row.accountId !== account.id ? [] : cardCandidates(data, row).map(toUseView);
      return { id: row.id, updatedAt: row.updatedAt, createdAt: row.createdAt, spentOn: row.spentOn, amount: row.amount, payee: row.payee, purpose: row.purpose,
        projectName: row.projectId ? projects.get(row.projectId) || "" : "", fileUrl: row.fileUrl, mimeType: row.mimeType,
        status: linked ? "LINKED" : candidates.length > 1 ? "CHOOSE" : "WAITING", linkedBy: linked ? row.linkedBy : undefined, use: use ? toUseView(use) : undefined, candidates };
    });
  const uses = data.bankTransactions.filter((row) => isCardUse(data, account.id, row) && row.transactionDate >= since && row.transactionDate <= today)
    .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate) || b.id.localeCompare(a.id));
  const missing = uses.filter((row) => !documented(data, row.id) && row.bookkeeping?.invoiceRequirement !== "NOT_REQUIRED").map(toUseView);
  const month = today.slice(0, 7), monthTotal = uses.filter((row) => row.transactionDate.startsWith(month)).reduce((sum, row) => sum + cents(row.amount), 0) / 100;
  return { account: { id: account.id, label: cardAccountLabel(account) }, receipts, missing, uses: uses.map((row) => ({ ...toUseView(row), documented: documented(data, row.id) })), monthTotal };
}
export type MyCardView = NonNullable<ReturnType<typeof myCardView>>;

export function canViewCardReceiptFile(data: AppData, user: Actor, name: string) {
  return Boolean(name) && live(data).some((row) => row.submittedById === user.id && can(user, "submit:expenses") && uploadedFileNameFromUrl(row.fileUrl) === name);
}

export function cardReceiptSource(data: AppData, receiptId: string) {
  const receipt = (data.cardReceipts || []).find((row) => row.id === receiptId);
  if (!receipt) return undefined;
  const project = receipt.projectId ? data.projects.find((row) => row.id === receipt.projectId)?.name : "";
  return { submitter: data.users.find((row) => row.id === receipt.submittedById)?.name || "", purpose: receipt.purpose, payee: receipt.payee, project: project || "", deleted: Boolean(receipt.deletedAt) };
}
