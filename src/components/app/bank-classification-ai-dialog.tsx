"use client";

import { useState, useTransition } from "react";
import { Bot, ChevronLeft, ChevronRight, LoaderCircle, Search } from "lucide-react";
import { classifyWithAiAction, prepareClassificationAiAction } from "@/app/banking/classification-ai-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { bankSelectClass } from "@/components/app/banking-settings";
import { CLASSIFICATION_AI_BATCH_SIZE, type ClassificationAiPreview, type ClassificationAiResult } from "@/lib/bank-classification-ai-types";
import type { CompanyScope } from "@/lib/company";

export function BankClassificationAiDialog({ company, open, onOpenChange, rowIds, selectedIds, initialScope, onResult }: {
  company: CompanyScope; open: boolean; onOpenChange: (open: boolean) => void;
  rowIds: string[]; selectedIds: string[]; initialScope: "page" | "selected" | "all";
  onResult: (result: ClassificationAiResult) => void;
}) {
  const [scope, setScope] = useState(initialScope), [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<(ClassificationAiPreview & { model: string; configured: boolean }) | null>(null);
  const [consent, setConsent] = useState(false), [error, setError] = useState("");
  function prepare(batch = 0) {
    setError(""); setConsent(false); setPreview(null);
    startTransition(async () => {
      try {
        const response = await prepareClassificationAiAction(company, { ...(scope === "all" ? {} : { ids: scope === "selected" ? selectedIds : rowIds }), batch });
        if (!response.success) { setError(response.error); return; }
        setPreview({ ...response.preview, model: response.model, configured: response.configured });
      } catch { setError("対象を取得できませんでした。画面を更新してください。"); }
    });
  }
  function run() {
    if (!preview || !consent || pending) return;
    setError("");
    startTransition(async () => {
      try {
        const response = await classifyWithAiAction(company, { scope: preview.scope, revision: preview.revision, model: preview.model, consent: true });
        setConsent(false);
        if (!response.success) { setError(response.error); return; }
        onResult(response.result); onOpenChange(false);
      } catch { setConsent(false); setError("AI判定の結果を取得できませんでした。分類結果は保存していません。"); }
    });
  }
  const count = preview?.payload.transactions.length || 0;
  const first = preview ? preview.scope.batch * CLASSIFICATION_AI_BATCH_SIZE : 0;
  return <Dialog open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" showCloseButton={!pending} onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
      <DialogHeader><DialogTitle>AIで勘定科目を判定</DialogTitle><DialogDescription>未分類の明細のみが対象です。手動変更・確認済み・ルールで判定できる明細は保護されます。</DialogDescription></DialogHeader>
      <label className="grid min-w-0 gap-1 text-sm">対象<select aria-label="AI分類の対象" className={bankSelectClass} value={scope} disabled={pending} onChange={(e) => { setScope(e.target.value as typeof scope); setPreview(null); setConsent(false); setError(""); }}>
        {rowIds.length ? <option value="page">表示中のページ（{rowIds.length}件）</option> : null}
        {selectedIds.length ? <option value="selected">選択した明細（{selectedIds.length}件）</option> : null}
        <option value="all">{company === "JAPAN" ? "日本" : "中国"}の全期間・全口座</option>
      </select></label>
      <Button className="min-h-11" variant="outline" disabled={pending} onClick={() => prepare()}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <Search className="size-4" />}対象データを確認</Button>
      {preview ? <>
        <div role="status" className="space-y-1 border-l-2 border-primary bg-primary/5 p-3 text-sm">
          <p className="font-medium">AI判定対象 {preview.total.toLocaleString()}件 / 今回 {count ? first + 1 : 0}〜{first + count}件</p>
          <p className="text-xs text-muted-foreground">対象範囲 {preview.scoped.toLocaleString()}件・対象外 {preview.protected.toLocaleString()}件・ルール候補 {preview.ruleCandidates.toLocaleString()}件</p>
        </div>
        {preview.total > CLASSIFICATION_AI_BATCH_SIZE ? <nav aria-label="AI送信範囲" className="flex items-center justify-between gap-2 text-sm">
          <Button className="size-11" variant="outline" size="icon" title="前の50件" aria-label="前のAI判定範囲" disabled={pending || preview.scope.batch === 0} onClick={() => prepare(preview.scope.batch - 1)}><ChevronLeft className="size-4" /></Button>
          <span>{preview.scope.batch + 1} / {Math.ceil(preview.total / CLASSIFICATION_AI_BATCH_SIZE)}</span>
          <Button className="size-11" variant="outline" size="icon" title="次の50件" aria-label="次のAI判定範囲" disabled={pending || first + count >= preview.total} onClick={() => prepare(preview.scope.batch + 1)}><ChevronRight className="size-4" /></Button>
        </nav> : null}
        {!preview.configured ? <p role="alert" className="text-sm text-amber-800 dark:text-amber-300">OpenAI APIキーが未設定です。管理者が画面上部の「AI設定」から登録してください。</p> : null}
        {count && preview.payload.categories.length ? <>
          <p className="text-sm">OpenAI API（{preview.model}）に、今回の{count}件の摘要・日付・金額・入出金方向・口座種別と勘定科目名を送信します。利用料金が発生します。原本・社内メモ・口座名や口座番号は送信項目に含めません。摘要等の長い数字やメールアドレスはマスクしますが、完全な匿名化ではありません。</p>
          <details><summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">送信内容</summary><pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all bg-muted p-3 text-xs">{JSON.stringify(preview.payload, null, 2)}</pre></details>
          <p className="text-xs text-muted-foreground">対象の全明細に最も近い勘定科目を付けます。判断材料が不足する候補は「要確認・推定」です。自動保存はしません。会社ごとに1日50回、15秒間隔が上限です。実行回数のみ記録します。</p>
          <label className="flex min-h-11 items-start gap-3 py-2 text-sm"><input type="checkbox" className="mt-1 size-5 shrink-0 accent-primary" checked={consent} disabled={pending || !preview.configured} onChange={(e) => setConsent(e.target.checked)} /><span>この内容をOpenAI APIへ送信し、勘定科目の候補を受け取ることに同意します。</span></label>
          <Button className="min-h-11" disabled={pending || !consent || !preview.configured} onClick={run}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <Bot className="size-4" />}{pending ? "AIが判定中..." : "送信して勘定科目を判定"}</Button>
        </> : <p className="text-sm">{!count ? "この範囲にAI判定の対象となる明細はありません。" : "有効な勘定科目がありません。"}</p>}
      </> : null}
      {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
    </DialogContent>
  </Dialog>;
}
