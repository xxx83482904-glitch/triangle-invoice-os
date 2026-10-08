"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireUser } from "@/lib/auth";
import { confirmBankReconciliation, removeBankReconciliation, syncReconciledInvoiceStatus, type ReconcileInput } from "@/lib/bank-reconciliation";
import { mutateData } from "@/lib/store";
import { isActiveUser } from "@/lib/user-access";
import type { CompanyScope } from "@/lib/company";
import type { AppData } from "@/lib/types";

function liveActor(data: AppData, id: string) {
  const user = data.users.find((row) => row.id === id && isActiveUser(row));
  if (!user) throw new Error("利用者の権限が変わっています");
  return user;
}
function refresh() {
  for (const path of ["/banking/reconcile", "/banking", "/banking/forecast", "/banking/insights", "/issued-invoices", "/received-invoices", "/mail-sorter", "/documents", "/payments", "/dashboard", "/projects", "/reports"]) revalidatePath(path);
  revalidatePath("/projects/[id]", "page");
}
function message(error: unknown, fallback: string) {
  if (error instanceof ZodError) return "金額・選択内容・確認チェックを見直してください。金額は正の数で小数点以下2桁までです。";
  return error instanceof Error ? error.message : fallback;
}
export async function confirmBankReconciliationAction(company: CompanyScope, input: ReconcileInput) {
  const user = await requireUser();
  try {
    const result = await mutateData(user.id, "BANK_RECONCILE", "BankReconciliation", input.transactionId, (data) => confirmBankReconciliation(data, liveActor(data, user.id), company, input));
    refresh(); return { success: true as const, ...result };
  } catch (error) { return { success: false as const, error: message(error, "照合に失敗しました") }; }
}
export async function removeBankReconciliationAction(company: CompanyScope, id: string, updatedAt: string) {
  const user = await requireUser();
  try {
    const result = await mutateData(user.id, "BANK_UNRECONCILE", "BankReconciliation", id, (data) => removeBankReconciliation(data, liveActor(data, user.id), company, id, updatedAt));
    refresh(); return { success: true as const, ...result };
  } catch (error) { return { success: false as const, error: message(error, "解除に失敗しました") }; }
}

export async function syncReconciledInvoiceStatusAction(company: CompanyScope, kind: "issued" | "received", id: string, updatedAt: string) {
  const user = await requireUser();
  try {
    const result = await mutateData(user.id, "BANK_RECONCILE_STATUS", "Invoice", id, (data) => syncReconciledInvoiceStatus(data, liveActor(data, user.id), company, kind, id, updatedAt));
    refresh(); return { success: true as const, ...result };
  } catch (error) { return { success: false as const, error: message(error, "状態の同期に失敗しました") }; }
}
