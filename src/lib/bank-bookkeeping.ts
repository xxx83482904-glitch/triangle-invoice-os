import { z } from "zod";
import { assertCan, assertCompanyAccess } from "@/lib/rbac";
import type { AccountingCategory, BankTransaction } from "@/lib/banking-types";
import type { CompanyScope } from "@/lib/company";
import type { AppData, User } from "@/lib/types";

export type BankSplit = { id: string; categoryId: string; subCategoryId?: string; amount: number; memo: string };
export type BankHoldReason = "MISSING_DOCUMENT" | "CATEGORY_UNCLEAR" | "AMOUNT_MISMATCH" | "DUPLICATE_REVIEW" | "OTHER";
export type BankHold = { reason: BankHoldReason; question: string };
// Optional BankTransaction contract. Allocations replace, never supplement, its parent category.
export type BankBookkeeping = {
  splits?: BankSplit[];
  hold?: BankHold;
  invoiceRequirement?: "UNDECIDED" | "REQUIRED" | "NOT_REQUIRED";
};
export type BankBookkeepingFields = { bookkeeping?: BankBookkeeping };
export type BookkeepingTransaction = BankTransaction & BankBookkeepingFields;
export type BankBookkeepingInput = {
  id: string;
  updatedAt: string;
  categoryId?: string;
  subCategoryId?: string;
  splits: BankSplit[];
  hold: BankHold | null;
  invoiceRequirement: NonNullable<BankBookkeeping["invoiceRequirement"]>;
  memo: string;
  reviewed: boolean;
};

const reference = z.string().min(1).max(1000);
const splitSchema = z.object({ id: reference, categoryId: reference, subCategoryId: reference.optional(), amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), memo: z.string().max(2000) }).strict();
const inputSchema = z.object({
  id: reference, updatedAt: reference, categoryId: reference.optional(), subCategoryId: reference.optional(),
  splits: z.array(splitSchema).max(50),
  hold: z.object({ reason: z.enum(["MISSING_DOCUMENT", "CATEGORY_UNCLEAR", "AMOUNT_MISMATCH", "DUPLICATE_REVIEW", "OTHER"]), question: z.string().trim().min(1).max(2000) }).strict().nullable(),
  invoiceRequirement: z.enum(["UNDECIDED", "REQUIRED", "NOT_REQUIRED"]), memo: z.string().max(2000), reviewed: z.boolean(),
}).strict();
type Actor = Pick<User, "id" | "role">;

function authorizedRow(data: AppData, actor: Actor, company: CompanyScope, id: string): BookkeepingTransaction {
  z.enum(["JAPAN", "CHINA"]).parse(company);
  assertCompanyAccess(actor, company);
  assertCan(actor, "manage:banking");
  reference.parse(id);
  const row = data.bankTransactions.find((item) => item.id === id && item.company === company);
  if (!row) throw new Error("明細が見つかりません");
  if (!data.bankAccounts.some((account) => account.id === row.bankAccountId && account.company === company && account.officeCode === row.officeCode)) throw new Error("明細と口座の会社・事業者が一致しません");
  return row;
}

function categoryIssue(categories: AccountingCategory[], row: BankTransaction, categoryId?: string, subCategoryId?: string) {
  const usable = (category: AccountingCategory) => category.company === row.company && category.available && !category.deletedAt && (!category.officeCode || category.officeCode === row.officeCode);
  if (categoryId && !categories.some((category) => category.id === categoryId && !category.parentId && usable(category))) return "明細と同じ会社・事業者の有効な勘定科目を選択してください";
  if (subCategoryId && (!categoryId || !categories.some((category) => category.id === subCategoryId && category.parentId === categoryId && usable(category)))) return "補助科目が勘定科目・事業者と一致しません";
  return "";
}

export function bankSplitValidation(row: BankTransaction, splits: BankSplit[], categories?: AccountingCategory[]) {
  if (!splits.length) return { total: 0, remaining: row.amount, issue: "" };
  const total = splits.reduce((sum, split) => sum + split.amount, 0);
  let issue = "";
  if (row.treatment !== "NORMAL") issue = "振替・対象外の明細は科目分割できません";
  else if (!Number.isSafeInteger(row.amount) || row.amount <= 0) issue = "元明細の金額を確認してください";
  else if (splits.length < 2 || splits.length > 50) issue = "分割は2行から50行で入力してください";
  else if (new Set(splits.map((split) => split.id)).size !== splits.length) issue = "分割行のIDが重複しています";
  else if (splits.some((split) => !split.id || !split.categoryId || !Number.isSafeInteger(split.amount) || split.amount <= 0)) issue = "各分割行の科目と1円以上の整数金額を入力してください";
  else if (!Number.isSafeInteger(total) || total !== row.amount) issue = "分割合計が明細金額と一致しません";
  else if (categories) {
    for (const split of splits) {
      issue = categoryIssue(categories, row, split.categoryId, split.subCategoryId);
      if (issue) break;
    }
  }
  return { total, remaining: row.amount - total, issue };
}

// Aggregators consume exactly one allocation set. Invalid source-corrected splits
// fall back to the whole amount as unclassified until the user repairs them.
export function bankCategoryAllocations(row: BookkeepingTransaction): Array<{ categoryId?: string; subCategoryId?: string; amount: number }> {
  if (row.sourceMissing || row.sourceStatus === "excluded" || row.treatment !== "NORMAL") return [];
  if (row.bookkeeping?.splits?.length) return bankSplitValidation(row, row.bookkeeping.splits).issue
    ? [{ amount: row.amount }]
    : row.bookkeeping.splits.map(({ categoryId, subCategoryId, amount }) => ({ categoryId, subCategoryId, amount }));
  return [{ categoryId: row.categoryId, subCategoryId: row.subCategoryId, amount: row.amount }];
}

const normalized = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("ja");
export type BankDuplicateCandidate = {
  id: string; sourceId: string; comparedSourceId: string; bankAccountId: string; accountName: string;
  officeCode: string; transactionDate: string; amount: number; side: BankTransaction["side"]; content: string;
  sourceMissing: boolean; evidence: Array<"SOURCE_ID" | "DATE_AMOUNT_CONTENT">;
};

export function bankDuplicateCandidates(data: AppData, actor: Actor, company: CompanyScope, id: string): BankDuplicateCandidate[] {
  const row = authorizedRow(data, actor, company, id);
  const accounts = new Map(data.bankAccounts.filter((account) => account.company === company && account.officeCode === row.officeCode).map((account) => [account.id, account]));
  return data.bankTransactions.flatMap((other): BankDuplicateCandidate[] => {
    if (other.id === row.id || other.company !== company || other.officeCode !== row.officeCode || !accounts.has(other.bankAccountId)) return [];
    const evidence: BankDuplicateCandidate["evidence"] = [];
    if (row.sourceId && other.sourceId === row.sourceId) evidence.push("SOURCE_ID");
    if (other.side === row.side && other.amount === row.amount && other.transactionDate === row.transactionDate && normalized(row.content) && normalized(other.content) === normalized(row.content)) evidence.push("DATE_AMOUNT_CONTENT");
    if (!evidence.length) return [];
    return [{ id: other.id, sourceId: other.sourceId, comparedSourceId: row.sourceId, bankAccountId: other.bankAccountId, accountName: accounts.get(other.bankAccountId)!.name, officeCode: other.officeCode, transactionDate: other.transactionDate, amount: other.amount, side: other.side, content: other.content, sourceMissing: other.sourceMissing, evidence }];
  }).sort((a, b) => Number(b.evidence.includes("SOURCE_ID")) - Number(a.evidence.includes("SOURCE_ID")) || a.id.localeCompare(b.id));
}

function lockedReason(data: AppData, row: BankTransaction) {
  if ((data.bankTransfers || []).some((link) => !link.deletedAt && [link.outgoingId, link.incomingId].includes(row.id))) return "資金移動と照合済みです。詳細を変える前に資金移動の照合を解除してください";
  if (row.sourceMissing || row.sourceStatus === "excluded") return "元明細なし・連携元で対象外のため編集できません";
  return "";
}

export function bankBookkeepingDetail(data: AppData, actor: Actor, company: CompanyScope, id: string) {
  const row = authorizedRow(data, actor, company, id);
  return {
    transaction: structuredClone(row),
    duplicates: bankDuplicateCandidates(data, actor, company, id),
    lockedReason: lockedReason(data, row),
    invoiceLinked: data.bankReconciliations.some((link) => !link.deletedAt && link.transactionId === row.id),
  };
}
export type BankBookkeepingDetail = ReturnType<typeof bankBookkeepingDetail>;

export function saveBankBookkeeping(data: AppData, actor: Actor, company: CompanyScope, input: BankBookkeepingInput) {
  const row = authorizedRow(data, actor, company, input?.id);
  const value = inputSchema.parse(input);
  if (row.updatedAt !== value.updatedAt) throw new Error("明細が更新されています。詳細を開き直して再度保存してください");
  const locked = lockedReason(data, row);
  if (locked) throw new Error(locked);
  const splitIssue = bankSplitValidation(row, value.splits, data.accountingCategories).issue;
  if (splitIssue) throw new Error(splitIssue);
  if (value.splits.length && (value.categoryId || value.subCategoryId)) throw new Error("分割科目と単一科目を同時に設定できません");
  const selectionIssue = categoryIssue(data.accountingCategories, row, value.categoryId, value.subCategoryId);
  if (selectionIssue) throw new Error(selectionIssue);
  if (value.invoiceRequirement === "NOT_REQUIRED" && data.bankReconciliations.some((link) => !link.deletedAt && link.transactionId === row.id)) throw new Error("請求書と照合済みのため請求書不要にはできません");
  if (value.reviewed && value.hold) throw new Error("保留中の明細は確認済みにできません");
  if (value.reviewed && row.treatment === "NORMAL" && !value.categoryId && !value.splits.length) throw new Error("確認済みにする前に勘定科目を選択してください");
  const updatedAt = new Date(Math.max(Date.now(), Number.isFinite(Date.parse(row.updatedAt)) ? Date.parse(row.updatedAt) + 1 : 0)).toISOString();
  Object.assign(row, {
    categoryId: value.splits.length ? undefined : value.categoryId,
    subCategoryId: value.splits.length ? undefined : value.subCategoryId,
    bookkeeping: { splits: value.splits.length ? value.splits : undefined, hold: value.hold || undefined, invoiceRequirement: value.invoiceRequirement },
    memo: value.memo, reviewed: value.hold ? false : value.reviewed,
    classificationSource: "MANUAL", classificationConfidence: undefined, classificationReason: undefined, ruleId: undefined, updatedAt,
  });
  return { transaction: structuredClone(row) };
}
