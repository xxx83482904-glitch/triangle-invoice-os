"use client";

import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GUESS_ACKNOWLEDGED_PREFIX } from "@/lib/bank-classification";
import type { AccountingCategory, BankTransaction } from "@/lib/banking-types";

const money = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 });

// Shown before guessed classifications are marked reviewed. Nothing here saves; the drafts still go through the save preview.
export function BankGuessReviewDialog({ guesses, others, categories, busy, onClose, onConfirm }: {
  guesses: BankTransaction[]; others: number; categories: AccountingCategory[]; busy: boolean; onClose: () => void; onConfirm: (acknowledgeGuesses: boolean) => void;
}) {
  const name = (id?: string) => categories.find((row) => row.id === id)?.name || "科目未設定";
  const shown = guesses.slice(0, 8);
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto" showCloseButton={!busy} onInteractOutside={(event) => event.preventDefault()}>
      <DialogHeader><DialogTitle>推測のままの分類を確認済みにしますか？</DialogTitle><DialogDescription>選択 {guesses.length + others}件のうち {guesses.length}件は、科目が根拠の弱い推測のままです。摘要と科目を見て問題がなければ確定してください。確定後も根拠には「{GUESS_ACKNOWLEDGED_PREFIX}」と残ります。</DialogDescription></DialogHeader>
      <ul className="max-h-[40dvh] divide-y overflow-auto border-y text-sm" aria-label="推測のままの明細">
        {shown.map((row) => <li key={row.id} className="space-y-0.5 py-2">
          <div className="flex flex-wrap justify-between gap-x-3"><span className="break-words font-medium">{row.transactionDate} / {row.content || "摘要なし"}</span><span className="tabular-nums">{row.side === "INCOME" ? "+" : "-"}{money.format(row.amount)}</span></div>
          <div className="break-words text-xs text-muted-foreground">科目: {name(row.categoryId)}{row.classificationReason ? ` / ${row.classificationReason}` : ""}</div>
        </li>)}
        {guesses.length > shown.length ? <li className="py-2 text-xs text-muted-foreground">ほか {guesses.length - shown.length}件</li> : null}
      </ul>
      <div className="flex flex-wrap justify-end gap-2">
        <Button className="min-h-11" variant="outline" disabled={busy} onClick={onClose}>キャンセル</Button>
        <Button className="min-h-11" variant="ghost" disabled={busy || !others} onClick={() => onConfirm(false)}>推測の行を除いて確認済みに ({others})</Button>
        <Button className="min-h-11" disabled={busy} onClick={() => onConfirm(true)}><Check className="size-4" />内容を確認して確定 ({guesses.length})</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
