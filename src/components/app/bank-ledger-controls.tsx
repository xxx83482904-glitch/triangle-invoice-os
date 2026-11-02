"use client";

import { Check, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function BankSelectionReview({ count, amount, reviewedCount, disabled, onClear, onReview }: {
  count: number; amount: number; reviewedCount: number; disabled: boolean; onClear: () => void; onReview: (reviewed: boolean) => void;
}) {
  return <section className="bank-selection-review" aria-label="選択明細の一括確認">
    <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold" aria-live="polite">{count ? `${count}件選択中` : "明細未選択"}</h2><Button variant="ghost" size="icon" className="size-8" title="選択解除" aria-label="選択解除" disabled={disabled || !count} onClick={onClear}><X className="size-4" /></Button></div>
    <dl className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><dt className="text-xs text-muted-foreground">選択金額</dt><dd className="break-all text-xl font-semibold tabular-nums">{count ? new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(amount) : "—"}</dd></dl>
    <div className="flex gap-2"><Button className="bank-review-action min-h-11 flex-1" variant="outline" disabled={disabled || !count || reviewedCount === count} onClick={() => onReview(true)}><Check className="size-4" />確認</Button>{reviewedCount ? <Button variant="outline" size="icon" className="size-11" title="選択明細を未確認に戻す" aria-label="選択明細を未確認に戻す" disabled={disabled} onClick={() => onReview(false)}><RotateCcw className="size-4" /></Button> : null}</div>
  </section>;
}

export { ReviewStatusTag as BankReviewTag } from "@/components/app/review-status-tag";
