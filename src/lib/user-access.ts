import { randomUUID } from "node:crypto";
import { z } from "zod";
import { can } from "@/lib/rbac";
import type { AppData, User } from "@/lib/types";

export const registrationSchema = z.object({
  name: z.string().trim().min(1, "名前を入力してください").max(100),
  email: z.email("メールアドレスを確認してください").trim().toLowerCase().max(254),
  password: z.string().min(8, "パスワードは8文字以上にしてください").max(72, "パスワードは72文字以内にしてください"),
});

export const approvalRoles = ["MAIL_EDITOR", "BILLING_EDITOR", "PROJECT_MANAGER", "CHIEF_DESIGNER", "DESIGNER", "ACCOUNTING"] as const;

export function isActiveUser(user: Pick<User, "id" | "deletedAt" | "accessStatus">) {
  // Existing accounts predate approval and keep their current access.
  return !user.deletedAt && (user.accessStatus === undefined || user.accessStatus === "ACTIVE");
}

export function requestRegistration(data: AppData, input: { name: string; email: string; passwordHash: string }) {
  const email = input.email.trim().toLowerCase();
  if (data.users.some((user) => user.email.toLowerCase() === email)) {
    throw new Error("このメールアドレスでは申請できません。管理者に確認してください。");
  }
  const timestamp = new Date().toISOString();
  const user: User = {
    id: randomUUID(), name: input.name, email, passwordHash: input.passwordHash,
    role: "MAIL_EDITOR", accessStatus: "PENDING", createdAt: timestamp, updatedAt: timestamp,
  };
  data.users.unshift(user);
  return { id: user.id, name: user.name, email: user.email, accessStatus: user.accessStatus };
}

const approvalSchema = z.object({
  id: z.string().min(1), updatedAt: z.string().min(1), decision: z.enum(["APPROVE", "REJECT"]),
  role: z.enum(approvalRoles),
});

export function reviewRegistration(data: AppData, actorId: string, input: z.input<typeof approvalSchema>) {
  const actor = data.users.find((user) => user.id === actorId);
  if (!actor || !isActiveUser(actor) || !can(actor, "manage:users")) throw new Error("権限がありません");
  const parsed = approvalSchema.parse(input);
  const user = data.users.find((item) => item.id === parsed.id && !item.deletedAt);
  if (!user || user.accessStatus !== "PENDING" || user.updatedAt !== parsed.updatedAt) {
    throw new Error("申請はすでに処理されたか、変更されています。再読み込みしてください。");
  }
  const timestamp = new Date(Math.max(Date.now(), Date.parse(user.updatedAt) + 1)).toISOString();
  user.accessStatus = parsed.decision === "APPROVE" ? "ACTIVE" : "REJECTED";
  if (parsed.decision === "APPROVE") {
    user.role = parsed.role;
    user.approvedAt = timestamp;
    user.approvedById = actor.id;
  }
  user.updatedAt = timestamp;
  return { id: user.id, role: user.role, accessStatus: user.accessStatus };
}
