import "server-only";

import { assertBankAccess } from "@/lib/banking";
import { BANK_RECEIPT_TYPE } from "@/lib/banking-types";
import { BANK_RECEIPT_LIMIT, bankReceipts } from "@/lib/bank-receipts";
import { companyFromParam, type CompanyScope } from "@/lib/company";
import { assertCan } from "@/lib/rbac";
import type { AppData, Attachment, User } from "@/lib/types";

type Actor = Pick<User, "id" | "role">;

// A mail document linked to a bank row as evidence (a receipt, notice or contract behind a payment).
// It never moves money: amount reconciliation stays with invoices. The link is an Attachment on the bank row
// that points at the mail's own file, so the bank row's "領収書・証憑" list shows it next to uploads.
export const MAIL_SOURCE = "MailDocument" as const;

function liveMail(data: AppData, company: CompanyScope, id: string) {
  const mail = data.mailDocuments.find((row) => row.id === id && !row.deletedAt);
  if (!mail || companyFromParam(mail.company) !== company) throw new Error("郵便物が見つかりません。画面を更新してください");
  if (!mail.fileUrl) throw new Error("ファイルのない郵便物は紐づけできません");
  return mail;
}

export function mailBankLinks(data: AppData, company: CompanyScope, mailId: string): Attachment[] {
  const banks = new Set(data.bankTransactions.filter((row) => row.company === company).map((row) => row.id));
  return data.attachments.filter((row) => !row.deletedAt && row.relatedType === BANK_RECEIPT_TYPE && row.sourceType === MAIL_SOURCE && row.sourceId === mailId && banks.has(row.relatedId))
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function linkMailToBank(data: AppData, actor: Actor, company: CompanyScope, input: { transactionId: string; mailId: string }, id: string, now = new Date().toISOString()) {
  assertBankAccess(actor, company);
  assertCan(actor, "view:mailSorter");
  const transaction = data.bankTransactions.find((row) => row.id === input.transactionId && row.company === company);
  if (!transaction) throw new Error("口座明細が見つかりません。画面を更新してください");
  const mail = liveMail(data, company, input.mailId);
  if (mailBankLinks(data, company, mail.id).some((row) => row.relatedId === transaction.id)) throw new Error("この郵便物はすでにこの明細に紐づいています");
  if (bankReceipts(data, company, transaction.id).length >= BANK_RECEIPT_LIMIT) throw new Error(`1つの明細に添付・紐づけできるのは${BANK_RECEIPT_LIMIT}件までです`);
  const attachment: Attachment = { id, relatedType: BANK_RECEIPT_TYPE, relatedId: transaction.id, fileUrl: mail.fileUrl, fileName: mail.originalFileName || mail.title || "郵便物",
    mimeType: mail.mimeType || "application/octet-stream", uploadedById: actor.id, createdAt: now, sourceType: MAIL_SOURCE, sourceId: mail.id };
  data.attachments.unshift(attachment);
  return attachment;
}

// Mail that can still be linked to a bank row, newest first.
export function linkableMail(data: AppData, company: CompanyScope, transactionId: string, limit = 500) {
  const linked = new Set(data.attachments.filter((row) => !row.deletedAt && row.relatedType === BANK_RECEIPT_TYPE && row.relatedId === transactionId && row.sourceType === MAIL_SOURCE).map((row) => row.sourceId));
  return data.mailDocuments.filter((row) => !row.deletedAt && row.fileUrl && companyFromParam(row.company) === company && !linked.has(row.id))
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit)
    .map((row) => ({ id: row.id, title: row.title || row.originalFileName, senderName: row.senderName || "", category: row.category, createdAt: row.createdAt, folderMonth: row.folderMonth || "",
      fileName: row.originalFileName, relatedReceivedInvoiceId: row.relatedReceivedInvoiceId || "" }));
}
export type LinkableMail = ReturnType<typeof linkableMail>[number];
