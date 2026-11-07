import "server-only";

import { assertBankAccess } from "@/lib/banking";
import { BANK_RECEIPT_TYPE } from "@/lib/banking-types";
import type { CompanyScope } from "@/lib/company";
import { uploadedFileNameFromUrl } from "@/lib/files";
import type { AppData, Attachment, User } from "@/lib/types";

type Actor = Pick<User, "id" | "role">;

// Receipts and other evidence attached directly to a bank row (for payments that have no invoice).
export { BANK_RECEIPT_TYPE };
export const BANK_RECEIPT_LIMIT = 20;
export const bankReceiptMimeTypes = ["application/pdf", "image/jpeg", "image/png"] as const;

export type BankReceiptInput = { transactionId: string; fileUrl: string; fileName: string; mimeType: string };
export type BankReceiptView = { id: string; fileUrl: string; fileName: string; mimeType: string; createdAt: string; uploadedBy: string };

function transactionFor(data: AppData, company: CompanyScope, id: string) {
  const row = data.bankTransactions.find((item) => item.id === id && item.company === company);
  if (!row) throw new Error("口座明細が見つかりません。画面を更新してください");
  return row;
}

export function bankReceipts(data: AppData, company: CompanyScope, transactionId: string): Attachment[] {
  if (!data.bankTransactions.some((row) => row.id === transactionId && row.company === company)) return [];
  return data.attachments.filter((row) => !row.deletedAt && row.relatedType === BANK_RECEIPT_TYPE && row.relatedId === transactionId)
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function bankReceiptViews(data: AppData, company: CompanyScope, transactionId: string): BankReceiptView[] {
  const users = new Map(data.users.map((row) => [row.id, row.name]));
  return bankReceipts(data, company, transactionId).map((row) => ({ id: row.id, fileUrl: row.fileUrl, fileName: row.fileName, mimeType: row.mimeType,
    createdAt: row.createdAt, uploadedBy: users.get(row.uploadedById) || "" }));
}

// Validates everything that does not need the stored file, so the route can reject before writing bytes.
export function assertBankReceiptAllowed(data: AppData, actor: Actor, company: CompanyScope, input: Pick<BankReceiptInput, "transactionId" | "mimeType">) {
  assertBankAccess(actor, company);
  transactionFor(data, company, input.transactionId);
  if (!(bankReceiptMimeTypes as readonly string[]).includes(input.mimeType)) throw new Error("PDF、JPEG、PNGのみ添付できます");
  if (bankReceipts(data, company, input.transactionId).length >= BANK_RECEIPT_LIMIT) throw new Error(`1つの明細に添付できるのは${BANK_RECEIPT_LIMIT}件までです`);
}

export function addBankReceipt(data: AppData, actor: Actor, company: CompanyScope, input: BankReceiptInput, id: string, now = new Date().toISOString()) {
  assertBankReceiptAllowed(data, actor, company, input);
  const fileName = input.fileName.normalize("NFKC").replace(/[\\/\x00-\x1f]/g, "_").trim().slice(0, 200) || "領収書";
  const attachment: Attachment = { id, relatedType: BANK_RECEIPT_TYPE, relatedId: input.transactionId, fileUrl: input.fileUrl, fileName, mimeType: input.mimeType, uploadedById: actor.id, createdAt: now };
  data.attachments.unshift(attachment);
  return attachment;
}

// Soft delete keeps the file and the audit trail; the row simply stops being shown or served.
export function removeBankReceipt(data: AppData, actor: Actor, company: CompanyScope, id: string, now = new Date().toISOString()) {
  assertBankAccess(actor, company);
  const row = data.attachments.find((item) => item.id === id && item.relatedType === BANK_RECEIPT_TYPE && !item.deletedAt);
  if (!row) throw new Error("添付ファイルが見つかりません。画面を更新してください");
  transactionFor(data, company, row.relatedId);
  row.deletedAt = now;
  return { id, transactionId: row.relatedId };
}

export function canViewBankReceiptFile(data: AppData, user: Actor, name: string) {
  if (!name) return false;
  return data.attachments.some((row) => {
    if (row.deletedAt || row.relatedType !== BANK_RECEIPT_TYPE || uploadedFileNameFromUrl(row.fileUrl) !== name) return false;
    const transaction = data.bankTransactions.find((item) => item.id === row.relatedId);
    if (!transaction) return false;
    try { assertBankAccess(user, transaction.company); return true; } catch { return false; }
  });
}
