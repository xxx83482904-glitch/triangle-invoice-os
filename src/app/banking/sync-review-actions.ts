"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { bankSyncRunViews, restoreBankSyncReview } from "@/lib/bank-sync-runs";
import { mutateData, readData } from "@/lib/store";
import { isActiveUser } from "@/lib/user-access";
import type { CompanyScope } from "@/lib/company";

export async function loadBankSyncRunsAction(company: CompanyScope) {
  const user = await requireUser();
  try {
    const data = await readData();
    const live = data.users.find((row) => row.id === user.id && isActiveUser(row));
    if (!live) throw new Error("権限を確認してください");
    return { success: true as const, rows: bankSyncRunViews(data, live, company) };
  } catch (error) { return { success: false as const, error: error instanceof Error ? error.message : "同期の記録を取得できませんでした" }; }
}

export async function restoreBankSyncReviewAction(company: CompanyScope, runId: string, transactionIds: string[]) {
  const user = await requireUser();
  try {
    const result = await mutateData(user.id, "BANK_REVIEW_RESTORE", "BankSyncRun", runId, (data) => {
      const live = data.users.find((row) => row.id === user.id && isActiveUser(row));
      if (!live) throw new Error("権限を確認してください");
      return restoreBankSyncReview(data, live, company, { runId, transactionIds });
    });
    for (const path of ["/banking", "/banking/accounts", "/banking/reconcile", "/banking/insights", "/banking/forecast", "/dashboard", "/reports"]) revalidatePath(path);
    return { success: true as const, ...result };
  } catch (error) { return { success: false as const, error: error instanceof Error ? error.message : "確認状態を戻せませんでした" }; }
}
