"use client";

import { Check, ChevronDown, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/app/money";
import { useEffect, useRef } from "react";
import { bankCategorySection } from "@/lib/bank-category-catalog";
import type { AccountingCategory, BankTransaction } from "@/lib/banking-types";

export function BankCategoryControl({ row, category, child, disabled, onChoose }: {
  row: BankTransaction; category?: AccountingCategory; child?: AccountingCategory; disabled: boolean; onChoose: (row: BankTransaction) => void;
}) {
  return <button type="button" className="bank-category-cell group flex w-full min-w-0 items-center gap-1 rounded-md border px-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50" title={category ? `${category.name}${child ? ` / ${child.name}` : ""}（${bankCategorySection(category.group).label}）` : undefined} aria-label={`${row.content}の勘定科目を選ぶ`} disabled={disabled || Boolean(row.bookkeeping?.splits?.length)} onClick={() => onChoose(row)}>
    <span className="min-w-0 flex-1 truncate">{row.bookkeeping?.splits?.length ? `分割 ${row.bookkeeping.splits.length}科目` : category?.name || "科目を選択"}{child ? <span className="text-xs text-muted-foreground"> / {child.name}</span> : null}</span><ChevronDown className="size-3 shrink-0 text-muted-foreground" />
  </button>;
}

export function BankSelectAllCheckbox({ all, some, disabled, onChange }: {
  all: boolean; some: boolean; disabled: boolean; onChange: (checked: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (input.current) input.current.indeterminate = some; }, [some]);
  return <label className="bank-select-all" title="表示中の明細を選択（対象外は自動選択しません）">
    <input ref={input} type="checkbox" aria-label="表示中の明細をすべて選択" aria-checked={some ? "mixed" : all} checked={all} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
  </label>;
}

export function BankSelectionReview({ count, amount, reviewedCount, disabled, onClear, onReview }: {
  count: number; amount: number; reviewedCount: number; disabled: boolean; onClear: () => void; onReview: (reviewed: boolean) => void;
}) {
  return <section className="bank-selection-review" aria-label="選択明細の一括確認">
    <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-medium" aria-live="polite">{count ? `${count}件選択中` : "明細未選択"}</h2><Button variant="ghost" size="icon" className="size-11 lg:size-8" title="選択解除" aria-label="選択解除" disabled={disabled || !count} onClick={onClear}><X className="size-4" /></Button></div>
    <dl className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><dt className="text-xs text-muted-foreground">選択金額</dt><dd className="text-xl font-medium">{count ? <Money value={amount} /> : "—"}</dd></dl>
    <div className="flex gap-2"><Button className="bank-review-action min-h-11 flex-1" variant="outline" disabled={disabled || !count || reviewedCount === count} onClick={() => onReview(true)}><Check className="size-4" />確認</Button>{reviewedCount ? <Button variant="outline" size="icon" className="size-11" title="選択明細を未確認に戻す" aria-label="選択明細を未確認に戻す" disabled={disabled} onClick={() => onReview(false)}><RotateCcw className="size-4" /></Button> : null}</div>
  </section>;
}

export { ReviewStatusTag as BankReviewTag } from "@/components/app/review-status-tag";
