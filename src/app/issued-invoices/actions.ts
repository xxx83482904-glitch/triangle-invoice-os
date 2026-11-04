"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireUser } from "@/lib/auth";
import type { CompanyScope } from "@/lib/company";
import { applyIssuedInvoiceEdits, type IssuedEdit } from "@/lib/issued-invoice-edits";
import { applyIssuedInvoiceDeletion, type IssuedDelete } from "@/lib/issued-invoice-delete";
import { applyIssuedInvoicePdfEdits } from "@/lib/invoice-pdf-layout-store";
import { pdfIssueMessage, type PdfEditsInput } from "@/lib/pdf-document-values";
import { can } from "@/lib/rbac";
import { mutateData } from "@/lib/store";
export type { IssuedEdit } from "@/lib/issued-invoice-edits";

export async function saveIssuedInvoiceEdits(company: CompanyScope, input: IssuedEdit[]) {
  const user = await requireUser();
  if (!can(user, "manage:issuedInvoices")) return { error: "権限がありません" };
  try {
    await mutateData(user.id, "SAVE_ISSUED_INVOICES", "IssuedInvoice", "bulk", (data) => applyIssuedInvoiceEdits(data, user, company, input));
    for (const path of ["/documents", "/issued-invoices", "/dashboard", "/projects", "/projects/[id]", "/reports", "/payments"]) revalidatePath(path, "page");
    return { success: true };
  } catch (error) { return { error: error instanceof Error ? error.message : "保存に失敗しました" }; }
}

export async function deleteIssuedInvoices(company: CompanyScope, input: IssuedDelete[]) {
  const user = await requireUser();
  if (!can(user, "manage:issuedInvoices")) return { error: "権限がありません" };
  try {
    await mutateData(user.id, "DELETE_ISSUED_INVOICES", "IssuedInvoice", "bulk", (data) => applyIssuedInvoiceDeletion(data, user, company, input));
    for (const path of ["/documents", "/issued-invoices", "/dashboard", "/projects", "/projects/[id]", "/reports", "/payments"]) revalidatePath(path, "page");
    return { success: true };
  } catch (error) { return { error: error instanceof Error ? error.message : "削除に失敗しました" }; }
}

// Layout and wording are presentation only; number, dates, lines and notes change the invoice itself.
export async function saveIssuedInvoicePdfEdits(company: CompanyScope, input: PdfEditsInput) {
  const user = await requireUser();
  if (!can(user, "manage:issuedInvoices")) return { error: "権限がありません" };
  try {
    const result = await mutateData(user.id, "SAVE_ISSUED_INVOICE_PDF", "IssuedInvoice", input.id, (data) => applyIssuedInvoicePdfEdits(data, user, company, input));
    for (const path of result.contentChanged ? ["/documents", "/issued-invoices", "/dashboard", "/projects", "/projects/[id]", "/reports", "/payments"] : ["/documents", "/issued-invoices"]) revalidatePath(path, "page");
    return { success: true, updatedAt: result.updatedAt };
  } catch (error) { return { error: error instanceof ZodError ? pdfIssueMessage(error.issues[0]) : error instanceof Error ? error.message : "保存に失敗しました" }; }
}
