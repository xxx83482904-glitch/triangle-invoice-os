import { bankFiscalYear } from "@/lib/bank-account-overview";
import type { BankEdit, BankTransaction } from "@/lib/banking-types";

export function bankLedgerMonths(year: number) {
  return Array.from({ length: 12 }, (_, index) => {
    const month = (index + 8) % 12 + 1;
    return `${month >= 9 ? year - 1 : year}-${String(month).padStart(2, "0")}`;
  });
}

export function bankLedgerYearMonth(year: number, months: string[]) {
  return months.filter((month) => bankFiscalYear(month) === year).sort().at(-1) || `${year - 1}-09`;
}

export function bankSelectionAmount(rows: BankTransaction[]) {
  return rows.reduce((sum, row) => sum + (row.side === "INCOME" ? row.amount : -row.amount), 0);
}

// Draft-only: validate the entire selection before marking anything reviewed.
export function reviewBankDrafts(rows: Array<BankTransaction & { linkLabel?: string }>, drafts: Record<string, BankEdit>, reviewed: boolean) {
  for (const row of rows) {
    const value = drafts[row.id] || row;
    if (value.reviewed === reviewed) continue;
    if (row.linkLabel === "資金移動") throw new Error("資金移動と照合済みです。確認状態を変える前に照合を解除してください");
    if (reviewed && (row.sourceMissing || (value.treatment === "NORMAL" && !value.categoryId))) throw new Error("確認前に、選択した明細の勘定科目と元明細を確認してください");
  }
  const next = { ...drafts };
  for (const row of rows) {
    const value = drafts[row.id] || row;
    if (value.reviewed === reviewed) continue;
    next[row.id] = {
      id: row.id, updatedAt: value.updatedAt, categoryId: value.categoryId, subCategoryId: value.subCategoryId,
      treatment: value.treatment, memo: value.memo, classificationSource: value.classificationSource,
      classificationConfidence: value.classificationConfidence, classificationReason: value.classificationReason, reviewed,
    };
  }
  return next;
}
