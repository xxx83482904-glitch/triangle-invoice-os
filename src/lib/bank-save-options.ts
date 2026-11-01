import type { BankTransaction } from "@/lib/banking-types";
import { bankSaveIds, type BankDrafts, type BankSaveScope } from "@/lib/bank-workspace-drafts";

export type BankSaveChoice = "all" | BankSaveScope;
export type BankSaveOption = { value: BankSaveChoice; label: string; scope: BankSaveScope; count: number; disabled: boolean };

// "all" deliberately aliases the existing edited scope: review-only drafts are edits too.
// Predictions are never added here; bankSaveIds includes them only in selected scope.
export function bankSaveOptions(rows: BankTransaction[], drafts: BankDrafts, selected: Set<string>): BankSaveOption[] {
  return ([
    ["all", "すべての編集", "edited"],
    ["selected", "選択中の明細", "selected"],
    ["reviewed", "確認済みにした明細", "reviewed"],
    ["edited", "編集した明細", "edited"],
  ] as const).map(([value, label, scope]) => {
    const count = bankSaveIds(rows, drafts, selected, scope).length;
    return { value, label, scope, count, disabled: count === 0 };
  });
}

export function availableBankSaveOption(options: BankSaveOption[], value?: string) {
  return options.find((option) => !option.disabled && (value === undefined || option.value === value));
}
