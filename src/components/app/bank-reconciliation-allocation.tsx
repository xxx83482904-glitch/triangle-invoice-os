"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { ArrowUpRight, Check, LoaderCircle, Plus, RefreshCw, Trash2 } from "lucide-react";
import { confirmBankReconciliationBatchAction, saveReconciliationAliasAction } from "@/app/banking/reconcile/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { bankSelectClass } from "@/components/app/banking-settings";
import { allocationPreview, feeDifference, type AllocationDraft } from "@/lib/bank-reconciliation-allocation";
import { normalizeReconciliationName, reconciliationPaymentOptions } from "@/lib/bank-reconciliation-matching";
import type { ReconciliationBank, ReconciliationInvoice } from "@/lib/bank-reconciliation";
import type { CompanyScope } from "@/lib/company";
import { toast } from "@/hooks/use-toast";

const money = (value: number) => new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 }).format(value);

function PayerAlias({ company, bank, invoice, disabled, onBusy }: { company: CompanyScope; bank: ReconciliationBank; invoice: ReconciliationInvoice; disabled: boolean; onBusy: (value: boolean) => void }) {
  const [pending, startTransition] = useTransition(), [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [alias, setAlias] = useState(() => invoice.bankAliases.find((row) => row.accountId === bank.accountId && row.content === normalizeReconciliationName(bank.content)));
  function save(removeId?: string) {
    if (pending || disabled) return;
    onBusy(true);
    startTransition(async () => {
      try {
        const result = await saveReconciliationAliasAction(company, { transactionId: bank.id, transactionUpdatedAt: bank.updatedAt, invoiceKind: invoice.kind, invoiceId: invoice.id, invoiceUpdatedAt: invoice.updatedAt, acknowledged: true, removeId });
        if (!result.success) { setError(result.error); return; }
        setAlias(result.bankAliases.find((row) => row.accountId === bank.accountId && row.content === normalizeReconciliationName(bank.content))); setConfirmed(false); setError("");
        toast({ title: removeId ? "名義対応を解除しました" : "名義対応を保存しました。支払い・照合は未確定です", variant: "success" });
      } catch { setError("保存結果を確認できません。画面を更新してください"); }
      finally { onBusy(false); }
    });
  }
  return <details className="text-xs"><summary className="min-h-11 cursor-pointer content-center">名義対応 {alias ? "登録済み" : "未登録"}</summary>
    <p className="break-words">{bank.content} → {invoice.party}</p>
    {alias ? <Button variant="ghost" size="sm" disabled={disabled || pending} onClick={() => save(alias.id)}><Trash2 className="size-4" />名義対応を解除</Button> : <><label className="flex min-h-11 items-center gap-2"><input type="checkbox" disabled={disabled || pending} checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />この口座の名義と取引先の対応を確認済み</label><Button variant="outline" size="sm" disabled={disabled || pending || !confirmed} onClick={() => save()}><Check className="size-4" />名義対応を保存</Button></>}
    {error ? <p role="alert" className="text-destructive">{error}</p> : null}
  </details>;
}

export function BankReconciliationAllocation({ company, bank, invoice, invoices = [invoice], feeCategories = [], initialKeys, onBusy, onComplete }: {
  company: CompanyScope; bank: ReconciliationBank; invoice: ReconciliationInvoice; invoices?: ReconciliationInvoice[]; feeCategories?: Array<{ id: string; name: string }>; initialKeys?: string[];
  onBusy: (busy: boolean) => void; onComplete: (amount: number) => void;
}) {
  const makeRow = (item: ReconciliationInvoice, availableAmount: number, id: string): AllocationDraft => {
    const payment = reconciliationPaymentOptions(bank, item)[0];
    return { id, invoiceKey: item.key, mode: payment ? "existing" : "new", paymentId: payment?.id || "", amount: String(Math.max(0, Math.min(availableAmount, payment?.available ?? item.outstanding))), duplicateAcknowledged: false };
  };
  // A 合算候補 opens with one allocation row per invoice, each taking what is left of the bank amount in turn.
  const [rows, setRows] = useState<AllocationDraft[]>(() => {
    const keys = initialKeys?.length ? initialKeys : [invoice.key];
    let remaining = bank.remaining;
    return keys.flatMap((key, index) => { const item = invoices.find((entry) => entry.key === key); if (!item) return []; const row = makeRow(item, remaining, index ? `initial-${index}` : "initial"); remaining = Math.max(0, remaining - Number(row.amount)); return [row]; });
  });
  const [pending, startTransition] = useTransition(), [aliasBusy, setAliasBusy] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false), [note, setNote] = useState(""), [error, setError] = useState("");
  const [addKey, setAddKey] = useState(""), [submitted, setSubmitted] = useState(false), [uncertain, setUncertain] = useState(false);
  const currentRevision = useMemo(() => JSON.stringify([bank.updatedAt, bank.remaining, bank.issue, bank.conflict, invoices.map((item) => [item.key, item.updatedAt, item.outstanding, item.payments])]), [bank, invoices]);
  const [reviewedRevision, setReviewedRevision] = useState(currentRevision);
  const stale = currentRevision !== reviewedRevision;
  const inFlight = useRef(false);
  const preview = allocationPreview(bank, invoices, rows);
  const busy = pending || aliasBusy || submitted || uncertain;
  function change(id: string, patch: Partial<AllocationDraft>) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch, duplicateAcknowledged: patch.duplicateAcknowledged ?? false } : row));
    setAcknowledged(false); setError("");
  }
  function submit() {
    if (inFlight.current || busy || stale || !preview.valid || !acknowledged) return;
    inFlight.current = true; onBusy(true); setError("");
    startTransition(async () => {
      try {
        const result = await confirmBankReconciliationBatchAction(company, { transactionId: bank.id, transactionUpdatedAt: bank.updatedAt, acknowledged: true,
          allocations: preview.allocations.map(({ row, invoice: item, payment, amount }) => ({ fee: row.fee ? { amount: Number(row.fee.amount), categoryId: row.fee.categoryId || undefined } : undefined, invoiceKind: item!.kind, invoiceId: item!.id, invoiceUpdatedAt: item!.updatedAt, mode: row.mode, paymentId: row.mode === "existing" ? row.paymentId : undefined, paymentUpdatedAt: row.mode === "existing" ? payment?.updatedAt : undefined, amount, note, duplicateAcknowledged: row.duplicateAcknowledged })),
        });
        if (!result.success) { setError(result.error); return; }
        setSubmitted(true); toast({ title: `${result.allocations.length}件・${money(result.amount)}の配賦を保存しました`, variant: "success" }); onComplete(result.amount);
      } catch { setUncertain(true); setError("保存結果を確認できません。再送信せず、画面を更新して照合済み記録を確認してください。入力内容はこの画面に保持しています。"); }
      finally { inFlight.current = false; onBusy(false); }
    });
  }
  return <section aria-label="複数請求書への配賦" className="space-y-3 border-y py-4">
    <h3 className="text-sm font-semibold">配賦明細</h3>
    {stale && !submitted ? <div role="alert" className="border-l-2 border-amber-500 p-3 text-sm"><p>元データが更新されました。入力した配賦は保持しています。最新の残額と支払い記録を再確認してください。</p><Button variant="outline" className="mt-2 min-h-11" disabled={busy} onClick={() => { setReviewedRevision(currentRevision); setAcknowledged(false); setRows((current) => current.map((row) => ({ ...row, duplicateAcknowledged: false }))); }}><RefreshCw className="size-4" />最新内容で再確認</Button></div> : null}
    <div className="space-y-4">{preview.allocations.map(({ row, invoice: item, payment, error: rowError, duplicateWarning }, index) => <div key={row.id} className="min-w-0 space-y-2 border-b pb-3">
      <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="break-words text-sm font-medium">{index + 1}. {item?.party} / {item?.title}</p><p className="break-words text-xs text-muted-foreground">{item?.project}</p></div><Button variant="ghost" size="icon" className="size-11 shrink-0" disabled={busy} aria-label={`配賦行${index + 1}を削除`} title="配賦行を削除" onClick={() => { setRows(rows.filter((entry) => entry.id !== row.id)); setAcknowledged(false); }}><Trash2 className="size-4" /></Button></div>
      {item ? <>
        <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">{[["請求額", item.total], ["支払い登録済み", item.paid], ["銀行照合済み", item.matched], ["配賦後の銀行未照合", preview.invoiceRemaining(item)]].map(([label, amount]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="break-all tabular-nums">{money(Number(amount))}</dd></div>)}</dl>
        <div className="grid gap-2 sm:grid-cols-2"><label className="grid min-w-0 gap-1 text-xs">記録方法<select className={bankSelectClass} disabled={busy} value={row.mode === "new" ? "new" : row.paymentId} onChange={(e) => { const record = item.payments.find((entry) => entry.id === e.target.value); change(row.id, { mode: record ? "existing" : "new", paymentId: record?.id || "" }); }}><option value="new" disabled={item.outstanding <= 0}>実際の支払いを新規登録</option>{item.payments.filter((entry) => entry.available > 0).map((entry) => <option key={entry.id} value={entry.id}>既存: {entry.date} / {money(entry.available)} / {entry.method}</option>)}</select></label><label className="grid min-w-0 gap-1 text-xs">配賦額<Input className="min-h-11 tabular-nums" type="number" step="0.01" min="0.01" disabled={busy} value={row.amount} onChange={(e) => change(row.id, { amount: e.target.value })} /></label></div>
        <p className="text-xs">{row.mode === "new" ? `${bank.date}の実際の${bank.side === "INCOME" ? "入金" : "支払い"} / 登録後の未入金・未払い ${money(preview.outstanding(item))}` : `支払いは追加しません / 記録日 ${payment?.date || ""}`}</p>
        {item.withholdingAmount > 0 ? <p className={`text-xs ${item.withholdingMismatch ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`}>源泉徴収 {money(item.withholdingAmount)} 差引後の支払額 {money(item.netPayable)}{item.withholdingMismatch ? `（請求書の差引支払額 ${money(item.total)} と一致しません。請求書の金額を確認してください）` : ""}</p> : null}
        {(() => {
          const difference = rows.length === 1 && row.mode === "new" ? feeDifference(bank, item) : 0;
          if (!difference) return null;
          return <div className="space-y-1 border-l-2 border-sky-500 pl-3 text-xs">
            <label className="flex min-h-11 items-start gap-2 pt-2"><input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={Boolean(row.fee)} disabled={busy || !feeCategories.length} onChange={(e) => change(row.id, e.target.checked ? { fee: { amount: String(difference), categoryId: row.fee?.categoryId || feeCategories[0]?.id || "" }, amount: String(bank.side === "INCOME" ? bank.remaining : item.outstanding) } : { fee: undefined })} /><span className="min-w-0 break-words">{bank.side === "INCOME" ? `差額 ${money(difference)} を振込手数料（先方差引）として支払記録に含め、請求書を全額入金扱いにする` : `銀行残額 ${money(difference)} を振込手数料として明細に配賦する`}</span></label>
            {row.fee ? <label className="grid gap-1">手数料の科目<select className={bankSelectClass} aria-label="手数料の科目" value={row.fee.categoryId} disabled={busy} onChange={(e) => change(row.id, { fee: { amount: row.fee!.amount, categoryId: e.target.value } })}>{feeCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label> : null}
            {!feeCategories.length ? <p>経費の科目がないため手数料差額の処理は使えません。</p> : null}
          </div>;
        })()}
        {duplicateWarning ? <div className="border-l-2 border-amber-500 pl-3 text-xs"><p>支払い済み・未照合・同日同額の記録があります。二重支払いの可能性を確認してください。</p><label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={row.duplicateAcknowledged} disabled={busy} onChange={(e) => change(row.id, { duplicateAcknowledged: e.target.checked })} />既存記録とは別の実際の支払いと確認済み</label></div> : null}
        {item.needsReview || item.stateMismatch ? <p className="text-xs text-amber-700">原本・処理状態と支払い記録に確認事項があります。</p> : null}
        {item.installmentSchedule.length ? <details className="text-xs"><summary className="min-h-11 cursor-pointer content-center">分割予定（実入金ではありません）</summary><ul>{item.installmentSchedule.map((entry) => <li className="break-words" key={entry.id}>{entry.dueDate} / {money(entry.amount)} / {entry.note}</li>)}</ul></details> : null}
        <div className="flex flex-wrap gap-4"><Link className="inline-flex min-h-11 items-center gap-1 text-xs text-primary" href={item.href} target="_blank" rel="noreferrer">書類<ArrowUpRight className="size-4" /></Link>{item.originalHref ? <a className="inline-flex min-h-11 items-center gap-1 text-xs text-primary" href={item.originalHref} target="_blank" rel="noreferrer">{item.kind === "issued" ? "原本・請求書PDF" : "原本"}<ArrowUpRight className="size-4" /></a> : <span className="content-center text-xs text-muted-foreground">原本未添付</span>}</div>
        <PayerAlias key={`${item.key}:${item.bankAliases.map((entry) => entry.id).join()}`} company={company} bank={bank} invoice={item} disabled={busy} onBusy={(value) => { setAliasBusy(value); onBusy(value); }} />
      </> : null}
      {rowError ? <p role="alert" className="text-xs text-destructive">{rowError}</p> : null}
    </div>)}</div>
    <div className="flex min-w-0 items-end gap-2"><label className="grid min-w-0 flex-1 gap-1 text-xs">請求書を追加<select className={bankSelectClass} value={addKey} disabled={busy || rows.length >= 100} onChange={(e) => setAddKey(e.target.value)}><option value="">選択してください</option>{invoices.map((item) => <option key={item.key} value={item.key}>{item.party} / {item.title} / 未払い {money(item.outstanding)}</option>)}</select></label><Button size="icon" variant="outline" className="size-11 shrink-0" title="配賦行を追加" aria-label="配賦行を追加" disabled={busy || !addKey || rows.length >= 100} onClick={() => { const item = invoices.find((entry) => entry.key === addKey); if (item) setRows([...rows, makeRow(item, preview.bankRemaining, crypto.randomUUID())]); setAddKey(""); setAcknowledged(false); }}><Plus className="size-4" /></Button></div>
    <div aria-live="polite" className="flex flex-wrap justify-between gap-2 text-sm"><span>配賦合計 <strong>{money(preview.total)}</strong>{preview.fees ? <span className="text-xs text-muted-foreground">（うち手数料 {money(preview.fees)}）</span> : null}</span><span className={preview.bankRemaining < 0 ? "text-destructive" : ""}>銀行残額 <strong>{money(preview.bankRemaining)}</strong></span></div>
    {preview.bankRemaining < 0 ? <p role="alert" className="text-xs text-destructive">配賦合計が銀行の未照合額を超えています。</p> : preview.bankRemaining > 0 ? <p className="text-xs text-amber-700">銀行残額は未照合として残ります。</p> : null}
    <Input aria-label="配賦メモ" placeholder="配賦メモ" disabled={busy} maxLength={1000} value={note} onChange={(e) => { setNote(e.target.value); setAcknowledged(false); }} />
    <label className="flex min-h-11 items-center gap-3 text-sm"><input className="size-5 shrink-0" type="checkbox" checked={acknowledged} disabled={busy || stale} onChange={(e) => setAcknowledged(e.target.checked)} />{rows.length}件の原本・配賦額・通貨・二重計上なしを確認済み</label>
    {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
    <Button className="min-h-11 w-full" disabled={busy || stale || !preview.valid || !acknowledged} onClick={submit}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}{submitted ? "配賦保存済み" : `${rows.length}件の配賦を一括確定`}</Button>
  </section>;
}
