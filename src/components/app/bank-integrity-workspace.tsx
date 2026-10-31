"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { ArrowUpRight, ChevronLeft, ChevronRight, FileJson, Landmark, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { bankSelectClass } from "@/components/app/banking-settings";
import type { CompanyScope } from "@/lib/company";
import { integritySeverityLabels, type IntegritySeverity, type IntegritySummary, type IntegrityView } from "@/lib/integrity";

const severityClass: Record<IntegritySeverity, string> = {
  ERROR: "border-red-300 bg-red-100 text-red-900 dark:border-red-500/70 dark:bg-red-950 dark:text-red-200",
  WARNING: "border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-500/70 dark:bg-amber-950 dark:text-amber-200",
  INFO: "border-border bg-muted text-muted-foreground",
};
const linkClass = "inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm hover:bg-muted";

// Read-only list. Every row links to the screen where the data can be fixed.
export function BankIntegrityWorkspace({ company, summary, view }: { company: CompanyScope; summary: IntegritySummary; view: IntegrityView }) {
  const router = useRouter(), [pending, startTransition] = useTransition();
  const navigate = (values: Record<string, string>) => startTransition(() => router.push(`/banking/integrity?${new URLSearchParams({ company, kind: view.kind, page: "1", ...values })}`));
  const generated = new Date(summary.generatedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  return <div className="min-w-0 space-y-4 pb-12">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1"><h1 className="break-words text-xl font-semibold">整合性チェック</h1><p className="text-xs text-muted-foreground">{company === "JAPAN" ? "日本" : "中国"} / 点検 {generated} / 該当 {summary.total.toLocaleString()}件（要対応 {summary.severity.ERROR} / 確認 {summary.severity.WARNING} / 参考 {summary.severity.INFO}）</p></div>
      <div className="flex flex-wrap gap-2">
        <Link className={linkClass} href={`/banking?company=${company}`}><Landmark className="size-4" />口座・カード明細</Link>
        <Link className={linkClass} href={`/banking/reconcile?company=${company}`}><Link2 className="size-4" />銀行・請求書照合</Link>
        <a className={linkClass} href={`/api/banking/integrity?company=${company}${view.kind !== "all" ? `&kind=${view.kind}` : ""}`} target="_blank" rel="noreferrer"><FileJson className="size-4" />JSON</a>
      </div>
    </header>
    <p className="text-sm text-muted-foreground">登録データのルールによる点検です。該当は誤りの確定ではなく、現金払いや前受金のように正当な場合もあります。この画面は読み取り専用で、修正は各行のリンク先で行います。</p>
    <div className="flex flex-wrap gap-2" role="group" aria-label="種類で絞り込み">
      <Button variant={view.kind === "all" ? "default" : "outline"} className="min-h-11" aria-pressed={view.kind === "all"} disabled={pending} onClick={() => navigate({ kind: "all" })}>すべて ({summary.total})</Button>
      {summary.kinds.map((row) => <Button key={row.kind} variant={view.kind === row.kind ? "default" : "outline"} className="min-h-11" aria-pressed={view.kind === row.kind} disabled={pending || !row.count} title={row.description} onClick={() => navigate({ kind: row.kind })}>{row.label} ({row.count})</Button>)}
    </div>
    <select className={`${bankSelectClass} sm:hidden`} aria-label="種類で絞り込み（選択）" value={view.kind} disabled={pending} onChange={(event) => navigate({ kind: event.target.value })}><option value="all">すべて ({summary.total})</option>{summary.kinds.map((row) => <option key={row.kind} value={row.kind}>{row.label} ({row.count})</option>)}</select>
    {view.kind !== "all" ? <div className="space-y-1 rounded-md border bg-muted/40 p-3 text-sm"><p className="break-words">{summary.kinds.find((row) => row.kind === view.kind)?.description}</p><p className="break-words text-muted-foreground">推奨: {summary.kinds.find((row) => row.kind === view.kind)?.action}</p></div> : null}
    {summary.truncated.length ? <p role="status" className="text-xs text-amber-800 dark:text-amber-300">件数が多いため、{summary.truncated.map((kind) => summary.kinds.find((row) => row.kind === kind)?.label).join("・")} は先頭500件だけを表示しています。</p> : null}
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{view.filteredTotal.toLocaleString()}件</span><div className="flex items-center gap-1">
      <Button className="size-11 lg:size-11 lg:min-h-11" size="icon" variant="ghost" title="前のページ" aria-label="前のページ" disabled={pending || view.page <= 1} onClick={() => navigate({ page: String(view.page - 1) })}><ChevronLeft className="size-4" /></Button>
      <span>{view.page}/{view.pages}</span>
      <Button className="size-11 lg:size-11 lg:min-h-11" size="icon" variant="ghost" title="次のページ" aria-label="次のページ" disabled={pending || view.page >= view.pages} onClick={() => navigate({ page: String(view.page + 1) })}><ChevronRight className="size-4" /></Button>
    </div></div>
    <ul className="divide-y border-y" aria-label="整合性チェックの結果">{view.items.map((row) => <li key={row.id} className="min-w-0 space-y-1.5 py-4">
      <div className="flex flex-wrap items-center gap-2 text-xs"><span className={`inline-flex items-center rounded border px-1.5 py-0.5 font-medium leading-5 ${severityClass[row.severity]}`}>{integritySeverityLabels[row.severity]}</span><span className="text-amber-800 dark:text-amber-300">{summary.kinds.find((item) => item.kind === row.kind)?.label}</span>{row.date ? <time className="tabular-nums text-muted-foreground">{row.date}</time> : null}</div>
      <h2 className="break-words text-sm font-medium">{row.title}</h2>
      <p className="break-words text-sm text-muted-foreground">{row.detail}</p>
      <p className="break-words text-xs text-muted-foreground">推奨: {row.action}</p>
      <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-1">{row.links.map((link, index) => <Link key={`${link.href}:${index}`} className="inline-flex min-h-11 min-w-0 max-w-full items-center gap-1 text-sm text-primary underline" href={link.href}><span className="min-w-0 break-words">{link.label}</span><ArrowUpRight className="size-4 shrink-0" /></Link>)}</div>
    </li>)}</ul>
    {!view.items.length ? <p className="text-sm text-muted-foreground">{summary.total ? "この種類に該当はありません。" : "該当する項目はありません。"}</p> : null}
  </div>;
}
