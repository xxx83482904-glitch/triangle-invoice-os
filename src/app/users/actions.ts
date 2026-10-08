"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import { mutateData } from "@/lib/store";
import { approvalRoles, reviewRegistration } from "@/lib/user-access";

export async function reviewRegistrationAction(_previous: { error: string; success?: boolean }, formData: FormData) {
  const actor = await requireUser();
  assertCan(actor, "manage:users");
  const id = String(formData.get("id") ?? "");
  try {
    await mutateData(actor.id, "REVIEW_REGISTRATION", "User", id, (data) => reviewRegistration(data, actor.id, {
      id, updatedAt: String(formData.get("updatedAt") ?? ""),
      decision: String(formData.get("decision")) as "APPROVE" | "REJECT",
      role: String(formData.get("role")) as (typeof approvalRoles)[number],
    }), undefined, { undoable: false });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "申請を処理できませんでした。" };
  }
  revalidatePath("/users");
  return { error: "", success: true };
}
