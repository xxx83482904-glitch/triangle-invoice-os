"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ArrowUpRight, Bot, Check, Link2, LoaderCircle, RotateCcw } from "lucide-react";
import { analyzeBankDocumentsAction } from "@/app/banking/reconcile/ai-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { BankAiPreview, BankAiResult } from "@/lib/bank-ai-types";
import type { CompanyScope } from "@/lib/company";

const money = (value: number) => new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 }).format(value);
const touch = "min-h-11 lg:min-h-11";
export function BankAiPanel({ company, preview, configured, model, onChooseInvoice }: {
  company: CompanyScope; preview: BankAiPreview; configured: boolean; model: string;
  onChooseInvoice?: (key: string) => void;
}) {
  const [pending, startTransition] = useTransition(), [open, setOpen] = useState(false), [consent, setConsent] = useState(false);
  const [result, setResult] = useState<BankAiResult | null>(null), [error, setError] = useState("");
  const counts = { banks: preview.payload.banks.length, invoices: preview.payload.invoices.length, mails: preview.payload.mails.length };
  const empty = !counts.banks || !counts.invoices && !counts.mails;
  function run() {
    if (!consent || pending) return;
    setResult(null); setError("");
    startTransition(async () => {
      try {
        const response = await analyzeBankDocumentsAction(company, { scope: preview.scope, revision: preview.revision, consent: true });
        if (!response.success) { setError(response.error); return; }
        if (response.result.revision !== preview.revision) { setError("対象データが変わりました。画面を更新してください。"); return; }
        setResult(response.result); setOpen(false); setConsent(false);
      } catch { setError("AIの確認結果を取得できませんでした。通常の照合は利用できます。"); }
    });
  }
  return <section className="min-w-0 space-y-3 border-y py-4" aria-label="AI横断チェック">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-base font-semibold"><Bot className="size-5" />AI横断チェック</h2>
      <Button className={touch} variant="outline" disabled={pending || empty || !configured} onClick={() => { setConsent(false); setError(""); setOpen(true); }}>
        {pending ? <LoaderCircle className="size-4 animate-spin" /> : result ? <RotateCcw className="size-4" /> : <Bot className="size-4" />}{pending ? "確認中" : result ? "再確認" : "AIで候補を探す"}
      </Button>
    </div>
    <p className="text-xs text-muted-foreground">対象: 銀行 {counts.banks}/{preview.totals.banks}件・請求書 {counts.invoices}/{preview.totals.invoices}件・郵便物 {counts.mails}/{preview.totals.mails}件。候補範囲内の推測であり、全件の確認や支払い確定ではありません。</p>
    {!configured ? <p className="text-sm text-amber-800 dark:text-amber-300">OpenAI APIキーが未設定です。管理者が画面上部の「AI設定」で登録すると利用できます。</p> : null}
    {empty ? <p className="text-sm text-muted-foreground">この範囲に未照合の銀行明細、または比較する書類がありません。</p> : null}
    {error && !open ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
    {result ? <>
      <p className="text-xs text-muted-foreground">AI提案 {result.suggestions.length}件 / {new Date(result.generatedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })} / {result.model}。同じ明細・書類を含む提案は代替候補です。すべてを重複して確定しないでください。</p>
      {!result.suggestions.length ? <p className="text-sm">この候補範囲から、根拠のある関連書類を提案できませんでした。書類不足や未払いを確定したものではありません。</p> : null}
      <ul className="divide-y">{result.suggestions.map((row, i) => <li key={`${row.bank.id}:${i}`} className="min-w-0 space-y-3 py-4 text-sm">
        <p className="break-words font-medium">{row.bank.date} / {row.bank.title}</p>
        <p className="break-words"><span className="font-medium">AIの推測: </span>{row.explanation}</p>
        <div className="grid grid-cols-1 gap-2 border-l-2 border-primary pl-3 sm:grid-cols-3">
          <p>銀行未照合額<br /><strong className="tabular-nums">{money(row.bank.remaining)}</strong></p>
          <p>候補の請求未照合額<br /><strong className="tabular-nums">{row.invoiceAmount === null ? "金額未確定" : money(row.invoiceAmount)}</strong></p>
          <p>差額（銀行 − 請求）<br /><strong className="tabular-nums">{row.difference === null ? "算出不可" : money(row.difference)}</strong></p>
        </div>
        <ul className="space-y-2">{row.invoices.map((invoice) => <li className="flex min-w-0 flex-wrap items-center justify-between gap-2" key={invoice.key}>
          <Link className="inline-flex min-h-11 min-w-0 items-center gap-1 break-words text-primary underline" href={invoice.href}><span className="min-w-0 break-words">{invoice.title}</span><ArrowUpRight className="size-4 shrink-0" /></Link>
          {onChooseInvoice ? <Button className={touch} variant="outline" onClick={() => onChooseInvoice(invoice.key)}><Link2 className="size-4" />確認して照合</Button> : null}
        </li>)}{row.mails.map((mail) => <li key={mail.id}><Link className="inline-flex min-h-11 min-w-0 items-center gap-1 text-primary underline" href={mail.href}><span className="min-w-0 break-words">郵便物: {mail.title} {mail.linked ? "（連携あり）" : "（未連携）"}</span><ArrowUpRight className="size-4 shrink-0" /></Link></li>)}</ul>
        <details><summary className="flex min-h-11 cursor-pointer items-center text-muted-foreground">根拠の抜粋（{row.evidence.length}件）</summary><ul className="space-y-1 border-l pl-3 text-xs">{row.evidence.map((item, n) => <li className="break-words" key={`${item.label}:${n}`}>{item.label}: {item.quote}</li>)}</ul></details>
        <ul className="space-y-1 text-xs text-amber-800 dark:text-amber-300">{row.cautions.map((text) => <li className="break-words" key={text}>{text}</li>)}</ul>
        <Link className="inline-flex min-h-11 items-center gap-1 text-primary underline" href={row.bank.href}><Link2 className="size-4" />銀行の照合画面へ</Link>
      </li>)}</ul>
    </> : null}
    <Dialog open={open} onOpenChange={(value) => { if (!pending) setOpen(value); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" showCloseButton={!pending} onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogHeader><DialogTitle>AIに送信する内容を確認</DialogTitle><DialogDescription>OpenAI API（{model}）へ下記のデータを送信します。利用料金が発生します。銀行への送金・書類の自動更新は行いません。</DialogDescription></DialogHeader>
        <p className="text-sm">銀行 {counts.banks}件、請求書 {counts.invoices}件、郵便物 {counts.mails}件の名称・摘要・日付・金額・状態と、OCRの必要箇所の抜粋を含みます。原本ファイル・社内メモ・APIキーは分析内容に含めません。</p>
        <p className="text-xs text-muted-foreground">口座番号らしい長い数字・メールアドレス等はマスクしますが、完全な匿名化ではありません。送信内容を確認してください。会社ごとに1日50回・連続実行は15秒間隔が上限です。</p>
        <details><summary className="flex min-h-11 cursor-pointer items-center font-medium">送信データの詳細</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs">{JSON.stringify(preview.payload, null, 2)}</pre></details>
        <a className="inline-flex min-h-11 items-center gap-1 text-xs text-primary underline" href="https://developers.openai.com/api/docs/guides/your-data" target="_blank" rel="noreferrer">OpenAIのデータ保持方針<ArrowUpRight className="size-4" /></a>
        <label className="flex min-h-11 items-start gap-3 py-2 text-sm"><input className="mt-1 size-5 shrink-0 accent-primary" type="checkbox" checked={consent} disabled={pending} onChange={(e) => setConsent(e.target.checked)} /><span>このデータをOpenAI APIへ送信し、候補の提案を受け取ることに同意します。</span></label>
        {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
        <Button className={touch} disabled={pending || !consent} onClick={run}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}{pending ? "AIが読み比べています" : "送信して横断チェック"}</Button>
      </DialogContent>
    </Dialog>
  </section>;
}
