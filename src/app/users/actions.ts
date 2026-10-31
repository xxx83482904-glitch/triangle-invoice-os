"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import { mutateData } from "@/lib/store";
import { approvalRoles, reviewRegistration } from "@/lib/user-access";
import { generateAgentTokenSecret, issueAgentToken, revokeAgentToken } from "@/lib/agent-tokens";
import type { ApiTokenScope } from "@/lib/types";

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

// The plain token travels only in this action's return value; the store and the audit log keep the hash and prefix.
export async function createAgentTokenAction(_previous: { error: string; plain?: string }, formData: FormData) {
  const actor = await requireUser();
  assertCan(actor, "manage:users");
  const secret = generateAgentTokenSecret();
  try {
    await mutateData(actor.id, "AGENT_TOKEN_ISSUE", "ApiToken", secret.prefix, (data) => issueAgentToken(data, actor, {
      userId: String(formData.get("userId") ?? "") || undefined, name: String(formData.get("name") ?? ""),
      scopes: formData.getAll("scopes").map(String) as ApiTokenScope[], expiresInDays: Number(formData.get("expiresInDays")) || 90,
      hash: secret.hash, prefix: secret.prefix,
    }), undefined, { undoable: false });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "トークンを発行できませんでした。" };
  }
  revalidatePath("/users");
  return { error: "", plain: secret.plain };
}

export async function revokeAgentTokenAction(_previous: { error: string }, formData: FormData) {
  const actor = await requireUser();
  assertCan(actor, "manage:users");
  const id = String(formData.get("id") ?? "");
  try {
    await mutateData(actor.id, "AGENT_TOKEN_REVOKE", "ApiToken", id, (data) => revokeAgentToken(data, actor, id, String(formData.get("updatedAt") ?? "")), undefined, { undoable: false });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "トークンを取り消せませんでした。" };
  }
  revalidatePath("/users");
  return { error: "" };
}
