"use server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireUser } from "@/lib/auth";
import { applyObligationMutation, updateVendorObligationKind, type ObligationMutation, type VendorObligationInput } from "@/lib/obligation-edits";
import { mutateData } from "@/lib/store";
import { isActiveUser } from "@/lib/user-access";
import type { AppData } from "@/lib/types";
import type { CompanyScope } from "@/lib/company";

function liveActor(data: AppData, id: string) {
  const user = data.users.find((row) => row.id === id && isActiveUser(row));
  if (!user) throw new Error("利用者の権限が変わっています");
  return user;
}
function message(error: unknown) {
  return error instanceof ZodError ? error.issues[0]?.message || "入力内容を確認してください" : error instanceof Error ? error.message : "保存できませんでした";
}
export async function saveObligationAction(company: CompanyScope, input: ObligationMutation) {
  const user = await requireUser();
  try {
    const names = { create: "CREATE_MANUAL_OBLIGATION", exclude: "EXCLUDE_OBLIGATION", restoreExclusion: "RESTORE_OBLIGATION", pay: "PAY_MANUAL_OBLIGATION", reopen: "REOPEN_MANUAL_OBLIGATION", cancel: "CANCEL_MANUAL_OBLIGATION", restoreManual: "RESTORE_MANUAL_OBLIGATION" };
    const targetType = input.action === "exclude" || input.action === "restoreExclusion" ? "ObligationExclusion" : "ManualObligation";
    const result = await mutateData(user.id, names[input.action], targetType, "id" in input ? input.id : "new", (data) => applyObligationMutation(data, liveActor(data, user.id), company, input));
    revalidatePath("/banking/obligations");
    return { success: true as const, ...result };
  } catch (error) { return { success: false as const, error: message(error) }; }
}
export async function saveVendorObligationKindAction(company: CompanyScope, input: VendorObligationInput) {
  const user = await requireUser();
  try {
    const result = await mutateData(user.id, "UPDATE_VENDOR_OBLIGATION_KIND", "Vendor", input.id, (data) => updateVendorObligationKind(data, liveActor(data, user.id), company, input));
    revalidatePath("/partners"); revalidatePath("/banking/obligations");
    return { success: true as const, ...result };
  } catch (error) { return { success: false as const, error: message(error) }; }
}
