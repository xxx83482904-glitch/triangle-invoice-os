import { z } from "zod";
import type { AppData, User } from "@/lib/types";
import type { CompanyScope } from "@/lib/company";
import type { BankEdit, BankTransaction } from "@/lib/banking-types";
import { assertBankAccess, saveBankEdits } from "@/lib/banking";
import { bankClassificationLabel } from "@/lib/bank-classification";
import { hasConfirmedBankLink, knownBankCardSettlement } from "@/lib/bank-card-settlement";

// 取引先単位の一括変更: every row with the same description (and direction) gets the same category, reviewed rows included,
// after a preview that spells out what will change and what is left alone.
type Actor = Pick<User, "id" | "role">;
export const normalizeBankContent = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("ja");

const scopeSchema = z.object({ content: z.string().trim().min(1).max(500), side: z.enum(["INCOME", "EXPENSE"]).optional(), bankAccountId: z.string().max(1000).optional(), includeReviewed: z.boolean().default(true) });
export type BulkReclassifyScope = z.input<typeof scopeSchema>;
const applySchema = scopeSchema.extend({ categoryId: z.string().min(1).max(1000), subCategoryId: z.string().max(1000).optional(), reason: z.string().trim().min(1, "変更の理由を入力してください").max(500), expectedCount: z.number().int().min(1).optional() });
export type BulkReclassifyInput = z.input<typeof applySchema>;

export type BulkReclassifyPreview = {
  content: string; matched: number; reviewed: number; unreviewed: number;
  categories: Array<{ categoryId?: string; subCategoryId?: string; name: string; count: number }>;
  rows: Array<{ id: string; transactionDate: string; amount: number; side: BankTransaction["side"]; reviewed: boolean; categoryName: string; label: string }>;
  skipped: Array<{ id: string; transactionDate: string; amount: number; reason: string }>;
};

function targets(data: AppData, company: CompanyScope, scope: z.infer<typeof scopeSchema>) {
  const key = normalizeBankContent(scope.content);
  const matched: BankTransaction[] = [], skipped: BulkReclassifyPreview["skipped"] = [];
  for (const row of data.bankTransactions) {
    if (row.company !== company || normalizeBankContent(row.content) !== key) continue;
    if (scope.side && row.side !== scope.side) continue;
    if (scope.bankAccountId && row.bankAccountId !== scope.bankAccountId) continue;
    const skip = (reason: string) => skipped.push({ id: row.id, transactionDate: row.transactionDate, amount: row.amount, reason });
    if (row.sourceMissing) { skip("元明細がありません"); continue; }
    if (row.sourceStatus === "excluded") { skip("連携元で対象外の明細です"); continue; }
    if (row.treatment !== "NORMAL") { skip("振替・対象外の明細です"); continue; }
    if (row.bookkeeping?.splits?.length) { skip("科目分割があるため記帳詳細で変更してください"); continue; }
    if (row.bookkeeping?.hold) { skip("保留中の明細です"); continue; }
    if (knownBankCardSettlement(data, row)) { skip("カード精算の明細です"); continue; }
    if (!scope.includeReviewed && row.reviewed) { skip("確認済みのため対象外（含める設定で変更できます）"); continue; }
    matched.push(row);
  }
  matched.sort((a, b) => b.transactionDate.localeCompare(a.transactionDate) || a.id.localeCompare(b.id));
  return { matched, skipped };
}

export function previewBulkReclassify(data: AppData, company: CompanyScope, input: BulkReclassifyScope): BulkReclassifyPreview {
  const scope = scopeSchema.parse(input);
  const { matched, skipped } = targets(data, company, scope);
  const names = new Map(data.accountingCategories.map((row) => [row.id, row.name]));
  const name = (categoryId?: string, subCategoryId?: string) => categoryId ? `${names.get(categoryId) || "不明な科目"}${subCategoryId ? ` / ${names.get(subCategoryId) || "不明な補助科目"}` : ""}` : "未分類";
  const breakdown = new Map<string, { categoryId?: string; subCategoryId?: string; name: string; count: number }>();
  for (const row of matched) {
    const key = `${row.categoryId || ""}|${row.subCategoryId || ""}`;
    const entry = breakdown.get(key) || { categoryId: row.categoryId, subCategoryId: row.subCategoryId, name: name(row.categoryId, row.subCategoryId), count: 0 };
    entry.count++; breakdown.set(key, entry);
  }
  return { content: scope.content, matched: matched.length, reviewed: matched.filter((row) => row.reviewed).length, unreviewed: matched.filter((row) => !row.reviewed).length,
    categories: [...breakdown.values()].sort((a, b) => b.count - a.count),
    rows: matched.slice(0, 200).map((row) => ({ id: row.id, transactionDate: row.transactionDate, amount: row.amount, side: row.side, reviewed: row.reviewed, categoryName: name(row.categoryId, row.subCategoryId), label: bankClassificationLabel(row).label })),
    skipped };
}

// Applies through saveBankEdits so every rule (office scope, reconciliation protection, acknowledgement) still holds.
export function applyBulkReclassify(data: AppData, actor: Actor, company: CompanyScope, input: BulkReclassifyInput) {
  assertBankAccess(actor, company);
  const value = applySchema.parse(input);
  const { matched, skipped } = targets(data, company, value);
  if (!matched.length) throw new Error("対象の明細がありません");
  if (value.expectedCount !== undefined && value.expectedCount !== matched.length) throw new Error(`対象件数が変わりました（${value.expectedCount}件 → ${matched.length}件）。プレビューを更新してください`);
  const reason = `一括変更（${value.content}）: ${value.reason}`;
  const edits: BankEdit[] = matched.map((row) => ({ id: row.id, updatedAt: row.updatedAt, categoryId: value.categoryId, subCategoryId: value.subCategoryId || undefined, treatment: row.treatment, reviewed: row.reviewed, memo: row.memo,
    classificationSource: "MANUAL", classificationConfidence: "INFERRED", classificationReason: reason, acknowledgeGuess: undefined }));
  // Rows already reconciled keep their link: only the category changes, never the treatment.
  const linked = matched.filter((row) => hasConfirmedBankLink(data, row)).length;
  for (let offset = 0; offset < edits.length; offset += 500) saveBankEdits(data, actor, company, edits.slice(offset, offset + 500));
  return { changed: matched.length, reviewed: matched.filter((row) => row.reviewed).length, linked, skipped: skipped.length, reason };
}
