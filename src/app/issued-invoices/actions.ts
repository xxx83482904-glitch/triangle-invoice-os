"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import type { CompanyScope } from "@/lib/company";
import { applyIssuedInvoiceEdits, type IssuedEdit } from "@/lib/issued-invoice-edits";
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
