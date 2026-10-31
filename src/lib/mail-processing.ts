import { z } from "zod";
import { companyFromParam, type CompanyScope } from "@/lib/company";
import { assertCompanyAccess, can } from "@/lib/rbac";
import type { AppData, MailDocument, MailDocumentCategory, ReceivedInvoice, User } from "@/lib/types";

// Missing legacy flags remain missing in storage and display as unprocessed. Never infer from payment/link state.
export const isMailProcessed = (row?: { mailProcessed?: boolean }) => row?.mailProcessed === true;
const reference = z.string().min(1).max(1000);
const editSchema = z.object({
  mailDocumentId: reference.optional(), receivedInvoiceId: reference.optional(),
  mailUpdatedAt: reference.optional(), invoiceUpdatedAt: reference.optional(),
  processingStatus: z.enum(["processed", "unprocessed"]).optional(),
  category: z.enum(["INVOICE", "CONTRACT", "ESTIMATE", "DELIVERY_NOTE", "RECEIPT", "NOTICE", "OTHER"]).optional(),
}).strict().refine((row) => row.mailDocumentId || row.receivedInvoiceId, "書類を指定してください")
  .refine((row) => row.processingStatus !== undefined || row.category !== undefined, "保存する変更がありません");
export type MailSorterEdit = z.input<typeof editSchema>;
const stamp = (previous: string) => new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();

// Validate every target before changing anything; called inside the existing mutation lock/audit/Undo path.
export function applyMailSorterEdits(data: AppData, actor: Pick<User, "id" | "role">, company: CompanyScope, input: unknown) {
  assertCompanyAccess(actor, company);
  if (!can(actor, "manage:mailSorter") && !can(actor, "manage:receivedInvoices") && !can(actor, "upload:receivedInvoices")) throw new Error("権限がありません");
  const edits = z.array(editSchema).min(1, "保存する変更がありません").max(1000, "一度に保存できるのは1000件までです").parse(input);
  const targets = new Map<string, { row: MailDocument | ReceivedInvoice; processed?: boolean; category?: MailDocumentCategory }>();
  const plan = (key: string, row: MailDocument | ReceivedInvoice, processed?: boolean, category?: MailDocumentCategory) => {
    const previous = targets.get(key);
    if (previous && ((processed !== undefined && previous.processed !== undefined && previous.processed !== processed) || (category !== undefined && previous.category !== undefined && previous.category !== category))) throw new Error("同じ書類に異なる変更が指定されています");
    targets.set(key, { row, processed: processed ?? previous?.processed, category: category ?? previous?.category });
  };
  for (const edit of edits) {
    const mail = edit.mailDocumentId ? data.mailDocuments.find((row) => row.id === edit.mailDocumentId && !row.deletedAt && companyFromParam(row.company) === company) : undefined;
    if (edit.mailDocumentId && !mail) throw new Error("郵便物が見つかりません");
    if (mail && edit.mailUpdatedAt && mail.updatedAt !== edit.mailUpdatedAt) throw new Error("郵便物が更新されています。再読込してから操作してください");
    if (mail && edit.receivedInvoiceId && mail.relatedReceivedInvoiceId !== edit.receivedInvoiceId) throw new Error("郵便物の連携先が変わっています。再読込してから操作してください");
    if (edit.category && !mail) throw new Error("分類を変更できる郵便物がありません");
    const processed = edit.processingStatus === undefined ? undefined : edit.processingStatus === "processed";
    const invoiceId = edit.receivedInvoiceId || mail?.relatedReceivedInvoiceId;
    const invoice = invoiceId ? data.receivedInvoices.find((row) => row.id === invoiceId && !row.deletedAt) : undefined;
    const project = invoice && data.projects.find((row) => row.id === invoice.projectId && !row.deletedAt && companyFromParam(row.company) === company);
    if (edit.receivedInvoiceId && (!invoice || !project)) throw new Error("受領請求書が見つかりません");
    if (processed !== undefined && invoice && project) {
      if (edit.invoiceUpdatedAt && invoice.updatedAt !== edit.invoiceUpdatedAt) throw new Error("受領請求書が更新されています。再読込してから操作してください");
      // Explicit manual processing of a linked row mirrors the flag to its invoice, as before.
      plan(`received:${invoice.id}`, invoice, processed);
    }
    if (mail) plan(`mail:${mail.id}`, mail, processed, edit.category);
    if (!mail && (!invoice || !project)) throw new Error("書類が見つかりません");
  }
  let updated = 0;
  for (const { row, processed, category } of targets.values()) {
    const processingChanged = processed !== undefined && row.mailProcessed !== processed;
    const categoryChanged = category !== undefined && "category" in row && row.category !== category;
    if (!processingChanged && !categoryChanged) continue;
    if (processingChanged) row.mailProcessed = processed;
    if (categoryChanged && "category" in row) row.category = category!;
    row.updatedAt = stamp(row.updatedAt);
    updated++;
  }
  return { updated };
}
