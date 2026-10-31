"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Landmark, LoaderCircle, Pencil, Plus } from "lucide-react";
import { adjustPaymentAction, cancelPaymentAction, recordPaymentAction } from "./payment-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { formatDate, todayIso, yen } from "@/lib/format";
import type { PaymentRecordView } from "@/lib/payment-records";
import type { CompanyScope } from "@/lib/company";

type Invoice = { id: string; updatedAt: string; total: number; paidAmount: number; unpaidAmount: number; status: string; statusMismatch: boolean };
type Mode = { type: "adjust" | "cancel"; id: string } | { type: "record" } | null;
const when = (value?: string) => value ? new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) : "";

// Payment records of one received invoice: list, explicit manual entry, amount/date correction and cancellation with reasons.
export function PaymentRecordsPanel({ company, invoice, records, canRecord }: { company: CompanyScope; invoice: Invoice; records: PaymentRecordView[]; canRecord: boolean }) {
  const router = useRouter(), [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<Mode>(null), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const active = records.filter((row) => !row.canceled), canceled = records.filter((row) => row.canceled);
  const linkedTotal = active.reduce((sum, row) => sum + row.linkedAmount, 0);
  const overpaid = Math.max(0, invoice.paidAmount - invoice.total);
  function run(task: () => Promise<{ success: true } | { success: false; error: string }>, done: string) {
    setError(""); setNotice("");
    startTransition(async () => {
      try {
        const result = await task();
        if (!result.success) { setError(result.error); return; }
        // The panel re-mounts when the records change, so the confirmation goes to a toast rather than local state.
        setMode(null); setNotice(done); toast({ title: done, variant: "success" }); router.refresh();
      } catch { setError("結果を確認できませんでした。画面を更新してください。"); }
    });
  }
  const submitRecord = (form: FormData) => run(() => recordPaymentAction(company, { kind: "received", invoiceId: invoice.id, invoiceUpdatedAt: invoice.updatedAt, amount: Number(String(form.get("amount") ?? "").replaceAll(",", "")), paymentDate: String(form.get("paymentDate") ?? ""), method: String(form.get("method") ?? ""), memo: String(form.get("memo") ?? ""), reason: String(form.get("reason") ?? "") }), "支払記録を登録しました");
  const submitAdjust = (row: PaymentRecordView, form: FormData) => run(() => adjustPaymentAction(company, { paymentId: row.id, updatedAt: row.updatedAt, amount: Number(String(form.get("amount") ?? "").replaceAll(",", "")), paymentDate: String(form.get("paymentDate") ?? ""), reason: String(form.get("reason") ?? "") }), "支払記録を修正しました");
  const submitCancel = (row: PaymentRecordView, form: FormData) => run(() => cancelPaymentAction(company, { paymentId: row.id, updatedAt: row.updatedAt, reason: String(form.get("reason") ?? "") }), "支払記録を取り消しました");
  const field = "h-9 min-w-0";
  return <section aria-label="支払記録" className="space-y-3 rounded-lg border p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="text-sm font-medium">支払記録 <span className="font-normal text-muted-foreground">{active.length}件</span></div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"><span>登録済み <strong className="font-medium text-foreground">{yen.format(invoice.paidAmount)}</strong></span><span>未払い <strong className="font-medium text-foreground">{yen.format(invoice.unpaidAmount)}</strong></span><span>銀行照合済み <strong className="font-medium text-foreground">{yen.format(linkedTotal)}</strong></span></div>
    </div>
    <p className="text-xs text-muted-foreground">支払済みは支払記録と銀行照合から決まります。状態の変更だけでは支払記録は作られません。</p>
    {overpaid > 0 ? <p role="alert" className="border-l-2 border-amber-500 pl-2 text-xs text-amber-800 dark:text-amber-300">支払記録の合計が請求額を {yen.format(overpaid)} 超えています。請求額が正しければ支払記録を修正または取消してください。</p> : null}
    {invoice.statusMismatch && invoice.unpaidAmount > 0 ? <p role="alert" className="border-l-2 border-amber-500 pl-2 text-xs text-amber-800 dark:text-amber-300">登録状態は支払済みですが、支払記録が請求額に足りていません。</p> : null}
    {notice ? <p role="status" className="text-xs text-emerald-700 dark:text-emerald-400">{notice}</p> : null}
    {error ? <p role="alert" className="break-words text-xs text-destructive">{error}</p> : null}
    {active.length ? <ul className="divide-y rounded-md border">{active.map((row) => <li key={row.id} className="space-y-2 p-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2"><span className="font-mono font-medium">{yen.format(row.amount)}</span>{row.feeAmount ? <span className="text-xs text-muted-foreground">（銀行入金 {yen.format(row.amount - row.feeAmount)} + 手数料 {yen.format(row.feeAmount)}）</span> : null}<span className="text-xs text-muted-foreground">{formatDate(row.paymentDate)}</span><span className="text-xs text-muted-foreground">{row.method || "方法未設定"}</span><Badge variant="outline">{row.originLabel}</Badge>{row.linked ? <Badge variant="secondary" className="gap-1"><Landmark className="size-3" />銀行照合済み {yen.format(row.linkedAmount)}</Badge> : <Badge variant="outline">銀行未照合</Badge>}</div>
        {canRecord ? row.linked ? <span className="text-xs text-muted-foreground">照合解除後に修正・取消できます</span> : <div className="flex gap-1"><Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => { setError(""); setMode({ type: "adjust", id: row.id }); }}><Pencil className="size-3" />金額・日付を修正</Button><Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => { setError(""); setMode({ type: "cancel", id: row.id }); }}><Ban className="size-3" />取消</Button></div> : null}
      </div>
      {row.linkIssue ? <p className="text-xs text-amber-800 dark:text-amber-300">照合は要再確認: {row.linkIssue}</p> : null}
      {row.memo ? <p className="break-words text-xs text-muted-foreground">{row.memo}</p> : null}
      {mode && mode.type === "adjust" && mode.id === row.id ? <form className="grid gap-2 rounded-md bg-muted/40 p-2 sm:grid-cols-[1fr_1fr_2fr_auto]" onSubmit={(event) => { event.preventDefault(); submitAdjust(row, new FormData(event.currentTarget)); }}>
        <label className="space-y-1 text-xs"><span className="text-muted-foreground">金額</span><Input className={field} name="amount" type="number" min="1" step="1" defaultValue={row.amount} required /></label>
        <label className="space-y-1 text-xs"><span className="text-muted-foreground">支払日</span><Input className={field} name="paymentDate" type="date" defaultValue={row.paymentDate} max={todayIso()} required /></label>
        <label className="space-y-1 text-xs"><span className="text-muted-foreground">修正の理由（必須）</span><Input className={field} name="reason" placeholder="例: 原本の金額に合わせた" maxLength={500} required /></label>
        <div className="flex items-end gap-1"><Button type="submit" size="sm" disabled={pending}>{pending ? <LoaderCircle className="size-3 animate-spin" /> : null}保存</Button><Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setMode(null)}>戻る</Button></div>
      </form> : null}
      {mode && mode.type === "cancel" && mode.id === row.id ? <form className="grid gap-2 rounded-md bg-muted/40 p-2 sm:grid-cols-[1fr_auto]" onSubmit={(event) => { event.preventDefault(); submitCancel(row, new FormData(event.currentTarget)); }}>
        <label className="space-y-1 text-xs"><span className="text-muted-foreground">取消の理由（必須）</span><Input className={field} name="reason" placeholder="例: 実際には未払い。状態変更で自動作成された記録" maxLength={500} required /></label>
        <div className="flex items-end gap-1"><Button type="submit" size="sm" variant="destructive" disabled={pending}>{pending ? <LoaderCircle className="size-3 animate-spin" /> : <Ban className="size-3" />}この記録を取り消す</Button><Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setMode(null)}>戻る</Button></div>
      </form> : null}
      {row.history.length ? <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">変更履歴 {row.history.length}件</summary><ul className="mt-1 space-y-1 text-muted-foreground">{row.history.map((entry, index) => <li key={index} className="break-words">{when(entry.at)} · {entry.kindLabel} · {entry.by}{entry.before && entry.after ? ` · ${yen.format(entry.before.amount)} ${formatDate(entry.before.paymentDate)} → ${yen.format(entry.after.amount)} ${formatDate(entry.after.paymentDate)}` : entry.after ? ` · ${yen.format(entry.after.amount)} ${formatDate(entry.after.paymentDate)}` : ""}{entry.reason ? ` · 理由: ${entry.reason}` : ""}</li>)}</ul></details> : <p className="text-xs text-muted-foreground">登録 {when(row.createdAt)} · {row.createdBy}</p>}
    </li>)}</ul> : <p className="text-xs text-muted-foreground">支払記録はありません。</p>}
    {canceled.length ? <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">取消済みの記録 {canceled.length}件</summary><ul className="mt-1 divide-y rounded-md border">{canceled.map((row) => <li key={row.id} className="space-y-1 p-2 text-muted-foreground"><p className="break-words"><span className="font-mono line-through">{yen.format(row.amount)}</span> {formatDate(row.paymentDate)} · {row.originLabel} · 取消 {when(row.canceledAt)}</p>{row.history.filter((entry) => entry.kind === "CANCELED").map((entry, index) => <p key={index} className="break-words">理由: {entry.reason || "未記入"} · {entry.by}</p>)}</li>)}</ul></details> : null}
    {canRecord ? invoice.unpaidAmount > 0 ? mode?.type === "record" ? <form className="grid gap-2 rounded-md bg-muted/40 p-2 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); submitRecord(new FormData(event.currentTarget)); }}>
      <label className="space-y-1 text-xs"><span className="text-muted-foreground">支払日（必須）</span><Input className={field} name="paymentDate" type="date" defaultValue={todayIso()} max={todayIso()} required /></label>
      <label className="space-y-1 text-xs"><span className="text-muted-foreground">金額（必須・未払い {yen.format(invoice.unpaidAmount)} まで）</span><Input className={field} name="amount" type="number" min="1" step="1" defaultValue={invoice.unpaidAmount} required /></label>
      <label className="space-y-1 text-xs"><span className="text-muted-foreground">支払方法</span><Input className={field} name="method" defaultValue="銀行振込" maxLength={100} /></label>
      <label className="space-y-1 text-xs"><span className="text-muted-foreground">根拠・理由（任意）</span><Input className={field} name="reason" placeholder="例: 通帳で確認、現金払い" maxLength={500} /></label>
      <label className="space-y-1 text-xs sm:col-span-2"><span className="text-muted-foreground">メモ</span><Textarea name="memo" className="min-h-16" maxLength={1000} /></label>
      <p className="text-xs text-muted-foreground sm:col-span-2">銀行明細と一致する支払いは、ここではなく「銀行・書類照合」で照合すると銀行照合済みになります。</p>
      <div className="flex gap-1 sm:col-span-2"><Button type="submit" size="sm" disabled={pending}>{pending ? <LoaderCircle className="size-3 animate-spin" /> : <Plus className="size-3" />}支払記録を登録</Button><Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setMode(null)}>戻る</Button></div>
    </form> : <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => { setError(""); setMode({ type: "record" }); }}><Plus className="size-3" />支払記録を手入力で登録</Button> : <p className="text-xs text-emerald-700 dark:text-emerald-400">全額の支払記録が登録されています。</p> : null}
  </section>;
}
