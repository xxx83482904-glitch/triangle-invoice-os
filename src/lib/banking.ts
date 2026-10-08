import { z } from "zod";
import type { CompanyScope } from "@/lib/company";
import { assertCan } from "@/lib/rbac";
import type { AppData, User } from "@/lib/types";
import type { AccountingCategory, BankEdit, BankFilters, BankRule, BankRuleInput, BankTransaction, CategoryInput } from "@/lib/banking-types";

export const treatmentLabels = { NORMAL: "通常", TRANSFER: "振替・カード精算", EXCLUDED: "対象外" } as const;
export const categoryGroups = { EXPENSE: "費用", INCOME: "収益", ASSET: "資産", LIABILITY: "負債", EQUITY: "純資産", OTHER: "その他" } as const;
export const BANK_PAGE_SIZE = 50;
type Actor = Pick<User, "id" | "role">;
const companySchema = z.enum(["JAPAN", "CHINA"]);
const reference = z.string().max(1000).optional();
const treatment = z.enum(["NORMAL", "TRANSFER", "EXCLUDED"]);
const normalized = (text: string) => text.normalize("NFKC").trim().toLocaleLowerCase("ja");
const stamp = (previous?: string) => new Date(Math.max(Date.now(), previous ? Date.parse(previous) + 1 : 0)).toISOString();
export const sourceKey = (company: CompanyScope, office: string, kind: string, id: string, subId = "") => ["mf", company, office, kind, id, subId].map(encodeURIComponent).join(":");

export function isBankDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
export function bankToday() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
export function monthRanges(start: string, end: string) {
  if (!isBankDate(start) || !isBankDate(end) || start > end) throw new Error("取得期間が不正です");
  if (Number(start.slice(0, 4)) < 1900 || Number(end.slice(0, 4)) > 2200) throw new Error("取得期間が不正です");
  const result: Array<{ start: string; end: string }> = [];
  let cursor = start;
  while (cursor <= end) {
    const date = new Date(`${cursor}T00:00:00Z`);
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    const through = last < end ? last : end;
    result.push({ start: cursor, end: through });
    cursor = new Date(Date.parse(`${through}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  }
  return result;
}

export function assertBankAccess(user: Actor, company: CompanyScope) {
  companySchema.parse(company);
  assertCan(user, "manage:banking");
}

function categorySelection(data: AppData, company: CompanyScope, categoryId?: string, subCategoryId?: string) {
  const category = categoryId ? data.accountingCategories.find((item) => item.id === categoryId && item.company === company && !item.parentId && item.available && !item.deletedAt) : undefined;
  if (categoryId && !category) throw new Error("有効な勘定科目を選択してください");
  if (subCategoryId && !data.accountingCategories.some((item) => item.id === subCategoryId && item.company === company && item.parentId === categoryId && item.available && !item.deletedAt)) throw new Error("補助科目が勘定科目と一致しません");
}

export function saveBankEdits(data: AppData, user: Actor, company: CompanyScope, input: BankEdit[]) {
  assertBankAccess(user, company);
  const edits = z.array(z.object({ id: z.string(), updatedAt: z.string(), categoryId: reference, subCategoryId: reference, treatment, reviewed: z.boolean(), memo: z.string().max(2000) })).min(1).max(500).parse(input);
  if (new Set(edits.map((row) => row.id)).size !== edits.length) throw new Error("明細が重複しています");
  const byId = new Map(data.bankTransactions.filter((row) => row.company === company).map((row) => [row.id, row]));
  const changes = edits.map((edit) => {
    const row = byId.get(edit.id);
    if (!row) throw new Error("明細が見つかりません");
    if (row.updatedAt !== edit.updatedAt) throw new Error("明細が更新されています。画面を更新して再度保存してください");
    categorySelection(data, company, edit.categoryId, edit.subCategoryId);
    if (edit.reviewed && (row.sourceMissing || (edit.treatment === "NORMAL" && !edit.categoryId))) throw new Error("確認済みにする前に勘定科目と元明細を確認してください");
    return { row, edit };
  });
  // Validate the entire batch before touching any row.
  for (const { row, edit } of changes) Object.assign(row, edit, { categoryId: edit.categoryId || undefined, subCategoryId: edit.subCategoryId || undefined, classificationSource: "MANUAL", ruleId: undefined, updatedAt: stamp(row.updatedAt) });
  return { count: changes.length };
}

const ruleSchema = z.object({
  id: reference, updatedAt: reference, name: z.string().trim().min(1).max(150), keyword: z.string().trim().min(1).max(250),
  match: z.enum(["CONTAINS", "EXACT"]), bankAccountId: reference, side: z.enum(["ALL", "INCOME", "EXPENSE"]),
  categoryId: reference, subCategoryId: reference, treatment, priority: z.number().int().min(1).max(9999), enabled: z.boolean(),
});
export function saveBankRule(data: AppData, user: Actor, company: CompanyScope, input: BankRuleInput) {
  assertBankAccess(user, company);
  const values = ruleSchema.parse(input);
  categorySelection(data, company, values.categoryId, values.subCategoryId);
  if (values.treatment === "NORMAL" && !values.categoryId) throw new Error("勘定科目を選択してください");
  if (values.bankAccountId && !data.bankAccounts.some((row) => row.id === values.bankAccountId && row.company === company)) throw new Error("口座が見つかりません");
  const existing = values.id ? data.bankRules.find((row) => row.id === values.id && row.company === company && !row.deletedAt) : undefined;
  if (values.id && (!existing || existing.updatedAt !== values.updatedAt)) throw new Error("ルールが更新されています。画面を更新してください");
  const timestamp = stamp(existing?.updatedAt);
  const result: BankRule = { ...values, bankAccountId: values.bankAccountId || undefined, categoryId: values.categoryId || undefined, subCategoryId: values.subCategoryId || undefined, id: existing?.id || crypto.randomUUID(), company, createdAt: existing?.createdAt || timestamp, updatedAt: timestamp };
  if (existing) Object.assign(existing, result); else data.bankRules.push(result);
  return result;
}

export function saveAccountingCategory(data: AppData, user: Actor, company: CompanyScope, input: CategoryInput) {
  assertBankAccess(user, company);
  const values = z.object({ id: reference, updatedAt: reference, name: z.string().trim().min(1).max(150), group: z.string().min(1).max(100), parentId: reference }).parse(input);
  if (!Object.hasOwn(categoryGroups, values.group)) throw new Error("科目区分が不正です");
  if (values.parentId) categorySelection(data, company, values.parentId);
  const existing = values.id ? data.accountingCategories.find((row) => row.id === values.id && row.company === company && !row.deletedAt) : undefined;
  if (values.id && (!existing || existing.updatedAt !== values.updatedAt)) throw new Error("科目が更新されています。画面を更新してください");
  if (existing?.sourceId) throw new Error("連携科目の名称はマネーフォワード側で変更してください");
  if (existing && (existing.parentId || "") !== (values.parentId || "")) throw new Error("既存科目の親科目は変更できません");
  if (data.accountingCategories.some((row) => row.company === company && !row.deletedAt && row.id !== values.id && (row.parentId || "") === (values.parentId || "") && normalized(row.name) === normalized(values.name))) throw new Error("同名の科目がすでに存在します");
  const timestamp = stamp(existing?.updatedAt);
  const category: AccountingCategory = { ...values, parentId: values.parentId || undefined, company, id: existing?.id || crypto.randomUUID(), available: true, createdAt: existing?.createdAt || timestamp, updatedAt: timestamp };
  if (existing) Object.assign(existing, category); else data.accountingCategories.push(category);
  return category;
}

export function deleteBankDefinition(data: AppData, user: Actor, company: CompanyScope, kind: "category" | "rule", id: string, updatedAt: string) {
  assertBankAccess(user, company);
  z.enum(["category", "rule"]).parse(kind);
  const row = (kind === "category" ? data.accountingCategories : data.bankRules).find((item) => item.id === id && item.company === company && !item.deletedAt);
  if (!row || row.updatedAt !== updatedAt) throw new Error("対象が更新されています。画面を更新してください");
  if (kind === "category") {
    if ((row as AccountingCategory).sourceId) throw new Error("連携科目は削除できません");
    if (data.bankTransactions.some((t) => t.company === company && (t.categoryId === id || t.subCategoryId === id)) || data.bankRules.some((r) => r.company === company && !r.deletedAt && (r.categoryId === id || r.subCategoryId === id)) || data.accountingCategories.some((c) => c.parentId === id && !c.deletedAt)) throw new Error("使用中の科目は削除できません");
  }
  row.deletedAt = stamp(row.updatedAt); row.updatedAt = row.deletedAt;
  return { id };
}

function matchesBankAccount(data: AppData, company: CompanyScope, filterId: string, rowId: string) {
  if (!filterId || filterId === rowId) return true;
  const parent = data.bankAccounts.find((row) => row.id === filterId && row.company === company && !row.sourceSubId);
  return Boolean(parent && data.bankAccounts.some((row) => row.id === rowId && row.company === company && row.officeCode === parent.officeCode && row.sourceId === parent.sourceId));
}

function ruleFor(data: AppData, transaction: BankTransaction) {
  return data.bankRules.filter((rule) => rule.company === transaction.company && !rule.deletedAt && rule.enabled && matchesBankAccount(data, transaction.company, rule.bankAccountId || "", transaction.bankAccountId) && (rule.side === "ALL" || rule.side === transaction.side))
    .sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).find((rule) => {
      try { categorySelection(data, transaction.company, rule.categoryId, rule.subCategoryId); } catch { return false; }
      const content = normalized(transaction.content), keyword = normalized(rule.keyword);
      return rule.match === "EXACT" ? content === keyword : content.includes(keyword);
    });
}

export function classifyBankTransaction(data: AppData, transaction: BankTransaction) {
  if (transaction.classificationSource === "MANUAL" || transaction.reviewed || transaction.sourceMissing || transaction.sourceStatus === "excluded") return false;
  const rule = ruleFor(data, transaction);
  if (!rule) {
    if (transaction.classificationSource !== "RULE") return false;
    Object.assign(transaction, { categoryId: undefined, subCategoryId: undefined, ruleId: undefined, treatment: "NORMAL", classificationSource: "UNASSIGNED", updatedAt: stamp(transaction.updatedAt) });
    return true;
  }
  const next = { categoryId: rule.categoryId, subCategoryId: rule.subCategoryId, treatment: rule.treatment, classificationSource: "RULE" as const, ruleId: rule.id };
  if (Object.entries(next).every(([key, value]) => transaction[key as keyof BankTransaction] === value)) return false;
  Object.assign(transaction, next, { updatedAt: stamp(transaction.updatedAt) });
  return true;
}

export function applyBankRules(data: AppData, user: Actor, company: CompanyScope) {
  assertBankAccess(user, company);
  let count = 0;
  for (const row of data.bankTransactions) if (row.company === company && classifyBankTransaction(data, row)) count++;
  return { count };
}

export type ImportedAccount = { id: string; subId?: string; name: string; serviceName: string; isManual: boolean };
export type ImportedCategory = { id: string; parentSourceId?: string; name: string; group: string; available: boolean };
export type ImportedTransaction = { id: string; connected_account_id: string; connected_sub_account_id?: string | null; date: string; value: number; side: "INCOME" | "EXPENSE"; content: string; memo?: string | null; journalizing_status: string };

export function mergeBankMasters(data: AppData, company: CompanyScope, office: string, accounts: ImportedAccount[], categories: ImportedCategory[]) {
  const timestamp = stamp();
  const accountIds = new Set<string>();
  for (const account of accounts) {
    const id = sourceKey(company, office, "account", account.id, account.subId);
    accountIds.add(id);
    const existing = data.bankAccounts.find((row) => row.id === id);
    const values = { id, company, officeCode: office, sourceId: account.id, sourceSubId: account.subId, name: account.name, serviceName: account.serviceName, isManual: account.isManual, available: true };
    if (existing) Object.assign(existing, values, { updatedAt: timestamp });
    else data.bankAccounts.push({ ...values, createdAt: timestamp, updatedAt: timestamp });
  }
  for (const row of data.bankAccounts) if (row.company === company && row.officeCode === office && !accountIds.has(row.id)) row.available = false;
  const categoryIds = new Set<string>();
  for (const item of categories) {
    const id = sourceKey(company, office, "category", item.id, item.parentSourceId);
    categoryIds.add(id);
    const existing = data.accountingCategories.find((row) => row.id === id);
    const values = { id, company, officeCode: office, sourceId: item.id, parentId: item.parentSourceId ? sourceKey(company, office, "category", item.parentSourceId) : undefined, name: item.name, group: item.group, available: item.available };
    if (existing) Object.assign(existing, values, { updatedAt: timestamp });
    else data.accountingCategories.push({ ...values, createdAt: timestamp, updatedAt: timestamp });
  }
  for (const row of data.accountingCategories) if (row.company === company && row.officeCode === office && row.sourceId && !categoryIds.has(row.id)) row.available = false;
}

export function mergeBankTransactions(data: AppData, company: CompanyScope, office: string, items: ImportedTransaction[], range: { start: string; end: string }) {
  monthRanges(range.start, range.end);
  const seen = new Set<string>();
  const byId = new Map(data.bankTransactions.filter((row) => row.company === company && row.officeCode === office).map((row) => [row.sourceId, row]));
  const accountIds = new Set(data.bankAccounts.filter((row) => row.company === company && row.officeCode === office).map((row) => row.id));
  for (const item of items) {
    if (!isBankDate(item.date) || item.date < range.start || item.date > range.end || !Number.isSafeInteger(item.value) || item.value < 0 || !["INCOME", "EXPENSE"].includes(item.side) || !item.id || seen.has(item.id)) throw new Error("明細の形式または取得範囲が不正です。同期を再実行してください");
    seen.add(item.id);
    if (!accountIds.has(sourceKey(company, office, "account", item.connected_account_id, item.connected_sub_account_id || undefined))) throw new Error("明細の口座情報が一致しません。再同期してください");
  }
  let imported = 0, updated = 0;
  for (const item of items) {
    const existing = byId.get(item.id);
    const values = { bankAccountId: sourceKey(company, office, "account", item.connected_account_id, item.connected_sub_account_id || undefined), transactionDate: item.date, amount: item.value, side: item.side, content: item.content, sourceMemo: item.memo || "", sourceStatus: item.journalizing_status, sourceMissing: false };
    if (existing) {
      if (Object.entries(values).some(([key, value]) => existing[key as keyof BankTransaction] !== value)) {
        if (existing.classificationSource !== "MANUAL") {
          if (values.sourceStatus === "excluded") existing.treatment = "EXCLUDED";
          else if (existing.sourceStatus === "excluded" && existing.treatment === "EXCLUDED") existing.treatment = "NORMAL";
        }
        Object.assign(existing, values, { reviewed: false, updatedAt: stamp(existing.updatedAt) });
        updated++;
      }
      classifyBankTransaction(data, existing);
    } else {
      const timestamp = stamp();
      const row: BankTransaction = { ...values, id: sourceKey(company, office, "transaction", item.id), company, officeCode: office, sourceId: item.id, treatment: item.journalizing_status === "excluded" ? "EXCLUDED" : "NORMAL", classificationSource: "UNASSIGNED", reviewed: false, memo: "", createdAt: timestamp, updatedAt: timestamp };
      classifyBankTransaction(data, row);
      data.bankTransactions.push(row); imported++;
    }
  }
  // Only a completely fetched period may mark vanished source rows. Never delete local history.
  for (const row of byId.values()) if (row.transactionDate >= range.start && row.transactionDate <= range.end && !seen.has(row.sourceId) && !row.sourceMissing) {
    row.sourceMissing = true; row.reviewed = false; row.updatedAt = stamp(row.updatedAt); updated++;
  }
  return { imported, updated };
}

export function bankFilters(params: Record<string, string | undefined>): BankFilters {
  return { month: /^\d{4}-(0[1-9]|1[0-2])$/.test(params.month || "") ? params.month! : "", account: params.account || "", category: params.category || "", side: ["INCOME", "EXPENSE"].includes(params.side || "") ? params.side! : "", status: ["unclassified", "unreviewed", "reviewed", "transfer", "excluded", "missing"].includes(params.status || "") ? params.status! : "", query: (params.q || "").slice(0, 200), sort: ["date-asc", "amount-desc", "amount-asc"].includes(params.sort || "") ? params.sort! : "date-desc", page: Math.max(1, Math.min(100000, Math.floor(Number(params.page) || 1))) };
}

export function selectBankTransactions(data: AppData, company: CompanyScope, filters: BankFilters) {
  const all = data.bankTransactions.filter((row) => row.company === company);
  const query = normalized(filters.query);
  const rows = all.filter((row) => (!filters.month || row.transactionDate.startsWith(filters.month)) && matchesBankAccount(data, company, filters.account, row.bankAccountId) && (!filters.category || row.categoryId === filters.category || row.subCategoryId === filters.category) && (!filters.side || row.side === filters.side) && (!query || normalized(`${row.content} ${row.memo} ${row.sourceMemo}`).includes(query)) && (!filters.status || (filters.status === "unclassified" && !row.categoryId && row.treatment === "NORMAL") || (filters.status === "unreviewed" && !row.reviewed) || (filters.status === "reviewed" && row.reviewed) || (filters.status === "transfer" && row.treatment === "TRANSFER") || (filters.status === "excluded" && row.treatment === "EXCLUDED") || (filters.status === "missing" && row.sourceMissing)));
  const months = Array.from(new Set(all.map((row) => row.transactionDate.slice(0, 7)))).sort().reverse();
  const direction = filters.sort.endsWith("asc") ? 1 : -1;
  rows.sort((a, b) => direction * (filters.sort.startsWith("amount") ? a.amount - b.amount : a.transactionDate.localeCompare(b.transactionDate)) || a.id.localeCompare(b.id));
  const page = Math.min(filters.page, Math.max(1, Math.ceil(rows.length / BANK_PAGE_SIZE)));
  const summary = rows.reduce((sum, row) => {
    if (row.sourceMissing || row.treatment !== "NORMAL") { sum.excluded++; return sum; }
    if (row.side === "INCOME") sum.income += row.amount; else sum.expense += row.amount;
    if (!row.categoryId) sum.unclassified++;
    return sum;
  }, { income: 0, expense: 0, excluded: 0, unclassified: 0 });
  return { rows: rows.slice((page - 1) * BANK_PAGE_SIZE, page * BANK_PAGE_SIZE), total: rows.length, page, months, summary };
}
