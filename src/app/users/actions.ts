"use server";

import { revalidatePath } from "next/cache";
import { hash } from "bcryptjs";
import { z } from "zod";
import { issueSession, requireUser } from "@/lib/auth";
import { assignCompanyCard } from "@/lib/card-receipts";
import { assertCan } from "@/lib/rbac";
import { mutateData } from "@/lib/store";
import { approvalRoles, reviewRegistration } from "@/lib/user-access";
import { editableRoles, endUserSessions, updateUserAccount, userAccountPasswordSchema, type UserAccountStatus } from "@/lib/user-admin";
import { generateAgentTokenSecret, issueAgentToken, revokeAgentToken } from "@/lib/agent-tokens";
import type { ApiTokenScope } from "@/lib/types";

export async function updateUserAccountAction(_previous: { error: string; success?: boolean }, formData: FormData) {
  const actor = await requireUser();
  assertCan(actor, "manage:users");
  const id = String(formData.get("id") ?? "");
  const password = String(formData.get("password") ?? "");
  let currentDevice: Parameters<typeof issueSession>[0] | undefined;
  try {
    // Only return the validation message; never return the submitted password.
    const checked = password ? userAccountPasswordSchema.safeParse(password) : undefined;
    if (checked && !checked.success) return { error: checked.error.issues[0].message };
    const passwordHash = password ? await hash(password, 12) : undefined;
    await mutateData(actor.id, "UPDATE_USER_ACCOUNT", "User", id, (data) => {
      const result = updateUserAccount(data, actor.id, {
        id, updatedAt: String(formData.get("updatedAt") ?? ""),
        name: String(formData.get("name") ?? ""), email: String(formData.get("email") ?? ""),
        role: String(formData.get("role")) as (typeof editableRoles)[number],
        status: String(formData.get("status")) as UserAccountStatus,
        passwordHash,
      });
      // Capture this mutation's version, without putting it or the hash in the audit result.
      if (id === actor.id && result.passwordChanged) currentDevice = data.users.find((user) => user.id === actor.id);
      return result;
    }, undefined, { undoable: false });
    if (currentDevice) await issueSession(currentDevice);
  } catch (error) {
    return { error: error instanceof z.ZodError ? error.issues[0].message : error instanceof Error ? error.message : "利用者を保存できませんでした。" };
  }
  revalidatePath("/users");
  return { error: "", success: true };
}

export async function endUserSessionsAction(_previous: { error: string; success?: boolean }, formData: FormData) {
  const actor = await requireUser();
  assertCan(actor, "manage:users");
  const id = String(formData.get("id") ?? "");
  let currentDevice: Parameters<typeof issueSession>[0] | undefined;
  try {
    await mutateData(actor.id, "END_USER_SESSIONS", "User", id, (data) => {
      const result = endUserSessions(data, actor.id, { id, updatedAt: String(formData.get("updatedAt") ?? "") });
      if (id === actor.id) currentDevice = data.users.find((user) => user.id === actor.id);
      return result;
    }, undefined, { undoable: false });
    if (currentDevice) await issueSession(currentDevice);
  } catch (error) {
    return { error: error instanceof z.ZodError ? error.issues[0].message : error instanceof Error ? error.message : "ログアウトできませんでした。" };
  }
  revalidatePath("/users");
  return { error: "", success: true };
}

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

export async function assignCompanyCardAction(_previous: { error: string; success?: boolean }, formData: FormData) {
  const actor = await requireUser();
  assertCan(actor, "manage:users");
  const userId = String(formData.get("userId") ?? ""), accountId = String(formData.get("accountId") ?? "");
  try {
    await mutateData(actor.id, "ASSIGN_COMPANY_CARD", "User", userId, (data) => assignCompanyCard(data, actor, "JAPAN", { userId, accountId }));
  } catch (error) {
    return { error: error instanceof Error ? error.message : "会社カードを登録できませんでした。" };
  }
  revalidatePath("/users"); revalidatePath("/expenses/capture");
  return { error: "", success: true };
}
