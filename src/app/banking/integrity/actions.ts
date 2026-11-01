"use server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireUser } from "@/lib/auth";
import type { CompanyScope } from "@/lib/company";
import { acknowledgeIntegrity, revokeIntegrityAcknowledgement, type AcknowledgeIntegrityInput, type RevokeIntegrityInput } from "@/lib/integrity-acknowledgements";
import { uploadedFileExists } from "@/lib/files";
import { mutateData } from "@/lib/store";
import { isActiveUser } from "@/lib/user-access";
import type { AppData } from "@/lib/types";

const message = (error: unknown) => error instanceof ZodError ? error.issues[0]?.message || "入力を確認してください" : error instanceof Error ? error.message : "保存できませんでした";
function liveActor(data: AppData, id: string) {
  const user = data.users.find((row) => row.id === id && isActiveUser(row));
  if (!user) throw new Error("利用者の権限が変わっています");
  return user;
}
function refresh() {
  for (const route of ["/banking/integrity", "/banking", "/banking/reconcile", "/dashboard", "/audit"]) revalidatePath(route);
}
export async function acknowledgeIntegrityAction(company: CompanyScope, input: AcknowledgeIntegrityInput) {
  const user = await requireUser();
  try {
    const result = await mutateData(user.id, "ACKNOWLEDGE_INTEGRITY", "IntegrityAcknowledgement", company,
      (data) => acknowledgeIntegrity(data, liveActor(data, user.id), company, input, { fileExists: uploadedFileExists }));
    refresh(); return { success: true as const, count: result.count };
  } catch (error) { return { success: false as const, error: message(error) }; }
}
export async function revokeIntegrityAcknowledgementAction(company: CompanyScope, input: RevokeIntegrityInput) {
  const user = await requireUser();
  try {
    await mutateData(user.id, "REVOKE_INTEGRITY_ACKNOWLEDGEMENT", "IntegrityAcknowledgement", input.id,
      (data) => revokeIntegrityAcknowledgement(data, liveActor(data, user.id), company, input));
    refresh(); return { success: true as const };
  } catch (error) { return { success: false as const, error: message(error) }; }
}
