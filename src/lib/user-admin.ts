import { z } from "zod";
import { can, roleLabel } from "@/lib/rbac";
import type { AppData, User } from "@/lib/types";
import { isActiveUser, registrationSchema } from "@/lib/user-access";

export const editableRoles = ["ADMIN", "ACCOUNTING", "CHIEF_DESIGNER", "PROJECT_MANAGER", "BILLING_EDITOR", "MAIL_EDITOR", "DESIGNER", "GUEST"] as const;
export type UserAccountStatus = "ACTIVE" | "DISABLED" | "REJECTED";
export type UserAccountView = Pick<User, "id" | "name" | "email" | "role" | "updatedAt" | "createdAt" | "approvedAt" | "passwordChangedAt" | "companyCardAccountId"> & {
  roleLabel: string;
  status: UserAccountStatus;
};

// Bcrypt truncates beyond 72 bytes, which can be fewer than 72 characters.
export const userAccountPasswordSchema = registrationSchema.shape.password.refine(
  (password) => new TextEncoder().encode(password).length <= 72,
  "パスワードはUTF-8で72バイト以内にしてください",
);

function accountStatus(user: User): UserAccountStatus {
  if (isActiveUser(user)) return "ACTIVE";
  return user.accessStatus === "REJECTED" ? "REJECTED" : "DISABLED";
}

export function userAccountViews(data: AppData): UserAccountView[] {
  const order = { ACTIVE: 0, DISABLED: 1, REJECTED: 2 };
  return data.users.filter((user) => !user.deletedAt && user.accessStatus !== "PENDING").map((user) => ({
    id: user.id, name: user.name, email: user.email, role: user.role, roleLabel: roleLabel(user.role),
    status: accountStatus(user), updatedAt: user.updatedAt, createdAt: user.createdAt,
    approvedAt: user.approvedAt, passwordChangedAt: user.passwordChangedAt, companyCardAccountId: user.companyCardAccountId,
  })).sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name, "ja"));
}

const accountVersionSchema = z.object({ id: z.string().min(1), updatedAt: z.string().min(1) });
const updateAccountSchema = accountVersionSchema.extend({
  name: z.string().trim().min(1, "名前を入力してください").max(100, "名前は100文字以内にしてください"),
  email: z.string().trim().toLowerCase().max(254, "メールアドレスは254文字以内にしてください").pipe(z.email("メールアドレスを確認してください")),
  role: z.enum(editableRoles),
  status: z.enum(["ACTIVE", "DISABLED", "REJECTED"]),
  passwordHash: z.string().optional(),
});

function requireAccountAdmin(data: AppData, actorId: string) {
  const actor = data.users.find((user) => user.id === actorId);
  if (!actor || !isActiveUser(actor) || !can(actor, "manage:users")) throw new Error("権限がありません");
  return actor;
}

function editableAccount(data: AppData, input: z.input<typeof accountVersionSchema>) {
  const user = data.users.find((item) => item.id === input.id && !item.deletedAt);
  if (!user) throw new Error("利用者が見つかりません");
  if (user.accessStatus === "PENDING") throw new Error("承認待ちの利用者は、承認フォームで処理してください");
  if (user.updatedAt !== input.updatedAt) throw new Error("この利用者は別の画面で変更されています。再読み込みしてください。");
  return user;
}

function nextTimestamp(user: User) {
  return new Date(Math.max(Date.now(), Date.parse(user.updatedAt) + 1)).toISOString();
}

function accountSummary(user: User) {
  return { name: user.name, email: user.email, role: user.role, status: accountStatus(user) };
}

export function updateUserAccount(data: AppData, actorId: string, input: z.input<typeof updateAccountSchema>) {
  const actor = requireAccountAdmin(data, actorId);
  const parsed = updateAccountSchema.parse(input);
  const user = editableAccount(data, parsed);
  const before = accountSummary(user);
  if (parsed.status === "REJECTED" && before.status !== "REJECTED") throw new Error("申請却下は、すでに却下された利用者だけに設定できます");
  if (data.users.some((other) => other.id !== user.id && other.email.toLowerCase() === parsed.email)) {
    throw new Error("このメールアドレスはほかの利用者が使っています");
  }
  if (user.id === actor.id && (parsed.role !== user.role || parsed.status !== before.status)) {
    throw new Error("自分の権限と利用状態は、ほかの管理者が変更してください");
  }
  if (!data.users.some((other) => other.id === user.id
    ? parsed.role === "ADMIN" && parsed.status === "ACTIVE"
    : other.role === "ADMIN" && isActiveUser(other))) {
    throw new Error("管理者が一人もいなくなるため変更できません");
  }

  const timestamp = nextTimestamp(user);
  const passwordChanged = Boolean(parsed.passwordHash);
  const stopping = parsed.status === "DISABLED" && user.accessStatus !== "DISABLED";
  const sessionsEnded = passwordChanged || stopping;
  const sessionVersion = (user.sessionVersion ?? 0) + Number(passwordChanged) + Number(stopping);
  // All validation, including the version and remaining administrator, precedes the first write.
  user.name = parsed.name;
  user.email = parsed.email;
  user.role = parsed.role;
  user.accessStatus = parsed.status;
  if (passwordChanged) {
    user.passwordHash = parsed.passwordHash!;
    user.passwordChangedAt = timestamp;
  }
  if (sessionsEnded) user.sessionVersion = sessionVersion;
  if (before.status === "REJECTED" && parsed.status === "ACTIVE") {
    user.approvedAt ??= timestamp;
    user.approvedById ??= actor.id;
  }
  user.updatedAt = timestamp;
  return { id: user.id, before, after: accountSummary(user), passwordChanged, sessionsEnded };
}

export function endUserSessions(data: AppData, actorId: string, input: z.input<typeof accountVersionSchema>) {
  requireAccountAdmin(data, actorId);
  const user = editableAccount(data, accountVersionSchema.parse(input));
  const timestamp = nextTimestamp(user);
  user.sessionVersion = (user.sessionVersion ?? 0) + 1;
  user.updatedAt = timestamp;
  return { id: user.id, sessionsEnded: true };
}
