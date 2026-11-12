"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { hash } from "bcryptjs";
import { z } from "zod";
import { issueSession, requireUser } from "@/lib/auth";
import { assignCompanyCard } from "@/lib/card-receipts";
import { effectiveFeatures, memberFeatures } from "@/lib/member-features";
import { assertCan } from "@/lib/rbac";
import { mutateData } from "@/lib/store";
import { approvalRoles, reviewRegistration } from "@/lib/user-access";
import { createUserAccount, editableRoles, endUserSessions, updateUserAccount, userAccountPasswordSchema, type UserAccountStatus } from "@/lib/user-admin";
import { generateAgentTokenSecret, issueAgentToken, revokeAgentToken } from "@/lib/agent-tokens";
import type { ApiTokenScope } from "@/lib/types";

function featureStatesFromForm(formData: FormData) {
  // New forms send every catalog key, including disabled switches; old forms send none.
  // A form opened before a switch was added lacks that key (see updateUserAccountAction).
  const entries = memberFeatures.map(({ key }) => [key, formData.get(`feature:${key}`)] as const).filter(([, value]) => value !== null);
  if (!entries.length) return undefined;
  const stateSchema = z.enum(["on", "off"], "使える機能の設定を確認してください");
  return Object.fromEntries(entries.map(([key, value]) => [key, stateSchema.parse(value) === "on"]));
}

export async function createUserAccountAction(_previous: { error: string; success?: boolean }, formData: FormData) {
  const actor = await requireUser();
  assertCan(actor, "manage:users");
  try {
    const checked = userAccountPasswordSchema.safeParse(String(formData.get("password") ?? ""));
    if (!checked.success) return { error: checked.error.issues[0].message };
    const features = featureStatesFromForm(formData);
    const passwordHash = await hash(checked.data, 12);
    const id = randomUUID();
    await mutateData(actor.id, "CREATE_USER_ACCOUNT", "User", id, (data) => createUserAccount(data, actor.id, {
      id, name: String(formData.get("name") ?? ""), email: String(formData.get("email") ?? ""),
      role: String(formData.get("role")) as (typeof editableRoles)[number], passwordHash, features,
    }), undefined, { undoable: false });
  } catch (error) {
    return { error: error instanceof z.ZodError ? error.issues[0].message : error instanceof Error ? error.message : "メンバーを追加できませんでした。" };
  }
  revalidatePath("/users");
  return { error: "", success: true };
}

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
    const features = featureStatesFromForm(formData);
    const passwordHash = password ? await hash(password, 12) : undefined;
    await mutateData(actor.id, "UPDATE_USER_ACCOUNT", "User", id, (data) => {
      // A form opened before a switch existed does not send it: same role keeps the member's current state.
      const role = String(formData.get("role"));
      const target = data.users.find((user) => user.id === id);
      const completed = features && target && target.role === role ? { ...effectiveFeatures(target.role, target.featureAccess), ...features } : features;
      const result = updateUserAccount(data, actor.id, {
        id, updatedAt: String(formData.get("updatedAt") ?? ""),
        name: String(formData.get("name") ?? ""), email: String(formData.get("email") ?? ""),
        role: String(formData.get("role")) as (typeof editableRoles)[number],
        status: String(formData.get("status")) as UserAccountStatus,
        passwordHash, features: completed,
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
  const userId = String(formData.get("userId") ?? ""), accountIds = formData.getAll("accountIds").map(String);
  try {
    await mutateData(actor.id, "ASSIGN_COMPANY_CARD", "User", userId, (data) => assignCompanyCard(data, actor, "JAPAN", { userId, accountIds }));
  } catch (error) {
    return { error: error instanceof Error ? error.message : "会社カードを登録できませんでした。" };
  }
  revalidatePath("/users"); revalidatePath("/expenses"); revalidatePath("/expenses/capture");
  return { error: "", success: true };
}
