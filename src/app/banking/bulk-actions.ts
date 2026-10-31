"use server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireUser } from "@/lib/auth";
import { applyBulkReclassify, previewBulkReclassify, type BulkReclassifyInput, type BulkReclassifyScope } from "@/lib/bank-bulk-reclassify";
import { assertBankAccess } from "@/lib/banking";
import { mutateData, readData } from "@/lib/store";
import { isActiveUser } from "@/lib/user-access";
import type { CompanyScope } from "@/lib/company";

const message = (error: unknown, fallback: string) => error instanceof ZodError ? error.issues[0]?.message || "入力内容を確認してください" : error instanceof Error ? error.message : fallback;

export async function previewBulkReclassifyAction(company: CompanyScope, input: BulkReclassifyScope) {
  const user = await requireUser();
  try {
    assertBankAccess(user, company);
    return { success: true as const, preview: previewBulkReclassify(await readData(), company, input) };
  } catch (error) { return { success: false as const, error: message(error, "対象を確認できませんでした") }; }
}

export async function applyBulkReclassifyAction(company: CompanyScope, input: BulkReclassifyInput) {
  const user = await requireUser();
  try {
    const result = await mutateData(user.id, "BANK_BULK_RECLASSIFY", "BankTransaction", input.content.slice(0, 100), (data) => {
      const live = data.users.find((row) => row.id === user.id && isActiveUser(row));
      if (!live) throw new Error("利用者の権限を確認してください");
      return applyBulkReclassify(data, live, company, input);
    });
    for (const path of ["/banking", "/banking/reconcile", "/banking/integrity", "/banking/insights", "/banking/payroll", "/dashboard"]) revalidatePath(path);
    return { success: true as const, ...result };
  } catch (error) { return { success: false as const, error: message(error, "一括変更できませんでした") }; }
}
