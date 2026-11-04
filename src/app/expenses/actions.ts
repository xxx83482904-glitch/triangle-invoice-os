"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireUser } from "@/lib/auth";
import type { CompanyScope } from "@/lib/company";
import { applyExpenseMutation, type ExpenseWorkflowMutation } from "@/lib/expense-claim-edits";
import { mutateData } from "@/lib/store";
import { isActiveUser } from "@/lib/user-access";
import type { AppData } from "@/lib/types";

function liveActor(data: AppData, id: string) {
  const user = data.users.find((row) => row.id === id && isActiveUser(row));
  if (!user) throw new Error("利用者の権限が変わっています");
  return user;
}

function message(error: unknown) {
  return error instanceof ZodError ? error.issues[0]?.message || "入力内容を確認してください" : error instanceof Error ? error.message : "保存できませんでした";
}

export async function expenseAction(company: CompanyScope, input: ExpenseWorkflowMutation) {
  const user = await requireUser();
  try {
    const names = { withdraw: "WITHDRAW_EXPENSE_CLAIM", approve: "APPROVE_EXPENSE_CLAIM", return: "RETURN_EXPENSE_CLAIM", pay: "PAY_EXPENSE_CLAIMS", unpay: "UNPAY_EXPENSE_CLAIM" };
    if (!input || !Object.hasOwn(names, input.action)) throw new Error("操作を確認してください");
    const result = await mutateData(user.id, names[input.action], "ExpenseClaim", input.action === "pay" ? "batch" : input.id,
      (data) => applyExpenseMutation(data, liveActor(data, user.id), company, input));
    revalidatePath("/expenses"); revalidatePath("/dashboard");
    return { success: true as const, ...result };
  } catch (error) { return { success: false as const, error: message(error) }; }
}
