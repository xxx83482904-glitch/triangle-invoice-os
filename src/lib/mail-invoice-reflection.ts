import { companyFromParam } from "@/lib/company";
import { can, assertCompanyAccess } from "@/lib/rbac";
import { receivedAmountsFromForm, validateReceivedDates } from "@/lib/received-invoice-review";
import { assertReceivedPaidAllowed } from "@/lib/payment-records";
import { resolveMailLink } from "@/lib/mail-links";
import type { AppData, ReceivedInvoice, ReceivedInvoiceStatus, User } from "@/lib/types";

export function reflectMailInvoice(data: AppData, actor: Pick<User, "id" | "role">, form: FormData, now = new Date().toISOString()) {
  assertCompanyAccess(actor, "JAPAN");
  if (!can(actor, "manage:mailSorter") && !can(actor, "manage:receivedInvoices") && !can(actor, "upload:receivedInvoices")) throw new Error("権限がありません。");
  const field = (name: string) => String(form.get(name) ?? "").trim();
  const mail = data.mailDocuments.find((row) => row.id === field("mailDocumentId") && !row.deletedAt && companyFromParam(row.company) === "JAPAN");
  if (!mail) throw new Error("郵便物が見つかりません。");
  if (!field("mailUpdatedAt") || mail.updatedAt !== field("mailUpdatedAt")) throw new Error("郵便物が更新されています。再読み込みして確認してください。");
  const linked = resolveMailLink(data, "JAPAN", mail).invoice;
  if (linked) throw new Error("受領請求書と連携済みです。再読み込みして確認してください。");
  if (!field("vendorId")) throw new Error("支払先を選択してください。");
  if (!field("projectId")) throw new Error("案件を選択してください。");
  const vendor = data.vendors.find((row) => row.id === field("vendorId") && !row.deletedAt && companyFromParam(row.company) === "JAPAN");
  const project = data.projects.find((row) => row.id === field("projectId") && !row.deletedAt && companyFromParam(row.company) === "JAPAN");
  if (!vendor || !project) throw new Error("支払先と案件を確認してください。");
  const issueDate = field("issueDate"), dueDate = field("dueDate");
  validateReceivedDates(issueDate, dueDate);
  const amountForm = new FormData();
  // Preserve the existing partial-save rule: an unknown amount may be stored as zero, dates may stay empty.
  amountForm.set("total", field("total") || "0");
  const amounts = receivedAmountsFromForm(amountForm);
  const status = (field("status") || "REVIEWING") as ReceivedInvoiceStatus;
  if (!["RECEIVED", "OCR_PENDING", "REVIEWING", "APPROVAL_PENDING", "SCHEDULED", "PAID", "ON_HOLD", "REJECTED", "ARCHIVED"].includes(status)) throw new Error("状態を確認してください。");
  const timestamp = new Date(Math.max(Date.parse(now), Date.parse(mail.updatedAt) + 1)).toISOString();
  const invoice: ReceivedInvoice = { id: crypto.randomUUID(), vendorId: vendor.id, projectId: project.id, folderMonth: mail.folderMonth, receivedDate: now.slice(0, 10),
    issueDate, dueDate, ...amounts, status, fileUrl: mail.fileUrl, originalFileName: mail.originalFileName, mimeType: mail.mimeType, ocrText: mail.ocrText,
    memo: field("memo") || mail.memo, uploadedById: mail.uploadedById || actor.id, createdAt: timestamp, updatedAt: timestamp };
  if (status === "PAID") assertReceivedPaidAllowed(data, invoice);
  // All validation precedes mutation. In particular, payment and manual processing flags remain untouched.
  if (mail.category !== "INVOICE" && mail.category !== "RECEIPT") mail.category = "INVOICE";
  mail.relatedReceivedInvoiceId = invoice.id; mail.memo = invoice.memo; mail.updatedAt = timestamp;
  data.receivedInvoices.unshift(invoice);
  data.attachments.unshift({ id: crypto.randomUUID(), relatedType: "ReceivedInvoice", relatedId: invoice.id, fileUrl: mail.fileUrl,
    fileName: mail.originalFileName, mimeType: mail.mimeType, uploadedById: actor.id, createdAt: timestamp });
  return { invoiceId: invoice.id };
}
