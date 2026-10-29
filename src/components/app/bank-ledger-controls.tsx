"use client";

import { Check, ChevronLeft, ChevronRight, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { bankFiscalYear } from "@/lib/bank-account-overview";
import { bankLedgerMonths, bankLedgerYearMonth } from "@/lib/bank-ledger";

export function BankFiscalMonthTabs({ value, months, today, disabled, onChange }: {
  value: string; months: string[]; today: string; disabled: boolean; onChange: (month: string) => void;
}) {
  const year = bankFiscalYear(value || [...months].sort().at(-1) || today);
  const years = [...new Set([year, bankFiscalYear(today), ...months.map(bankFiscalYear)])].sort((a, b) => b - a);
  return <nav aria-label="取引月" className="bank-fiscal-months">
    <div className="flex shrink-0 items-center gap-1">
      <Button variant="ghost" size="icon" className="size-9" title="前の年度" aria-label="前の年度" disabled={disabled || year <= 1901} onClick={() => onChange(bankLedgerYearMonth(year - 1, months))}><ChevronLeft className="size-4" /></Button>
      <select aria-label="決算年度" className="bank-period-select" value={year} disabled={disabled} onChange={(event) => onChange(bankLedgerYearMonth(Number(event.target.value), months))}>{years.map((item) => <option key={item} value={item}>{item - 1}.09 - {item}.08</option>)}</select>
      <Button variant="ghost" size="icon" className="size-9" title="次の年度" aria-label="次の年度" disabled={disabled || year >= Math.max(bankFiscalYear(today), ...months.map(bankFiscalYear))} onClick={() => onChange(bankLedgerYearMonth(year + 1, months))}><ChevronRight className="size-4" /></Button>
    </div>
    <div className="bank-month-tabs" aria-label="月を選択">
      <button type="button" disabled={disabled} aria-pressed={!value} onClick={() => onChange("")}>全期間</button>
      {bankLedgerMonths(year).map((month) => <button type="button" key={month} title={`${month.slice(0, 4)}年${Number(month.slice(5))}月`} aria-label={`${month.slice(0, 4)}年${Number(month.slice(5))}月`} aria-pressed={value === month} disabled={disabled} onClick={() => onChange(month)}>{Number(month.slice(5))}月</button>)}
    </div>
  </nav>;
}

export function BankSelectionReview({ count, amount, reviewedCount, disabled, onClear, onReview }: {
  count: number; amount: number; reviewedCount: number; disabled: boolean; onClear: () => void; onReview: (reviewed: boolean) => void;
}) {
  return <section className="bank-selection-review" aria-label="選択明細の一括確認">
    <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold" aria-live="polite">{count ? `${count}件選択中` : "明細未選択"}</h2><Button variant="ghost" size="icon" className="size-8" title="選択解除" aria-label="選択解除" disabled={disabled || !count} onClick={onClear}><X className="size-4" /></Button></div>
    <dl className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><dt className="text-xs text-muted-foreground">選択金額</dt><dd className="break-all text-xl font-semibold tabular-nums">{count ? new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(amount) : "—"}</dd></dl>
    <div className="flex gap-2"><Button className="bank-review-action min-h-11 flex-1" variant="outline" disabled={disabled || !count || reviewedCount === count} onClick={() => onReview(true)}><Check className="size-4" />確認</Button>{reviewedCount ? <Button variant="outline" size="icon" className="size-11" title="選択明細を未確認に戻す" aria-label="選択明細を未確認に戻す" disabled={disabled} onClick={() => onReview(false)}><RotateCcw className="size-4" /></Button> : null}</div>
  </section>;
}

export function BankReviewTag({ reviewed, missing }: { reviewed: boolean; missing: boolean }) {
  return <span className={`bank-review-tag ${reviewed ? "is-reviewed" : ""}`}>
    {reviewed ? <Check className="size-3 shrink-0" /> : null}{missing ? "元明細なし" : reviewed ? "確認済み" : "未確認"}
  </span>;
}
