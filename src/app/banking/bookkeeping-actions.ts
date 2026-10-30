"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireUser } from "@/lib/auth";
import { bankBookkeepingDetail, saveBankBookkeeping, type BankBookkeepingInput } from "@/lib/bank-bookkeeping";
import type { CompanyScope } from "@/lib/company";
import { mutateData, readData } from "@/lib/store";
import { isActiveUser } from "@/lib/user-access";

const errorMessage = (error: unknown) => error instanceof ZodError ? "入力内容を確認してください" : error instanceof Error ? error.message : "処理に失敗しました";

export async function loadBankBookkeepingAction(company: CompanyScope, id: string) {
  const user = await requireUser();
  try {
    const data = await readData();
    const actor = data.users.find((row) => row.id === user.id && isActiveUser(row));
    if (!actor) throw new Error("利用者の権限を確認してください");
    return { success: true as const, detail: bankBookkeepingDetail(data, actor, company, id) };
  } catch (error) { return { success: false as const, error: errorMessage(error) }; }
}

export async function saveBankBookkeepingAction(company: CompanyScope, input: BankBookkeepingInput) {
  const user = await requireUser();
  try {
    const result = await mutateData(user.id, "BANK_BOOKKEEPING", "BankTransaction", input?.id, (data) => {
      const actor = data.users.find((row) => row.id === user.id && isActiveUser(row));
      if (!actor) throw new Error("利用者の権限を確認してください");
      return saveBankBookkeeping(data, actor, company, input);
    });
    for (const path of ["/dashboard", "/banking", "/banking/accounts", "/banking/insights", "/banking/reconcile", "/banking/forecast"]) revalidatePath(path);
    return { success: true as const, ...result };
  } catch (error) { return { success: false as const, error: errorMessage(error) }; }
}
