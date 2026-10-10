import { z } from "zod";
import { assertBankAccess, bankToday, isBankDate } from "@/lib/banking";
import { companyFromParam, partnerMatchesCompany, type CompanyScope } from "@/lib/company";
import { invoicePaymentSummary } from "@/lib/invoice-status";
import { invoiceAccountScopeIssue } from "@/lib/bank-reconciliation-accounts";
import type { BankReconciliation, BankTransaction } from "@/lib/banking-types";
import type { AppData, IssuedInvoice, Payment, ReceivedInvoice, User } from "@/lib/types";
import { normalizeReconciliationName } from "@/lib/bank-reconciliation-matching";
export { reconciliationCandidates } from "@/lib/bank-reconciliation-matching";

type Kind = "issued" | "received";
const cents = (value: number) => Math.round(value * 100);
const monetary = (value: number) => Number.isFinite(value) && value > 0 && value <= 1e12 && Math.abs(value * 100 - cents(value)) < 0.001;
const stamp = (old: string) => new Date(Math.max(Date.now(), Date.parse(old) + 1)).toISOString();
const bankEvidence = (row: BankTransaction) => JSON.stringify([row.officeCode, row.bankAccountId, row.sourceId, row.side, row.transactionDate, row.amount, row.content]);
const invoiceEvidence = (kind: Kind, row: IssuedInvoice | ReceivedInvoice) => JSON.stringify([kind, row.projectId, "clientId" in row ? row.clientId : row.vendorId, row.total]);
const paymentEvidence = (row: Payment) => JSON.stringify([row.type, row.issuedInvoiceId, row.receivedInvoiceId, row.amount, row.paymentDate]);
const activeLinks = (data: AppData, company: CompanyScope) => (data.bankReconciliations || []).filter((row) => row.company === company && !row.deletedAt);
const paymentMatches = (payment: Payment, kind: Kind, id: string) => !payment.deletedAt && payment.type === (kind === "issued" ? "INCOME" : "EXPENSE") && (kind === "issued" ? payment.issuedInvoiceId === id && !payment.receivedInvoiceId : payment.receivedInvoiceId === id && !payment.issuedInvoiceId);

function reconciliationIndex(data: AppData) {
  const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((row) => [row.id, row]));
  return { banks: byId(data.bankTransactions), accounts: byId(data.bankAccounts), projects: byId(data.projects), issued: byId(data.issuedInvoices), received: byId(data.receivedInvoices), payments: byId(data.payments) };
}
type ReconciliationIndex = ReturnType<typeof reconciliationIndex>;

function targetInvoice(data: AppData, company: CompanyScope, kind: Kind, id: string, index?: ReconciliationIndex) {
  const invoice = index ? index[kind].get(id) : kind === "issued" ? data.issuedInvoices.find((row) => row.id === id) : data.receivedInvoices.find((row) => row.id === id);
  const project = invoice && (index ? index.projects.get(invoice.projectId) : data.projects.find((row) => row.id === invoice.projectId));
  if (!invoice || invoice.deletedAt || !project || project.deletedAt || companyFromParam(project.company) !== company) throw new Error("対象の請求書が見つかりません");
  return { invoice, project };
}
function eligibleInvoice(kind: Kind, invoice: IssuedInvoice | ReceivedInvoice) {
  return monetary(invoice.total) && !(kind === "issued" ? ["DRAFT", "CANCELED", "REISSUED"] : ["OCR_PENDING", "ON_HOLD", "REJECTED", "ARCHIVED"]).includes(invoice.status);
}
function bankIssue(data: AppData, company: CompanyScope, bank: BankTransaction, today: string, index?: ReconciliationIndex) {
  const account = index ? index.accounts.get(bank.bankAccountId) : data.bankAccounts.find((row) => row.id === bank.bankAccountId);
  if (!account || account.company !== company || account.officeCode !== bank.officeCode || bank.company !== company) return "口座が見つかりません";
  if (["CARD", "OTHER"].includes(account.forecastSettings?.accountKind || "")) return "カード利用・その他口座は銀行入出金として照合できません";
  if (bank.sourceMissing) return "元明細がなくなっています";
  if (bank.treatment !== "NORMAL") return "振替・対象外の明細です";
  if (!isBankDate(bank.transactionDate) || bank.transactionDate > today || !monetary(bank.amount)) return "取引日・金額を確認してください";
  return "";
}

export function reconciliationIssue(data: AppData, link: BankReconciliation, today = bankToday(), index?: ReconciliationIndex) {
  const bank = index ? index.banks.get(link.transactionId) : data.bankTransactions.find((row) => row.id === link.transactionId);
  if (!bank || bank.company !== link.company) return "銀行明細が見つかりません";
  const issue = bankIssue(data, link.company, bank, today, index);
  if (issue) return issue;
  if (bankEvidence(bank) !== link.bankEvidence) return "照合後に銀行の金額・日付・摘要が変わりました";
  try {
    const { invoice } = targetInvoice(data, link.company, link.invoiceKind, link.invoiceId, index);
    if (!eligibleInvoice(link.invoiceKind, invoice) || invoiceEvidence(link.invoiceKind, invoice) !== link.invoiceEvidence) return "照合後に請求書の金額・案件・状態が変わりました";
  } catch { return "請求書が削除・移動されています"; }
  const payment = index ? index.payments.get(link.paymentId) : data.payments.find((row) => row.id === link.paymentId);
  if (!payment || !paymentMatches(payment, link.invoiceKind, link.invoiceId) || paymentEvidence(payment) !== link.paymentEvidence) return "照合後に入金・支払い記録が変わりました";
  if (bank.side !== payment.type) return "入出金の方向が一致しません";
  return "";
}

function updatePaymentStatus(data: AppData, kind: Kind, invoice: IssuedInvoice | ReceivedInvoice) {
  if (kind === "issued") {
    const item = invoice as IssuedInvoice, summary = invoicePaymentSummary(data, item);
    item.status = summary.status; item.paidAt = summary.paidAt; item.updatedAt = stamp(item.updatedAt);
  } else {
    const item = invoice as ReceivedInvoice;
    const payments = data.payments.filter((row) => paymentMatches(row, kind, item.id));
    const complete = payments.reduce((total, row) => total + cents(row.amount), 0) >= cents(item.total);
    item.status = complete ? "PAID" : item.status === "PAID" ? "SCHEDULED" : item.status;
    item.paidAt = complete ? payments.map((row) => row.paymentDate).sort().at(-1) : undefined;
    item.mailProcessed = complete; item.updatedAt = stamp(item.updatedAt);
    for (const mail of data.mailDocuments) if (!mail.deletedAt && mail.relatedReceivedInvoiceId === item.id && companyFromParam(mail.company) === companyFromParam(data.projects.find((row) => row.id === item.projectId)?.company)) {
      mail.mailProcessed = complete; mail.updatedAt = stamp(mail.updatedAt);
    }
  }
}

export const reconcileSchema = z.object({
  transactionId: z.string().min(1).max(1000), transactionUpdatedAt: z.string(),
  invoiceKind: z.enum(["issued", "received"]), invoiceId: z.string().min(1).max(1000), invoiceUpdatedAt: z.string(),
  mode: z.enum(["existing", "new"]), paymentId: z.string().optional(), paymentUpdatedAt: z.string().optional(),
  amount: z.number().refine(monetary, "金額は正の数で小数点以下2桁までにしてください"),
  acknowledged: z.literal(true), note: z.string().trim().max(1000).default(""),
});
export type ReconcileInput = z.input<typeof reconcileSchema>;

export function confirmBankReconciliation(data: AppData, actor: Pick<User, "id" | "role">, company: CompanyScope, input: ReconcileInput, today = bankToday()) {
  assertBankAccess(actor, company);
  const value = reconcileSchema.parse(input), amount = cents(value.amount);
  const bank = data.bankTransactions.find((row) => row.company === company && row.id === value.transactionId);
  if (!bank || bank.updatedAt !== value.transactionUpdatedAt) throw new Error("銀行明細が更新されています。画面を更新してください");
  const problem = bankIssue(data, company, bank, today); if (problem) throw new Error(problem);
  const scopeIssue = invoiceAccountScopeIssue(data.bankAccounts.find((row) => row.id === bank.bankAccountId)!);
  if (scopeIssue) throw new Error(scopeIssue);
  if (bank.side !== (value.invoiceKind === "issued" ? "INCOME" : "EXPENSE")) throw new Error("請求書と入出金の方向が異なります");
  const links = activeLinks(data, company), bankLinks = links.filter((row) => row.transactionId === bank.id);
  if (bankLinks.some((row) => reconciliationIssue(data, row, today))) throw new Error("この明細には要再確認の照合があります。先に解除して見直してください");
  if (amount > cents(bank.amount) - bankLinks.reduce((total, row) => total + cents(row.amount), 0)) throw new Error("銀行明細の未照合額を超えています");
  const { invoice } = targetInvoice(data, company, value.invoiceKind, value.invoiceId);
  if (links.some((row) => row.invoiceKind === value.invoiceKind && row.invoiceId === value.invoiceId && reconciliationIssue(data, row, today))) throw new Error("この請求書には要再確認の照合があります。先に解除して見直してください");
  if (!eligibleInvoice(value.invoiceKind, invoice)) throw new Error("下書き・保留などの請求書は先に金額と状態を確定してください");
  if (invoice.updatedAt !== value.invoiceUpdatedAt) throw new Error("請求書が更新されています。画面を更新してください");
  let payment: Payment;
  if (value.mode === "existing") {
    const found = data.payments.find((row) => row.id === value.paymentId);
    if (!found || !paymentMatches(found, value.invoiceKind, invoice.id) || found.updatedAt !== value.paymentUpdatedAt || !monetary(found.amount)) throw new Error("入金・支払い記録が更新されています");
    const reserved = links.filter((row) => row.paymentId === found.id).reduce((total, row) => total + cents(row.amount), 0);
    if (amount > cents(found.amount) - reserved) throw new Error("既存の支払い記録はすでに照合済みです");
    payment = found;
  } else {
    const paid = data.payments.filter((row) => paymentMatches(row, value.invoiceKind, invoice.id)).reduce((total, row) => total + cents(row.amount), 0);
    if (amount > cents(invoice.total) - paid) throw new Error("未入金・未払い額を超えています。登録済みの支払いがある場合は既存記録に紐づけてください");
    const timestamp = new Date().toISOString();
    payment = { id: crypto.randomUUID(), source: "BANK_RECONCILIATION", type: bank.side,
      ...(value.invoiceKind === "issued" ? { issuedInvoiceId: invoice.id } : { receivedInvoiceId: invoice.id }),
      amount: value.amount, paymentDate: bank.transactionDate, method: "銀行明細照合", memo: value.note,
      createdById: actor.id, createdAt: timestamp, updatedAt: timestamp };
  }
  // Validate everything before altering payment totals or linked mail status.
  if (value.mode === "new") data.payments.unshift(payment);
  updatePaymentStatus(data, value.invoiceKind, invoice);
  const timestamp = new Date().toISOString();
  const link: BankReconciliation = { id: crypto.randomUUID(), company, transactionId: bank.id, invoiceKind: value.invoiceKind, invoiceId: invoice.id, paymentId: payment.id, amount: value.amount,
    createdPayment: value.mode === "new", bankEvidence: bankEvidence(bank), invoiceEvidence: invoiceEvidence(value.invoiceKind, invoice), paymentEvidence: paymentEvidence(payment),
    note: value.note, confirmedById: actor.id, createdAt: timestamp, updatedAt: timestamp };
  data.bankReconciliations ||= [];
  data.bankReconciliations.unshift(link);
  return { id: link.id, paymentId: payment.id, createdPayment: link.createdPayment };
}

export function removeBankReconciliation(data: AppData, actor: Pick<User, "id" | "role">, company: CompanyScope, id: string, updatedAt: string) {
  assertBankAccess(actor, company);
  const link = activeLinks(data, company).find((row) => row.id === id);
  if (!link || link.updatedAt !== updatedAt) throw new Error("照合記録が更新されています");
  if (link.createdPayment) {
    const payment = data.payments.find((row) => row.id === link.paymentId);
    if (!payment || !paymentMatches(payment, link.invoiceKind, link.invoiceId) || paymentEvidence(payment) !== link.paymentEvidence || payment.source !== "BANK_RECONCILIATION" || payment.updatedAt !== payment.createdAt || activeLinks(data, company).some((row) => row.id !== link.id && row.paymentId === payment.id)) throw new Error("照合後に支払い記録が変更されています。既存記録を保護するため解除できません");
    const { invoice } = targetInvoice(data, company, link.invoiceKind, link.invoiceId);
    payment.deletedAt = new Date().toISOString(); payment.updatedAt = stamp(payment.updatedAt);
    if (eligibleInvoice(link.invoiceKind, invoice)) updatePaymentStatus(data, link.invoiceKind, invoice);
  }
  link.deletedAt = new Date().toISOString(); link.updatedAt = stamp(link.updatedAt);
  return { id: link.id, removedPayment: link.createdPayment };
}

export function syncReconciledInvoiceStatus(data: AppData, actor: Pick<User, "id" | "role">, company: CompanyScope, kind: Kind, id: string, updatedAt: string, today = bankToday()) {
  assertBankAccess(actor, company);
  if (!["issued", "received"].includes(kind)) throw new Error("書類の種類が不正です");
  const { invoice } = targetInvoice(data, company, kind, id);
  const links = activeLinks(data, company).filter((row) => row.invoiceId === id && row.invoiceKind === kind);
  if (invoice.updatedAt !== updatedAt || !links.length || links.some((row) => reconciliationIssue(data, row, today))) throw new Error("照合内容が更新されています。先に銀行・請求書の照合を確認してください");
  updatePaymentStatus(data, kind, invoice);
  return { id, status: invoice.status };
}

export function bankReconciliationOverview(data: AppData, company: CompanyScope, today = bankToday()) {
  const index = reconciliationIndex(data);
  const links = activeLinks(data, company);
  const issues = new Map(links.map((row) => [row.id, reconciliationIssue(data, row, today, index)]));
  const paymentsByInvoice = new Map<string, Payment[]>(), mailByInvoice = new Map<string, AppData["mailDocuments"]>();
  for (const payment of data.payments) {
    const kind = payment.type === "INCOME" ? "issued" : "received", id = kind === "issued" ? payment.issuedInvoiceId : payment.receivedInvoiceId;
    if (!id || !paymentMatches(payment, kind, id)) continue;
    const key = `${kind}:${id}`, rows = paymentsByInvoice.get(key) || [];
    rows.push(payment); paymentsByInvoice.set(key, rows);
  }
  let unlinkedMailCount = 0;
  for (const mail of data.mailDocuments) {
    if (mail.deletedAt || companyFromParam(mail.company) !== company) continue;
    const invoice = mail.relatedReceivedInvoiceId && index.received.get(mail.relatedReceivedInvoiceId);
    const project = invoice && index.projects.get(invoice.projectId);
    if (!invoice || invoice.deletedAt || !project || project.deletedAt || companyFromParam(project.company) !== company) {
      if (["INVOICE", "RECEIPT"].includes(mail.category)) unlinkedMailCount++;
      continue;
    }
    const rows = mailByInvoice.get(invoice.id) || []; rows.push(mail); mailByInvoice.set(invoice.id, rows);
  }
  const clients = new Map(data.clients.filter((row) => !row.deletedAt && partnerMatchesCompany(row, company)).map((row) => [row.id, row]));
  const vendors = new Map(data.vendors.filter((row) => !row.deletedAt && partnerMatchesCompany(row, company)).map((row) => [row.id, row]));
  const linkedBank = new Map<string, number>(), linkedPayment = new Map<string, number>();
  const validInvoice = new Map<string, number>();
  const conflictBank = new Set<string>(), conflictInvoice = new Set<string>();
  for (const link of links) {
    const key = `${link.invoiceKind}:${link.invoiceId}`;
    linkedBank.set(link.transactionId, (linkedBank.get(link.transactionId) || 0) + cents(link.amount));
    linkedPayment.set(link.paymentId, (linkedPayment.get(link.paymentId) || 0) + cents(link.amount));
    if (issues.get(link.id)) { conflictBank.add(link.transactionId); conflictInvoice.add(key); }
    else validInvoice.set(key, (validInvoice.get(key) || 0) + cents(link.amount));
  }
  const invoices = ( ["issued", "received"] as const).flatMap((kind) => (kind === "issued" ? data.issuedInvoices : data.receivedInvoices).flatMap((invoice) => {
    if (invoice.deletedAt) return [];
    const project = index.projects.get(invoice.projectId);
    if (!project || project.deletedAt || companyFromParam(project.company) !== company) return [];
    const key = `${kind}:${invoice.id}`, party = kind === "issued" ? clients.get((invoice as IssuedInvoice).clientId) : vendors.get((invoice as ReceivedInvoice).vendorId);
    const payments = paymentsByInvoice.get(key) || [];
    const paid = payments.reduce((total, row) => total + cents(row.amount), 0), matched = validInvoice.get(key) || 0;
    const mail = kind === "received" ? mailByInvoice.get(invoice.id) || [] : [];
    const eligible = eligibleInvoice(kind, invoice);
    const complete = paid >= cents(invoice.total) && invoice.total > 0;
    const stateMismatch = eligible && (kind === "received"
      ? (invoice.status === "PAID") !== complete || Boolean((invoice as ReceivedInvoice).mailProcessed) !== complete || mail.some((row) => Boolean(row.mailProcessed) !== complete)
      : invoicePaymentSummary({ payments }, invoice as IssuedInvoice).status !== invoice.status);
    return [{ key, kind, id: invoice.id, updatedAt: invoice.updatedAt, title: kind === "issued" ? (invoice as IssuedInvoice).invoiceNumber : (invoice as ReceivedInvoice).originalFileName || mail[0]?.title || "受領請求書",
      party: party?.companyName || "取引先未設定", partyId: party?.id || "", accountHolder: party && "accountHolder" in party && typeof party.accountHolder === "string" ? party.accountHolder : "",
      confirmedNames: [] as Array<{ accountId: string; content: string }>,
      project: project.name, total: invoice.total, date: invoice.issueDate, dueDate: invoice.dueDate,
      paid: paid / 100, outstanding: Math.max(0, cents(invoice.total) - paid) / 100, matched: matched / 100, unmatched: Math.max(0, cents(invoice.total) - matched) / 100,
      recordedUnmatched: Math.max(0, paid - matched) / 100, overpaid: Math.max(0, paid - cents(invoice.total)) / 100,
      eligible, needsReview: kind === "issued" && Boolean((invoice as IssuedInvoice).needsReview), conflict: conflictInvoice.has(key), stateMismatch,
      mailCount: mail.length, status: invoice.status, overdue: eligible && Boolean(invoice.dueDate) && invoice.dueDate < today && paid < cents(invoice.total),
      href: kind === "issued" ? `/issued-invoices?company=${company}&document=${encodeURIComponent(key)}` : `/received-invoices?company=${company}&document=${encodeURIComponent(invoice.id)}`,
      payments: payments.map((row) => ({ id: row.id, updatedAt: row.updatedAt, amount: row.amount, date: row.paymentDate, available: Math.max(0, cents(row.amount) - (linkedPayment.get(row.id) || 0)) / 100, method: row.method || "手入力" })),
    }];
  }));
  // Only intact, unambiguous confirmations teach a bank description to a counterparty.
  const invoiceByKey = new Map(invoices.map((row) => [row.key, row]));
  const identities = new Map<string, { accountId: string; content: string; parties: Set<string> }>();
  for (const link of links) {
    if (issues.get(link.id)) continue;
    const invoice = invoiceByKey.get(`${link.invoiceKind}:${link.invoiceId}`), bank = index.banks.get(link.transactionId);
    if (!invoice?.partyId || !bank) continue;
    const content = normalizeReconciliationName(bank.content);
    if (content.length < 4 || /^(振込|振替|入金|出金|送金|振込入金|振込出金)$/.test(content)) continue;
    const key = JSON.stringify([bank.bankAccountId, bank.side, content]);
    const entry = identities.get(key) || { accountId: bank.bankAccountId, content, parties: new Set<string>() };
    entry.parties.add(`${invoice.kind}:${invoice.partyId}`); identities.set(key, entry);
  }
  const namesByParty = new Map<string, Array<{ accountId: string; content: string }>>();
  for (const entry of identities.values()) {
    if (entry.parties.size !== 1) continue;
    const key = [...entry.parties][0], names = namesByParty.get(key) || [];
    names.push({ accountId: entry.accountId, content: entry.content }); namesByParty.set(key, names);
  }
  for (const invoice of invoices) invoice.confirmedNames = namesByParty.get(`${invoice.kind}:${invoice.partyId}`) || [];
  const banks = data.bankTransactions.filter((row) => row.company === company).map((row) => {
    const allocated = (linkedBank.get(row.id) || 0) / 100, sourceIssue = bankIssue(data, company, row, today, index);
    const account = index.accounts.get(row.bankAccountId);
    const scopeIssue = account ? invoiceAccountScopeIssue(account) : "";
    const issue = sourceIssue || scopeIssue;
    // A new matching scope must not invalidate previously confirmed payment evidence.
    const matched = !sourceIssue && allocated > 0 && cents(allocated) >= cents(row.amount);
    return { id: row.id, updatedAt: row.updatedAt, accountId: row.bankAccountId, date: row.transactionDate, side: row.side, content: row.content, amount: row.amount,
      remaining: Math.max(0, cents(row.amount) - cents(allocated)) / 100, allocated, issue, conflict: conflictBank.has(row.id),
      state: conflictBank.has(row.id) ? "conflict" : matched ? "matched" : issue ? "excluded" : "unmatched" };
  });
  return { banks, invoices, unlinkedMailCount, links: links.map((row) => ({ id: row.id, updatedAt: row.updatedAt, transactionId: row.transactionId, invoiceKey: `${row.invoiceKind}:${row.invoiceId}`, amount: row.amount, createdPayment: row.createdPayment, issue: issues.get(row.id) || "", note: row.note, createdAt: row.createdAt })) };
}
export type ReconciliationOverview = ReturnType<typeof bankReconciliationOverview>;
export type ReconciliationInvoice = ReconciliationOverview["invoices"][number];
export type ReconciliationBank = ReconciliationOverview["banks"][number];
