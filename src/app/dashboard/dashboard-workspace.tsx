"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, CheckCircle2, ChevronLeft, ChevronRight, FileSearch, FolderKanban, Landmark, Mail, RefreshCw } from "lucide-react";
import { BankBalanceSummary } from "@/components/app/bank-balance-summary";
import { recordSelectClass } from "@/components/app/record-list-controls";
import { Button } from "@/components/ui/button";
import type { DashboardDocument, DashboardSummary } from "@/lib/dashboard";
import { yen } from "@/lib/format";

const monthLabel = (month: string) => `${month.slice(0, 4)}年${Number(month.slice(5))}月`;
const timingLabels = { overdue: "期限超過", soon: "7日以内", later: "期限待ち", undated: "期限未設定" };
type WorkView = "income" | "expense" | "review";

export function DashboardActions({ company }: { company: DashboardSummary["company"] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <>
    <Button variant="outline" className="min-h-11" disabled={pending} onClick={() => startTransition(() => router.refresh())}><RefreshCw className={`size-4 ${pending ? "animate-spin" : ""}`} />{pending ? "更新中" : "表示を更新"}</Button>
    <Button asChild className="min-h-11"><Link href={`/banking/accounts?company=${company}`} prefetch={false}><Landmark className="size-4" />口座一覧</Link></Button>
  </>;
}

export function DashboardWorkspace({ summary: s }: { summary: DashboardSummary }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [view, setView] = useState<WorkView>("income");
  const [timing, setTiming] = useState("all");
  const [limit, setLimit] = useState(8);
  const workRef = useRef<HTMLElement>(null);
  const query = `company=${s.company}`;
  const accountsHref = `/banking/accounts?${query}`;
  const workRows = (view === "income" ? s.receivables : view === "expense" ? s.payables : s.review).filter((row) => view === "review" || timing === "all" || row.timing === timing && !row.paymentMismatch);
  const openWork = (value: WorkView, scroll = false) => {
    setView(value); setTiming("all"); setLimit(8);
    if (scroll) { workRef.current?.scrollIntoView({ block: "start" }); workRef.current?.focus({ preventScroll: true }); }
  };
  const workTotal = s.review.length;
  const statClass = "min-w-0 space-y-2 py-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring sm:px-4 first:sm:pl-0 last:sm:pr-0";
  return <>
    <div className="grid grid-cols-2 gap-x-4 border-b pb-2 sm:gap-0 sm:divide-x xl:grid-cols-[1.2fr_1fr_1fr_0.8fr]">
      <Link href={accountsHref} prefetch={false} className={statClass}>
        <span className="flex items-center gap-2 text-sm text-muted-foreground"><Landmark className="size-4" />銀行の計算残高<ArrowRight className="ml-auto size-4 shrink-0" /></span>
        <span className="block break-all text-2xl font-semibold tabular-nums">{s.cash.amount === null ? "残高未登録" : yen.format(s.cash.amount)}</span>
        <span className="block text-xs text-muted-foreground">登録済み {s.cash.registered}口座{ s.cash.provisional ? ` / 暫定 ${s.cash.provisional}口座` : ""}</span>
        {s.cash.missing || s.cash.unknownAccounts ? <span className="block text-xs text-amber-700 dark:text-amber-400">残高未登録 {s.cash.missing} / 種別未確定 {s.cash.unknownAccounts}</span> : null}
      </Link>
      <button type="button" className={statClass} onClick={() => openWork("income", true)}>
        <span className="flex items-center gap-2 text-sm text-muted-foreground"><ArrowDownLeft className="size-4" />未入金<ArrowRight className="ml-auto size-4 shrink-0" /></span>
        <span className="block break-all text-2xl font-semibold tabular-nums">{yen.format(s.incoming.amount)}</span>
        <span className="block text-xs text-muted-foreground">全期間 {s.incoming.count}件</span>
        <span className={`block text-xs ${s.incoming.overdue ? "text-destructive" : "text-muted-foreground"}`}>期限超過 {s.incoming.overdue}件</span>
      </button>
      <button type="button" className={statClass} onClick={() => openWork("expense", true)}>
        <span className="flex items-center gap-2 text-sm text-muted-foreground"><ArrowUpRight className="size-4" />未払い<ArrowRight className="ml-auto size-4 shrink-0" /></span>
        <span className="block break-all text-2xl font-semibold tabular-nums">{yen.format(s.outgoing.amount)}</span>
        <span className="block text-xs text-muted-foreground">全期間 {s.outgoing.count}件</span>
        <span className={`block text-xs ${s.outgoing.overdue ? "text-destructive" : "text-muted-foreground"}`}>期限超過 {s.outgoing.overdue}件 / 7日以内 {s.outgoing.soon}件</span>
      </button>
      <button type="button" className={statClass} onClick={() => openWork("review", true)}>
        <span className="flex items-center gap-2 text-sm text-muted-foreground"><FileSearch className="size-4" />書類確認<ArrowRight className="ml-auto size-4 shrink-0" /></span>
        <span className="block text-2xl font-semibold tabular-nums">{workTotal}<span className="ml-1 text-sm font-normal">件</span></span>
        <span className="block text-xs text-muted-foreground">下書き・入力不足・支払記録</span>
      </button>
    </div>

    <div className="grid min-w-0 gap-7 border-b py-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <section ref={workRef} tabIndex={-1} className="min-w-0 scroll-mt-20 outline-none" aria-labelledby="dashboard-work-title">
        <div className="mb-4 flex items-center justify-between gap-2"><h2 id="dashboard-work-title" className="font-semibold">対応する書類</h2><span className="text-xs text-muted-foreground">全期間 / 未完了</span></div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
          <div role="group" aria-label="対応書類の種類" className="flex max-w-full flex-wrap gap-1">
            {([ ["income", "未入金", s.incoming.count], ["expense", "未払い", s.outgoing.count], ["review", "書類確認", workTotal] ] as const).map(([value, label, count]) => <Button key={value} variant={view === value ? "secondary" : "ghost"} aria-pressed={view === value} className="min-h-11 px-3" onClick={() => openWork(value)}>{label}<span className="text-xs tabular-nums text-muted-foreground">{count}</span></Button>)}
          </div>
          {view !== "review" ? <select aria-label="書類の期限" className={`${recordSelectClass} min-h-11 max-w-full`} value={timing} onChange={(event) => { setTiming(event.target.value); setLimit(8); }}><option value="all">すべての期限</option><option value="overdue">期限超過</option><option value="soon">7日以内</option><option value="undated">期限未設定</option></select> : null}
        </div>
        <div role="region" aria-label="対応する書類一覧" tabIndex={0} className="max-h-[440px] overflow-y-auto overscroll-contain focus-visible:outline-2 focus-visible:outline-ring">
          {workRows.length ? workRows.slice(0, limit).map((row) => <WorkRow key={row.id} row={row} review={view === "review"} />) : <div className="flex min-h-40 flex-col items-center justify-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="size-6 text-emerald-600 dark:text-emerald-400" />該当する書類はありません</div>}
          {limit < workRows.length ? <Button variant="ghost" className="my-2 min-h-11 w-full" onClick={() => setLimit((value) => value + 20)}>さらに表示 ({workRows.length - limit}件)</Button> : null}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>{workRows.length}件{view === "review" ? " / 金額は書類の税込額" : " / 金額は支払記録との差額"}</span><Link className="inline-flex min-h-11 items-center gap-1 text-primary hover:underline" href={`/${view === "expense" ? "received-invoices" : view === "review" ? "documents" : "issued-invoices"}?${query}`} prefetch={false}>書類一覧<ArrowRight className="size-3" /></Link></div>
      </section>
      <section aria-labelledby="dashboard-cash-title" className="min-w-0 xl:border-l xl:pl-6">
        <div className="mb-4 flex items-center justify-between gap-2"><h2 id="dashboard-cash-title" className="font-semibold">口座残高</h2><Link href={accountsHref} prefetch={false} className="inline-flex min-h-11 items-center gap-1 text-xs text-primary hover:underline">残高設定<ArrowRight className="size-3" /></Link></div>
        <div role="region" aria-label="口座残高一覧" tabIndex={0} className="max-h-[420px] overflow-y-auto overscroll-contain focus-visible:outline-2 focus-visible:outline-ring">
          {s.accounts.length ? s.accounts.map((row) => <Link key={row.id} href={`/banking?${query}&account=${encodeURIComponent(row.id)}`} prefetch={false} className="grid min-w-0 gap-2 border-b py-4 hover:bg-muted/40 first:pt-0"><span className="flex min-w-0 items-start justify-between gap-2 text-sm font-medium"><span className="break-words [overflow-wrap:anywhere]">{row.name}</span><ArrowRight className="size-4 shrink-0 text-muted-foreground" /></span><BankBalanceSummary row={row} /></Link>) : <p className="py-6 text-sm text-muted-foreground">銀行口座が未登録です。</p>}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">手動登録の終日残高を基準に計算 / カード利用残高を除く</p>
      </section>
    </div>

    <section aria-labelledby="dashboard-tasks-title" className="border-b py-5">
      <h2 id="dashboard-tasks-title" className="mb-3 font-semibold">確認待ち・連携状況</h2>
      <div className="grid gap-x-6 sm:grid-cols-2 xl:grid-cols-4">
        <QueueLink icon={Landmark} label="未確認の口座明細" count={s.banking.unreviewed} href={`/banking?${query}&status=unreviewed`} />
        {s.company === "JAPAN" ? <QueueLink icon={Mail} label="未処理の郵便物" count={s.pendingMail} href={`/mail-sorter?${query}`} /> : null}
        <QueueLink icon={FolderKanban} label="進行中の案件" count={s.projectCount} href={`/projects?${query}`} />
        <Link href={`/banking?${query}`} prefetch={false} className="flex min-h-14 items-center justify-between gap-2 text-sm hover:text-primary"><span>{s.banking.syncing ? "口座明細を同期中" : s.banking.syncErrors ? `同期エラー ${s.banking.syncErrors}件` : "口座連携"}</span><ArrowRight className="size-4 shrink-0" /></Link>
      </div>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>最終同期: {s.banking.lastSyncAt ? new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "short", timeStyle: "short" }).format(new Date(s.banking.lastSyncAt)) : "未同期"}</span><span>最新取引: {s.banking.latestDate || "未取得"}</span>{s.banking.missing ? <Link href={`/banking?${query}&status=missing`} prefetch={false} className="min-h-6 text-amber-700 underline dark:text-amber-400">元明細なし {s.banking.missing}件</Link> : null}</p>
    </section>

    <MonthlyOverview summary={s} pending={pending} changeYear={(year) => startTransition(() => router.push(`/dashboard?${query}&year=${year}`, { scroll: false }))} />
  </>;
}

function WorkRow({ row, review }: { row: DashboardDocument; review: boolean }) {
  const label = row.paymentMismatch ? (row.kind === "issued" ? "入金記録要確認" : "支払記録要確認") : timingLabels[row.timing];
  return <Link href={row.href} prefetch={false} className="group grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-b py-3 pr-2 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring">
    <span className="min-w-0 break-words text-sm font-medium [overflow-wrap:anywhere]">{row.project}</span>
    <span className="max-w-[140px] break-all text-right text-sm font-semibold tabular-nums">{yen.format(review ? row.amount : row.remaining)}</span>
    <span className="col-span-2 min-w-0 break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">{row.partner} / {row.title}</span>
    <span className="col-span-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <span className={row.paymentMismatch ? "text-amber-700 dark:text-amber-400" : row.timing === "overdue" ? "text-destructive" : "text-muted-foreground"}>{review ? row.reasons.join("・") : label}</span>
      {row.dueDate ? <span className="text-muted-foreground">期限 {row.dueDate}</span> : null}
      <ArrowRight className="ml-auto size-3 shrink-0 text-primary" />
    </span>
  </Link>;
}

function QueueLink({ icon: Icon, label, count, href }: { icon: typeof Landmark; label: string; count: number; href: string }) {
  return <Link href={href} prefetch={false} className="flex min-h-14 items-center gap-2 border-b text-sm hover:text-primary xl:border-0"><Icon className="size-4 shrink-0 text-muted-foreground" /><span>{label}</span><span className="ml-auto whitespace-nowrap font-medium tabular-nums">{count}件</span><ArrowRight className="size-3 shrink-0" /></Link>;
}

function MonthlyOverview({ summary: s, pending, changeYear }: { summary: DashboardSummary; pending: boolean; changeYear: (year: number) => void }) {
  const [mode, setMode] = useState<"bank" | "invoice">("bank");
  const [month, setMonth] = useState(s.through.slice(0, 7));
  const selected = s.months.find((row) => row.month === month)!;
  const values = s.months.map((row) => ({ ...row, left: mode === "bank" ? row.income : row.issued, right: mode === "bank" ? row.expense : row.received }));
  const max = Math.max(1, ...values.flatMap((row) => [row.left, row.right]));
  const leftLabel = mode === "bank" ? "銀行入金" : "発行請求", rightLabel = mode === "bank" ? "銀行出金" : "受領請求";
  const yearIndex = s.availableYears.indexOf(s.period.year);
  return <section aria-labelledby="dashboard-months-title" className="min-w-0 py-6">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div><h2 id="dashboard-months-title" className="font-semibold">月別の動き</h2><p className="mt-1 text-xs text-muted-foreground">{s.period.start} ～ {s.period.end} / 8月決算</p></div>
      <div className="flex max-w-full items-center gap-1">
        <Button variant="ghost" size="icon" className="size-11 shrink-0" title="前の決算期" aria-label="前の決算期" disabled={pending || yearIndex === s.availableYears.length - 1} onClick={() => changeYear(s.availableYears[yearIndex + 1])}><ChevronLeft className="size-4" /></Button>
        <select aria-label="決算期" value={s.period.year} disabled={pending} onChange={(event) => changeYear(Number(event.target.value))} className={`${recordSelectClass} min-h-11 min-w-0`}>
          {s.availableYears.map((year) => <option key={year} value={year}>{year}年8月期</option>)}
        </select>
        <Button variant="ghost" size="icon" className="size-11 shrink-0" title="次の決算期" aria-label="次の決算期" disabled={pending || yearIndex === 0} onClick={() => changeYear(s.availableYears[yearIndex - 1])}><ChevronRight className="size-4" /></Button>
      </div>
    </div>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div role="group" aria-label="月別集計の種類" className="flex gap-1"><Button variant={mode === "bank" ? "secondary" : "ghost"} className="min-h-11" aria-pressed={mode === "bank"} onClick={() => setMode("bank")}>銀行の入出金</Button><Button variant={mode === "invoice" ? "secondary" : "ghost"} className="min-h-11" aria-pressed={mode === "invoice"} onClick={() => setMode("invoice")}>請求額</Button></div>
      <div className="flex gap-4 text-xs"><span className="flex items-center gap-1.5"><span className="size-2 bg-emerald-500" />{leftLabel} {yen.format(values.reduce((sum, row) => sum + row.left, 0))}</span><span className="flex items-center gap-1.5"><span className="size-2 bg-rose-500" />{rightLabel} {yen.format(values.reduce((sum, row) => sum + row.right, 0))}</span></div>
    </div>
    <div role="region" aria-label="9月から8月の月次グラフ" tabIndex={0} className="overflow-x-auto overscroll-x-contain focus-visible:outline-2 focus-visible:outline-ring">
      <div className="grid min-w-[660px] grid-cols-12 gap-1 border-b">
        {values.map((row) => <button key={row.month} type="button" aria-pressed={month === row.month} aria-label={`${monthLabel(row.month)} ${row.future ? "未到来" : `${leftLabel} ${yen.format(row.left)} ${rightLabel} ${yen.format(row.right)}`}`} disabled={row.future} title={row.future ? "未到来" : `${monthLabel(row.month)} / ${leftLabel} ${yen.format(row.left)} / ${rightLabel} ${yen.format(row.right)}`} className={`min-w-0 px-2 pt-2 text-center hover:bg-muted/50 disabled:opacity-40 ${month === row.month ? "bg-muted ring-1 ring-inset ring-primary/50" : ""}`} onClick={() => setMonth(row.month)}>
          <span className="flex h-36 items-end justify-center gap-1 border-b"><span className="w-1/2 max-w-6 bg-emerald-500" style={{ height: `${row.left / max * 100}%` }} /><span className="w-1/2 max-w-6 bg-rose-500" style={{ height: `${row.right / max * 100}%` }} /></span>
          <span className="flex h-11 items-center justify-center text-xs">{Number(row.month.slice(5))}月</span>
        </button>)}
      </div>
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm" aria-live="polite"><strong>{monthLabel(month)}</strong><span>{leftLabel} <span className="font-semibold tabular-nums">{yen.format(mode === "bank" ? selected.income : selected.issued)}</span></span><span>{rightLabel} <span className="font-semibold tabular-nums">{yen.format(mode === "bank" ? selected.expense : selected.received)}</span></span>{mode === "bank" ? <span className={`text-xs ${selected.covered ? "text-muted-foreground" : "text-amber-700 dark:text-amber-400"}`}>{selected.count}件 / {selected.covered ? "取得範囲確認済み" : s.accounts.length ? "取得範囲未確認" : "銀行口座未登録"}</span> : null}</div>
    <p className="mt-3 text-xs text-muted-foreground">{mode === "bank" ? "取得済み銀行明細のみ。資金移動・カード引落しを含み、カード利用明細は含みません。" : "発行日ベース・税込。下書き・取消・却下・アーカイブを除く。"} 集計は {s.through} まで。</p>
  </section>;
}
