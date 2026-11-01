"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireUser } from "@/lib/auth";
import type { CompanyScope } from "@/lib/company";
import { savePayrollSettings, type PayrollSettingsInput } from "@/lib/payroll-settings";
import { parsePayrollYear, payrollYearCookieName } from "@/lib/payroll-summary";
import { assertCan, assertCompanyAccess } from "@/lib/rbac";
import { mutateData } from "@/lib/store";
import { isActiveUser } from "@/lib/user-access";

function message(error: unknown) {
  return error instanceof ZodError ? error.issues[0]?.message || "入力内容を確認してください" : error instanceof Error ? error.message : "保存できませんでした";
}
export async function savePayrollSettingsAction(company: CompanyScope, input: PayrollSettingsInput) {
  const user = await requireUser();
  try {
    const result = await mutateData(user.id, "SAVE_PAYROLL_SETTINGS", "PayrollSettings", company, (data) => {
      const actor = data.users.find((row) => row.id === user.id && isActiveUser(row));
      if (!actor) throw new Error("利用者の権限が変わっています");
      return savePayrollSettings(data, actor, company, input);
    });
    revalidatePath("/banking/payroll"); return { success: true as const, ...result };
  } catch (error) { return { success: false as const, error: message(error) }; }
}

export async function rememberPayrollYearAction(company: CompanyScope, year: number) {
  const user = await requireUser();
  try {
    assertCompanyAccess(user, company); assertCan(user, "view:banking");
    if (typeof year !== "number" || parsePayrollYear(String(year)) === undefined) throw new Error("年度は1901〜2200の整数で指定してください");
    (await cookies()).set(payrollYearCookieName(user.id, company), String(year), { path: "/banking/payroll", maxAge: 365 * 86400, httpOnly: true, sameSite: "lax", secure: process.env.SESSION_COOKIE_SECURE === "false" ? false : process.env.SESSION_COOKIE_SECURE === "true" || process.env.NODE_ENV === "production" });
    return { success: true as const, year };
  } catch (error) { return { success: false as const, error: message(error) }; }
}
