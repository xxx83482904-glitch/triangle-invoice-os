"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireUser } from "@/lib/auth";
import { assertBankAccess, bankDisplayRows, bankFilters, deleteBankDefinition, previewBankRules, saveAccountingCategory, saveBankEdits, saveBankRule, selectBankTransactions } from "@/lib/banking";
import { setBankAutoSync } from "@/lib/banking-sync";
import type { BankEdit, BankRuleInput, CategoryInput } from "@/lib/banking-types";
import type { BankForecastSettings } from "@/lib/banking-types";
import { saveBankForecastSettings } from "@/lib/bank-forecast";
import { bankToday } from "@/lib/banking";
import { saveBankOverview, type BankOverviewInput } from "@/lib/bank-account-overview";
import { isActiveUser } from "@/lib/user-access";
import type { CompanyScope } from "@/lib/company";
import { mutateData, readData } from "@/lib/store";
import { bankingDataRevision } from "@/lib/banking-revision";

function errorMessage(error: unknown) {
  return error instanceof ZodError ? "入力内容を確認してください" : error instanceof Error ? error.message : "保存に失敗しました";
}
function revalidateBanking() {
  revalidatePath("/dashboard");
  revalidatePath("/banking/accounts");
  revalidatePath("/banking");
  revalidatePath("/banking/insights");
  revalidatePath("/banking/reconcile");
  revalidatePath("/banking/forecast");
}
export async function saveBankOverviewAction(company: CompanyScope, accountId: string, updatedAt: string, input: BankOverviewInput) {
  const user = await requireUser();
  try {
    await mutateData(user.id, "BANK_OVERVIEW_SETTINGS", "BankAccount", accountId, (data) => {
      const live = data.users.find((row) => row.id === user.id && isActiveUser(row));
      if (!live) throw new Error("利用者の権限を確認してください");
      return saveBankOverview(data, live, company, accountId, updatedAt, input, bankToday());
    });
    revalidateBanking(); return { success: true as const };
  } catch (error) { return { success: false as const, error: errorMessage(error) }; }
}
export async function saveBankEditsAction(company: CompanyScope, edits: BankEdit[]) {
  const user = await requireUser();
  try {
    const result = await mutateData(user.id, "BANK_CLASSIFY", "BankTransaction", company, (data) => {
      const live = data.users.find((row) => row.id === user.id && isActiveUser(row));
      if (!live) throw new Error("利用者の権限を確認してください");
      return saveBankEdits(data, live, company, edits);
    });
    revalidateBanking(); return { ...result, success: true as const };
  } catch (error) { return { success: false as const, error: errorMessage(error) }; }
}
export async function saveBankRuleAction(company: CompanyScope, input: BankRuleInput) {
  const user = await requireUser();
  try {
    await mutateData(user.id, "BANK_RULE_SAVE", "BankRule", input.id || "new", (data) => saveBankRule(data, user, company, input));
    revalidateBanking(); return { success: true };
  } catch (error) { return { error: errorMessage(error) }; }
}
export async function saveAccountingCategoryAction(company: CompanyScope, input: CategoryInput) {
  const user = await requireUser();
  try {
    await mutateData(user.id, "BANK_CATEGORY_SAVE", "AccountingCategory", input.id || "new", (data) => saveAccountingCategory(data, user, company, input));
    revalidateBanking(); return { success: true };
  } catch (error) { return { error: errorMessage(error) }; }
}
export async function deleteBankDefinitionAction(company: CompanyScope, kind: "category" | "rule", id: string, updatedAt: string) {
  const user = await requireUser();
  try {
    await mutateData(user.id, "BANK_DEFINITION_DELETE", kind, id, (data) => deleteBankDefinition(data, user, company, kind, id, updatedAt));
    revalidateBanking(); return { success: true };
  } catch (error) { return { error: errorMessage(error) }; }
}
export async function previewBankRulesAction(company: CompanyScope, ids?: string[]) {
  const user = await requireUser();
  try {
    const data = await readData();
    const live = data.users.find((row) => row.id === user.id && isActiveUser(row));
    if (!live) throw new Error("利用者の権限を確認してください");
    return { ...previewBankRules(data, live, company, ids, true), success: true as const };
  } catch (error) { return { success: false as const, error: errorMessage(error) }; }
}
export async function loadBankTransactionsAction(company: CompanyScope, params: Record<string, string | undefined>, revision: string) {
  const user = await requireUser();
  try {
    const data = await readData();
    const live = data.users.find((row) => row.id === user.id && isActiveUser(row));
    if (!live) throw new Error("利用者の権限を確認してください");
    assertBankAccess(live, company);
    if (revision !== bankingDataRevision(data, company)) throw new Error("明細が更新されました。編集内容を保存してから一覧を更新してください");
    const result = selectBankTransactions(data, company, bankFilters(params));
    return { rows: bankDisplayRows(data, result.rows), total: result.total, page: result.page, success: true as const };
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
    revalidateBanking();
    return { ...result, success: true as const };
  } catch (error) { return { success: false as const, error: errorMessage(error) }; }
}
