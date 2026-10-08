"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowUpRight, Check, ChevronLeft, ChevronRight, CircleAlert, Link2, LoaderCircle, RefreshCw, Search, Unlink, X } from "lucide-react";
import { confirmBankReconciliationAction, removeBankReconciliationAction, syncReconciledInvoiceStatusAction } from "@/app/banking/reconcile/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { bankSelectClass } from "@/components/app/banking-settings";
import { BankAiPanel } from "@/components/app/bank-ai-panel";
import { BankAiSettings } from "@/components/app/bank-ai-settings";
import { BankReviewPanel } from "@/components/app/bank-review-panel";
import type { BankAiPreview } from "@/lib/bank-ai-types";
import type { BankDocumentReview } from "@/lib/bank-review";
import { toast } from "@/hooks/use-toast";
import type { ReconciliationBank, ReconciliationInvoice, ReconciliationOverview } from "@/lib/bank-reconciliation";
import type { CompanyScope } from "@/lib/company";

const money = (value: number) => new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 }).format(value);
const stateLabels: Record<string, string> = { unmatched: "未照合・一部照合", matched: "照合済み", conflict: "要再確認", excluded: "対象外" };
const touch = "min-h-11";
type Props = {
  company: CompanyScope; filters: { account: string; month: string; status: string; query: string; invoice: string };
  rows: ReconciliationBank[]; selected?: ReconciliationBank; invoices: ReconciliationInvoice[]; links: ReconciliationOverview["links"];
  candidates: Array<{ key: string; score: number; reasons: string[] }>; accounts: Array<{ id: string; name: string }>;
  page: number; total: number; initialView: "bank" | "invoices" | "checks"; unlinkedMailCount: number; counts: { unmatched: number; recorded: number; overdue: number; conflicts: number };
  aiPreview?: BankAiPreview; aiConfigured: boolean; aiModel: string; review?: BankDocumentReview;
  aiSettings?: { keyFromEnv: boolean; modelFromEnv: boolean };
};

function SyncStatusButton({ company, invoice }: { company: CompanyScope; invoice: ReconciliationInvoice }) {
  const router = useRouter(), [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false), [error, setError] = useState("");
  function sync() {
    startTransition(async () => {
      try {
        const result = await syncReconciledInvoiceStatusAction(company, invoice.kind, invoice.id, invoice.updatedAt);
        if (!result.success) { setError(result.error); return; }
        setOpen(false); router.refresh(); toast({ title: "支払い記録に合わせて状態を揃えました", variant: "success" });
      } catch { setError("結果を確認できませんでした。画面を更新してください。"); }
    });
  }
  return <>
    <Button className={touch} variant="outline" onClick={() => { setError(""); setOpen(true); }}><RefreshCw className="size-4" />状態を揃える</Button>
    <Dialog open={open} onOpenChange={(value) => { if (!pending) setOpen(value); }}>
      <DialogContent showCloseButton={!pending} onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogHeader><DialogTitle>支払い記録に状態を揃えますか？</DialogTitle><DialogDescription>入金・支払いの追加や削除はせず、登録済みの金額に合わせて請求書と関連する郵便物の完了状態を更新します。</DialogDescription></DialogHeader>
        <p className="break-words text-sm">{invoice.title} / 請求額 {money(invoice.total)} / 登録済み {money(invoice.paid)}</p>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <Button className={touch} disabled={pending} onClick={sync}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}状態を揃える</Button>
      </DialogContent>
    </Dialog>
  </>;
}

function ReconcileDialog({ company, bank, invoice, close }: { company: CompanyScope; bank: ReconciliationBank; invoice: ReconciliationInvoice; close: () => void }) {
  const router = useRouter(), [pending, startTransition] = useTransition();
  const available = invoice.payments.filter((row) => row.available > 0);
  const [mode, setMode] = useState<"existing" | "new">(available.length ? "existing" : "new");
  const [paymentId, setPaymentId] = useState(available[0]?.id || "");
  const [amount, setAmount] = useState(String(Math.min(bank.remaining, available[0]?.available || invoice.outstanding)));
  const [acknowledged, setAcknowledged] = useState(false), [note, setNote] = useState(""), [error, setError] = useState("");
  const payment = available.find((row) => row.id === paymentId), value = Number(amount);
  const max = Math.min(bank.remaining, mode === "existing" ? payment?.available || 0 : invoice.outstanding);
  function submit() {
    startTransition(async () => {
      try {
        const result = await confirmBankReconciliationAction(company, { transactionId: bank.id, transactionUpdatedAt: bank.updatedAt, invoiceKind: invoice.kind, invoiceId: invoice.id, invoiceUpdatedAt: invoice.updatedAt, mode, paymentId: mode === "existing" ? paymentId : undefined, paymentUpdatedAt: mode === "existing" ? payment?.updatedAt : undefined, amount: value, acknowledged: true, note });
        if (!result.success) { setError(result.error); return; }
        toast({ title: result.createdPayment ? "照合し、入金・支払いを登録しました" : "既存の入金・支払い記録と照合しました", variant: "success" }); close(); router.refresh();
      } catch { setError("照合結果を確認できませんでした。画面を更新して確認してください。"); }
    });
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !pending) close(); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl" showCloseButton={!pending} onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
    <DialogHeader><DialogTitle>銀行明細と請求書を照合</DialogTitle><DialogDescription>銀行への送金操作は行いません。アプリの入金・支払い記録を紐づけます。</DialogDescription></DialogHeader>
    <div className="space-y-2 border-y py-3 text-sm"><p className="break-words">{bank.date} / {bank.content}</p><p>銀行の未照合額 <strong>{money(bank.remaining)}</strong></p><p className="break-words">{invoice.title} / {invoice.party}</p><p>請求額 {money(invoice.total)} / 登録済み {money(invoice.paid)} / 未入金・未払い {money(invoice.outstanding)}</p><Link className="inline-flex min-h-11 items-center gap-1 text-primary underline" href={invoice.href} target="_blank" rel="noreferrer">請求書を確認<ArrowUpRight className="size-4" /></Link></div>
    {invoice.needsReview || invoice.stateMismatch ? <p className="text-sm text-amber-700 dark:text-amber-400">請求書のOCR・支払い状態に確認事項があります。原本と金額を確認してください。</p> : null}
    <label className="grid min-w-0 gap-1 text-sm">記録方法<select className={bankSelectClass} value={mode} disabled={pending} onChange={(e) => { const next = e.target.value as typeof mode; setMode(next); setAmount(String(Math.min(bank.remaining, next === "existing" ? payment?.available || 0 : invoice.outstanding))); setAcknowledged(false); }}><option value="existing" disabled={!available.length}>登録済みの入金・支払いに紐づける</option><option value="new" disabled={!invoice.outstanding}>未登録分の入金・支払いを追加</option></select></label>
    {mode === "existing" ? <label className="grid min-w-0 gap-1 text-sm">既存の記録<select className={bankSelectClass} value={paymentId} disabled={pending} onChange={(e) => { setPaymentId(e.target.value); setAmount(String(Math.min(bank.remaining, available.find((row) => row.id === e.target.value)?.available || 0))); setAcknowledged(false); }}>{available.map((row) => <option key={row.id} value={row.id}>{row.date} / {row.method} / 未照合 {money(row.available)}</option>)}</select></label> : <p className="text-sm text-muted-foreground">銀行の取引日 {bank.date} で支払いを記録します。全額になると請求書を完了にし、受領請求書に紐づく郵便物も処理済みにします。</p>}
    {payment && mode === "existing" && payment.date !== bank.date ? <p className="text-sm text-amber-700 dark:text-amber-400">記録日 {payment.date} と銀行日 {bank.date} が異なります。既存の日付は上書きしません。</p> : null}
    <label className="grid min-w-0 gap-1 text-sm">今回の照合額<Input className={touch} type="number" inputMode="decimal" step="0.01" min="0.01" max={max} value={amount} disabled={pending} onChange={(e) => { setAmount(e.target.value); setAcknowledged(false); }} /></label>
    <p className="text-sm">銀行側に残る未照合額: {money(Math.max(0, bank.remaining - (Number.isFinite(value) ? value : 0)))}</p>
    <label className="grid min-w-0 gap-1 text-sm">照合メモ<Input className={touch} value={note} maxLength={1000} disabled={pending} onChange={(e) => setNote(e.target.value)} /></label>
    <label className="flex min-h-11 items-start gap-3 py-2 text-sm"><input type="checkbox" className="mt-1 size-5 shrink-0 accent-primary" checked={acknowledged} disabled={pending} onChange={(e) => setAcknowledged(e.target.checked)} /><span>同じ通貨・同じ支払いであることを確認しました。カード利用や振替の二重計上ではありません。</span></label>
    {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
    <Button className={touch} disabled={pending || !acknowledged || !Number.isFinite(value) || value <= 0 || value > max} onClick={submit}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}照合を確定</Button>
  </DialogContent></Dialog>;
}

export function BankReconciliationWorkspace({ company, filters, rows, selected, invoices, links, candidates, accounts, page, total, initialView, counts, unlinkedMailCount, aiPreview, aiConfigured, aiModel, review, aiSettings }: Props) {
  const router = useRouter(), [pending, startTransition] = useTransition();
  const view = initialView;
  const [query, setQuery] = useState(filters.query);
  const [invoiceQuery, setInvoiceQuery] = useState(""), [invoiceFilter, setInvoiceFilter] = useState("unmatched");
  const [chosen, setChosen] = useState<ReconciliationInvoice | null>(null), [removing, setRemoving] = useState<Props["links"][number] | null>(null), [error, setError] = useState("");
  const href = (values: Record<string, string>) => `/banking/reconcile?${new URLSearchParams({ company, view, account: filters.account, month: filters.month, status: filters.status, q: filters.query, invoice: filters.invoice, page: "1", ...values })}`;
  const navigate = (values: Record<string, string>) => startTransition(() => router.push(href(values)));
  const invoiceMap = new Map(invoices.map((row) => [row.key, row]));
  const normalizedQuery = invoiceQuery.normalize("NFKC").toLocaleLowerCase("ja");
  const searchInvoice = (row: ReconciliationInvoice) => !normalizedQuery || `${row.title} ${row.party} ${row.project} ${row.total}`.normalize("NFKC").toLocaleLowerCase("ja").includes(normalizedQuery);
  const choices = selected ? invoices.filter((row) => row.eligible && !row.conflict && (selected.side === "INCOME" ? row.kind === "issued" : row.kind === "received") && (row.outstanding > 0 || row.payments.some((payment) => payment.available > 0)) && searchInvoice(row)) : [];
  const invoiceRows = invoices.filter(searchInvoice).filter((row) => invoiceFilter === "all" || (invoiceFilter === "unmatched" && row.eligible && row.unmatched > 0) || (invoiceFilter === "recorded" && row.recordedUnmatched > 0) || (invoiceFilter === "issues" && (row.conflict || row.stateMismatch || row.overpaid > 0 || !row.eligible)) || (invoiceFilter === "overdue" && row.overdue));
  const selectedLinks = links.filter((row) => row.transactionId === selected?.id);
  const actionable = selected && !selected.issue && !selected.conflict && selected.remaining > 0;
  function remove() {
    if (!removing) return;
    startTransition(async () => {
      try {
        const result = await removeBankReconciliationAction(company, removing.id, removing.updatedAt);
        if (!result.success) { setError(result.error); return; }
        setRemoving(null); router.refresh(); toast({ title: "照合を解除しました", variant: "success" });
      } catch { setError("解除結果を確認できません。画面を更新してください。"); }
    });
  }
  return <div className="min-w-0 space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-4"><h1 className="text-xl font-semibold">{view === "checks" ? "AI・確認事項" : "銀行・請求書の照合"}</h1><div className="flex flex-wrap gap-2">{aiSettings ? <BankAiSettings configured={aiConfigured} model={aiModel} {...aiSettings} /> : null}<Button className={touch} variant="outline" disabled={pending} onClick={() => startTransition(() => router.refresh())}><RefreshCw className={`size-4 ${pending ? "animate-spin" : ""}`} />更新</Button></div></header>
    <dl className="grid grid-cols-2 gap-4 border-b pb-4 lg:grid-cols-4">{[["未照合の銀行明細", counts.unmatched], ["支払い登録済み・銀行未照合", counts.recorded], ["期限超過の請求書", counts.overdue], ["要再確認・状態の不整合", counts.conflicts]].map(([label, count]) => <div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-xl font-semibold tabular-nums">{count}件</dd></div>)}</dl>
    <p className="text-xs text-muted-foreground">同一会社内の銀行入出金と発行・受領請求書を照合します。郵便物に紐づく受領請求書は1件として扱います。通貨換算・差額の自動処理は行いません。件数は会社全体です。</p>
    {unlinkedMailCount ? <p className="border-l-2 border-amber-500 pl-3 text-sm">受領請求書と未連携の郵便物が {unlinkedMailCount}件あります。<Link className="inline-flex min-h-11 items-center gap-1 text-primary underline" href={`/mail-sorter?company=${company}`}>郵便物を確認<ArrowUpRight className="size-4" /></Link></p> : null}
    {view !== "checks" ? <div className="flex flex-wrap gap-1" role="group" aria-label="照合の表示">{(["bank", "invoices"] as const).map((value) => <button className={`min-h-11 min-w-0 rounded-md border px-3 text-sm ${view === value ? "border-primary/30 bg-primary/10 font-medium text-primary" : "border-transparent text-muted-foreground hover:bg-muted"}`} key={value} aria-pressed={view === value} disabled={pending} onClick={() => navigate({ view: value })}>{value === "bank" ? "銀行から照合" : "請求書から確認"}</button>)}</div> : null}
    {view === "bank" ? <>
      <div className="grid min-w-0 gap-2 sm:grid-cols-3"><select className={bankSelectClass} aria-label="照合口座" value={filters.account} disabled={pending} onChange={(e) => navigate({ account: e.target.value })}><option value="">すべての口座</option>{accounts.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select><Input className={touch} type="month" aria-label="銀行の取引月" value={filters.month} disabled={pending} onChange={(e) => navigate({ month: e.target.value })} /><select className={bankSelectClass} aria-label="照合状態" value={filters.status} disabled={pending} onChange={(e) => navigate({ status: e.target.value })}><option value="all">すべての状態</option>{Object.entries(stateLabels).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></div>
      <form className="flex min-w-0 gap-2" onSubmit={(e) => { e.preventDefault(); navigate({ q: query }); }}><Input className={touch} aria-label="銀行摘要・金額を検索" placeholder="摘要・金額" value={query} maxLength={200} onChange={(e) => setQuery(e.target.value)} /><Button className="size-11 shrink-0" size="icon" variant="outline" type="submit" aria-label="検索" title="検索" disabled={pending}><Search className="size-4" /></Button></form>
      {filters.invoice ? <div className="flex flex-wrap items-center justify-between gap-2 border-l-2 border-primary bg-primary/5 p-2 text-sm"><span className="break-words">請求書候補: {invoiceMap.get(filters.invoice)?.title || "対象外の請求書"}</span><Button className={touch} variant="ghost" onClick={() => navigate({ invoice: "" })}><X className="size-4" />解除</Button></div> : null}
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(270px,0.85fr)_minmax(0,1.5fr)]">
        <section className="min-w-0" aria-label="銀行明細"><div className="flex min-h-11 items-center justify-between gap-2 text-sm"><span>{total}件</span><div className="flex items-center gap-1"><Button className="size-11" size="icon" variant="ghost" aria-label="前のページ" title="前のページ" disabled={page === 1 || pending} onClick={() => navigate({ page: String(page - 1) })}><ChevronLeft className="size-4" /></Button><span>{page}/{Math.max(1, Math.ceil(total / 50))}</span><Button className="size-11" size="icon" variant="ghost" aria-label="次のページ" title="次のページ" disabled={page * 50 >= total || pending} onClick={() => navigate({ page: String(page + 1) })}><ChevronRight className="size-4" /></Button></div></div>
          <ul className="max-h-[360px] divide-y overflow-y-auto border-y xl:max-h-[65vh]">{rows.map((row) => <li key={row.id}><Link prefetch={false} href={href({ transaction: row.id, page: String(page) })} className={`block min-h-11 space-y-1 p-3 text-sm ${selected?.id === row.id ? "bg-primary/10" : "hover:bg-muted"}`} aria-current={selected?.id === row.id ? "true" : undefined}><div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground"><span>{row.date} / {row.side === "INCOME" ? "入金" : "出金"}</span><span className={row.conflict ? "text-destructive" : ""}>{stateLabels[row.state]}</span></div><div className="break-words font-medium">{row.content || "摘要なし"}</div><div className="flex flex-wrap justify-between gap-2 tabular-nums"><span>{money(row.amount)}</span><span className="text-xs text-muted-foreground">未照合 {money(row.remaining)}</span></div></Link></li>)}</ul>
          {!rows.length ? <p className="py-4 text-sm text-muted-foreground">該当する銀行明細はありません。口座・月・状態を変更して確認してください。</p> : null}
        </section>
        <section className="min-w-0 space-y-4 xl:border-l xl:pl-5" aria-label="照合の詳細">{selected ? <>
          <div className="space-y-1 border-b pb-3"><h2 className="break-words text-base font-semibold">{selected.content || "摘要なし"}</h2><p className="break-words text-xs text-muted-foreground">{accounts.find((row) => row.id === selected.accountId)?.name} / {selected.date} / {selected.side === "INCOME" ? "入金" : "出金"}</p><p className="text-sm tabular-nums">明細額 {money(selected.amount)} / 照合割当 {money(selected.allocated)} / 未照合 {money(selected.remaining)}</p><Link className="inline-flex min-h-11 items-center gap-1 text-sm text-primary underline" href={`/banking?company=${company}&transaction=${encodeURIComponent(selected.id)}`}>銀行明細を確認<ArrowUpRight className="size-4" /></Link></div>
          {selected.issue || selected.conflict ? <p role="alert" className="flex items-start gap-2 border-l-2 border-amber-500 p-3 text-sm"><CircleAlert className="size-4 shrink-0" />{selected.issue || "照合後に元データが変わっています。既存の照合を解除して見直してください。"}</p> : null}
          {selectedLinks.length ? <div className="space-y-2"><h3 className="text-sm font-semibold">紐づけ済みの記録</h3><ul className="divide-y">{selectedLinks.map((row) => <li className="space-y-1 py-2 text-sm" key={row.id}><div className="flex flex-wrap items-center justify-between gap-2"><span className="min-w-0 break-words">{invoiceMap.get(row.invoiceKey)?.title || "請求書が削除・移動されています"} / {money(row.amount)}</span><Button className={touch} variant="ghost" disabled={pending} onClick={() => { setRemoving(row); setError(""); }}><Unlink className="size-4" />照合解除</Button></div><p className="text-xs text-muted-foreground">{row.createdPayment ? "照合時に入金・支払いを新規登録" : "既存の入金・支払い記録に紐づけ"}</p>{row.issue ? <p className="break-words text-xs text-destructive">要再確認: {row.issue}</p> : null}{row.note ? <p className="break-words text-xs">{row.note}</p> : null}</li>)}</ul></div> : null}
          {actionable && aiPreview ? <BankAiPanel key={aiPreview.revision} company={company} preview={aiPreview} configured={aiConfigured} model={aiModel} onChooseInvoice={(key) => { const invoice = invoiceMap.get(key); if (invoice) setChosen(invoice); }} /> : null}
          {actionable ? <><div className="space-y-2"><h3 className="text-sm font-semibold">請求書の候補</h3><p className="text-xs text-muted-foreground">金額・摘要・日付の一致から提案しています。候補が複数ある場合や金額だけ一致する場合は、原本を確認してください。</p><ul className="divide-y">{candidates.map((candidate) => { const invoice = invoiceMap.get(candidate.key)!; return <li className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm" key={candidate.key}><div className="min-w-0 flex-1"><p className="break-words font-medium">{invoice.title} / {invoice.party}</p><p className="break-words text-xs text-muted-foreground">{invoice.project} / 請求額 {money(invoice.total)}</p><p className="mt-1 break-words text-xs text-emerald-700 dark:text-emerald-400">{candidate.reasons.join(" / ")}</p></div><Button className={touch} variant="outline" disabled={pending} onClick={() => setChosen(invoice)}><Link2 className="size-4" />照合</Button></li>; })}</ul>{!candidates.length ? <p className="text-sm text-muted-foreground">一致する候補がありません。請求書名・取引先・金額から検索できます。</p> : null}</div>
          <div className="space-y-2 border-t pt-3"><label className="grid gap-1 text-sm">請求書を検索<Input className={touch} value={invoiceQuery} placeholder="請求書・取引先・案件・金額" onChange={(e) => setInvoiceQuery(e.target.value)} /></label><select className={bankSelectClass} aria-label="照合する請求書を選択" value="" disabled={pending} onChange={(e) => { const invoice = invoiceMap.get(e.target.value); if (invoice) setChosen(invoice); }}><option value="">請求書を選択（{choices.length}件）</option>{choices.slice(0, 100).map((row) => <option key={row.key} value={row.key}>{row.title} / {row.party} / {money(row.total)}</option>)}</select>{choices.length > 100 ? <p className="text-xs text-muted-foreground">先頭100件を表示中。検索語で絞り込んでください。</p> : null}</div></> : null}
        </> : <p className="py-5 text-sm text-muted-foreground">照合する銀行明細を選択してください。</p>}</section>
      </div>
    </> : view === "checks" && aiPreview && review ? <BankReviewPanel company={company} review={review} preview={aiPreview} configured={aiConfigured} model={aiModel} /> : <section className="space-y-3" aria-label="請求書の照合状況"><div className="grid gap-2 sm:grid-cols-2"><Input className={touch} aria-label="請求書を検索" placeholder="請求書・取引先・案件・金額" value={invoiceQuery} onChange={(e) => setInvoiceQuery(e.target.value)} /><select className={bankSelectClass} aria-label="請求書の照合状態" value={invoiceFilter} onChange={(e) => setInvoiceFilter(e.target.value)}><option value="unmatched">銀行未照合</option><option value="recorded">支払い登録済み・銀行未照合</option><option value="overdue">期限超過</option><option value="issues">要再確認・状態の不整合・照合対象外</option><option value="all">すべて</option></select></div><p className="text-xs text-muted-foreground">{invoiceRows.length}件{invoiceRows.length > 100 ? " / 先頭100件を表示。検索で絞り込めます。" : ""}。支払い登録済みと銀行照合済みは別の状態です。</p>
      <ul className="divide-y">{invoiceRows.slice(0, 100).map((row) => <li className="space-y-2 py-4 text-sm" key={row.key}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0"><p className="break-words font-medium">{row.title} / {row.party}</p><p className="break-words text-xs text-muted-foreground">{row.kind === "issued" ? "発行請求書" : `受領請求書${row.mailCount ? "・郵便物連携" : ""}`} / {row.project} / 期日 {row.dueDate || "未設定"}</p></div>
          <div className="flex flex-wrap gap-2">
            <Link className="inline-flex min-h-11 items-center gap-1 text-primary underline" href={row.href}>書類<ArrowUpRight className="size-4" /></Link>
            {row.eligible ? <Link prefetch={false} className="inline-flex min-h-11 items-center gap-1 rounded-md border px-3 hover:bg-muted" href={`/banking/reconcile?company=${company}&invoice=${encodeURIComponent(row.key)}&status=all`}><Search className="size-4" />銀行候補・照合記録</Link> : null}
            {row.stateMismatch && !row.conflict && row.matched > 0 ? <SyncStatusButton company={company} invoice={row} /> : null}
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">{[["請求額", row.total], ["入金・支払い登録済み", row.paid], ["銀行照合済み", row.matched], ["未入金・未払い", row.outstanding]].map(([label, amount]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="break-all font-medium tabular-nums">{money(Number(amount))}</dd></div>)}</dl>
        <p className="text-xs text-amber-800 dark:text-amber-300">{[row.conflict ? "照合後にデータ変更あり" : "", row.stateMismatch ? "支払記録と請求書・郵便物の状態が不一致" : "", row.overpaid ? `請求額より多い支払い ${money(row.overpaid)}` : "", row.overdue ? "期限超過" : "", !row.eligible ? "下書き・保留・金額などを確認後に照合" : "", row.recordedUnmatched > 0 ? `登録済みのうち銀行未照合 ${money(row.recordedUnmatched)}` : ""].filter(Boolean).join(" / ")}</p>
      </li>)}</ul>{!invoiceRows.length ? <p className="py-4 text-sm text-muted-foreground">該当する請求書はありません。</p> : null}
    </section>}
    {chosen && selected ? <ReconcileDialog key={`${chosen.key}:${selected.id}`} company={company} bank={selected} invoice={chosen} close={() => setChosen(null)} /> : null}
    <Dialog open={Boolean(removing)} onOpenChange={(open) => { if (!open && !pending) setRemoving(null); }}><DialogContent showCloseButton={!pending} onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}><DialogHeader><DialogTitle>照合を解除しますか？</DialogTitle><DialogDescription>{removing?.createdPayment ? "この照合で追加した入金・支払い記録も取り消し、請求書・郵便物の完了状態を再計算します。" : "銀行との紐づけだけを解除します。もともと登録されていた入金・支払い記録は残します。"} 銀行の原明細は変更しません。</DialogDescription></DialogHeader>{error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}<div className="flex flex-wrap gap-2"><Button className={touch} variant="outline" disabled={pending} onClick={() => setRemoving(null)}>キャンセル</Button><Button className={touch} disabled={pending} onClick={remove}><Unlink className="size-4" />照合解除</Button></div></DialogContent></Dialog>
  </div>;
}
