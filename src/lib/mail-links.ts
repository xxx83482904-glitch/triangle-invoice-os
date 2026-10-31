import { z } from "zod";
import { companyFromParam, type CompanyScope } from "@/lib/company";
import { visibleProjects } from "@/lib/documents";
import { can, canAccessCompany } from "@/lib/rbac";
import type { AppData, MailDocument, ReceivedInvoice, User } from "@/lib/types";

type Actor = Pick<User, "id" | "role">;
const stamp = (previous?: string) => new Date(Math.max(Date.now(), previous ? Date.parse(previous) + 1 : 0)).toISOString();
const cents = (value: number) => Math.round(value * 100);
const normalize = (value?: string) => (value || "").normalize("NFKC").toLocaleLowerCase("ja").replace(/\s+/g, "");
export const canManageMailLinks = (actor: Actor) => can(actor, "manage:mailSorter") || can(actor, "manage:receivedInvoices") || can(actor, "upload:receivedInvoices");

// A link target must be a live received invoice on a live project of the same company.
export function activeReceivedInvoice(data: AppData, company: CompanyScope, id?: string) {
  const invoice = id ? data.receivedInvoices.find((row) => row.id === id && !row.deletedAt) : undefined;
  const project = invoice && data.projects.find((row) => row.id === invoice.projectId && !row.deletedAt && companyFromParam(row.company) === company);
  return invoice && project ? invoice : undefined;
}

export function resolveMailLink(data: AppData, company: CompanyScope, mail: MailDocument): { invoice?: ReceivedInvoice; broken: boolean; targetId?: string } {
  if (!mail.relatedReceivedInvoiceId) return { broken: false };
  const invoice = activeReceivedInvoice(data, company, mail.relatedReceivedInvoiceId);
  return { invoice, broken: !invoice, targetId: mail.relatedReceivedInvoiceId };
}

// Deleting a received invoice returns its mail documents to "未連携" instead of leaving a dangling reference.
export function unlinkMailDocumentsForInvoice(data: AppData, invoiceId: string) {
  let count = 0;
  for (const mail of data.mailDocuments) {
    if (mail.deletedAt || mail.relatedReceivedInvoiceId !== invoiceId) continue;
    mail.relatedReceivedInvoiceId = undefined; mail.mailProcessed = false; mail.updatedAt = stamp(mail.updatedAt); count++;
  }
  return count;
}

export type MailLinkCandidate = { id: string; score: number; reasons: string[] };
export function mailLinkCandidates(data: AppData, company: CompanyScope, mail: MailDocument, limit = 5): MailLinkCandidate[] {
  const linkedElsewhere = new Set(data.mailDocuments.filter((row) => !row.deletedAt && row.id !== mail.id && row.relatedReceivedInvoiceId).map((row) => row.relatedReceivedInvoiceId));
  const vendors = new Map(data.vendors.map((row) => [row.id, normalize(row.companyName)]));
  const title = normalize(mail.title), sender = normalize(mail.senderName), file = normalize(mail.originalFileName);
  const month = mail.folderMonth || mail.createdAt.slice(0, 7);
  return data.receivedInvoices.filter((row) => activeReceivedInvoice(data, company, row.id)).map((row) => {
    const reasons: string[] = [];
    let score = 0;
    if (mail.fileUrl && row.fileUrl === mail.fileUrl) { score += 100; reasons.push("同じ原本ファイル"); }
    if (file && row.originalFileName && normalize(row.originalFileName) === file) { score += 60; reasons.push("同じファイル名"); }
    const vendor = vendors.get(row.vendorId) || "";
    if (vendor.length >= 2 && (title.includes(vendor) || sender.includes(vendor) || (sender.length >= 2 && vendor.includes(sender)))) { score += 30; reasons.push("支払先名が一致"); }
    if (row.folderMonth === month || row.issueDate.startsWith(month)) { score += 10; reasons.push("同じ月"); }
    if (linkedElsewhere.has(row.id)) reasons.push("別の郵便物と連携済み"); else score += 5;
    return { id: row.id, score, reasons };
  }).filter((row) => row.score >= 30).sort((a, b) => b.score - a.score).slice(0, limit);
}

const linkSchema = z.object({ mailDocumentId: z.string().min(1).max(1000), receivedInvoiceId: z.string().min(1).max(1000), mailUpdatedAt: z.string().optional() });
export type LinkMailDocumentInput = z.input<typeof linkSchema>;
function targetMail(data: AppData, actor: Actor, company: CompanyScope, mailDocumentId: string, mailUpdatedAt?: string) {
  if (!canManageMailLinks(actor) || !canAccessCompany(actor, company)) throw new Error("権限がありません");
  const mail = data.mailDocuments.find((row) => row.id === mailDocumentId && !row.deletedAt && companyFromParam(row.company) === company);
  if (!mail) throw new Error("郵便物が見つかりません");
  if (mailUpdatedAt && mail.updatedAt !== mailUpdatedAt) throw new Error("郵便物が更新されています。画面を更新してください");
  return mail;
}

export function linkMailDocumentToReceivedInvoice(data: AppData, actor: Actor, company: CompanyScope, input: LinkMailDocumentInput) {
  const value = linkSchema.parse(input);
  const mail = targetMail(data, actor, company, value.mailDocumentId, value.mailUpdatedAt);
  const invoice = activeReceivedInvoice(data, company, value.receivedInvoiceId);
  if (!invoice || !visibleProjects(data, actor).some((row) => row.id === invoice.projectId)) throw new Error("受領請求書が見つかりません");
  const current = resolveMailLink(data, company, mail);
  if (current.invoice && current.invoice.id !== invoice.id) throw new Error("別の受領請求書と連携済みです。先に連携を解除してください");
  const paid = data.payments.filter((row) => !row.deletedAt && row.type === "EXPENSE" && row.receivedInvoiceId === invoice.id).reduce((total, row) => total + cents(row.amount), 0);
  mail.relatedReceivedInvoiceId = invoice.id;
  if (mail.category !== "INVOICE" && mail.category !== "RECEIPT") mail.category = "INVOICE";
  // Mail "processed" follows the document's payment completion, the same rule bank reconciliation applies.
  mail.mailProcessed = invoice.total > 0 && paid >= cents(invoice.total);
  mail.updatedAt = stamp(mail.updatedAt);
  return { mailDocumentId: mail.id, receivedInvoiceId: invoice.id, mailProcessed: mail.mailProcessed };
}

const unlinkSchema = z.object({ mailDocumentId: z.string().min(1).max(1000), mailUpdatedAt: z.string().optional() });
export type UnlinkMailDocumentInput = z.input<typeof unlinkSchema>;
export function unlinkMailDocument(data: AppData, actor: Actor, company: CompanyScope, input: UnlinkMailDocumentInput) {
  const value = unlinkSchema.parse(input);
  const mail = targetMail(data, actor, company, value.mailDocumentId, value.mailUpdatedAt);
  if (!mail.relatedReceivedInvoiceId) throw new Error("この郵便物は未連携です");
  const previous = mail.relatedReceivedInvoiceId;
  mail.relatedReceivedInvoiceId = undefined; mail.mailProcessed = false; mail.updatedAt = stamp(mail.updatedAt);
  return { mailDocumentId: mail.id, previousReceivedInvoiceId: previous };
}

export type MailIntegrityIssue = { kind: "BROKEN_LINK" | "MISSING_FILE"; mailDocumentId?: string; receivedInvoiceId?: string; title: string; folderMonth: string; detail: string };
export function mailIntegrityReport(data: AppData, company: CompanyScope, fileExists?: (fileUrl?: string) => boolean | undefined) {
  const issues: MailIntegrityIssue[] = [];
  for (const mail of data.mailDocuments) {
    if (mail.deletedAt || companyFromParam(mail.company) !== company) continue;
    const folderMonth = mail.folderMonth || mail.createdAt.slice(0, 7);
    const link = resolveMailLink(data, company, mail);
    if (link.broken) issues.push({ kind: "BROKEN_LINK", mailDocumentId: mail.id, title: mail.title, folderMonth, detail: `参照先の受領請求書（${link.targetId}）が存在しません` });
    if (fileExists && fileExists(mail.fileUrl) === false) issues.push({ kind: "MISSING_FILE", mailDocumentId: mail.id, title: mail.title, folderMonth, detail: `原本ファイルがありません: ${mail.originalFileName}` });
  }
  if (fileExists) for (const invoice of data.receivedInvoices) {
    if (!activeReceivedInvoice(data, company, invoice.id) || !invoice.fileUrl || fileExists(invoice.fileUrl) !== false) continue;
    issues.push({ kind: "MISSING_FILE", receivedInvoiceId: invoice.id, title: invoice.originalFileName || "受領請求書", folderMonth: invoice.folderMonth || invoice.issueDate.slice(0, 7), detail: `原本ファイルがありません: ${invoice.originalFileName || invoice.fileUrl}` });
  }
  return { issues, brokenLinks: issues.filter((row) => row.kind === "BROKEN_LINK").length, missingMailFiles: issues.filter((row) => row.kind === "MISSING_FILE" && row.mailDocumentId).length, missingInvoiceFiles: issues.filter((row) => row.kind === "MISSING_FILE" && row.receivedInvoiceId).length };
}
