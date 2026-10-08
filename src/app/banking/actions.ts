"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireUser } from "@/lib/auth";
import { applyBankRules, deleteBankDefinition, saveAccountingCategory, saveBankEdits, saveBankRule } from "@/lib/banking";
import { setBankAutoSync } from "@/lib/banking-sync";
import type { BankEdit, BankRuleInput, CategoryInput } from "@/lib/banking-types";
import type { BankForecastSettings } from "@/lib/banking-types";
import { saveBankForecastSettings } from "@/lib/bank-forecast";
import { bankToday } from "@/lib/banking";
import { isActiveUser } from "@/lib/user-access";
import type { CompanyScope } from "@/lib/company";
import { mutateData } from "@/lib/store";

function errorMessage(error: unknown) {
  return error instanceof ZodError ? "入力内容を確認してください" : error instanceof Error ? error.message : "保存に失敗しました";
}
export async function saveBankEditsAction(company: CompanyScope, edits: BankEdit[]) {
  const user = await requireUser();
  try {
    const result = await mutateData(user.id, "BANK_CLASSIFY", "BankTransaction", company, (data) => saveBankEdits(data, user, company, edits));
    revalidatePath("/banking"); return { ...result, success: true as const };
  } catch (error) { return { success: false as const, error: errorMessage(error) }; }
}
export async function saveBankRuleAction(company: CompanyScope, input: BankRuleInput) {
  const user = await requireUser();
  try {
    await mutateData(user.id, "BANK_RULE_SAVE", "BankRule", input.id || "new", (data) => saveBankRule(data, user, company, input));
    revalidatePath("/banking"); return { success: true };
  } catch (error) { return { error: errorMessage(error) }; }
}
export async function saveAccountingCategoryAction(company: CompanyScope, input: CategoryInput) {
  const user = await requireUser();
  try {
    await mutateData(user.id, "BANK_CATEGORY_SAVE", "AccountingCategory", input.id || "new", (data) => saveAccountingCategory(data, user, company, input));
    revalidatePath("/banking"); return { success: true };
  } catch (error) { return { error: errorMessage(error) }; }
}
export async function deleteBankDefinitionAction(company: CompanyScope, kind: "category" | "rule", id: string, updatedAt: string) {
  const user = await requireUser();
  try {
    await mutateData(user.id, "BANK_DEFINITION_DELETE", kind, id, (data) => deleteBankDefinition(data, user, company, kind, id, updatedAt));
    revalidatePath("/banking"); return { success: true };
  } catch (error) { return { error: errorMessage(error) }; }
}
export async function applyBankRulesAction(company: CompanyScope, ids?: string[]) {
  const user = await requireUser();
  try {
    const result = await mutateData(user.id, "BANK_RULE_APPLY", "BankRule", company, (data) => applyBankRules(data, user, company, ids));
    revalidatePath("/banking"); return { ...result, success: true as const };
  } catch (error) { return { success: false as const, error: errorMessage(error) }; }
}
export async function setBankAutoSyncAction(company: CompanyScope, enabled: boolean) {
  const user = await requireUser();
  try {
    await setBankAutoSync(user, company, enabled);
    revalidatePath("/banking"); return { success: true };
  } catch (error) { return { error: errorMessage(error) }; }
}

export async function saveBankForecastAction(company: CompanyScope, accountId: string, updatedAt: string, settings: BankForecastSettings) {
  const user = await requireUser();
  try {
    const result = await mutateData(user.id, "BANK_FORECAST_SETTINGS", "BankAccount", accountId, (data) => {
      const live = data.users.find((row) => row.id === user.id && isActiveUser(row));
      if (!live) throw new Error("利用者の権限を確認してください");
      return saveBankForecastSettings(data, live, company, accountId, updatedAt, settings, bankToday());
    });
    revalidatePath("/banking/forecast");
    return { ...result, success: true as const };
  } catch (error) { return { success: false as const, error: errorMessage(error) }; }
}
