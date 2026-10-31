import { z } from "zod";
import { assertBankAccess, bankToday, isBankDate } from "@/lib/banking";
import { companyFromParam, partnerMatchesCompany, type CompanyScope } from "@/lib/company";
import { invoicePaymentSummary } from "@/lib/invoice-status";
import { invoiceAccountScopeIssue } from "@/lib/bank-reconciliation-accounts";
import { APLUS_SETTLEMENT_LINK_ISSUE, bankCardSettlementConflict, bankCardSettlementDetail, knownBankCardSettlement } from "@/lib/bank-card-settlement";
import type { BankReconciliation, BankTransaction } from "@/lib/banking-types";
import type { AppData, IssuedInvoice, Payment, ReceivedInvoice, User } from "@/lib/types";
import { normalizeReconciliationName } from "@/lib/bank-reconciliation-matching";
import { bankSplitValidation } from "@/lib/bank-bookkeeping";
export { reconciliationCandidates } from "@/lib/bank-reconciliation-matching";

type Kind = "issued" | "received";
const cents = (value: number) => Math.round(value * 100);
const monetary = (value: number) => Number.isFinite(value) && value > 0 && value <= 1e12 && Math.abs(value * 100 - cents(value)) < 0.001;
const stamp = (old: string) => new Date(Math.max(Date.now(), Date.parse(old) + 1)).toISOString();
const bankEvidence = (row: BankTransaction) => JSON.stringify([row.officeCode, row.bankAccountId, row.sourceId, row.side, row.transactionDate, row.amount, row.content]);
const invoiceEvidence = (kind: Kind, row: IssuedInvoice | ReceivedInvoice) => JSON.stringify([kind, row.projectId, "clientId" in row ? row.clientId : row.vendorId, row.total]);
// Only the document kind and the payable total are evidence. The stored shape still carries the project and
// counterparty for older readers, but editing a project, counterparty, memo or an eligible status never
// invalidates a confirmed link.
const invoiceEvidenceMatches = (stored: string, kind: Kind, row: IssuedInvoice | ReceivedInvoice) => {
  try { const parsed: unknown = JSON.parse(stored); return Array.isArray(parsed) && parsed[0] === kind && cents(Number(parsed[3])) === cents(row.total); } catch { return false; }
};
const paymentEvidence = (row: Payment) => JSON.stringify([row.type, row.issuedInvoiceId, row.receivedInvoiceId, row.amount, row.paymentDate]);
const activeLinks = (data: AppData, company: CompanyScope) => (data.bankReconciliations || []).filter((row) => row.company === company && !row.deletedAt);
const paymentMatches = (payment: Payment, kind: Kind, id: string) => !payment.deletedAt && payment.type === (kind === "issued" ? "INCOME" : "EXPENSE") && (kind === "issued" ? payment.issuedInvoiceId === id && !payment.receivedInvoiceId : payment.receivedInvoiceId === id && !payment.issuedInvoiceId);
// A fee rides along a link. Payer-borne fees are part of what the invoice received; bank-borne fees are part of what left the bank row.
export const linkBankCents = (link: Pick<BankReconciliation, "amount" | "fee">) => cents(link.amount) + (link.fee?.borneBy === "bank" ? cents(link.fee.amount) : 0);
export const linkPaymentCents = (link: Pick<BankReconciliation, "amount" | "fee">) => cents(link.amount) + (link.fee?.borneBy === "payer" ? cents(link.fee.amount) : 0);

function withholdingInfo(kind: Kind, invoice: IssuedInvoice | ReceivedInvoice) {
  const withholdingAmount = kind === "received" ? (invoice as ReceivedInvoice).withholdingAmount || 0 : 0;
  const netPayable = withholdingAmount > 0 ? Math.max(0, ((invoice as ReceivedInvoice).grossAmount ?? invoice.subtotal + invoice.taxTotal) - withholdingAmount) : invoice.total;
  return { withholdingAmount, netPayable, withholdingMismatch: withholdingAmount > 0 && cents(netPayable) !== cents(invoice.total) };
}

// Bank-borne fee: split the bank row into the invoice part and the fee category when the row allows it. Returns a note, never throws.
function applyFeeSplit(data: AppData, bank: BankTransaction, feeYen: number, categoryId?: string) {
  if (!categoryId) return "手数料の科目が未指定のため、明細の科目分割はしていません";
  if (bank.bookkeeping?.splits?.length) return "明細に科目分割があるため変更していません";
  if (!bank.categoryId) return "明細に科目が未設定のため分割していません。科目を設定してから記帳詳細で分けてください";
  if (!Number.isSafeInteger(bank.amount) || !Number.isSafeInteger(feeYen) || feeYen >= bank.amount) return "整数の円金額でないため分割していません";
  const splits = [{ id: crypto.randomUUID(), categoryId: bank.categoryId, subCategoryId: bank.subCategoryId, amount: bank.amount - feeYen, memo: "請求書照合分" }, { id: crypto.randomUUID(), categoryId, amount: feeYen, memo: "振込手数料" }];
  const issue = bankSplitValidation(bank, splits, data.accountingCategories).issue;
  if (issue) return `分割していません: ${issue}`;
  bank.bookkeeping = { ...bank.bookkeeping, splits };
  bank.updatedAt = stamp(bank.updatedAt);
  return `明細を ${bank.amount - feeYen} 円（${bank.categoryId ? "元の科目" : ""}）と手数料 ${feeYen} 円に分割しました`;
}

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
  if (knownBankCardSettlement(data, bank)) return bankCardSettlementConflict(data, bank) || APLUS_SETTLEMENT_LINK_ISSUE;
  if (["CARD", "OTHER"].includes(account.forecastSettings?.accountKind || "")) return "カード利用・その他口座は銀行入出金として照合できません";
  if (bank.sourceMissing) return "元明細がなくなっています";
  if (bank.sourceStatus === "excluded") return "連携元で対象外の明細です";
  if ((data.bankTransfers || []).some((link) => !link.deletedAt && [link.outgoingId, link.incomingId].includes(bank.id))) return "口座間の資金移動と照合済みです";
  if (bank.treatment !== "NORMAL") return "振替・対象外の明細です";
  if (bank.bookkeeping?.invoiceRequirement === "NOT_REQUIRED") return "請求書不要（経費集計には残ります）。照合する場合は明細の請求書要否を変更してください";
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
    if (!eligibleInvoice(link.invoiceKind, invoice)) return "照合後に請求書が照合できない状態（下書き・保留・却下など）になりました";
    if (!invoiceEvidenceMatches(link.invoiceEvidence, link.invoiceKind, invoice)) return "照合後に請求書の金額が変わりました";
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

// Shared with manual payment records: re-derive paid/complete state from payment rows without creating any payment.
export function syncInvoicePaymentState(data: AppData, kind: Kind, invoice: IssuedInvoice | ReceivedInvoice) {
  updatePaymentStatus(data, kind, invoice);
}

export const reconcileSchema = z.object({
  transactionId: z.string().min(1).max(1000), transactionUpdatedAt: z.string(),
  invoiceKind: z.enum(["issued", "received"]), invoiceId: z.string().min(1).max(1000), invoiceUpdatedAt: z.string(),
  mode: z.enum(["existing", "new"]), paymentId: z.string().optional(), paymentUpdatedAt: z.string().optional(),
  amount: z.number().refine(monetary, "金額は正の数で小数点以下2桁までにしてください"),
  acknowledged: z.literal(true), note: z.string().trim().max(1000).default(""),
  duplicateAcknowledged: z.boolean().optional(),
  // 差額を支払手数料で処理: payer-deducted fee on income, bank-charged fee on expense. New payment records only.
  fee: z.object({ amount: z.number().refine(monetary, "手数料は正の数で小数点以下2桁までにしてください"), categoryId: z.string().min(1).max(1000).optional() }).optional(),
});
export type ReconcileInput = z.input<typeof reconcileSchema>;

export function confirmBankReconciliation(data: AppData, actor: Pick<User, "id" | "role">, company: CompanyScope, input: ReconcileInput, today = bankToday()) {
  assertBankAccess(actor, company);
  const value = reconcileSchema.parse(input), amount = cents(value.amount);
  const bank = data.bankTransactions.find((row) => row.company === company && row.id === value.transactionId);
  if (!bank || bank.updatedAt !== value.transactionUpdatedAt) throw new Error("銀行明細が更新されています。画面を更新してください");
  const problem = bankIssue(data, company, bank, today); if (problem) throw new Error(problem);
  if (bank.bookkeeping?.hold) throw new Error("保留中の明細です。確認事項を解決して保留を解除してから照合してください");
  const scopeIssue = invoiceAccountScopeIssue(data.bankAccounts.find((row) => row.id === bank.bankAccountId)!);
  if (scopeIssue) throw new Error(scopeIssue);
  if (bank.side !== (value.invoiceKind === "issued" ? "INCOME" : "EXPENSE")) throw new Error("請求書と入出金の方向が異なります");
  const links = activeLinks(data, company), bankLinks = links.filter((row) => row.transactionId === bank.id);
  if (bankLinks.some((row) => reconciliationIssue(data, row, today))) throw new Error("この明細には要再確認の照合があります。先に解除して見直してください");
  const fee = value.fee ? cents(value.fee.amount) : 0, borneBy = value.invoiceKind === "issued" ? "payer" as const : "bank" as const;
  if (fee && value.mode !== "new") throw new Error("手数料差額の処理は新しい支払記録でのみ使えます");
  const feeCategory = value.fee?.categoryId ? data.accountingCategories.find((row) => row.id === value.fee!.categoryId && row.company === company && !row.parentId && row.available && !row.deletedAt && (!row.officeCode || row.officeCode === bank.officeCode)) : undefined;
  if (value.fee?.categoryId && !feeCategory) throw new Error("手数料の科目が見つかりません");
  if (amount + (borneBy === "bank" ? fee : 0) > cents(bank.amount) - bankLinks.reduce((total, row) => total + linkBankCents(row), 0)) throw new Error(fee && borneBy === "bank" ? "手数料を含めると銀行明細の未照合額を超えています" : "銀行明細の未照合額を超えています");
  const { invoice } = targetInvoice(data, company, value.invoiceKind, value.invoiceId);
  if (links.some((row) => row.invoiceKind === value.invoiceKind && row.invoiceId === value.invoiceId && reconciliationIssue(data, row, today))) throw new Error("この請求書には要再確認の照合があります。先に解除して見直してください");
  if (!eligibleInvoice(value.invoiceKind, invoice)) throw new Error("下書き・保留などの請求書は先に金額と状態を確定してください");
  if (invoice.updatedAt !== value.invoiceUpdatedAt) throw new Error("請求書が更新されています。画面を更新してください");
  let payment: Payment;
  if (value.mode === "existing") {
    const found = data.payments.find((row) => row.id === value.paymentId);
    if (!found || !paymentMatches(found, value.invoiceKind, invoice.id) || found.updatedAt !== value.paymentUpdatedAt || !monetary(found.amount)) throw new Error("入金・支払い記録が更新されています");
    if (!isBankDate(found.paymentDate) || found.paymentDate > today) throw new Error("将来日・不正な日付の支払い記録は実際の銀行照合に使用できません");
    const reserved = links.filter((row) => row.paymentId === found.id).reduce((total, row) => total + linkPaymentCents(row), 0);
    if (amount > cents(found.amount) - reserved) throw new Error("既存の支払い記録はすでに照合済みです");
    payment = found;
  } else {
    const recorded = data.payments.filter((row) => paymentMatches(row, value.invoiceKind, invoice.id));
    const paid = recorded.reduce((total, row) => total + cents(row.amount), 0);
    if (amount + (borneBy === "payer" ? fee : 0) > cents(invoice.total) - paid) throw new Error(fee && borneBy === "payer" ? "手数料を含めた記録額が未入金額を超えています。差額と請求額を確認してください" : "未入金・未払い額を超えています。登録済みの支払いがある場合は既存記録に紐づけてください");
    const possibleDuplicate = invoice.status === "PAID" || recorded.some((payment) =>
      cents(payment.amount) > links.filter((link) => link.paymentId === payment.id).reduce((sum, link) => sum + linkPaymentCents(link), 0) ||
      (payment.paymentDate === bank.transactionDate && cents(payment.amount) === amount));
    if (possibleDuplicate && !value.duplicateAcknowledged) throw new Error("支払い済み・未照合の記録があります。既存記録との照合、または別の実際の支払いであることを確認してください");
    const timestamp = new Date().toISOString();
    payment = { id: crypto.randomUUID(), source: "BANK_RECONCILIATION", type: bank.side,
      ...(value.invoiceKind === "issued" ? { issuedInvoiceId: invoice.id } : { receivedInvoiceId: invoice.id }),
      amount: borneBy === "payer" && fee ? (amount + fee) / 100 : value.amount, ...(borneBy === "payer" && fee ? { feeAmount: value.fee!.amount, feeCategoryId: feeCategory?.id } : {}),
      paymentDate: bank.transactionDate, method: fee ? "銀行明細照合（手数料差額処理）" : "銀行明細照合", memo: value.note,
      createdById: actor.id, createdAt: timestamp, updatedAt: timestamp };
  }
  // Validate everything before altering payment totals or linked mail status.
  if (value.mode === "new") data.payments.unshift(payment);
  updatePaymentStatus(data, value.invoiceKind, invoice);
  const timestamp = new Date().toISOString();
  const link: BankReconciliation = { id: crypto.randomUUID(), company, transactionId: bank.id, invoiceKind: value.invoiceKind, invoiceId: invoice.id, paymentId: payment.id, amount: value.amount,
    createdPayment: value.mode === "new", bankEvidence: bankEvidence(bank), invoiceEvidence: invoiceEvidence(value.invoiceKind, invoice), paymentEvidence: paymentEvidence(payment),
    note: value.note, ...(value.fee ? { fee: { amount: value.fee.amount, categoryId: feeCategory?.id, borneBy } } : {}), confirmedById: actor.id, createdAt: timestamp, updatedAt: timestamp };
  data.bankReconciliations ||= [];
  data.bankReconciliations.unshift(link);
  const feeNote = fee && borneBy === "bank" ? applyFeeSplit(data, bank, value.fee!.amount, feeCategory?.id) : "";
  return { id: link.id, paymentId: payment.id, createdPayment: link.createdPayment, ...(fee ? { fee: { amount: value.fee!.amount, borneBy, note: feeNote } } : {}) };
}

export const reconciliationBatchSchema = z.object({
  transactionId: z.string().min(1).max(1000), transactionUpdatedAt: z.string(),
  acknowledged: z.literal(true),
  allocations: z.array(reconcileSchema.omit({ transactionId: true, transactionUpdatedAt: true, acknowledged: true })).min(1).max(100),
});
export type ReconciliationBatchInput = z.input<typeof reconciliationBatchSchema>;

export function confirmBankReconciliationBatch(data: AppData, actor: Pick<User, "id" | "role">, company: CompanyScope, input: ReconciliationBatchInput, today = bankToday()) {
  assertBankAccess(actor, company);
  const value = reconciliationBatchSchema.parse(input);
  const keys = new Set<string>();
  for (const row of value.allocations) {
    const key = `${row.invoiceKind}:${row.invoiceId}:${row.mode === "new" ? "new" : row.paymentId}`;
    if (keys.has(key)) throw new Error("同じ請求書の新規支払い・既存記録が重複しています。1行にまとめてください");
    keys.add(key);
    const { invoice } = targetInvoice(data, company, row.invoiceKind, row.invoiceId);
    if (invoice.updatedAt !== row.invoiceUpdatedAt) throw new Error("請求書が更新されています。画面を更新してください");
  }
  // Publish nothing until every allocation passes, including mail/status side effects.
  const draft = structuredClone(data);
  const bankRow = draft.bankTransactions.find((row) => row.id === value.transactionId && row.company === company);
  if (!bankRow || bankRow.updatedAt !== value.transactionUpdatedAt) throw new Error("銀行明細が更新されています。画面を更新してください");
  if (value.allocations.filter((row) => row.fee).length > 1) throw new Error("手数料差額の処理は1件の配賦にだけ付けられます");
  // A bank-borne fee may split the bank row (bumping its version), so later allocations read the current version.
  const results = value.allocations.map((row) => confirmBankReconciliation(draft, actor, company, {
    ...row, transactionId: value.transactionId, transactionUpdatedAt: bankRow.updatedAt, acknowledged: true,
    invoiceUpdatedAt: targetInvoice(draft, company, row.invoiceKind, row.invoiceId).invoice.updatedAt,
  }, today));
  data.bankTransactions = draft.bankTransactions;
  data.payments = draft.payments;
  data.bankReconciliations = draft.bankReconciliations;
  data.issuedInvoices = draft.issuedInvoices;
  data.receivedInvoices = draft.receivedInvoices;
  data.mailDocuments = draft.mailDocuments;
  return { allocations: results, amount: value.allocations.reduce((sum, row) => sum + cents(row.amount), 0) / 100 };
}

const aliasSchema = z.object({ transactionId: z.string().min(1), transactionUpdatedAt: z.string(), invoiceKind: z.enum(["issued", "received"]), invoiceId: z.string().min(1), invoiceUpdatedAt: z.string(), acknowledged: z.literal(true), removeId: z.string().optional() });
export type ReconciliationAliasInput = z.input<typeof aliasSchema>;
export function saveReconciliationAlias(data: AppData, actor: Pick<User, "id" | "role">, company: CompanyScope, input: ReconciliationAliasInput) {
  assertBankAccess(actor, company);
  const value = aliasSchema.parse(input);
  const bank = data.bankTransactions.find((row) => row.id === value.transactionId && row.company === company);
  const account = bank && data.bankAccounts.find((row) => row.id === bank.bankAccountId && row.company === company && row.officeCode === bank.officeCode);
  if (!bank || !account || bank.sourceMissing || bank.updatedAt !== value.transactionUpdatedAt) throw new Error("銀行明細が更新されています");
  if (bank.side !== (value.invoiceKind === "issued" ? "INCOME" : "EXPENSE")) throw new Error("取引先と明細の方向が異なります");
  const { invoice } = targetInvoice(data, company, value.invoiceKind, value.invoiceId);
  if (invoice.updatedAt !== value.invoiceUpdatedAt) throw new Error("請求書が更新されています");
  const parties = value.invoiceKind === "issued" ? data.clients : data.vendors;
  const partyId = value.invoiceKind === "issued" ? (invoice as IssuedInvoice).clientId : (invoice as ReceivedInvoice).vendorId;
  const party = parties.find((row) => row.id === partyId && !row.deletedAt && partnerMatchesCompany(row, company));
  if (!party) throw new Error("取引先が見つかりません");
  if (value.removeId) {
    const alias = party.bankAliases?.find((row) => row.id === value.removeId && row.company === company && row.accountId === bank.bankAccountId);
    if (!alias) throw new Error("名義の対応が更新されています");
    party.bankAliases = party.bankAliases!.filter((row) => row.id !== alias.id);
  } else {
    const content = normalizeReconciliationName(bank.content);
    if (content.length < 4 || /^(振込|振替|入金|出金|送金|振込入金|振込出金)$/.test(content)) throw new Error("取引先を識別できる名義を確認してください");
    const conflictingHistory = activeLinks(data, company).some((link) => {
      if (link.invoiceKind !== value.invoiceKind || reconciliationIssue(data, link)) return false;
      const source = data.bankTransactions.find((row) => row.id === link.transactionId);
      if (!source || source.bankAccountId !== bank.bankAccountId || source.side !== bank.side || normalizeReconciliationName(source.content) !== content) return false;
      const target = targetInvoice(data, company, link.invoiceKind, link.invoiceId).invoice;
      return (link.invoiceKind === "issued" ? (target as IssuedInvoice).clientId : (target as ReceivedInvoice).vendorId) !== party.id;
    });
    if (conflictingHistory) throw new Error("この口座・名義の確定済み照合は別の取引先です。既存の照合を確認してください");
    if (parties.some((row) => !row.deletedAt && row.id !== party.id && partnerMatchesCompany(row, company) && row.bankAliases?.some((alias) => alias.company === company && alias.accountId === bank.bankAccountId && alias.content === content))) throw new Error("この口座・名義は別の取引先に登録されています。既存の対応を確認してください");
    if (!party.bankAliases?.some((row) => row.company === company && row.accountId === bank.bankAccountId && row.content === content)) {
      party.bankAliases = [...(party.bankAliases || []), { id: crypto.randomUUID(), company, accountId: bank.bankAccountId, content, confirmedById: actor.id, createdAt: new Date().toISOString() }];
    }
  }
  party.updatedAt = stamp(party.updatedAt);
  return { partyId: party.id, bankAliases: (party.bankAliases || []).filter((row) => row.company === company && row.accountId === bank.bankAccountId) };
}

const installmentSchema = z.object({ invoiceId: z.string().min(1), invoiceUpdatedAt: z.string(),
  installments: z.array(z.object({ id: z.string().min(1).max(100), dueDate: z.string().refine(isBankDate), amount: z.number().refine(monetary), note: z.string().trim().max(500).optional() })).max(100),
});
export type ReconciliationInstallmentsInput = z.input<typeof installmentSchema>;
export function saveReconciliationInstallments(data: AppData, actor: Pick<User, "id" | "role">, company: CompanyScope, input: ReconciliationInstallmentsInput) {
  assertBankAccess(actor, company);
  const value = installmentSchema.parse(input);
  const { invoice } = targetInvoice(data, company, "issued", value.invoiceId);
  if (invoice.updatedAt !== value.invoiceUpdatedAt) throw new Error("請求書が更新されています。画面を更新してください");
  if (!eligibleInvoice("issued", invoice)) throw new Error("先に請求書の金額・状態を確定してください");
  if (new Set(value.installments.map((row) => row.id)).size !== value.installments.length) throw new Error("予定行が重複しています");
  if (value.installments.reduce((sum, row) => sum + cents(row.amount), 0) > cents(invoice.total)) throw new Error("分割予定の合計が請求額を超えています");
  (invoice as IssuedInvoice).installmentSchedule = value.installments.toSorted((a, b) => a.dueDate.localeCompare(b.dueDate));
  invoice.updatedAt = stamp(invoice.updatedAt);
  return { invoiceId: invoice.id, count: value.installments.length };
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

// Empty string means the current bank row, invoice and payment still support the link, so its evidence can be re-recorded.
export function reconciliationReaffirmBlocker(data: AppData, link: BankReconciliation, today = bankToday(), index?: ReconciliationIndex) {
  const bank = index ? index.banks.get(link.transactionId) : data.bankTransactions.find((row) => row.id === link.transactionId);
  if (!bank || bank.company !== link.company) return "銀行明細が見つかりません";
  const bankProblem = bankIssue(data, link.company, bank, today, index);
  if (bankProblem) return bankProblem;
  let invoice: IssuedInvoice | ReceivedInvoice;
  try { invoice = targetInvoice(data, link.company, link.invoiceKind, link.invoiceId, index).invoice; } catch { return "請求書が削除・移動されています"; }
  if (!eligibleInvoice(link.invoiceKind, invoice)) return "下書き・保留などの請求書は先に金額と状態を確定してください";
  const payment = index ? index.payments.get(link.paymentId) : data.payments.find((row) => row.id === link.paymentId);
  if (!payment || !paymentMatches(payment, link.invoiceKind, link.invoiceId) || !monetary(payment.amount)) return "入金・支払い記録が見つかりません";
  if (bank.side !== payment.type) return "入出金の方向が一致しません";
  if (!isBankDate(payment.paymentDate) || payment.paymentDate > today) return "将来日・不正な日付の支払い記録は実際の銀行照合に使用できません";
  if (!monetary(link.amount)) return "照合額が不正です";
  const others = activeLinks(data, link.company).filter((row) => row.id !== link.id);
  if (linkBankCents(link) > cents(bank.amount) - others.filter((row) => row.transactionId === bank.id).reduce((total, row) => total + linkBankCents(row), 0)) return "銀行明細の金額が照合額を下回ります";
  if (linkPaymentCents(link) > cents(payment.amount) - others.filter((row) => row.paymentId === payment.id).reduce((total, row) => total + linkPaymentCents(row), 0)) return "入金・支払い記録の金額が照合額を下回ります";
  return "";
}

function reaffirmLink(data: AppData, actor: Pick<User, "id" | "role">, link: BankReconciliation, today: string) {
  const issue = reconciliationIssue(data, link, today);
  if (!issue) throw new Error("この照合は要再確認ではありません");
  const blocker = reconciliationReaffirmBlocker(data, link, today);
  if (blocker) throw new Error(blocker);
  const bank = data.bankTransactions.find((row) => row.id === link.transactionId)!;
  const { invoice } = targetInvoice(data, link.company, link.invoiceKind, link.invoiceId);
  const payment = data.payments.find((row) => row.id === link.paymentId)!;
  // Re-record the evidence only. Payments and document statuses stay as they are; "状態を揃える" remains the explicit status repair.
  Object.assign(link, { bankEvidence: bankEvidence(bank), invoiceEvidence: invoiceEvidence(link.invoiceKind, invoice), paymentEvidence: paymentEvidence(payment),
    reaffirmedAt: new Date().toISOString(), reaffirmedById: actor.id, reaffirmedIssue: issue, updatedAt: stamp(link.updatedAt) });
  return { id: link.id, issue };
}

export function reaffirmBankReconciliation(data: AppData, actor: Pick<User, "id" | "role">, company: CompanyScope, id: string, updatedAt: string, today = bankToday()) {
  assertBankAccess(actor, company);
  const link = activeLinks(data, company).find((row) => row.id === id);
  if (!link || link.updatedAt !== updatedAt) throw new Error("照合記録が更新されています");
  return reaffirmLink(data, actor, link, today);
}

export function reaffirmInvoiceReconciliations(data: AppData, actor: Pick<User, "id" | "role">, company: CompanyScope, kind: Kind, id: string, updatedAt: string, today = bankToday()) {
  assertBankAccess(actor, company);
  if (!["issued", "received"].includes(kind)) throw new Error("書類の種類が不正です");
  const { invoice } = targetInvoice(data, company, kind, id);
  if (invoice.updatedAt !== updatedAt) throw new Error("請求書が更新されています。画面を更新してください");
  const links = activeLinks(data, company).filter((row) => row.invoiceKind === kind && row.invoiceId === id && reconciliationIssue(data, row, today));
  if (!links.length) throw new Error("この請求書に要再確認の照合はありません");
  // All or nothing: one unsupported link means the document still needs a decision, so nothing is re-recorded.
  const blocked = links.map((row) => reconciliationReaffirmBlocker(data, row, today)).filter(Boolean);
  if (blocked.length) throw new Error(`維持できない照合があります: ${[...new Set(blocked)].join(" / ")}`);
  const results = links.map((row) => reaffirmLink(data, actor, row, today));
  return { count: results.length, issues: results.map((row) => row.issue) };
}

export function bankReconciliationOverview(data: AppData, company: CompanyScope, today = bankToday()) {
  const index = reconciliationIndex(data);
  const links = activeLinks(data, company);
  const issues = new Map(links.map((row) => [row.id, reconciliationIssue(data, row, today, index)]));
  const blockers = new Map(links.filter((row) => issues.get(row.id)).map((row) => [row.id, reconciliationReaffirmBlocker(data, row, today, index)]));
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
  const validInvoice = new Map<string, number>(), reaffirmableInvoice = new Map<string, number>();
  const conflictBank = new Set<string>(), conflictInvoice = new Set<string>();
  for (const link of links) {
    const key = `${link.invoiceKind}:${link.invoiceId}`;
    linkedBank.set(link.transactionId, (linkedBank.get(link.transactionId) || 0) + linkBankCents(link));
    linkedPayment.set(link.paymentId, (linkedPayment.get(link.paymentId) || 0) + linkPaymentCents(link));
    if (issues.get(link.id)) {
      conflictBank.add(link.transactionId); conflictInvoice.add(key);
      if (!blockers.get(link.id)) reaffirmableInvoice.set(key, (reaffirmableInvoice.get(key) || 0) + 1);
    } else validInvoice.set(key, (validInvoice.get(key) || 0) + linkPaymentCents(link));
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
      bankAliases: (party?.bankAliases || []).filter((row) => row.company === company),
      installmentSchedule: kind === "issued" ? (invoice as IssuedInvoice).installmentSchedule || [] : [],
      processed: kind === "received" ? Boolean((invoice as ReceivedInvoice).mailProcessed) : undefined,
      originalHref: invoice.fileUrl || (kind === "issued" ? `/api/issued-invoices/${encodeURIComponent(invoice.id)}/pdf` : ""),
      project: project.name, total: invoice.total, date: invoice.issueDate, dueDate: invoice.dueDate,
      paid: paid / 100, outstanding: Math.max(0, cents(invoice.total) - paid) / 100, matched: matched / 100, unmatched: Math.max(0, cents(invoice.total) - matched) / 100,
      recordedUnmatched: Math.max(0, paid - matched) / 100, overpaid: Math.max(0, paid - cents(invoice.total)) / 100,
      eligible, needsReview: kind === "issued" && Boolean((invoice as IssuedInvoice).needsReview), conflict: conflictInvoice.has(key), reaffirmable: reaffirmableInvoice.get(key) || 0, stateMismatch,
      ...withholdingInfo(kind, invoice),
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
    const issue = sourceIssue || (row.bookkeeping?.hold ? "保留中の明細です。確認事項を解決して保留を解除してから照合してください" : "") || scopeIssue;
    // A new matching scope must not invalidate previously confirmed payment evidence.
    const matched = !sourceIssue && allocated > 0 && cents(allocated) >= cents(row.amount);
    const transfer = (data.bankTransfers || []).find((link) => link.company === company && !link.deletedAt && [link.outgoingId, link.incomingId].includes(row.id));
    const counterpart = transfer && index.banks.get(transfer.outgoingId === row.id ? transfer.incomingId : transfer.outgoingId);
    const transferCounterpart = counterpart?.company === company ? { id: counterpart.id, date: counterpart.transactionDate, content: counterpart.content, amount: counterpart.amount, account: index.accounts.get(counterpart.bankAccountId)?.name || "" } : undefined;
    const settlement = bankCardSettlementDetail(data, row);
    return { id: row.id, updatedAt: row.updatedAt, accountId: row.bankAccountId, date: row.transactionDate, side: row.side, content: row.content, amount: row.amount,
      invoiceRequirement: row.bookkeeping?.invoiceRequirement || "UNDECIDED", transferCounterpart, settlement,
      remaining: Math.max(0, cents(row.amount) - cents(allocated)) / 100, allocated, issue, conflict: conflictBank.has(row.id),
      state: conflictBank.has(row.id) ? "conflict" : matched ? "matched" : row.treatment === "NORMAL" && !row.sourceMissing && row.bookkeeping?.invoiceRequirement === "NOT_REQUIRED" ? "not_required" : issue ? "excluded" : "unmatched" };
  });
  return { banks, invoices, unlinkedMailCount, links: links.map((row) => ({ id: row.id, updatedAt: row.updatedAt, transactionId: row.transactionId, invoiceKey: `${row.invoiceKind}:${row.invoiceId}`, amount: row.amount, createdPayment: row.createdPayment,
    fee: row.fee, issue: issues.get(row.id) || "", reaffirmable: Boolean(issues.get(row.id)) && !blockers.get(row.id), reaffirmBlocker: blockers.get(row.id) || "", reaffirmedAt: row.reaffirmedAt, note: row.note, createdAt: row.createdAt })) };
}
export type ReconciliationOverview = ReturnType<typeof bankReconciliationOverview>;
export type ReconciliationInvoice = ReconciliationOverview["invoices"][number];
export type ReconciliationBank = ReconciliationOverview["banks"][number];
