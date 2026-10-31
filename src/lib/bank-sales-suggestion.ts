import type { AppData } from "@/lib/types";
import type { AccountingCategory, BankEdit, BankTransaction } from "@/lib/banking-types";
import { bankCategorySection } from "@/lib/bank-category-catalog";
import { bankCategorySide } from "@/lib/bank-classification";

// A proposal only: it never changes the saved classification and never marks anything reviewed.
export type BankSalesSuggestion = {
  reason: string;
  categoryId?: string;
  categoryName?: string;
  acceptedIds: string[];
  candidates: Array<{ id: string; name: string }>;
};

type Selection = Pick<BankEdit, "categoryId" | "treatment">;
const normalize = (value: string) => value.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase("ja");
const salesName = (category: AccountingCategory) => /売上|売り上げ|sales|revenue/.test(normalize(category.name));
const isIncome = (category: AccountingCategory) => bankCategorySide(category) === "INCOME" || bankCategorySection(category.group).id === "INCOME";
const inScope = (category: AccountingCategory, row: BankTransaction) => category.company === row.company && !category.parentId && category.available && !category.deletedAt
  && (!category.officeCode || category.officeCode === row.officeCode);

// Income reconciled against an issued invoice is normally revenue. Deposits or reimbursements are legitimate
// exceptions, so the result is a hint for the person reviewing, not a rule or a block.
export function createBankSalesSuggester(data: AppData) {
  const liveIssued = new Set(data.issuedInvoices.filter((row) => !row.deletedAt).map((row) => row.id));
  const linked = new Set(data.bankReconciliations.filter((link) => !link.deletedAt && link.invoiceKind === "issued" && liveIssued.has(link.invoiceId)).map((link) => link.transactionId));
  const income = data.accountingCategories.filter(isIncome);
  return (row: BankTransaction, selection: Selection = row): BankSalesSuggestion | undefined => {
    if (row.side !== "INCOME" || row.sourceMissing || row.sourceStatus === "excluded" || row.bookkeeping?.splits?.length || selection.treatment !== "NORMAL" || !linked.has(row.id)) return;
    const scoped = income.filter((category) => inScope(category, row));
    const sales = scoped.filter(salesName);
    // Without a 売上-named category, any income category counts as acceptable.
    const accepted = sales.length ? sales : scoped;
    if (!accepted.length) return;
    const acceptedIds = accepted.map((category) => category.id);
    if (selection.categoryId && acceptedIds.includes(selection.categoryId)) return;
    const proposed = accepted.length === 1 ? accepted[0] : accepted.find((category) => normalize(category.name) === "売上高");
    const current = selection.categoryId ? data.accountingCategories.find((category) => category.id === selection.categoryId) : undefined;
    const state = current ? `現在の科目「${current.name}」は売上系ではありません` : "勘定科目が未設定です";
    return {
      reason: `発行請求書と照合済みの入金です。${state}。売上系の科目${proposed ? `「${proposed.name}」` : ""}を提案します（提案は未保存。内容を確認して採用してください）`,
      categoryId: proposed?.id, categoryName: proposed?.name, acceptedIds,
      candidates: accepted.map((category) => ({ id: category.id, name: category.name })),
    };
  };
}

export const bankSalesSuggestion = (data: AppData, row: BankTransaction, selection?: Selection) => createBankSalesSuggester(data)(row, selection);
