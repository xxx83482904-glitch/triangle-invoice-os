"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { assertBankAccess } from "@/lib/banking";
import { bankReconciliationOverview, type ReconciliationBank } from "@/lib/bank-reconciliation";
import { invoiceBankCandidates } from "@/lib/bank-reconciliation-matching";
import { linkableMail, linkMailToBank, mailBankLinks } from "@/lib/bank-document-links";
import { companyFromParam, type CompanyScope } from "@/lib/company";
import { can } from "@/lib/rbac";
import { mutateData, newId, readData } from "@/lib/store";
import { isActiveUser } from "@/lib/user-access";
import type { AppData } from "@/lib/types";

type InvoiceKind = "issued" | "received";

function actor(data: AppData, id: string, company: CompanyScope) {
  const user = data.users.find((row) => row.id === id && isActiveUser(row));
  if (!user) throw new Error("利用者の権限を確認してください");
  assertBankAccess(user, company); return user;
}
const message = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;
function refresh() {
  for (const path of ["/banking", "/banking/reconcile", "/issued-invoices", "/received-invoices", "/mail-sorter", "/documents", "/payments", "/dashboard"]) revalidatePath(path);
}
function accountNames(data: AppData) { return new Map(data.bankAccounts.map((row) => [row.id, row.name])); }
function bankSummary(bank: ReconciliationBank, accounts: Map<string, string>) {
  return { id: bank.id, date: bank.date, side: bank.side, content: bank.content, amount: bank.amount, remaining: bank.remaining, account: accounts.get(bank.accountId) || "" };
}
export type BankRowSummary = ReturnType<typeof bankSummary>;

// The invoice as reconciliation sees it, its confirmed bank links, and (with full) the rows it could still be matched to.
function invoiceState(data: AppData, company: CompanyScope, kind: InvoiceKind, id: string, full: boolean) {
  const overview = bankReconciliationOverview(data, company), accounts = accountNames(data), key = `${kind}:${id}`;
  const invoice = overview.invoices.find((row) => row.key === key);
  const banks = new Map(overview.banks.map((row) => [row.id, row]));
  const links = overview.links.filter((row) => row.invoiceKey === key).map((row) => {
    const bank = banks.get(row.transactionId);
    return { id: row.id, updatedAt: row.updatedAt, amount: row.amount, fee: row.fee, issue: row.issue, bank: bank ? bankSummary(bank, accounts) : undefined };
  });
  const source = kind === "issued" ? data.issuedInvoices.find((row) => row.id === id && !row.deletedAt) : data.receivedInvoices.find((row) => row.id === id && !row.deletedAt);
  if (!source) throw new Error("請求書が見つかりません。画面を更新してください");
  const blocked = !invoice ? "この請求書は照合の対象外です（別会社・削除済みなど）" : !invoice.eligible ? "下書き・保留などの請求書は、先に金額と状態を確定してから照合してください" : invoice.conflict ? "照合内容に食い違いがあります。銀行照合の画面で確認してください" : "";
  const summary = { invoice, links, blocked };
  if (!full || !invoice || blocked) return { ...summary, candidates: [], banks: [], accounts: {} as Record<string, string>, choices: [] };
  const side = kind === "issued" ? "INCOME" : "EXPENSE";
  const open = overview.banks.filter((row) => row.side === side && row.state === "unmatched").toSorted((a, b) => b.date.localeCompare(a.date));
  return { ...summary, candidates: invoiceBankCandidates(open, overview.invoices, key), banks: open,
    accounts: Object.fromEntries(accounts), choices: overview.invoices.filter((row) => row.kind === kind && row.eligible && !row.conflict && (row.outstanding > 0 || row.payments.some((payment) => payment.available > 0))) };
}

export async function loadInvoiceBankLinksAction(company: CompanyScope, kind: InvoiceKind, id: string, full = false) {
  const user = await requireUser();
  try {
    const data = await readData(); actor(data, user.id, company);
    if (kind !== "issued" && kind !== "received") throw new Error("請求書の種類が不正です");
    return { success: true as const, ...invoiceState(data, company, kind, id, full) };
  } catch (error) { return { success: false as const, error: message(error, "照合情報を取得できませんでした") }; }
}

// A mail's amount reconciliation goes through its received invoice; the mail itself only links as evidence.
export async function loadMailBankLinksAction(company: CompanyScope, mailId: string, full = false) {
  const user = await requireUser();
  try {
    const data = await readData(); const current = actor(data, user.id, company);
    if (!can(current, "view:mailSorter")) throw new Error("郵便物を表示する権限がありません");
    const mail = data.mailDocuments.find((row) => row.id === mailId && !row.deletedAt && companyFromParam(row.company) === company);
    if (!mail) throw new Error("郵便物が見つかりません。画面を更新してください");
    const invoiceId = mail.relatedReceivedInvoiceId && data.receivedInvoices.some((row) => row.id === mail.relatedReceivedInvoiceId && !row.deletedAt) ? mail.relatedReceivedInvoiceId : "";
    const accounts = accountNames(data), rows = new Map(data.bankTransactions.filter((row) => row.company === company).map((row) => [row.id, row]));
    const links = mailBankLinks(data, company, mail.id).map((row) => {
      const bank = rows.get(row.relatedId)!;
      return { id: row.id, createdAt: row.createdAt, bank: { id: bank.id, date: bank.transactionDate, side: bank.side, content: bank.content, amount: bank.amount, remaining: 0, account: accounts.get(bank.bankAccountId) || "" } };
    });
    const linked = new Set(links.map((row) => row.bank.id));
    const banks = full ? [...rows.values()].filter((row) => !row.sourceMissing && !linked.has(row.id)).toSorted((a, b) => b.transactionDate.localeCompare(a.transactionDate)).slice(0, 2000)
      .map((row) => ({ id: row.id, date: row.transactionDate, side: row.side, content: row.content, amount: row.amount, remaining: 0, account: accounts.get(row.bankAccountId) || "" })) : [];
    return { success: true as const, mail: { id: mail.id, title: mail.title || mail.originalFileName, category: mail.category, senderName: mail.senderName || "", createdAt: mail.createdAt }, invoiceId, links, banks };
  } catch (error) { return { success: false as const, error: message(error, "紐づけ情報を取得できませんでした") }; }
}

export async function linkMailToBankAction(company: CompanyScope, input: { transactionId: string; mailId: string }) {
  const user = await requireUser();
  try {
    const id = newId();
    await mutateData(user.id, "BANK_MAIL_LINK", "Attachment", id, (data) => linkMailToBank(data, actor(data, user.id, company), company, input, id));
    refresh(); return { success: true as const, id };
  } catch (error) { return { success: false as const, error: message(error, "紐づけできませんでした") }; }
}

export async function loadLinkableMailAction(company: CompanyScope, transactionId: string) {
  const user = await requireUser();
  try {
    const data = await readData(); const current = actor(data, user.id, company);
    if (!can(current, "view:mailSorter")) throw new Error("郵便物を表示する権限がありません");
    if (!data.bankTransactions.some((row) => row.id === transactionId && row.company === company)) throw new Error("口座明細が見つかりません。画面を更新してください");
    return { success: true as const, mail: linkableMail(data, company, transactionId) };
  } catch (error) { return { success: false as const, error: message(error, "郵便物を取得できませんでした") }; }
}
