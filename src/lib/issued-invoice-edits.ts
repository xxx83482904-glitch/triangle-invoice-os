import { z } from "zod";
import { randomUUID } from "node:crypto";
import { companyFromParam, type CompanyScope } from "@/lib/company";
import { visibleProjects } from "@/lib/documents";
import { assertCan, assertCompanyAccess } from "@/lib/rbac";
import { invoicePaymentSummary } from "@/lib/invoice-status";
import type { AppData, User } from "@/lib/types";

const date = z.string().refine((s) => s === "" || (/^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s), "日付を確認してください");
const editSchema = z.object({
  id: z.string(), updatedAt: z.string(), invoiceNumber: z.string().trim().min(1).max(100),
  projectId: z.string().min(1), issueDate: date, dueDate: date, total: z.number().finite().nonnegative().max(1e12),
  status: z.enum(["DRAFT", "ISSUED", "SENT", "WAITING_PAYMENT", "PARTIALLY_PAID", "PAID", "OVERDUE", "CANCELED", "REISSUED"]),
  needsReview: z.boolean(),
  paymentDate: z.iso.date().optional(),
});
export type IssuedEdit = z.infer<typeof editSchema>;


export function applyIssuedInvoiceEdits(data: AppData, user: Pick<User, "id" | "role">, company: CompanyScope, input: IssuedEdit[]) {
  assertCan(user, "manage:issuedInvoices");
  assertCompanyAccess(user, company);
  const edits = z.array(editSchema).min(1).max(500).parse(input);
  // Validate and apply the whole batch in isolation, including payment additions/reversals.
  const draft = { ...data, issuedInvoices: data.issuedInvoices.map((i) => ({ ...i })), payments: data.payments.map((p) => ({ ...p })) };
  const projects = new Map(visibleProjects(data, user).filter((p) => companyFromParam(p.company) === company).map((p) => [p.id, p]));
  const timestamp = new Date(Math.max(Date.now(), ...edits.map((e) => (Date.parse(e.updatedAt) || 0) + 1))).toISOString();
  const seen = new Set<string>();
  for (const edit of edits) {
    if (seen.has(edit.id)) throw new Error("同じ書類が重複しています");
    seen.add(edit.id);
    const invoice = draft.issuedInvoices.find((i) => i.id === edit.id && !i.deletedAt && projects.has(i.projectId));
    const project = projects.get(edit.projectId);
    if (!invoice || !project) throw new Error("編集できない案件が含まれています");
    if (invoice.updatedAt !== edit.updatedAt) throw new Error("他の操作で更新されています。画面を再読込して確認してください");
    if (edit.status !== "DRAFT" && edit.status !== "CANCELED" && (!edit.issueDate || !edit.dueDate || !edit.total || edit.needsReview)) {
      throw new Error("原本確認・発行日・入金期限・金額を入力してから発行済みにしてください");
    }
    if (edit.issueDate && edit.dueDate && edit.dueDate < edit.issueDate) throw new Error("入金期限は発行日以降にしてください");
    if (!invoice.fileUrl && invoice.total !== edit.total) throw new Error("手作成の請求書は明細と金額が一致する必要があります");
    const originalPayment = invoicePaymentSummary(draft, invoice);
    if (originalPayment.paid > 0 && (invoice.total !== edit.total || invoice.projectId !== edit.projectId)) throw new Error("入金記録のある請求書の金額・案件は変更できません");
    if (edit.status === "WAITING_PAYMENT") {
      if (Math.round((originalPayment.paid - originalPayment.statusPaid) * 100) / 100 >= edit.total && originalPayment.paid > 0) throw new Error("別途登録された入金が全額あります。入金記録を確認してください");
      for (const payment of draft.payments) if (!payment.deletedAt && payment.type === "INCOME" && payment.issuedInvoiceId === invoice.id && payment.source === "INVOICE_STATUS") {
        payment.deletedAt = timestamp; payment.updatedAt = timestamp;
      }
    }
    let paid = invoicePaymentSummary(draft, invoice).paid;
    if (edit.status === "PAID" && paid < edit.total) {
      if (!edit.paymentDate) throw new Error("入金完了にする場合は入金日を入力してください");
      draft.payments.unshift({ id: randomUUID(), type: "INCOME", source: "INVOICE_STATUS", issuedInvoiceId: invoice.id,
        amount: Math.round((edit.total - paid) * 100) / 100, paymentDate: edit.paymentDate, memo: "請求書の入金完了操作から登録",
        createdById: user.id, createdAt: timestamp, updatedAt: timestamp });
      paid = invoicePaymentSummary(draft, invoice).paid;
    }
    if (paid > edit.total || (paid > 0 && ["DRAFT", "CANCELED"].includes(edit.status))) throw new Error("入金済みの金額・状態と矛盾しています");
    if (paid > 0 && !["PARTIALLY_PAID", "PAID", "WAITING_PAYMENT"].includes(edit.status)) throw new Error("入金記録があるため入金状態は変更できません");
    if (edit.status === "PARTIALLY_PAID" && (paid <= 0 || paid >= edit.total)) throw new Error("一部入金への変更は入金記録を確認してください");
    invoice.invoiceNumber = edit.invoiceNumber;
    if (edit.projectId !== invoice.projectId || invoice.fileUrl) invoice.clientId = project.clientId;
    invoice.projectId = edit.projectId;
    invoice.issueDate = edit.issueDate;
    invoice.dueDate = edit.dueDate;
    invoice.transactionDate = invoice.transactionDate || edit.issueDate;
    if (invoice.fileUrl) { invoice.total = edit.total; invoice.subtotal = edit.total; invoice.taxTotal = 0; }
    invoice.status = edit.status;
    const payment = invoicePaymentSummary(draft, invoice);
    invoice.status = payment.status; invoice.paidAt = payment.paidAt;
    invoice.needsReview = edit.needsReview;
    invoice.updatedAt = timestamp;
  }
  const numbers = new Set<string>();
  for (const invoice of draft.issuedInvoices.filter((i) => !i.deletedAt && data.projects.some((p) => p.id === i.projectId && companyFromParam(p.company) === company))) {
    if (numbers.has(invoice.invoiceNumber)) throw new Error("請求書番号が重複しています");
    numbers.add(invoice.invoiceNumber);
  }
  data.issuedInvoices = draft.issuedInvoices; data.payments = draft.payments;
  return { ids: [...seen] };
}
