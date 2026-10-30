"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { AccountingCategory } from "@/lib/banking-types";
import { bankRenderWindow, BANK_RENDER_WINDOW, type BankSaveChange, type BankSaveScope } from "@/lib/bank-workspace-drafts";

export const bankSaveScopeLabels = { selected: "選択した明細", reviewed: "確認済みの編集", edited: "手動編集した明細" };
export type BankSavePreview = { scope: BankSaveScope; changes: BankSaveChange[]; omitted: number; unselected: number; destination?: string };
const treatment = { NORMAL: "通常", EXCLUDED: "対象外", TRANSFER: "振替・カード精算" };

export function BankSavePreviewDialog({ preview, categories, busy, onClose, onSave }: { preview: BankSavePreview; categories: AccountingCategory[]; busy: boolean; onClose: () => void; onSave: () => void }) {
  const [start, setStart] = useState(0);
  const window = bankRenderWindow(preview.changes, start);
  const categoryName = (id?: string) => categories.find((row) => row.id === id)?.name || (id ? `不明な科目 (${id})` : "未分類");
  const counterparties = new Set(preview.changes.map(({ before }) => before.content));
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl" showCloseButton={!busy} onInteractOutside={(event) => event.preventDefault()}>
      <DialogHeader><DialogTitle>保存内容の確認</DialogTitle><DialogDescription>{bankSaveScopeLabels[preview.scope]}: {preview.changes.length}件 / 自動候補の採用 {preview.changes.filter((row) => row.prediction).length}件</DialogDescription></DialogHeader>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm"><span>摘要 {counterparties.size}種類</span><span>選択解除 {preview.unselected}件</span><span>変更なし {preview.omitted}件</span><span>保留 {preview.changes.filter((row) => row.before.bookkeeping?.hold).length}件</span><span>科目分割 {preview.changes.filter((row) => row.before.bookkeeping?.splits?.length).length}件</span><span>対象外のまま保存 {preview.changes.filter((row) => row.after.treatment === "EXCLUDED").length}件</span><span>対象外から変更 {preview.changes.filter((row) => row.before.treatment === "EXCLUDED" && row.after.treatment !== "EXCLUDED").length}件</span></div>
      <div className="max-h-[48dvh] overflow-auto divide-y border-y">
        {window.rows.map(({ before, after, prediction }) => <section key={before.id} className="space-y-1 py-3 text-sm">
          <h3 className="break-words font-medium">{before.transactionDate} / {before.content || "摘要なし"} / {before.amount.toLocaleString()}円</h3>
          {before.bookkeeping?.splits?.length ? <p>分割 {before.bookkeeping.splits.length}科目（内訳変更なし）</p> : null}
          {before.bookkeeping?.hold ? <p className="break-words text-amber-700 dark:text-amber-300">保留: {before.bookkeeping.hold.question}</p> : null}
          {prediction ? <p className="text-amber-700 dark:text-amber-300">自動候補を採用（未確認）</p> : null}
          {before.categoryId !== after.categoryId || before.subCategoryId !== after.subCategoryId ? <p className="break-words">科目: {categoryName(before.categoryId)}{before.subCategoryId ? ` / ${categoryName(before.subCategoryId)}` : ""} → {categoryName(after.categoryId)}{after.subCategoryId ? ` / ${categoryName(after.subCategoryId)}` : ""}</p> : null}
          {before.treatment !== after.treatment ? <p>扱い: {treatment[before.treatment]} → {treatment[after.treatment]}</p> : null}
          {before.reviewed !== after.reviewed ? <p>確認: {before.reviewed ? "確認済み" : "未確認"} → {after.reviewed ? "確認済み" : "未確認"}</p> : null}
          {before.memo !== after.memo ? <p className="whitespace-pre-wrap break-words">メモ: {before.memo || "なし"} → {after.memo || "なし"}</p> : null}
          {before.classificationReason !== after.classificationReason ? <p className="break-words text-xs text-muted-foreground">根拠: {before.classificationReason || "なし"} → {after.classificationReason || "なし"}</p> : null}
        </section>)}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2"><Button variant="ghost" size="icon" aria-label="前の変更" title="前の変更" disabled={window.offset === 0} onClick={() => setStart(window.offset - BANK_RENDER_WINDOW)}><ArrowLeft className="size-4" /></Button><span className="text-xs">{preview.changes.length ? window.offset + 1 : 0}–{window.end} / {preview.changes.length}</span><Button variant="ghost" size="icon" aria-label="次の変更" title="次の変更" disabled={window.end >= preview.changes.length} onClick={() => setStart(window.end)}><ArrowRight className="size-4" /></Button></div>
        <Button disabled={busy || !preview.changes.length} onClick={onSave}><Save className="size-4" />{preview.changes.length}件を保存{preview.destination ? "して移動" : ""}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
