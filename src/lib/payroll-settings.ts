import { z } from "zod";
import type { CompanyScope } from "@/lib/company";
import { assertCan, assertCompanyAccess } from "@/lib/rbac";
import type { AppData, PayrollSettings, User } from "@/lib/types";

export const payrollCategoryPattern = /給与|給料|賞与|役員報酬|退職金|通勤手当/;
const excludedDefaultPattern = /支払報酬|源泉所得税|住民税|社会保険料|法定福利|税金/;
export const isDefaultPayrollCategory = (name: string) => {
  const normalized = name.normalize("NFKC").replace(/\s+/g, "");
  return payrollCategoryPattern.test(normalized) && !excludedDefaultPattern.test(normalized);
};
export type PayrollCategoryOption = { id: string; name: string; group: string; office: string; available: boolean };
export type PayrollSettingsView = { mode: "DEFAULT" | "CUSTOM"; updatedAt: string; categoryIds: string[]; missingCategoryIds: string[]; options: PayrollCategoryOption[] };

export function payrollSettingsView(data: AppData, company: CompanyScope): PayrollSettingsView {
  // Inactive master categories remain selectable for historical payroll; deleted and subcategories do not.
  const categories = data.accountingCategories.filter((row) => row.company === company && !row.deletedAt && !row.parentId);
  const setting = (data.payrollSettings || []).find((row) => row.company === company);
  const mode = setting?.mode || "DEFAULT";
  const selected = mode === "CUSTOM" ? setting!.categoryIds : categories.filter((row) => isDefaultPayrollCategory(row.name)).map((row) => row.id);
  const ids = new Set(categories.map((row) => row.id));
  return { mode, updatedAt: setting?.updatedAt || "", categoryIds: [...new Set(selected.filter((id) => ids.has(id)))], missingCategoryIds: selected.filter((id) => !ids.has(id)),
    options: categories.map((row) => ({ id: row.id, name: row.name, group: row.group, available: row.available,
      office: row.officeCode ? data.bankSyncStates.find((state) => state.company === company && state.officeCode === row.officeCode)?.officeName || row.officeCode : "" }))
      .sort((a, b) => a.name.localeCompare(b.name, "ja") || a.office.localeCompare(b.office, "ja") || a.id.localeCompare(b.id)) };
}

const schema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("CUSTOM"), categoryIds: z.array(z.string().min(1).max(1000)).max(2000).refine((ids) => new Set(ids).size === ids.length, "科目が重複しています"), updatedAt: z.string().max(1000) }).strict(),
  z.object({ mode: z.literal("DEFAULT"), updatedAt: z.string().max(1000) }).strict(),
]);
export type PayrollSettingsInput = z.input<typeof schema>;
const stamp = (previous?: string) => new Date(Math.max(Date.now(), previous ? Date.parse(previous) + 1 : 0)).toISOString();

export function savePayrollSettings(data: AppData, actor: Pick<User, "id" | "role">, company: CompanyScope, input: PayrollSettingsInput) {
  assertCompanyAccess(actor, company); assertCan(actor, "manage:banking");
  const value = schema.parse(input), current = (data.payrollSettings || []).find((row) => row.company === company);
  if ((current?.updatedAt || "") !== value.updatedAt) throw new Error("対象科目の設定が更新されています。再読込してから選び直してください");
  const categoryIds = value.mode === "CUSTOM" ? value.categoryIds : [];
  const allowed = new Set(payrollSettingsView(data, company).options.map((row) => row.id));
  if (categoryIds.some((id) => !allowed.has(id))) throw new Error("削除済み・別会社・補助科目は選べません。科目一覧を再読込してください");
  const timestamp = stamp(current?.updatedAt);
  const row: PayrollSettings = { id: current?.id || `payroll:${company}`, company, mode: value.mode, categoryIds: [...categoryIds], createdById: current?.createdById || actor.id, updatedById: actor.id, createdAt: current?.createdAt || timestamp, updatedAt: timestamp };
  if (current) Object.assign(current, row);
  else (data.payrollSettings ??= []).push(row);
  return { ...row, categoryNames: categoryIds.map((id) => data.accountingCategories.find((category) => category.id === id && category.company === company && !category.deletedAt && !category.parentId)!.name) };
}
