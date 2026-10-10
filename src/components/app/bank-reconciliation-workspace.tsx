"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowUpRight, Check, LoaderCircle, RefreshCw, Search, SlidersHorizontal, Unlink, X } from "lucide-react";
import { removeBankReconciliationAction, syncReconciledInvoiceStatusAction } from "@/app/banking/reconcile/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { bankSelectClass } from "@/components/app/banking-settings";
import { BankReconciliationDesk } from "@/components/app/bank-reconciliation-desk";
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
  accounts: Array<{ id: string; name: string; invoiceEligible: boolean }>;
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

export function BankReconciliationWorkspace({ company, filters, rows, selected, invoices, links, accounts, page, total, initialView, counts, unlinkedMailCount, aiPreview, aiConfigured, aiModel, review, aiSettings }: Props) {
  const router = useRouter(), [pending, startTransition] = useTransition();
  const view = initialView;
  const [query, setQuery] = useState(filters.query);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [invoiceQuery, setInvoiceQuery] = useState(""), [invoiceFilter, setInvoiceFilter] = useState("unmatched");
  const [removing, setRemoving] = useState<Props["links"][number] | null>(null), [error, setError] = useState("");
  const href = (values: Record<string, string>) => `/banking/reconcile?${new URLSearchParams({ company, view, account: filters.account, month: filters.month, status: filters.status, q: filters.query, invoice: filters.invoice, page: "1", ...values })}`;
  const navigate = (values: Record<string, string>) => startTransition(() => router.push(href(values)));
  const invoiceMap = new Map(invoices.map((row) => [row.key, row]));
  const normalizedQuery = invoiceQuery.normalize("NFKC").toLocaleLowerCase("ja");
  const searchInvoice = (row: ReconciliationInvoice) => !normalizedQuery || `${row.title} ${row.party} ${row.project} ${row.total}`.normalize("NFKC").toLocaleLowerCase("ja").includes(normalizedQuery);
  const invoiceRows = invoices.filter(searchInvoice).filter((row) => invoiceFilter === "all" || (invoiceFilter === "unmatched" && row.eligible && row.unmatched > 0) || (invoiceFilter === "recorded" && row.recordedUnmatched > 0) || (invoiceFilter === "issues" && (row.conflict || row.stateMismatch || row.overpaid > 0 || !row.eligible)) || (invoiceFilter === "overdue" && row.overdue));
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
    {view !== "bank" ? <dl className="grid grid-cols-2 gap-4 border-b pb-4 lg:grid-cols-4">{[["未照合の銀行明細", counts.unmatched], ["支払い登録済み・銀行未照合", counts.recorded], ["期限超過の請求書", counts.overdue], ["要再確認・状態の不整合", counts.conflicts]].map(([label, count]) => <div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-xl font-semibold tabular-nums">{count}件</dd></div>)}</dl> : null}
    {company === "JAPAN" ? <p className="break-words text-xs text-muted-foreground">照合口座: 三菱UFJ銀行 / PayPay銀行（末尾7691）<span className="ml-3">その他の口座・カード: 経費中心</span></p> : null}
    {unlinkedMailCount ? <p className="border-l-2 border-amber-500 pl-3 text-sm">受領請求書と未連携の郵便物が {unlinkedMailCount}件あります。<Link className="inline-flex min-h-11 items-center gap-1 text-primary underline" href={`/mail-sorter?company=${company}`}>郵便物を確認<ArrowUpRight className="size-4" /></Link></p> : null}
    {view !== "checks" ? <div className="flex flex-wrap gap-1" role="group" aria-label="照合の表示">{(["bank", "invoices"] as const).map((value) => <button className={`min-h-11 min-w-0 rounded-md border px-3 text-sm ${view === value ? "border-primary/30 bg-primary/10 font-medium text-primary" : "border-transparent text-muted-foreground hover:bg-muted"}`} key={value} aria-pressed={view === value} disabled={pending} onClick={() => navigate({ view: value })}>{value === "bank" ? "銀行から照合" : "請求書から確認"}</button>)}{view === "bank" ? <Button size="icon" variant="ghost" className="ml-auto size-11 md:hidden" aria-label="絞り込み" title="絞り込み" aria-expanded={filtersOpen} aria-controls="reconciliation-filters" onClick={() => setFiltersOpen(!filtersOpen)}><SlidersHorizontal className="size-4" /></Button> : null}</div> : null}
    {view === "bank" ? <>
      <div id="reconciliation-filters" className={`min-w-0 gap-2 md:grid md:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1.2fr)] ${filtersOpen ? "grid" : "hidden"}`}>
        <select className={bankSelectClass} aria-label="照合口座" value={filters.account} disabled={pending} onChange={(e) => navigate({ account: e.target.value })}><option value="">すべての口座</option>{accounts.map((row) => <option key={row.id} value={row.id}>{row.name}{row.invoiceEligible ? "" : "（照合対象外）"}</option>)}</select>
        <Input className={touch} type="month" aria-label="銀行の取引月" value={filters.month} disabled={pending} onChange={(e) => navigate({ month: e.target.value })} />
        <select className={bankSelectClass} aria-label="照合状態" value={filters.status} disabled={pending} onChange={(e) => navigate({ status: e.target.value })}><option value="all">すべての状態</option>{Object.entries(stateLabels).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select>
        <form className="flex min-w-0 gap-1" onSubmit={(e) => { e.preventDefault(); navigate({ q: query }); }}><Input className={touch} aria-label="銀行摘要・金額を検索" placeholder="摘要・金額" value={query} maxLength={200} onChange={(e) => setQuery(e.target.value)} /><Button className="size-11 shrink-0" size="icon" variant="outline" type="submit" aria-label="検索" title="検索" disabled={pending}><Search className="size-4" /></Button></form>
      </div>
      <p className="text-xs text-muted-foreground md:hidden">{filters.month || "全期間"} / {stateLabels[filters.status] || "すべての状態"}{filters.account ? ` / ${accounts.find((row) => row.id === filters.account)?.name || ""}` : ""}{filters.query ? ` / 検索: ${filters.query}` : ""}</p>
      {filters.invoice ? <div className="flex flex-wrap items-center justify-between gap-2 border-l-2 border-primary bg-primary/5 p-2 text-sm"><span className="break-words">請求書候補: {invoiceMap.get(filters.invoice)?.title || "対象外の請求書"}</span><Button className={touch} variant="ghost" onClick={() => navigate({ invoice: "" })}><X className="size-4" />解除</Button></div> : null}
      <BankReconciliationDesk key={`${filters.account}:${filters.month}:${filters.status}:${filters.invoice}:${page}:${selected?.id || ""}`} company={company} rows={rows} selected={selected} invoices={invoices} links={links} accounts={accounts} page={page} total={total} focusInvoice={filters.invoice} href={href} pending={pending} onRemove={(link) => { setRemoving(link); setError(""); }} aiPreview={aiPreview} aiConfigured={aiConfigured} aiModel={aiModel} />
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
    <Dialog open={Boolean(removing)} onOpenChange={(open) => { if (!open && !pending) setRemoving(null); }}><DialogContent showCloseButton={!pending} onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}><DialogHeader><DialogTitle>照合を解除しますか？</DialogTitle><DialogDescription>{removing?.createdPayment ? "この照合で追加した入金・支払い記録も取り消し、請求書・郵便物の完了状態を再計算します。" : "銀行との紐づけだけを解除します。もともと登録されていた入金・支払い記録は残します。"} 銀行の原明細は変更しません。</DialogDescription></DialogHeader>{error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}<div className="flex flex-wrap gap-2"><Button className={touch} variant="outline" disabled={pending} onClick={() => setRemoving(null)}>キャンセル</Button><Button className={touch} disabled={pending} onClick={remove}><Unlink className="size-4" />照合解除</Button></div></DialogContent></Dialog>
  </div>;
}
