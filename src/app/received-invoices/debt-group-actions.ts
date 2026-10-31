"use server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireUser } from "@/lib/auth";
import { assignDebtGroup, removeFromDebtGroup, updateDebtRole, type AssignDebtGroupInput, type RemoveFromDebtGroupInput, type UpdateDebtRoleInput } from "@/lib/debt-groups";
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
  for (const path of ["/received-invoices", "/payments", "/dashboard", "/documents", "/reports", "/banking/reconcile", "/banking/integrity"]) revalidatePath(path);
}
function message(error: unknown, fallback: string) {
  if (error instanceof ZodError) return error.issues[0]?.message || "入力内容を確認してください";
  return error instanceof Error ? error.message : fallback;
}

export async function assignDebtGroupAction(company: CompanyScope, input: AssignDebtGroupInput) {
  const user = await requireUser();
  try {
    const result = await mutateData(user.id, "DEBT_GROUP_ASSIGN", "ReceivedInvoice", input.invoiceIds[0] || "", (data) => assignDebtGroup(data, liveActor(data, user.id), company, input));
    refresh(); return { success: true as const, ...result };
  } catch (error) { return { success: false as const, error: message(error, "書類を束ねられませんでした") }; }
}
export async function updateDebtRoleAction(company: CompanyScope, input: UpdateDebtRoleInput) {
  const user = await requireUser();
  try {
    const result = await mutateData(user.id, "DEBT_GROUP_ROLE", "ReceivedInvoice", input.invoiceId, (data) => updateDebtRole(data, liveActor(data, user.id), company, input));
    refresh(); return { success: true as const, ...result };
  } catch (error) { return { success: false as const, error: message(error, "役割を変更できませんでした") }; }
}
export async function removeFromDebtGroupAction(company: CompanyScope, input: RemoveFromDebtGroupInput) {
  const user = await requireUser();
  try {
    const result = await mutateData(user.id, "DEBT_GROUP_REMOVE", "ReceivedInvoice", input.invoiceId, (data) => removeFromDebtGroup(data, liveActor(data, user.id), company, input));
    refresh(); return { success: true as const, ...result };
  } catch (error) { return { success: false as const, error: message(error, "グループから外せませんでした") }; }
}
