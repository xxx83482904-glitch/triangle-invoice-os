"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowUpRight, ChevronLeft, ChevronRight, FileJson, Landmark, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { bankSelectClass } from "@/components/app/banking-settings";
import type { CompanyScope } from "@/lib/company";
import { integritySeverityLabels, type IntegritySeverity, type IntegritySummary, type IntegrityView } from "@/lib/integrity-types";
import { IntegrityKnownDialog, type IntegrityKnownSelection } from "@/components/app/integrity-known-dialog";

const severityClass: Record<IntegritySeverity, string> = {
  ERROR: "border-red-300 bg-red-100 text-red-900 dark:border-red-500/70 dark:bg-red-950 dark:text-red-200",
  WARNING: "border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-500/70 dark:bg-amber-950 dark:text-amber-200",
  INFO: "border-border bg-muted text-muted-foreground",
};

// Only acknowledgement metadata is editable here; source data is changed at the row links.
export function BankIntegrityWorkspace({ company, summary, view, mayEdit }: { company: CompanyScope; summary: IntegritySummary; view: IntegrityView; mayEdit: boolean }) {
  const [selection, setSelection] = useState<IntegrityKnownSelection | null>(null), [message, setMessage] = useState("");
  const count = (row: IntegritySummary["kinds"][number]) => view.knownOnly ? row.knownCount : row.count;
  const displayedTotal = view.knownOnly ? summary.knownTotal : summary.total;
  const truncated = view.knownOnly ? summary.knownTruncated : summary.truncated;
  const router = useRouter(), [pending, startTransition] = useTransition();
  const navigate = (values: Record<string, string>) => startTransition(() => router.push(`/banking/integrity?${new URLSearchParams({ company, kind: view.kind, page: "1", known: view.knownOnly ? "1" : "0", ...values })}`));
  const generated = new Date(summary.generatedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  return <div className="min-w-0 space-y-6 pb-12">
    <header className="flex flex-wrap items-start justify-between gap-3 border-b py-4">
      <div className="min-w-0 space-y-1"><h1 className="break-words text-2xl font-semibold">整合性チェック</h1><p className="text-xs text-muted-foreground">{company === "JAPAN" ? "日本" : "中国"} / 点検 {generated} / 未対応の指摘 {summary.total.toLocaleString()}件 / 既知 {summary.knownTotal.toLocaleString()}件（要対応 {summary.severity.ERROR} / 確認 {summary.severity.WARNING} / 参考 {summary.severity.INFO}）</p></div>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="soft" size="sm" className="h-auto max-w-full whitespace-normal break-words py-2 text-left lg:h-auto lg:min-h-8 lg:py-1.5"><Link href={`/banking?company=${company}`}><Landmark className="size-4" />口座・カード明細</Link></Button>
        <Button asChild variant="soft" size="sm" className="h-auto max-w-full whitespace-normal break-words py-2 text-left lg:h-auto lg:min-h-8 lg:py-1.5"><Link href={`/banking/reconcile?company=${company}`}><Link2 className="size-4" />銀行・請求書照合</Link></Button>
        <Button asChild variant="soft" size="sm" className="h-auto max-w-full whitespace-normal break-words py-2 text-left lg:h-auto lg:min-h-8 lg:py-1.5"><a href={`/api/banking/integrity?company=${company}${view.knownOnly ? "&includeKnown=1" : ""}${view.kind !== "all" ? `&kind=${view.kind}` : ""}`} target="_blank" rel="noreferrer"><FileJson className="size-4" />{view.knownOnly ? "JSON（既知含む）" : "JSON"}</a></Button>
      </div>
    </header>
    <p className="text-sm text-muted-foreground">登録データのルールによる点検です。該当は誤りの確定ではなく、現金払いや前受金のように正当な場合もあります。理由を付けた既知の指摘は別に表示します。対象の根拠が変わると再表示します。既知の登録では明細・書類・支払・照合を変更しません。</p>
    {summary.cardSettlements.length ? <p className="text-xs text-muted-foreground">カード精算として相手なし振替から除外: {summary.cardSettlements.map((row) => `${row.label} ${row.count}件`).join(" / ")}。分類・照合は変更していません。</p> : null}
    {message ? <p role="status" className="rounded-md border bg-muted p-3 text-sm">{message}</p> : null}
    <div className="flex flex-wrap gap-2" aria-label="既知の表示切替"><Button variant={view.knownOnly ? "outline" : "default"} disabled={pending} onClick={() => navigate({ known: "0", kind: "all" })}>未対応の指摘 {summary.total}件</Button><Button variant={view.knownOnly ? "default" : "outline"} disabled={pending} onClick={() => navigate({ known: "1", kind: "all" })}>既知 {summary.knownTotal}件</Button></div>
    <div className="hidden flex-wrap gap-3 rounded-xl border bg-muted/40 p-4 sm:flex" role="group" aria-label="種類で絞り込み">
      <Button variant={view.kind === "all" ? "default" : "outline"} className="min-h-11" aria-pressed={view.kind === "all"} disabled={pending} onClick={() => navigate({ kind: "all" })}>すべて ({displayedTotal})</Button>
      {summary.kinds.map((row) => <Button key={row.kind} variant={view.kind === row.kind ? "default" : "outline"} className="min-h-11" aria-pressed={view.kind === row.kind} disabled={pending || !count(row)} title={row.description} onClick={() => navigate({ kind: row.kind })}>{row.label} ({count(row)})</Button>)}
    </div>
    <select className={`${bankSelectClass} sm:hidden`} aria-label="種類で絞り込み（選択）" value={view.kind} disabled={pending} onChange={(event) => navigate({ kind: event.target.value })}><option value="all">すべて ({displayedTotal})</option>{summary.kinds.map((row) => <option key={row.kind} value={row.kind}>{row.label} ({count(row)})</option>)}</select>
    {view.kind !== "all" ? <div className="space-y-1 rounded-md border bg-muted/40 p-3 text-sm"><p className="break-words">{summary.kinds.find((row) => row.kind === view.kind)?.description}</p><p className="break-words text-muted-foreground">推奨: {summary.kinds.find((row) => row.kind === view.kind)?.action}</p></div> : null}
    {mayEdit && !view.knownOnly ? <div className="space-y-4">{view.batches.map((batch) => <div key={batch.kind} className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4 shadow-sm"><h2 className="min-w-0 break-words text-sm font-medium">{summary.kinds.find((row) => row.kind === batch.kind)?.label}</h2><Button variant="outline" disabled={pending} onClick={() => setSelection({ mode: "KIND", kind: batch.kind, targets: batch.targets, title: summary.kinds.find((row) => row.kind === batch.kind)!.label })}>この種類を既知にする（{batch.targets.length}件）</Button></div>)}</div> : null}
    {truncated.length ? <p role="status" className="text-xs text-amber-800 dark:text-amber-300">件数が多いため、{truncated.map((kind) => summary.kinds.find((row) => row.kind === kind)?.label).join("・")} は先頭500件だけを表示しています。</p> : null}
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{view.filteredTotal.toLocaleString()}件</span><div className="flex items-center gap-1">
      <Button className="size-11 lg:size-11 lg:min-h-11" size="icon" variant="outline" title="前のページ" aria-label="前のページ" disabled={pending || view.page <= 1} onClick={() => navigate({ page: String(view.page - 1) })}><ChevronLeft className="size-4" /></Button>
      <span>{view.page}/{view.pages}</span>
      <Button className="size-11 lg:size-11 lg:min-h-11" size="icon" variant="outline" title="次のページ" aria-label="次のページ" disabled={pending || view.page >= view.pages} onClick={() => navigate({ page: String(view.page + 1) })}><ChevronRight className="size-4" /></Button>
    </div></div>
    <ul className="space-y-4" aria-label="整合性チェックの結果">{view.items.map((row) => <li key={row.id} className="min-w-0 space-y-3 rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-2 text-xs"><span className={`inline-flex items-center rounded border px-1.5 py-0.5 font-medium leading-5 ${severityClass[row.severity]}`}>{integritySeverityLabels[row.severity]}</span><span className="text-amber-800 dark:text-amber-300">{summary.kinds.find((item) => item.kind === row.kind)?.label}</span>{row.date ? <time className="tabular-nums text-muted-foreground">{row.date}</time> : null}</div>
      <h2 className="break-words text-sm font-medium">{row.title}</h2>
      <p className="break-words text-sm text-muted-foreground">{row.detail}</p>
      <p className="break-words text-xs text-muted-foreground">推奨: {row.action}</p>
      {row.known ? <div className="space-y-1 rounded-md border bg-muted/40 p-3 text-sm"><p className="break-words">既知の理由: {row.known.reason}</p><p className="break-words text-xs text-muted-foreground">{new Date(row.known.createdAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })} / {row.known.createdByName}</p></div> : null}
      {mayEdit ? <Button variant="outline" disabled={pending} onClick={() => setSelection(row.known ? { mode: "REVOKE", known: row.known, title: row.title } : { mode: "ISSUE", kind: row.kind, targets: [{ id: row.id, fingerprint: row.fingerprint }], title: row.title })}>{row.known ? "既知を取り消す" : "既知にする"}</Button> : null}
      <div className="flex min-w-0 flex-wrap gap-2">{row.links.map((link, index) => <Button asChild variant="soft" size="sm" key={`${link.href}:${index}`} className="h-auto max-w-full whitespace-normal break-words py-2 text-left lg:h-auto lg:min-h-8 lg:py-1.5"><Link href={link.href}><span className="min-w-0 break-words">{link.label}</span><ArrowUpRight className="size-4 shrink-0" /></Link></Button>)}</div>
    </li>)}</ul>
    {!view.items.length ? <p className="text-sm text-muted-foreground">{displayedTotal ? "この種類に該当はありません。" : "該当する項目はありません。"}</p> : null}
    {selection ? <IntegrityKnownDialog company={company} selection={selection} onClose={() => setSelection(null)} onSaved={(text) => { setMessage(text); setSelection(null); router.refresh(); }} /> : null}
  </div>;
}
