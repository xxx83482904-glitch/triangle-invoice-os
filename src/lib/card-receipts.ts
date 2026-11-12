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
type Actor = Pick<User, "id" | "role" | "featureAccess">;
const DAY = 86_400_000;
export const CARD_MATCH_DAYS = 7;
export const CARD_USE_LOOKBACK_DAYS = 120;
export const CARD_RECEIPT_SOURCE = "CardReceipt" as const;
const cents = (value: number) => Math.round(value * 100);
const days = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / DAY);
const stamp = (previous?: string) => new Date(Math.max(Date.now(), previous ? Date.parse(previous) + 1 : 0)).toISOString();

// Payment accounts that are not bank accounts: PayPay, other e-money and prepaid wallets.
const walletName = /paypay|ペイペイ|電子マネー|プリペイド|デビット|楽天ペイ|d払い|au\s*pay|merpay|メルペイ|suica|pasmo|icoca/i;
export function isCompanyPaymentAccount(account: Parameters<typeof accountKind>[0]) {
  const kind = accountKind(account);
  if (kind === "CARD" || kind === "OTHER") return true;
  return kind === "UNKNOWN" && walletName.test(`${account.serviceName} ${account.name}`.normalize("NFKC"));
}

// A bank account given as a company card stands for its debit card (e.g. PayPay銀行 Visaデビット). Debit purchases
// appear only as the shop name ("OPENAI *CHATGPT SUBSCR", "ローソン"), so every withdrawal counts except the ones
// that are clearly not card purchases: transfers and their fees, account transfers and direct debits (RL) / PGBS),
// Pay-easy (PE), overseas remittances, ATM, interest and taxes.
const notPurchase = /振込|振替|引落|ATM|手数料|利息|税|給与|賞与|送金|ソウキン|ｿｳｷﾝ|入金/i, debitPrefix = /^\s*(PE\s|RL\)|PGBS)/i;
export function isDebitPurchase(row: Pick<BankTransaction, "content" | "sourceMemo">) {
  const content = row.content.normalize("NFKC"), text = `${content} ${row.sourceMemo || ""}`.normalize("NFKC");
  return !notPurchase.test(text) && !debitPrefix.test(content);
}
const isBankAccount = (account: Parameters<typeof accountKind>[0]) => accountKind(account) === "BANK";

// Accounts an administrator can hand to a person as their company card: credit cards, PayPay and similar wallets, and
// bank accounts used through their debit card. A connection header with sub-accounts and no lines of its own is skipped.
export function companyCardAccounts(data: AppData, company: CompanyScope) {
  const accounts = data.bankAccounts.filter((row) => row.company === company);
  const family = (row: (typeof accounts)[number]) => `${row.officeCode}\u0000${row.sourceId}`;
  const parents = new Set(accounts.filter((row) => row.sourceSubId).map(family));
  const used = new Set(data.bankTransactions.filter((row) => row.company === company).map((row) => row.bankAccountId));
  return accounts.filter((row) => isCompanyPaymentAccount(row) || isBankAccount(row) && !(!row.sourceSubId && parents.has(family(row)) && !used.has(row.id)))
    .sort((a, b) => Number(isBankAccount(a)) - Number(isBankAccount(b)) || `${a.serviceName} ${a.name}`.localeCompare(`${b.serviceName} ${b.name}`, "ja"));
}

export function cardAccountLabel(account: Parameters<typeof accountKind>[0]) {
  const label = account.name.includes(account.serviceName) || !account.serviceName ? account.name : `${account.serviceName} ${account.name}`;
  return isBankAccount(account) ? `${label}（デビット）` : label;
}

// The cards a person holds. companyCardAccountId is the single card stored before people could hold several.
export function heldCardIds(user: Pick<User, "companyCardAccountId" | "companyCardAccountIds"> | undefined) {
  if (!user) return [];
  return [...new Set([...(user.companyCardAccountIds || []), ...(user.companyCardAccountId ? [user.companyCardAccountId] : [])])];
}

export function userCardAccounts(data: AppData, user: Pick<User, "id">, company: CompanyScope) {
  const ids = heldCardIds(data.users.find((row) => row.id === user.id));
  return ids.length ? companyCardAccounts(data, company).filter((row) => ids.includes(row.id)) : [];
}

// Administrators give each person any number of cards; a card belongs to one person.
export function assignCompanyCard(data: AppData, actor: Actor, company: CompanyScope, input: { userId: string; accountIds: string[] }) {
  assertCan(actor, "manage:users"); assertCompanyAccess(actor, company);
  const user = data.users.find((row) => row.id === input.userId && isActiveUser(row));
  if (!user) throw new Error("利用者が見つかりません");
  const ids = [...new Set(input.accountIds.map((id) => String(id)).filter(Boolean))], offered = companyCardAccounts(data, company);
  for (const id of ids) {
    if (!offered.some((row) => row.id === id)) throw new Error("カードの口座を選んでください");
    const holder = data.users.find((row) => row.id !== user.id && !row.deletedAt && heldCardIds(row).includes(id));
    if (holder) throw new Error(`このカードは${holder.name}さんに登録されています。先にそちらを外してください`);
  }
  delete user.companyCardAccountId;
  if (ids.length) user.companyCardAccountIds = ids; else delete user.companyCardAccountIds;
  user.updatedAt = stamp(user.updatedAt);
  return { userId: user.id, accountIds: ids };
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
  if (row.bankAccountId !== accountId || row.side !== "EXPENSE" || row.sourceMissing || row.sourceStatus === "excluded" || row.treatment !== "NORMAL"
    || !Number.isFinite(row.amount) || row.amount <= 0 || knownBankCardSettlement(data, row)) return false;
  const account = data.bankAccounts.find((item) => item.id === accountId);
  return !account || !isBankAccount(account) || isDebitPurchase(row);
}

// Which cards a receipt may belong to: the card it was registered on, or, when the person did not say which card,
// every card they hold now.
function receiptCardIds(data: AppData, receipt: Pick<CardReceipt, "accountId" | "submittedById">) {
  const held = heldCardIds(data.users.find((row) => row.id === receipt.submittedById && !row.deletedAt));
  return receipt.accountId ? held.includes(receipt.accountId) ? [receipt.accountId] : [] : held;
}

export function cardCandidates(data: AppData, receipt: Pick<CardReceipt, "accountId" | "submittedById" | "amount" | "spentOn"> & { excludedTransactionIds?: string[] }) {
  const ids = receiptCardIds(data, receipt);
  return data.bankTransactions.filter((row) => ids.some((id) => isCardUse(data, id, row)) && cents(row.amount) === cents(receipt.amount)
      && Math.abs(days(row.transactionDate, receipt.spentOn)) <= CARD_MATCH_DAYS && !documented(data, row.id) && !receipt.excludedTransactionIds?.includes(row.id))
    .sort((a, b) => Math.abs(days(a.transactionDate, receipt.spentOn)) - Math.abs(days(b.transactionDate, receipt.spentOn)) || a.id.localeCompare(b.id));
}

function link(data: AppData, receipt: CardReceipt, row: BankTransaction, by: "AUTO" | "SELF", now: string) {
  const attachment: Attachment = { id: `card-receipt-${receipt.id}-${Date.parse(now)}`, relatedType: BANK_RECEIPT_TYPE, relatedId: row.id, fileUrl: receipt.fileUrl,
    fileName: `${receipt.payee}（${receipt.purpose}）`.slice(0, 200), mimeType: receipt.mimeType, uploadedById: receipt.submittedById, createdAt: now,
    sourceType: CARD_RECEIPT_SOURCE, sourceId: receipt.id };
  data.attachments.unshift(attachment);
  Object.assign(receipt, { accountId: row.bankAccountId, transactionId: row.id, attachmentId: attachment.id, linkedAt: now, linkedBy: by, updatedAt: now });
}

const toUseView = (row: BankTransaction): { id: string; date: string; content: string; amount: number; card?: string; accountId?: string } => ({ id: row.id, date: row.transactionDate, content: row.content, amount: row.amount });
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

function ownAccounts(data: AppData, actor: Actor, company: CompanyScope) {
  assertCompanyAccess(actor, company); assertCan(actor, "submit:expenses");
  const accounts = userCardAccounts(data, actor, company);
  if (!accounts.length) throw new Error("会社カードが登録されていません。管理者に登録を依頼してください");
  return accounts;
}

// A use the person picked themselves: any unreceipted use on one of their own cards, whatever the amount.
function ownUse(data: AppData, accountIds: string[], transactionId: string, receipt?: CardReceipt) {
  const row = data.bankTransactions.find((item) => item.id === transactionId);
  if (!row || !accountIds.some((id) => isCardUse(data, id, row))) throw new Error("あなたのカードの利用が見つかりません。画面を更新してください");
  if (documented(data, row.id) || receipt?.excludedTransactionIds?.includes(row.id)) throw new Error("この利用にはすでに領収書が付いています");
  return row;
}

export function submitCardReceipt(data: AppData, actor: Actor, company: CompanyScope, input: CardReceiptSubmit, id: string, now = new Date().toISOString()) {
  const accounts = ownAccounts(data, actor, company), value = submitSchema.parse(input);
  if (value.projectId && !data.projects.some((row) => row.id === value.projectId && !row.deletedAt && matchesCompany(row, company))) throw new Error("この会社の案件を選択してください");
  if (value.categoryId && !expenseCategoryOptions(data, company).some((row) => row.value === value.categoryId)) throw new Error("利用できる経費の勘定科目を選択してください");
  const tax = value.taxBreakdown && Object.fromEntries(Object.entries(value.taxBreakdown).filter(([, amount]) => amount)) as NonNullable<typeof value.taxBreakdown>;
  if (tax && (tax.rate10 || 0) + (tax.rate8 || 0) >= value.amount) throw new Error("消費税額は金額より小さくしてください");
  const picked = value.transactionId ? ownUse(data, accounts.map((row) => row.id), value.transactionId) : undefined;
  // With one card the receipt belongs to it; with several it is matched against all of them until it is attached.
  const receipt: CardReceipt = { id, company, submittedById: actor.id, accountId: picked?.bankAccountId || (accounts.length === 1 ? accounts[0].id : ""), spentOn: value.spentOn, amount: value.amount, payee: value.payee, purpose: value.purpose,
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
  const accounts = ownAccounts(data, actor, company).map((row) => row.id);
  const value = pickSchema.parse(input), receipt = ownReceipt(data, actor, company, value.id, value.version);
  if (isLinked(data, receipt)) throw new Error("この領収書はすでにカードの利用に付いています");
  link(data, receipt, ownUse(data, receipt.accountId ? accounts.filter((id) => id === receipt.accountId) : accounts, value.transactionId, receipt), "SELF", stamp(receipt.updatedAt) > now ? stamp(receipt.updatedAt) : now);
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
    const candidates = cardCandidates(data, receipt);
    if (candidates.length !== 1) continue;
    link(data, receipt, candidates[0], "AUTO", stamp(receipt.updatedAt) > now ? stamp(receipt.updatedAt) : now);
    linked++;
  }
  return linked;
}

// Everything the expense screens show about the person's own cards. Only those cards' uses are ever returned.
export function myCardView(data: AppData, actor: Actor, company: CompanyScope, today = bankToday()) {
  if (!can(actor, "submit:expenses")) return null;
  const accounts = userCardAccounts(data, actor, company);
  if (!accounts.length) return null;
  const ids = accounts.map((row) => row.id), labels = new Map(accounts.map((row) => [row.id, cardAccountLabel(row)]));
  const withCard = (row: BankTransaction) => ({ ...toUseView(row), card: labels.get(row.bankAccountId) || "", accountId: row.bankAccountId });
  const since = new Date(Date.parse(today) - CARD_USE_LOOKBACK_DAYS * DAY).toISOString().slice(0, 10);
  const projects = new Map(data.projects.filter((row) => matchesCompany(row, company)).map((row) => [row.id, row.name]));
  const receipts: CardReceiptView[] = live(data).filter((row) => row.company === company && row.submittedById === actor.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100).map((row) => {
      const linked = isLinked(data, row), use = linked ? data.bankTransactions.find((item) => item.id === row.transactionId) : undefined;
      const candidates = linked || (row.accountId && !ids.includes(row.accountId)) ? [] : cardCandidates(data, row).map(withCard);
      return { id: row.id, updatedAt: row.updatedAt, createdAt: row.createdAt, spentOn: row.spentOn, amount: row.amount, payee: row.payee, purpose: row.purpose,
        projectName: row.projectId ? projects.get(row.projectId) || "" : "", fileUrl: row.fileUrl, mimeType: row.mimeType,
        status: linked ? "LINKED" : candidates.length > 1 ? "CHOOSE" : "WAITING", linkedBy: linked ? row.linkedBy : undefined, use: use ? withCard(use) : undefined, candidates };
    });
  const uses = data.bankTransactions.filter((row) => ids.some((id) => isCardUse(data, id, row)) && row.transactionDate >= since && row.transactionDate <= today)
    .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate) || b.id.localeCompare(a.id));
  const holder = data.users.find((row) => row.id === actor.id), exemptions = (holder?.cardReceiptExemptions || []).filter((row) => ids.includes(row.accountId));
  const exempt = (row: BankTransaction) => exemptions.some((item) => item.accountId === row.bankAccountId && item.key === payeeKey(row.content));
  const missing = uses.filter((row) => !documented(data, row.id) && row.bookkeeping?.invoiceRequirement !== "NOT_REQUIRED" && !exempt(row)).map(withCard);
  const month = today.slice(0, 7), monthTotal = uses.filter((row) => row.transactionDate.startsWith(month)).reduce((sum, row) => sum + cents(row.amount), 0) / 100;
  // account.label names every card, so screens written for one card read naturally with several.
  return { account: { id: ids[0], label: accounts.map(cardAccountLabel).join("・") }, accounts: accounts.map((row) => ({ id: row.id, label: cardAccountLabel(row) })),
    receipts, missing, uses: uses.map((row) => ({ ...withCard(row), documented: documented(data, row.id) })), monthTotal,
    exemptions: exemptions.map((row) => ({ ...row, card: labels.get(row.accountId) || "", count: uses.filter((use) => use.bankAccountId === row.accountId && payeeKey(use.content) === row.key).length }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
}
export type MyCardView = NonNullable<ReturnType<typeof myCardView>>;

// The same shop on a statement: width, case and spacing differences do not matter.
export function payeeKey(content: string) {
  return content.normalize("NFKC").toUpperCase().replace(/\s+/g, " ").trim();
}

const exemptSchema = z.object({ accountId: reference, content: required("支払先", 1000) }).strict();
const unexemptSchema = z.object({ accountId: reference, key: required("支払先", 1000) }).strict();

// The card holder marks a payee on one of their cards as never needing a receipt; every use of it, past and future,
// leaves the missing list. Nothing on the statement or in accounting changes.
export function exemptCardPayee(data: AppData, actor: Actor, company: CompanyScope, input: z.input<typeof exemptSchema>, now = new Date().toISOString()) {
  const accounts = ownAccounts(data, actor, company), value = exemptSchema.parse(input);
  if (!accounts.some((row) => row.id === value.accountId)) throw new Error("あなたのカードではありません。画面を更新してください");
  const user = data.users.find((row) => row.id === actor.id)!, key = payeeKey(value.content);
  if (!key) throw new Error("支払先を確認してください");
  const list = user.cardReceiptExemptions || [];
  if (!list.some((row) => row.accountId === value.accountId && row.key === key)) user.cardReceiptExemptions = [...list, { accountId: value.accountId, key, label: value.content.normalize("NFKC").trim().slice(0, 200), createdAt: now }];
  user.updatedAt = stamp(user.updatedAt);
  return { accountId: value.accountId, key };
}

export function unexemptCardPayee(data: AppData, actor: Actor, company: CompanyScope, input: z.input<typeof unexemptSchema>) {
  assertCompanyAccess(actor, company); assertCan(actor, "submit:expenses");
  const value = unexemptSchema.parse(input), user = data.users.find((row) => row.id === actor.id);
  if (!user) throw new Error("利用者が見つかりません");
  const list = user.cardReceiptExemptions || [], next = list.filter((row) => !(row.accountId === value.accountId && row.key === value.key));
  if (next.length === list.length) throw new Error("この支払先はすでに戻されています。画面を更新してください");
  if (next.length) user.cardReceiptExemptions = next; else delete user.cardReceiptExemptions;
  user.updatedAt = stamp(user.updatedAt);
  return { accountId: value.accountId, key: value.key };
}

export function canViewCardReceiptFile(data: AppData, user: Actor, name: string) {
  return Boolean(name) && live(data).some((row) => row.submittedById === user.id && can(user, "submit:expenses") && uploadedFileNameFromUrl(row.fileUrl) === name);
}

export function cardReceiptSource(data: AppData, receiptId: string) {
  const receipt = (data.cardReceipts || []).find((row) => row.id === receiptId);
  if (!receipt) return undefined;
  const project = receipt.projectId ? data.projects.find((row) => row.id === receipt.projectId)?.name : "";
  return { submitter: data.users.find((row) => row.id === receipt.submittedById)?.name || "", purpose: receipt.purpose, payee: receipt.payee, project: project || "", deleted: Boolean(receipt.deletedAt) };
}
