"use client";

import { ArrowUpRight } from "lucide-react";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveObligationAction } from "@/app/banking/obligations/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { obligationKindLabels } from "@/lib/obligation-classification";
import type { CompanyScope } from "@/lib/company";
import type { ObligationMutation } from "@/lib/obligation-edits";
import type { ObligationSummary } from "@/lib/tax-obligations";

const money = (amount: number) => new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 }).format(amount);
const dateTime = (value: string) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
const actionLabels = { exclude: "対象外にする", restoreExclusion: "対象外を元に戻す", pay: "支払済みにする", reopen: "支払済みを取り消す", cancel: "登録を取り消す", restoreManual: "登録を元に戻す" };
type Selection = { action: keyof typeof actionLabels; id: string; version: string; title: string };
const emptyForm = { title: "", party: "", amount: "", dueDate: "", memo: "" };

export function ObligationsWorkspace({ company, today, summary, mayEdit, actors }: { company: CompanyScope; today: string; summary: ObligationSummary; mayEdit: boolean; actors: Record<string, string> }) {
  const router = useRouter();
  const [selection, setSelection] = useState<Selection | null>(null), [reason, setReason] = useState(""), [paymentDate, setPaymentDate] = useState(today);
  const [draft, setDraft] = useState(emptyForm), [pending, setPending] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const select = (value: Selection) => { setSelection(value); setReason(""); setPaymentDate(today); setError(""); };
  const save = async (input: ObligationMutation) => {
    setPending(true); setError(""); setMessage("");
    try {
      const result = await saveObligationAction(company, input);
      if (!result.success) { setError(result.error); return false; }
      setMessage(input.action === "create" ? "書類のない未納を登録しました" : input.action === "restoreExclusion" ? "対象外を元に戻しました。一覧の条件を満たすものが再表示されます" : `${actionLabels[input.action]}：保存しました`);
      router.refresh(); return true;
    } catch { setError("保存できませんでした。入力を保持しています。再度お試しください"); return false; }
    finally { setPending(false); }
  };
  const operationButton = (value: Selection) => mayEdit ? <Button size="sm" type="button" variant="outline" disabled={pending} onClick={() => select(value)}>{actionLabels[value.action]}</Button> : null;
  const activeManual = summary.items.filter((row) => row.source === "manual").length;
  return <div className="min-w-0 space-y-6">
    <p className="text-sm text-muted-foreground">支払先の「税金・社会保険」区分を優先し、未設定の場合だけ支払先・差出人の名前から推定します。ファイル名・メモ・OCR本文は判定に使いません。<Link href={`/partners?company=${company}&tab=vendors`} className="ml-1 hover:underline underline-offset-4 hover:text-primary">支払先の区分を設定</Link></p>
    <p className="text-sm" data-obligation-summary>未払い {summary.items.length}件（期限超過 {summary.overdue} / 14日以内 {summary.dueSoon}）/ 金額判明分の合計 ¥{money(summary.outstandingTotal)} / 金額未登録 {summary.unpriced}件 / うち手入力 {activeManual}件</p>
    {message ? <p role="status" className="rounded-md border p-3 text-sm">{message}</p> : null}
    {error && !selection ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {mayEdit ? <details className="rounded-md border p-3"><summary className="min-h-11 cursor-pointer content-center text-sm font-medium">書類のない未納を追加</summary>
      <p className="mb-3 text-xs text-muted-foreground">手入力分はこの一覧内の記録です。請求書・支払記録・銀行照合には追加されません。後日書類を登録した場合は、重複しないよう手入力分を取り消してください。</p>
      <form className="grid min-w-0 gap-3 sm:grid-cols-2" onSubmit={async (event) => { event.preventDefault(); if (await save({ action: "create", ...draft, amount: Number(draft.amount) })) setDraft(emptyForm); }}>
        <label className="min-w-0 space-y-1 text-sm">名称<Input name="title" required maxLength={200} value={draft.title} disabled={pending} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
        <label className="min-w-0 space-y-1 text-sm">納付先<Input name="party" required maxLength={200} value={draft.party} disabled={pending} onChange={(event) => setDraft({ ...draft, party: event.target.value })} /></label>
        <label className="min-w-0 space-y-1 text-sm">金額（円）<Input name="amount" required type="number" min={1} step={1} max={1e12} value={draft.amount} disabled={pending} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} /></label>
        <label className="min-w-0 space-y-1 text-sm">期限（不明なら空欄）<Input name="dueDate" type="date" value={draft.dueDate} disabled={pending} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} /></label>
        <label className="min-w-0 space-y-1 text-sm sm:col-span-2">メモ<Textarea name="memo" maxLength={2000} value={draft.memo} disabled={pending} onChange={(event) => setDraft({ ...draft, memo: event.target.value })} /></label>
        <Button type="submit" className="justify-self-start" disabled={pending}>{pending ? "保存中…" : "未納を追加"}</Button>
      </form>
    </details> : null}
    <ul className="space-y-4" aria-label="未払いの税金・社会保険">{summary.items.map((row) => <li key={row.id} data-obligation-id={row.id} className="min-w-0 space-y-3 rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {row.overdue ? <span className="rounded border border-red-300 bg-red-100 px-1.5 py-0.5 text-red-900 dark:border-red-500/70 dark:bg-red-950 dark:text-red-200">期限超過</span> : row.dueSoon ? <span className="rounded border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-amber-900 dark:border-amber-500/70 dark:bg-amber-950 dark:text-amber-200">14日以内</span> : null}
        <span className="rounded border px-1.5 py-0.5">{row.classification.basis === "MANUAL" ? "手入力（書類なし）" : `${obligationKindLabels[row.classification.kind]} / ${row.classification.basis === "NAME" ? "名前による推定" : "支払先の区分"}`}</span>
        <span className="text-muted-foreground">{row.source === "received" ? "受領請求書" : row.source === "mail" ? "郵便物" : "手入力"} / {row.status}</span>
        {row.dueDate ? <time className="tabular-nums text-muted-foreground">期限 {row.dueDate}</time> : null}
      </div>
      <h2 className="break-words text-sm font-medium">{row.title} <span className="font-normal text-muted-foreground">/ {row.party}</span></h2>
      <p className="text-sm">{row.amount !== undefined ? <>請求 ¥{money(row.amount)} / 支払済 ¥{money(row.paid)} / <strong>未払い ¥{money(row.outstanding || 0)}</strong></> : "金額未登録"}</p>
      <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{row.note}</p>
      <div className="flex flex-wrap items-center gap-2">
        {row.href ? <Button asChild variant="soft" size="sm" className="h-auto max-w-full whitespace-normal break-words py-2 text-left lg:h-auto lg:min-h-8 lg:py-1.5"><Link href={row.href}>{row.source === "received" ? "受領請求書を開く" : "郵便物フォルダーを開く"}<ArrowUpRight aria-hidden="true" className="size-4 shrink-0" /></Link></Button> : null}
        {operationButton({ action: "exclude", id: row.id, version: row.version, title: row.title })}
        {row.source === "manual" ? <>{operationButton({ action: "pay", id: row.id.slice(7), version: row.version, title: row.title })}{operationButton({ action: "cancel", id: row.id.slice(7), version: row.version, title: row.title })}</> : null}
      </div>
    </li>)}</ul>
    {!summary.items.length ? <p className="text-sm text-muted-foreground">未払いとして検出された税金・社会保険はありません。</p> : null}
    <details className="rounded-md border p-3"><summary className="min-h-11 cursor-pointer content-center text-sm font-medium">対象外 {summary.excluded.length}件</summary>
      <p className="text-xs text-muted-foreground">この一覧だけから除外しています。書類・支払先・支払記録は変更していません。</p>
      <ul className="divide-y">{summary.excluded.map((row) => <li key={row.id} data-exclusion-id={row.id} className="space-y-2 py-3 text-sm">
        <p className="break-words font-medium">{row.snapshot.title} / {row.snapshot.party}</p><p className="whitespace-pre-wrap break-words">理由：{row.reason}</p>
        <p className="break-words text-xs text-muted-foreground">{dateTime(row.createdAt)} / {row.actorName}</p>
        {!row.current ? <p className="text-xs text-muted-foreground">元の対象は現在の未払い一覧の条件を満たしていません。解除後も表示されない場合があります。</p> : null}
        {operationButton({ action: "restoreExclusion", id: row.id, version: row.updatedAt, title: row.snapshot.title })}
      </li>)}</ul>
    </details>
    {summary.manualInactive.length ? <details className="rounded-md border p-3"><summary className="min-h-11 cursor-pointer content-center text-sm font-medium">手入力の支払済み・登録取消 {summary.manualInactive.length}件</summary>
      <ul className="divide-y">{summary.manualInactive.map((row) => <li key={row.id} data-manual-history-id={row.id} className="space-y-2 py-3 text-sm">
        <p className="break-words font-medium">{row.title} / {row.party} / ¥{money(row.amount)}</p>
        <p>{row.status === "PAID" ? `支払済み（手入力） / ${row.paidAt}` : "登録取消"}</p>
        <ul className="space-y-1 text-xs text-muted-foreground">{row.history.map((event, index) => <li key={index} className="break-words">{dateTime(event.at)} / {actors[event.byId] || event.byId} / {({ CREATE: "登録", PAY: "支払済み", REOPEN: "支払済み取消", CANCEL: "登録取消", RESTORE: "登録復元" })[event.action]} / {event.reason}{event.paymentDate ? ` / 支払日 ${event.paymentDate}` : ""}</li>)}</ul>
        {operationButton({ action: row.status === "PAID" ? "reopen" : "restoreManual", id: row.id, version: row.updatedAt, title: row.title })}
      </li>)}</ul>
    </details> : null}
    {summary.paidRecently.length ? <details className="text-sm"><summary className="min-h-11 cursor-pointer content-center font-medium">支払済みの受領請求書 {summary.paidRecently.length}件（直近20件まで）</summary><ul className="divide-y">{summary.paidRecently.map((row) => <li key={row.id} className="flex flex-wrap justify-between gap-2 py-2"><span className="break-words">{row.title}</span><span className="tabular-nums text-muted-foreground">{row.paidAt} / ¥{money(row.amount)}</span></li>)}</ul></details> : null}
    <Dialog open={Boolean(selection)} onOpenChange={(open) => { if (!open && !pending) { setSelection(null); setError(""); } }}><DialogContent className="max-h-[90dvh] overflow-y-auto">
      <DialogHeader><DialogTitle>{selection ? actionLabels[selection.action] : "操作"}</DialogTitle><DialogDescription className="break-words">{selection?.title}。理由を記録して保存します。</DialogDescription></DialogHeader>
      <form className="min-w-0 space-y-3" onSubmit={async (event) => { event.preventDefault(); if (!selection) return; const { title: _title, ...input } = selection; void _title; if (await save({ ...input, reason, ...(input.action === "pay" ? { paymentDate } : {}) })) setSelection(null); }}>
        {selection?.action === "pay" ? <label className="block space-y-1 text-sm">支払日<Input type="date" required max={today} value={paymentDate} disabled={pending} onChange={(event) => setPaymentDate(event.target.value)} /></label> : null}
        <label className="block space-y-1 text-sm">理由（必須）<Textarea required maxLength={500} value={reason} disabled={pending} onChange={(event) => setReason(event.target.value)} /></label>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <div className="flex flex-wrap gap-2"><Button type="submit" disabled={pending}>{pending ? "保存中…" : "理由を記録して保存"}</Button><Button type="button" variant="outline" disabled={pending} onClick={() => { setSelection(null); setError(""); }}>閉じる</Button></div>
      </form>
    </DialogContent></Dialog>
  </div>;
}
