import { bankClassificationLabel } from "@/lib/bank-classification";
import type { BankTransaction } from "@/lib/banking-types";

const colors = {
  GUESS: "border-red-300 bg-red-100 text-red-900 dark:border-red-500/70 dark:bg-red-950 dark:text-red-200",
  HISTORY: "border-yellow-500 bg-yellow-300 text-yellow-950 dark:border-yellow-400 dark:bg-yellow-400 dark:text-yellow-950",
  INFERRED: "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-200/60 dark:bg-yellow-100 dark:text-yellow-950",
  CONFIRMED: "border-blue-400 bg-blue-100 text-blue-900 dark:border-blue-400 dark:bg-blue-900 dark:text-blue-100",
  UNAVAILABLE: "border-border bg-muted text-muted-foreground",
  NOT_APPLICABLE: "border-border bg-muted text-muted-foreground",
};

export function BankClassificationBadge({ row }: { row: BankTransaction }) {
  const state = bankClassificationLabel(row);
  const conflict = !row.reviewed && /競合|食い違|矛盾/.test(row.classificationReason || "");
  return <span data-classification={state.kind} title={row.classificationReason} aria-label={`${state.label}${row.classificationReason ? `：${row.classificationReason}` : ""}`} className={`inline-flex max-w-full items-center rounded border px-1.5 py-0.5 text-xs font-medium leading-5 ${colors[state.kind]}`}>
    {conflict ? "履歴競合・要確認" : row.sourceMissing ? "元明細なし" : state.kind === "NOT_APPLICABLE" && row.treatment === "TRANSFER" ? "振替・カード精算" : state.kind === "UNAVAILABLE" ? "有効な科目なし" : state.label}
  </span>;
}
