"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { bankAuditEntries, bankAuditUndoPatch } from "@/lib/bank-audit";
import { mutateData, readData, restoreUndoState } from "@/lib/store";
import { isActiveUser } from "@/lib/user-access";
import type { CompanyScope } from "@/lib/company";

export async function loadBankAuditAction(company: CompanyScope) {
  const user = await requireUser();
  try {
    const data = await readData();
    const live = data.users.find((row) => row.id === user.id && isActiveUser(row));
    if (!live) throw new Error("権限を確認してください");
    return { success: true as const, rows: bankAuditEntries(data, live, company) };
  } catch (error) { return { success: false as const, error: error instanceof Error ? error.message : "履歴を取得できませんでした" }; }
}
export async function undoBankAuditAction(company: CompanyScope, id: string) {
  const user = await requireUser();
  try {
    await mutateData(user.id, "UNDO_ACTION", "BankTransaction", id, (data) => {
      const live = data.users.find((row) => row.id === user.id && isActiveUser(row));
      if (!live) throw new Error("権限を確認してください");
      const { log, patch } = bankAuditUndoPatch(data, live, company, id);
      restoreUndoState(data, patch);
      log.undoneAt = new Date().toISOString(); log.undoneById = user.id;
      return { undoOfAuditLogId: id };
    }, undefined, { undoable: false });
    for (const path of ["/banking", "/banking/accounts", "/banking/reconcile", "/banking/insights", "/banking/forecast", "/dashboard", "/reports"]) revalidatePath(path);
    return { success: true as const };
  } catch (error) { return { success: false as const, error: error instanceof Error ? error.message : "取り消せませんでした" }; }
}
