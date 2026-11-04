import "server-only";

import { z } from "zod";
import { bankToday, isBankDate } from "@/lib/banking";
import { bankCategorySection } from "@/lib/bank-category-catalog";
import { matchesCompany, type CompanyScope } from "@/lib/company";
import { expenseEditableBy, expenseMonth } from "@/lib/expense-claims";
import { uploadedFileNameFromUrl } from "@/lib/files";
import { assertCan, assertCompanyAccess, can, canAccessCompany } from "@/lib/rbac";
import type { AppData, ExpenseClaim, ExpenseClaimAction, User } from "@/lib/types";

type Actor = Pick<User, "id" | "role">;
export type ExpenseClaimView = ExpenseClaim & {
  month: string; submitterName: string; projectName: string; categoryName: string; reviewerName: string; paidByName: string; editable: boolean;
};

export function canViewExpenseFile(data: AppData, user: Actor, name: string) {
  return Boolean(name) && (data.expenseClaims || []).some((row) => !row.deletedAt && canAccessCompany(user, row.company)
    && uploadedFileNameFromUrl(row.fileUrl) === name
    && (can(user, "manage:expenses") || row.submittedById === user.id && can(user, "submit:expenses")));
}

function categoryName(data: AppData, company: CompanyScope, id?: string) {
  const category = data.accountingCategories.find((row) => row.id === id && row.company === company);
  if (!category) return id || "未設定";
  const parent = data.accountingCategories.find((row) => row.id === category.parentId && row.company === company);
  return parent ? `${parent.name} / ${category.name}` : category.name;
}

export function expenseCategoryOptions(data: AppData, company: CompanyScope) {
  return data.accountingCategories.filter((row) => row.company === company && row.available && !row.deletedAt && bankCategorySection(row.group).id === "EXPENSE")
    .map((row) => ({ value: row.id, label: categoryName(data, company, row.id) })).sort((a, b) => a.label.localeCompare(b.label, "ja"));
}

export function expenseClaimViews(data: AppData, actor: Actor, company: CompanyScope): ExpenseClaimView[] {
  assertCompanyAccess(actor, company); assertCan(actor, "submit:expenses");
  const manage = can(actor, "manage:expenses");
  const name = (id?: string) => data.users.find((row) => row.id === id)?.name || id || "—";
  return (data.expenseClaims || []).filter((row) => !row.deletedAt && row.company === company && (manage || row.submittedById === actor.id))
    .map((row) => ({ ...row, month: expenseMonth(row), submitterName: name(row.submittedById), reviewerName: name(row.reviewedById), paidByName: name(row.paidById),
      projectName: data.projects.find((project) => project.id === row.projectId && matchesCompany(project, company))?.name || row.projectId || "共通経費（案件なし）",
      categoryName: categoryName(data, company, row.categoryId), editable: expenseEditableBy(actor, row) }))
    .sort((a, b) => b.spentOn.localeCompare(a.spentOn) || b.createdAt.localeCompare(a.createdAt));
}

export function expenseSettlementSummary(views: ExpenseClaimView[], today: string) {
  const people = new Map<string, { userId: string; name: string; approvedCount: number; approvedAmount: number; submittedCount: number; submittedAmount: number }>();
  const totals = { submittedCount: 0, submittedAmount: 0, approvedCount: 0, approvedAmount: 0, paidThisMonth: 0 };
  for (const row of views) {
    let person = people.get(row.submittedById);
    if (!person) {
      person = { userId: row.submittedById, name: row.submitterName, approvedCount: 0, approvedAmount: 0, submittedCount: 0, submittedAmount: 0 };
      people.set(row.submittedById, person);
    }
    if (row.status === "SUBMITTED") { person.submittedCount++; person.submittedAmount += row.amount; totals.submittedCount++; totals.submittedAmount += row.amount; }
    if (row.status === "APPROVED") { person.approvedCount++; person.approvedAmount += row.amount; totals.approvedCount++; totals.approvedAmount += row.amount; }
    if (row.status === "PAID" && row.paidAt?.slice(0, 7) === today.slice(0, 7)) totals.paidThisMonth += row.amount;
  }
  return { people: [...people.values()].sort((a, b) => a.name.localeCompare(b.name, "ja")), totals };
}

const required = (label: string, max: number) => z.string().trim().min(1, `${label}を入力してください`).max(max, `${label}は${max}文字以内にしてください`);
const reference = required("対象", 1000), version = required("更新情報", 20000);
const memo = z.string().trim().max(1000, "メモは1000文字以内にしてください").optional();
const fields = {
  spentOn: z.string().refine((value) => isBankDate(value) && value <= bankToday(), "支払日は今日以前の実在する日付にしてください"),
  amount: z.number().finite().int("金額は整数円で入力してください").positive("金額は1円以上にしてください"),
  payee: required("支払先", 100), purpose: required("用途", 200),
  categoryId: reference.optional(), projectId: reference.optional(), paidWith: z.enum(["CASH", "PERSONAL_CARD", "OTHER"]).optional(), memo,
  file: z.object({ fileUrl: required("領収書", 2000), originalFileName: required("ファイル名", 1000), mimeType: z.enum(["application/pdf", "image/jpeg", "image/png"]), ocrText: z.string().max(4000, "OCRテキストは4000文字以内にしてください").optional() }).strict().optional(),
};
const mutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("submit"), ...fields }).strict(),
  z.object({ action: z.literal("update"), id: reference, version, ...fields }).strict(),
  z.object({ action: z.literal("withdraw"), id: reference, version }).strict(),
  z.object({ action: z.literal("approve"), id: reference, version }).strict(),
  z.object({ action: z.literal("return"), id: reference, version, note: required("差戻しの理由", 500) }).strict(),
  z.object({ action: z.literal("pay"), items: z.array(z.object({ id: reference, version }).strict()).min(1, "精算する申請を選択してください")
    .refine((items) => new Set(items.map((row) => row.id)).size === items.length, "同じ申請を重複して精算できません"),
    paidAt: z.string().refine(isBankDate, "振込日は実在する日付にしてください"), memo }).strict(),
  z.object({ action: z.literal("unpay"), id: reference, version }).strict(),
]);
export type ExpenseMutation = z.input<typeof mutationSchema>;
export type ExpenseWorkflowMutation = Exclude<ExpenseMutation, { action: "submit" | "update" }>;
type ExpenseMutationResult = { id: string; action: Exclude<ExpenseMutation["action"], "pay">; updatedAt: string } | { ids: string[]; action: "pay"; updatedAt: string };
const stamp = (previous?: string) => new Date(Math.max(Date.now(), previous ? Date.parse(previous) + 1 : 0)).toISOString();

function claim(data: AppData, company: CompanyScope, id: string, version: string) {
  const row = (data.expenseClaims || []).find((item) => item.id === id && item.company === company && !item.deletedAt);
  if (!row) throw new Error("経費の申請が見つかりません");
  if (row.updatedAt !== version) throw new Error("経費の申請が更新されています。再読込してください");
  return row;
}

function assertState(allowed: boolean) {
  if (!allowed) throw new Error("現在の状態ではこの操作はできません。再読込してください");
}

export function applyExpenseMutation(data: AppData, actor: Actor, company: CompanyScope, input: ExpenseMutation, submissionId?: string): ExpenseMutationResult {
  assertCompanyAccess(actor, company);
  assertCan(actor, ["submit", "update", "withdraw"].includes(input.action) ? "submit:expenses" : "manage:expenses");
  const value = mutationSchema.parse(input);
  if (value.action === "submit" || value.action === "update") {
    if (value.projectId && !data.projects.some((row) => row.id === value.projectId && !row.deletedAt && matchesCompany(row, company))) throw new Error("この会社の案件を選択してください");
    if (value.categoryId && !expenseCategoryOptions(data, company).some((row) => row.value === value.categoryId)) throw new Error("利用できる経費の勘定科目を選択してください");
    const contents = { spentOn: value.spentOn, amount: value.amount, payee: value.payee, purpose: value.purpose,
      categoryId: value.categoryId, projectId: value.projectId, paidWith: value.paidWith, memo: value.memo, ...value.file };
    if (value.action === "submit") {
      const id = submissionId ?? globalThis.crypto.randomUUID(), at = stamp();
      if ((data.expenseClaims || []).some((row) => row.id === id)) throw new Error("経費の申請が既に登録されています");
      (data.expenseClaims ??= []).push({ ...contents, id, company, submittedById: actor.id, status: "SUBMITTED",
        history: [{ action: "SUBMIT", at, byId: actor.id }], createdAt: at, updatedAt: at });
      return { id, action: value.action, updatedAt: at };
    }
    const row = claim(data, company, value.id, value.version);
    if (row.submittedById !== actor.id) throw new Error("権限がありません");
    assertState(expenseEditableBy(actor, row));
    const action = row.status === "RETURNED" ? "RESUBMIT" : "EDIT", at = stamp(row.updatedAt);
    Object.assign(row, contents, { status: "SUBMITTED", updatedAt: at });
    delete row.reviewNote;
    row.history.push({ action, at, byId: actor.id });
    return { id: row.id, action: value.action, updatedAt: at };
  }
  if (value.action === "pay") {
    // Validate the whole batch before touching any row, including its history.
    const rows = value.items.map((item) => claim(data, company, item.id, item.version));
    for (const row of rows) assertState(row.status === "APPROVED");
    const at = stamp(rows.reduce((latest, row) => row.updatedAt > latest ? row.updatedAt : latest, ""));
    for (const row of rows) {
      row.status = "PAID"; row.paidAt = value.paidAt; row.paidById = actor.id; row.paymentMemo = value.memo; row.updatedAt = at;
      row.history.push({ action: "PAY", at, byId: actor.id, note: value.memo });
    }
    return { ids: rows.map((row) => row.id), action: value.action, updatedAt: at };
  }
  const row = claim(data, company, value.id, value.version);
  if (value.action === "withdraw" && row.submittedById !== actor.id) throw new Error("権限がありません");
  const transitions = {
    withdraw: { allowed: expenseEditableBy(actor, row), status: "WITHDRAWN", history: "WITHDRAW" },
    approve: { allowed: row.status === "SUBMITTED", status: "APPROVED", history: "APPROVE" },
    return: { allowed: row.status === "SUBMITTED" || row.status === "APPROVED", status: "RETURNED", history: "RETURN" },
    unpay: { allowed: row.status === "PAID", status: "APPROVED", history: "UNPAY" },
  } as const;
  const next = transitions[value.action];
  assertState(next.allowed);
  const at = stamp(row.updatedAt);
  row.status = next.status; row.updatedAt = at;
  if (value.action === "approve" || value.action === "return") { row.reviewedById = actor.id; row.reviewedAt = at; }
  if (value.action === "return") row.reviewNote = value.note;
  if (value.action === "unpay") { delete row.paidAt; delete row.paidById; delete row.paymentMemo; }
  row.history.push({ action: next.history satisfies ExpenseClaimAction, at, byId: actor.id, ...(value.action === "return" ? { note: value.note } : {}) });
  return { id: row.id, action: value.action, updatedAt: at };
}

export function expenseReceiptFallback(text: string) {
  const normalized = text.normalize("NFKC");
  const dates = [...normalized.matchAll(/(\d{4})[\/年-]\s*(\d{1,2})[\/月-]\s*(\d{1,2})日?|令和\s*(元|\d{1,2})年\s*(\d{1,2})月\s*(\d{1,2})日/g)]
    .map((match) => `${match[1] || 2018 + (match[4] === "元" ? 1 : Number(match[4]))}-${(match[2] || match[5]).padStart(2, "0")}-${(match[3] || match[6]).padStart(2, "0")}`);
  const number = (value: string) => Number(value.replaceAll(",", ""));
  const positive = (value: number) => Number.isSafeInteger(value) && value > 0;
  const labeled = [...normalized.matchAll(/(?:合計|お買上(?:げ)?|ご請求|総額)[^\d\n]{0,20}(?:\n\s*[¥￥]?\s*)?([\d,]+)(?:\.00)?/g)].map((match) => number(match[1])).filter(positive);
  const amounts = [...normalized.matchAll(/(?:[¥￥]\s*([\d,]+)|([\d,]+)\s*円|\b(\d{1,3}(?:,\d{3})+)\b)/g)]
    .map((match) => number(match[1] || match[2] || match[3])).filter(positive);
  return { spentOn: dates.find(isBankDate) || "", amount: Math.max(0, ...(labeled.length ? labeled : amounts)) || undefined };
}
