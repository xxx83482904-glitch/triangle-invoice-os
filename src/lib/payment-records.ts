import { z } from "zod";
import { bankToday, isBankDate } from "@/lib/banking";
import { reconciliationIssue, syncInvoicePaymentState, linkPaymentCents } from "@/lib/bank-reconciliation";
import { companyFromParam, type CompanyScope } from "@/lib/company";
import { isBillableIssuedInvoice, visibleProjects } from "@/lib/documents";
import { assertCan, assertCompanyAccess } from "@/lib/rbac";
import type { AppData, IssuedInvoice, Payment, PaymentHistoryEntry, ReceivedInvoice, User } from "@/lib/types";

type Actor = Pick<User, "id" | "role">;
export type PaymentKind = "issued" | "received";
const cents = (value: number) => Math.round(value * 100);
const monetary = (value: number) => Number.isFinite(value) && value > 0 && value <= 1e12 && Math.abs(value * 100 - cents(value)) < 0.001;
const stamp = (previous?: string) => new Date(Math.max(Date.now(), previous ? Date.parse(previous) + 1 : 0)).toISOString();
const reason = z.string().trim().max(500);

export const paymentOriginLabels = {
  BANK_RECONCILIATION: "銀行照合", MANUAL: "手入力", INVOICE_STATUS: "状態変更（発行請求書）", LEGACY_STATUS: "旧ステータス変更（自動作成）", LEGACY_MANUAL: "手入力（旧）",
} as const;
export type PaymentOrigin = keyof typeof paymentOriginLabels;
export const historyKindLabels: Record<PaymentHistoryEntry["kind"], string> = { RECORDED: "登録", ADJUSTED: "金額・日付の修正", CANCELED: "取消" };

// Rows created by the retired "status → PAID" flow carry no source; they are recognized by their fixed method/memo.
export const isLegacyStatusPayment = (payment: Payment) => !payment.source && (payment.method === "ステータス変更" || (payment.memo || "").startsWith("ステータス変更で支払済み"));
export function paymentOrigin(payment: Payment): PaymentOrigin {
  if (payment.source === "BANK_RECONCILIATION" || payment.source === "MANUAL" || payment.source === "INVOICE_STATUS") return payment.source;
  return isLegacyStatusPayment(payment) ? "LEGACY_STATUS" : "LEGACY_MANUAL";
}

const matches = (payment: Payment, kind: PaymentKind, invoiceId: string) => payment.type === (kind === "issued" ? "INCOME" : "EXPENSE")
  && (kind === "issued" ? payment.issuedInvoiceId === invoiceId && !payment.receivedInvoiceId : payment.receivedInvoiceId === invoiceId && !payment.issuedInvoiceId);
export const activePaymentsFor = (data: AppData, kind: PaymentKind, invoiceId: string) => data.payments.filter((payment) => !payment.deletedAt && matches(payment, kind, invoiceId));

// "支払済み" is derived from payment records; the stored status is compared against them.
export function receivedPaymentSummary(data: AppData, invoice: ReceivedInvoice) {
  const payments = activePaymentsFor(data, "received", invoice.id);
  const paid = payments.reduce((total, payment) => total + cents(payment.amount), 0);
  const complete = invoice.total > 0 && paid >= cents(invoice.total);
  return {
    paid: paid / 100, complete, outstanding: Math.max(0, cents(invoice.total) - paid) / 100, overpaid: Math.max(0, paid - cents(invoice.total)) / 100,
    status: (complete ? "PAID" : invoice.status === "PAID" ? "SCHEDULED" : invoice.status) as ReceivedInvoice["status"],
    statusMismatch: (invoice.status === "PAID") !== complete, paidAt: complete ? payments.map((payment) => payment.paymentDate).sort().at(-1) : undefined,
  };
}

export function assertReceivedPaidAllowed(data: AppData, invoice: ReceivedInvoice) {
  const summary = receivedPaymentSummary(data, invoice);
  if (!summary.complete) throw new Error(`支払済みにするには支払記録の登録か銀行照合が必要です（未払い ${summary.outstanding.toLocaleString("ja-JP")}円）。詳細の「支払記録」から登録できます。`);
  return summary;
}

function targetInvoice(data: AppData, actor: Actor, company: CompanyScope, kind: PaymentKind, invoiceId: string) {
  assertCompanyAccess(actor, company);
  assertCan(actor, kind === "issued" ? "manage:incomePayments" : "manage:expensePayments");
  const invoice = kind === "issued" ? data.issuedInvoices.find((row) => row.id === invoiceId && !row.deletedAt) : data.receivedInvoices.find((row) => row.id === invoiceId && !row.deletedAt);
  const project = invoice && visibleProjects(data, actor).find((row) => row.id === invoice.projectId && companyFromParam(row.company) === company);
  if (!invoice || !project) throw new Error("対象の請求書が見つかりません");
  if (kind === "issued" && !isBillableIssuedInvoice(invoice as IssuedInvoice)) throw new Error("金額のある発行済みの請求書を選択してください");
  return { invoice, project };
}

function linkedAmount(data: AppData, paymentId: string) {
  return (data.bankReconciliations || []).filter((link) => !link.deletedAt && link.paymentId === paymentId).reduce((total, link) => total + cents(link.amount), 0) / 100;
}

function paymentFor(data: AppData, actor: Actor, company: CompanyScope, paymentId: string, updatedAt: string) {
  const payment = data.payments.find((row) => row.id === paymentId && !row.deletedAt);
  if (!payment || payment.updatedAt !== updatedAt) throw new Error("支払記録が更新されています。画面を更新してください");
  const kind: PaymentKind = payment.type === "INCOME" ? "issued" : "received";
  const invoiceId = kind === "issued" ? payment.issuedInvoiceId : payment.receivedInvoiceId;
  if (!invoiceId || !matches(payment, kind, invoiceId)) throw new Error("請求書に紐づかない支払記録です");
  const { invoice } = targetInvoice(data, actor, company, kind, invoiceId);
  if (linkedAmount(data, payment.id) > 0) throw new Error("銀行照合済みの支払記録です。先に銀行・書類照合で照合を解除してください");
  return { payment, kind, invoice };
}

const recordSchema = z.object({
  kind: z.enum(["issued", "received"]), invoiceId: z.string().min(1).max(1000), invoiceUpdatedAt: z.string().optional(),
  amount: z.number().refine(monetary, "金額は正の数で小数点以下2桁までにしてください"), paymentDate: z.string(),
  method: z.string().trim().max(100).default(""), memo: z.string().trim().max(1000).default(""), reason: reason.default(""),
});
export type RecordPaymentInput = z.input<typeof recordSchema>;

// Explicit manual entry is the only non-bank way a payment record comes into existence.
export function recordPayment(data: AppData, actor: Actor, company: CompanyScope, input: RecordPaymentInput, today = bankToday()) {
  const value = recordSchema.parse(input);
  const { invoice } = targetInvoice(data, actor, company, value.kind, value.invoiceId);
  if (value.invoiceUpdatedAt && invoice.updatedAt !== value.invoiceUpdatedAt) throw new Error("請求書が更新されています。画面を更新してください");
  if (!isBankDate(value.paymentDate) || value.paymentDate > today) throw new Error("支払日は今日以前の実在する日付にしてください");
  const paid = activePaymentsFor(data, value.kind, invoice.id).reduce((total, payment) => total + cents(payment.amount), 0);
  const outstanding = Math.max(0, cents(invoice.total) - paid);
  if (cents(value.amount) > outstanding) throw new Error(`未払い額（${(outstanding / 100).toLocaleString("ja-JP")}円）を超えています。請求額が違う場合は先に請求書の金額を訂正してください`);
  const timestamp = new Date().toISOString();
  const payment: Payment = { id: crypto.randomUUID(), source: "MANUAL", type: value.kind === "issued" ? "INCOME" : "EXPENSE",
    ...(value.kind === "issued" ? { issuedInvoiceId: invoice.id } : { receivedInvoiceId: invoice.id }),
    amount: value.amount, paymentDate: value.paymentDate, method: value.method || "手入力", memo: value.memo || undefined,
    history: [{ at: timestamp, byId: actor.id, kind: "RECORDED", reason: value.reason || undefined, after: { amount: value.amount, paymentDate: value.paymentDate } }],
    createdById: actor.id, createdAt: timestamp, updatedAt: timestamp };
  data.payments.unshift(payment);
  syncInvoicePaymentState(data, value.kind, invoice);
  return { id: payment.id, status: invoice.status };
}

const cancelSchema = z.object({ paymentId: z.string().min(1).max(1000), updatedAt: z.string(), reason: reason.min(1, "取消の理由を入力してください") });
export type CancelPaymentInput = z.input<typeof cancelSchema>;
export function cancelPayment(data: AppData, actor: Actor, company: CompanyScope, input: CancelPaymentInput) {
  const value = cancelSchema.parse(input);
  const { payment, kind, invoice } = paymentFor(data, actor, company, value.paymentId, value.updatedAt);
  const timestamp = new Date().toISOString();
  payment.history = [...(payment.history || []), { at: timestamp, byId: actor.id, kind: "CANCELED", reason: value.reason, before: { amount: payment.amount, paymentDate: payment.paymentDate } }];
  payment.deletedAt = timestamp; payment.updatedAt = stamp(payment.updatedAt);
  syncInvoicePaymentState(data, kind, invoice);
  return { id: payment.id, status: invoice.status };
}

const adjustSchema = z.object({ paymentId: z.string().min(1).max(1000), updatedAt: z.string(), amount: z.number().refine(monetary, "金額は正の数で小数点以下2桁までにしてください"), paymentDate: z.string(), reason: reason.min(1, "修正の理由を入力してください") });
export type AdjustPaymentInput = z.input<typeof adjustSchema>;
export function adjustPayment(data: AppData, actor: Actor, company: CompanyScope, input: AdjustPaymentInput, today = bankToday()) {
  const value = adjustSchema.parse(input);
  const { payment, kind, invoice } = paymentFor(data, actor, company, value.paymentId, value.updatedAt);
  if (!isBankDate(value.paymentDate) || value.paymentDate > today) throw new Error("支払日は今日以前の実在する日付にしてください");
  if (cents(value.amount) === cents(payment.amount) && value.paymentDate === payment.paymentDate) throw new Error("金額と日付に変更がありません");
  const others = activePaymentsFor(data, kind, invoice.id).filter((row) => row.id !== payment.id).reduce((total, row) => total + cents(row.amount), 0);
  if (others + cents(value.amount) > cents(invoice.total)) throw new Error(`支払記録の合計が請求額（${invoice.total.toLocaleString("ja-JP")}円）を超えます`);
  const timestamp = new Date().toISOString();
  payment.history = [...(payment.history || []), { at: timestamp, byId: actor.id, kind: "ADJUSTED", reason: value.reason, before: { amount: payment.amount, paymentDate: payment.paymentDate }, after: { amount: value.amount, paymentDate: value.paymentDate } }];
  payment.amount = value.amount; payment.paymentDate = value.paymentDate; payment.updatedAt = stamp(payment.updatedAt);
  syncInvoicePaymentState(data, kind, invoice);
  return { id: payment.id, status: invoice.status };
}

export type PaymentRecordView = {
  id: string; updatedAt: string; amount: number; feeAmount: number; paymentDate: string; method: string; memo: string; origin: PaymentOrigin; originLabel: string;
  linked: boolean; linkedAmount: number; linkIssue: string; canceled: boolean; canceledAt?: string; createdBy: string; createdAt: string;
  history: Array<{ at: string; by: string; kind: PaymentHistoryEntry["kind"]; kindLabel: string; reason: string; before?: { amount: number; paymentDate: string }; after?: { amount: number; paymentDate: string } }>;
};

// Read model for a document's payment records, including canceled rows so the trail stays visible.
export function paymentRecordsFor(data: AppData, company: CompanyScope, kind: PaymentKind, invoiceId: string, today = bankToday()): PaymentRecordView[] {
  const users = new Map(data.users.map((row) => [row.id, row.name]));
  const name = (id: string) => users.get(id) || (id.startsWith("migration:") ? "移行スクリプト" : "利用者");
  const links = (data.bankReconciliations || []).filter((link) => !link.deletedAt && link.company === company);
  return data.payments.filter((payment) => matches(payment, kind, invoiceId)).map((payment): PaymentRecordView => {
    const own = links.filter((link) => link.paymentId === payment.id);
    const origin = paymentOrigin(payment);
    return { id: payment.id, updatedAt: payment.updatedAt, amount: payment.amount, feeAmount: payment.feeAmount || 0, paymentDate: payment.paymentDate, method: payment.method || "", memo: payment.memo || "", origin, originLabel: paymentOriginLabels[origin],
      linked: own.length > 0, linkedAmount: own.reduce((total, link) => total + linkPaymentCents(link), 0) / 100, linkIssue: own.map((link) => reconciliationIssue(data, link, today)).find(Boolean) || "",
      canceled: Boolean(payment.deletedAt), canceledAt: payment.deletedAt || undefined, createdBy: name(payment.createdById), createdAt: payment.createdAt,
      history: (payment.history || []).map((entry) => ({ at: entry.at, by: name(entry.byId), kind: entry.kind, kindLabel: historyKindLabels[entry.kind], reason: entry.reason || "", before: entry.before, after: entry.after })) };
  }).sort((a, b) => Number(a.canceled) - Number(b.canceled) || b.paymentDate.localeCompare(a.paymentDate) || b.createdAt.localeCompare(a.createdAt));
}
