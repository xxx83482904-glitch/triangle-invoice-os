import type { AccountOverviewRow } from "@/lib/bank-account-overview";

export type BankBalanceSummaryProps = {
  row: Pick<AccountOverviewRow, "kind" | "unspecified" | "balance" | "balanceCalculation">;
};

const money = (value: number) => new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(value);

export function BankBalanceSummary({ row }: BankBalanceSummaryProps) {
  const { balance, balanceCalculation: calculation } = row;
  if (row.kind !== "BANK" || row.unspecified) {
    return <span className="block text-sm text-muted-foreground">{row.unspecified ? "口座未特定" : "預金残高の対象外"}</span>;
  }
  return <span className="block min-w-0 text-left">
    <span className="block text-xs text-muted-foreground">計算残高{calculation ? ` / ${calculation.through}まで` : ""}</span>
    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="min-w-0 break-all text-lg font-semibold tabular-nums">{calculation ? money(calculation.amount) : balance ? "計算不可" : "残高未登録"}</span>
      {calculation && !calculation.complete ? <span className="rounded border border-amber-500/40 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">暫定</span> : null}
    </span>
    {balance ? <span className="mt-1 block break-words text-xs text-muted-foreground">基準: {balance.asOf} 終日<span className="block break-all tabular-nums">手動登録 {money(balance.amount)}</span></span> : null}
    {calculation && !calculation.complete ? <span className="mt-1 block text-xs text-amber-700 dark:text-amber-400">取得データ未完備{calculation.missing ? ` / 元明細なし ${calculation.missing}件` : ""}</span> : null}
    {balance && !calculation ? <span className="mt-1 block text-xs text-destructive">基準残高・確認日の再確認が必要</span> : null}
  </span>;
}
