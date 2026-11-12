"use server";

import { compare, hash } from "bcryptjs";
import { issueSession, requireUser } from "@/lib/auth";
import { changeOwnPassword, checkNewOwnPassword } from "@/lib/own-password";
import { mutateData, readData } from "@/lib/store";
import { isActiveUser } from "@/lib/user-access";

export type OwnPasswordState = { error: string; success?: boolean };

// Each person sets their own password. Never echo any submitted password back.
export async function changeOwnPasswordAction(_previous: OwnPasswordState, formData: FormData): Promise<OwnPasswordState> {
  const actor = await requireUser();
  const current = String(formData.get("current") ?? ""), next = String(formData.get("next") ?? ""), confirm = String(formData.get("confirm") ?? "");
  const signOutOthers = formData.get("signOutOthers") === "on";
  try {
    const password = checkNewOwnPassword({ current, next, confirm });
    const user = (await readData()).users.find((row) => row.id === actor.id && isActiveUser(row));
    if (!user) throw new Error("利用者が見つかりません");
    if (!await compare(current, user.passwordHash)) throw new Error("今のパスワードが違います");
    const passwordHash = await hash(password, 12);
    let updated: Parameters<typeof issueSession>[0] | undefined;
    await mutateData(actor.id, "CHANGE_OWN_PASSWORD", "User", actor.id, (data) => {
      const result = changeOwnPassword(data, actor.id, { passwordHash, signOutOthers, expectedHash: user.passwordHash });
      updated = data.users.find((row) => row.id === actor.id);
      return { id: result.id, signedOutOthers: signOutOthers };
    }, undefined, { undoable: false });
    // Keep this browser signed in with the new session version.
    if (updated) await issueSession(updated);
    return { error: "", success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "パスワードを変更できませんでした" };
  }
}
