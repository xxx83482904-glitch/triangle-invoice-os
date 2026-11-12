import type { AppData } from "@/lib/types";
import { isActiveUser } from "@/lib/user-access";
import { userAccountPasswordSchema } from "@/lib/user-admin";

// A person changing their own password. The current password is checked by the caller (bcrypt) before this runs.
// Ending other sessions bumps sessionVersion; the caller then issues a fresh cookie so this browser stays signed in.
export function checkNewOwnPassword(input: { current: string; next: string; confirm: string }) {
  if (!input.current) throw new Error("今のパスワードを入力してください");
  const parsed = userAccountPasswordSchema.safeParse(input.next);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || "新しいパスワードを確認してください");
  if (input.next !== input.confirm) throw new Error("確認用のパスワードが一致しません");
  if (input.next === input.current) throw new Error("今と違うパスワードにしてください");
  return parsed.data;
}

export function changeOwnPassword(data: AppData, userId: string, input: { passwordHash: string; signOutOthers: boolean; expectedHash: string }, now = new Date().toISOString()) {
  const user = data.users.find((row) => row.id === userId && isActiveUser(row));
  if (!user) throw new Error("利用者が見つかりません");
  // The password changed in between (another tab or an administrator): the checked current password is stale.
  if (user.passwordHash !== input.expectedHash) throw new Error("パスワードがほかで変更されています。ログインし直してください");
  user.passwordHash = input.passwordHash;
  user.passwordChangedAt = now;
  if (input.signOutOthers) user.sessionVersion = (user.sessionVersion ?? 0) + 1;
  user.updatedAt = new Date(Math.max(Date.parse(now), Date.parse(user.updatedAt) + 1)).toISOString();
  return { id: user.id, sessionVersion: user.sessionVersion ?? 0 };
}
