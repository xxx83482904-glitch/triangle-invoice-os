"use client";

import "./dashboard.css";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, CheckCircle2, ChevronLeft, ChevronRight, FileSearch, FolderKanban, Info, Landmark, Link2, Mail, RefreshCw, ShieldAlert, type LucideIcon } from "lucide-react";
import { recordSelectClass } from "@/components/app/record-list-controls";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { DashboardDocument, DashboardSummary } from "@/lib/dashboard";
import { dashboardReviewBreakdown, dashboardTimingBreakdown, dashboardWorkRows, type DashboardNextStep, type DashboardTimingKey, type DashboardWorkView } from "@/lib/dashboard-work";
import { yen } from "@/lib/format";

const money = (value: number) => yen.format(value).replace("￥", "¥");
const compact = new Intl.NumberFormat("ja-JP", { notation: "compact", maximumFractionDigits: 1 });
const monthLabel = (month: string) => `${month.slice(0, 4)}年${Number(month.slice(5))}月`;
const timingLabels = { overdue: "期限超過", soon: "7日以内", later: "期限待ち", undated: "期限未設定" };
const legendLabels: Record<DashboardTimingKey, string> = { overdue: "超過", soon: "7日内", later: "待ち", undated: "未設定", mismatch: "要確認" };
type WorkView = DashboardWorkView;
type StepGroup = "urgent" | "soon" | "check";

const stepGroupLabels: Record<StepGroup, string> = { urgent: "今すぐ", soon: "7日以内", check: "確認・整理" };
const stepGroup = (id: string): StepGroup => id.endsWith("-overdue") || id === "integrity" ? "urgent" : id.endsWith("-soon") ? "soon" : "check";
const stepIcons: Record<string, LucideIcon> = { "expense-overdue": ArrowUpRight, "income-overdue": ArrowDownLeft, "expense-soon": ArrowUpRight, "income-soon": ArrowDownLeft,
  integrity: ShieldAlert, documents: FileSearch, "bank-unreviewed": Landmark, "bank-unmatched": Link2, mail: Mail };

export function DashboardWorkspace({ summary: s, nextSteps = [], companyLabel }: { summary: DashboardSummary; nextSteps?: DashboardNextStep[]; companyLabel: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [refreshing, startRefresh] = useTransition();
  const [view, setView] = useState<WorkView>("income");
  const [timing, setTiming] = useState("all");
  const [limit, setLimit] = useState(8);
  const workRef = useRef<HTMLElement>(null);
  const query = `company=${s.company}`;
  const accountsHref = `/banking/accounts?${query}`;
  const workRows = dashboardWorkRows(s, view, timing);
  const openWork = (value: WorkView, scroll = false, nextTiming = "all") => {
    setView(value); setTiming(nextTiming); setLimit(8);
    if (scroll) { workRef.current?.scrollIntoView({ block: "nearest" }); workRef.current?.focus({ preventScroll: true }); }
  };
  const showNextSteps = s.company === "JAPAN";
  return <div className="dash">
    <header className="dash-head">
      <div>
        <h1 className="dash-title">ダッシュボード</h1>
        <p className="dash-subtitle">{s.today} 現在 / {companyLabel}</p>
      </div>
      <div className="dash-head-actions">
        <StatusLinks summary={s} query={query} />
        <button type="button" className="dash-status" disabled={refreshing} onClick={() => startRefresh(() => router.refresh())}><RefreshCw className={refreshing ? "animate-spin" : ""} />{refreshing ? "更新中" : "表示を更新"}</button>
      </div>
    </header>

    <div className="dash-kpis">
      <CashCard summary={s} href={accountsHref} />
      <MoneyCard flow="in" icon={ArrowDownLeft} label="未入金" total={s.incoming} rows={s.receivables} pressed={view === "income"} onOpen={() => openWork("income", true)} />
      <MoneyCard flow="out" icon={ArrowUpRight} label="未払い" total={s.outgoing} rows={s.payables} pressed={view === "expense"} onOpen={() => openWork("expense", true)} />
      <ReviewCard rows={s.review} pressed={view === "review"} onOpen={() => openWork("review", true)} />
    </div>

    <div className="dash-grid" data-columns={showNextSteps ? undefined : 2}>
      {showNextSteps ? <section aria-labelledby="dashboard-next-title" className="dash-panel">
        <div className="dash-panel-head"><h2 id="dashboard-next-title" className="dash-panel-title">次にやること</h2></div>
        <div className="dash-scroll">
          {nextSteps.length ? <NextSteps steps={nextSteps} view={view} timing={timing} openWork={openWork} /> : <p className="dash-empty"><CheckCircle2 className="size-5" />今すぐ対応が必要なものはありません</p>}
        </div>
      </section> : null}

      <section ref={workRef} tabIndex={-1} aria-labelledby="dashboard-work-title" className="dash-panel dash-grid-docs scroll-mt-20 outline-none">
        <div className="dash-panel-head">
          <h2 id="dashboard-work-title" className="dash-panel-title">対応する書類</h2>
          {view !== "review" ? <select aria-label="書類の期限" className={`${recordSelectClass} dash-select`} value={timing} onChange={(event) => { setTiming(event.target.value); setLimit(8); }}><option value="all">すべての期限</option><option value="overdue">期限超過</option><option value="soon">7日以内</option><option value="undated">期限未設定</option></select> : null}
        </div>
        <div role="group" aria-label="対応書類の種類" className="dash-track">
          {([["income", "未入金", s.incoming.count], ["expense", "未払い", s.outgoing.count], ["review", "書類確認", s.review.length]] as const).map(([value, label, count]) => <button key={value} type="button" aria-pressed={view === value} onClick={() => openWork(value)}>{label}<span>{count}</span></button>)}
        </div>
        <div role="region" aria-label="対応する書類一覧" tabIndex={0} className="dash-scroll">
          {workRows.length ? workRows.slice(0, limit).map((row) => <WorkRow key={row.id} row={row} review={view === "review"} />) : <p className="dash-empty"><CheckCircle2 className="size-5" />該当する書類はありません</p>}
          {limit < workRows.length ? <Button variant="ghost" size="sm" className="w-full" onClick={() => setLimit((value) => value + 20)}>さらに表示 ({workRows.length - limit}件)</Button> : null}
        </div>
        <div className="dash-foot"><span>{workRows.length}件{view === "review" ? " / 書類の税込額" : " / 支払記録との差額"}</span><Link className="dash-link" href={`/${view === "expense" ? "received-invoices" : view === "review" ? "documents" : "issued-invoices"}?${query}`} prefetch={false}>書類一覧<ChevronRight /></Link></div>
      </section>

      <section aria-labelledby="dashboard-cash-title" className="dash-panel">
        <div className="dash-panel-head"><h2 id="dashboard-cash-title" className="dash-panel-title">口座残高</h2><Link className="dash-link" href={accountsHref} prefetch={false}>残高設定<ChevronRight /></Link></div>
        <div role="region" aria-label="口座残高一覧" tabIndex={0} className="dash-scroll">
          {s.accounts.length ? s.accounts.map((row) => <AccountRow key={row.id} row={row} query={query} />) : <p className="dash-empty">銀行口座が未登録です。</p>}
        </div>
        <p className="dash-foot">手動登録の残高を基準に計算 / カード利用分を除く</p>
      </section>
    </div>

    <MonthlyOverview summary={s} pending={pending} changeYear={(year) => startTransition(() => router.push(`/dashboard?${query}&year=${year}`, { scroll: false }))} />
  </div>;
}

function StatusLinks({ summary: s, query }: { summary: DashboardSummary; query: string }) {
  const lastSync = s.banking.lastSyncAt ? new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "short", timeStyle: "short" }).format(new Date(s.banking.lastSyncAt)) : "";
  const sync = s.banking.syncing ? { tone: "busy", text: "口座明細を同期中" } : s.banking.syncErrors ? { tone: "error", text: `同期エラー ${s.banking.syncErrors}件` } : lastSync ? { tone: "ok", text: `最終同期 ${lastSync}` } : { tone: "warn", text: "未同期" };
  return <>
    <Link className="dash-status" href={`/banking?${query}`} prefetch={false}><span className="dash-dot" data-tone={sync.tone} />{sync.text} / 最新取引 {s.banking.latestDate || "未取得"}</Link>
    <Link className="dash-status" href={`/projects?${query}`} prefetch={false}><FolderKanban />進行中の案件 <b>{s.projectCount}</b>件</Link>
    {s.company !== "JAPAN" ? <Link className="dash-status" href={`/banking?${query}&status=unreviewed`} prefetch={false}><Landmark />未確認の口座明細 <b>{s.banking.unreviewed}</b>件</Link> : null}
    {s.banking.missing ? <Link className="dash-status" data-tone="warn" href={`/banking?${query}&status=missing`} prefetch={false}>元明細なし {s.banking.missing}件</Link> : null}
  </>;
}

function CashCard({ summary: s, href }: { summary: DashboardSummary; href: string }) {
  const balances = s.accounts.map((row) => row.balanceCalculation?.amount ?? 0).filter((amount) => amount > 0);
  return <Link href={href} prefetch={false} className="dash-raised dash-kpi">
    <span className="dash-kpi-label"><Landmark /><span>銀行の計算残高</span><ChevronRight aria-hidden="true" className="dash-chevron" /></span>
    <span className="dash-kpi-value">{s.cash.amount === null ? "残高未登録" : money(s.cash.amount)}</span>
    <span aria-hidden="true" className="dash-bar">{balances.map((amount, index) => <span key={index} style={{ flexGrow: amount, background: "var(--primary)", opacity: Math.max(0.3, 1 - index * 0.22) }} />)}</span>
    <span className="dash-legend">
      <span>登録済み <b>{s.cash.registered}</b>口座</span>
      {s.cash.provisional ? <span>暫定 <b>{s.cash.provisional}</b></span> : null}
      {s.cash.missing ? <span data-warn="">残高未登録 <b>{s.cash.missing}</b></span> : null}
      {s.cash.unknownAccounts ? <span data-warn="">種別未確定 <b>{s.cash.unknownAccounts}</b></span> : null}
    </span>
  </Link>;
}

function MoneyCard({ flow, icon: Icon, label, total, rows, pressed, onOpen }: { flow: "in" | "out"; icon: LucideIcon; label: string; total: DashboardSummary["incoming"]; rows: DashboardDocument[]; pressed: boolean; onOpen: () => void }) {
  const breakdown = dashboardTimingBreakdown(rows);
  const anyAmount = breakdown.some((row) => row.amount > 0);
  return <button type="button" className="dash-raised dash-kpi" data-flow={flow} aria-pressed={pressed} onClick={onOpen}>
    <span className="dash-kpi-label"><Icon /><span>{label}</span><span className="dash-count" title={`全期間 ${total.count}件`}>{total.count}</span><ChevronRight aria-hidden="true" className="dash-chevron" /></span>
    <span className="dash-kpi-value">{money(total.amount)}</span>
    <span aria-hidden="true" className="dash-bar">{breakdown.map((row) => <span key={row.key} className="dash-tone" data-tone={row.key} style={{ flexGrow: anyAmount ? row.amount : row.count }} />)}</span>
    <span className="dash-legend">{breakdown.length ? breakdown.map((row) => <span key={row.key} data-alert={row.key === "overdue" ? "" : undefined}><i aria-hidden="true" className="dash-tone" data-tone={row.key} />{legendLabels[row.key]} <b>{row.count}</b></span>) : <span>期限超過 <b>0</b>件</span>}</span>
  </button>;
}

function ReviewCard({ rows, pressed, onOpen }: { rows: DashboardDocument[]; pressed: boolean; onOpen: () => void }) {
  const breakdown = dashboardReviewBreakdown(rows);
  return <button type="button" className="dash-raised dash-kpi" data-flow="review" aria-pressed={pressed} onClick={onOpen}>
    <span className="dash-kpi-label"><FileSearch /><span>書類確認</span><ChevronRight aria-hidden="true" className="dash-chevron" /></span>
    <span className="dash-kpi-value">{rows.length}<small>件</small></span>
    <span aria-hidden="true" className="dash-bar">{breakdown.map((row, index) => <span key={row.reason} style={{ flexGrow: row.count, background: "var(--tone-violet-bar)", opacity: Math.max(0.35, 1 - index * 0.25) }} />)}</span>
    <span className="dash-legend">{breakdown.length ? breakdown.slice(0, 2).map((row) => <span key={row.reason}>{row.reason} <b>{row.count}</b></span>) : <span>下書き・入力不足・支払記録</span>}</span>
  </button>;
}

function NextSteps({ steps, view, timing, openWork }: { steps: DashboardNextStep[]; view: WorkView; timing: string; openWork: (view: WorkView, scroll: boolean, timing: string) => void }) {
  return (["urgent", "soon", "check"] as const).map((group) => {
    const rows = steps.filter((step) => stepGroup(step.id) === group);
    if (!rows.length) return null;
    return <div key={group} role="group" aria-label={stepGroupLabels[group]} className="dash-step-group">
      {rows.map((step) => <NextStepRow key={step.id} step={step} group={group} active={"view" in step.target && step.target.view === view && step.target.timing === timing} openWork={openWork} />)}
    </div>;
  });
}

function NextStepRow({ step, group, active, openWork }: { step: DashboardNextStep; group: StepGroup; active: boolean; openWork: (view: WorkView, scroll: boolean, timing: string) => void }) {
  const target = step.target;
  const Icon = stepIcons[step.id] || ArrowRight;
  const name = `${step.label}を開く / ${step.count}件${step.amount !== undefined ? ` / ${money(step.amount)}` : ""} / ${step.reason}`;
  return <div className="dash-row" data-active={active}>
    <Icon aria-hidden="true" className="dash-row-icon" data-tone={group} />
    {"href" in target ? <Link className="dash-row-main" href={target.href} prefetch={false} title={step.reason} aria-label={name}>{step.label}</Link>
      : <button type="button" className="dash-row-main" title={step.reason} aria-label={name} onClick={() => openWork(target.view, true, target.timing)}>{step.label}</button>}
    {step.caveat ? <Popover>
      <PopoverTrigger className="dash-note" aria-label={`${step.label}の件数について`} title={step.caveat}><Info aria-hidden="true" /></PopoverTrigger>
      <PopoverContent align="end" className="max-w-72 text-xs">{step.caveat}</PopoverContent>
    </Popover> : null}
    {step.amount !== undefined ? <span className="dash-row-amount">{money(step.amount)}</span> : null}
    <span className="dash-count" data-tone={group}>{step.count.toLocaleString("ja-JP")}</span>
    <ChevronRight aria-hidden="true" className="dash-chevron" />
  </div>;
}

function WorkRow({ row, review }: { row: DashboardDocument; review: boolean }) {
  const tone = row.paymentMismatch ? "mismatch" : row.timing;
  const label = row.paymentMismatch ? (row.kind === "issued" ? "入金記録要確認" : "支払記録要確認") : timingLabels[row.timing];
  const tag = review ? row.reasons[0] : label;
  const extras = review ? row.reasons.slice(1).join("・") : "";
  return <Link href={row.href} prefetch={false} className="dash-doc" title={`${row.project} / ${row.partner} / ${row.title}`}>
    <span className="dash-tag" data-tone={review ? "review" : tone} title={review ? row.reasons.join("・") : label}>{tag}</span>
    <span className="min-w-0">
      <span className="dash-doc-title">{row.project}</span>
      <span className="dash-doc-sub">{row.partner} / {row.title}{extras ? ` / ${extras}` : ""}</span>
    </span>
    <span className="dash-doc-right">
      <span className="dash-doc-amount">{money(review ? row.amount : row.remaining)}</span>
      <span className="dash-doc-sub">{row.dueDate ? row.dueDate : "期限なし"}</span>
    </span>
  </Link>;
}

function AccountRow({ row, query }: { row: DashboardSummary["accounts"][number]; query: string }) {
  const calculation = row.balanceCalculation, balance = row.balance;
  const [bank, ...branch] = row.name.replace(/^【法人】/, "").split(" / ");
  const provisional = Boolean(calculation && !calculation.complete);
  const detail = [row.name, calculation ? `計算残高 ${calculation.through}まで` : "", balance ? `基準: ${balance.asOf} 終日 / 手動登録 ${money(balance.amount)}` : "",
    provisional ? `取得データ未完備${calculation?.missing ? ` / 元明細なし ${calculation.missing}件` : ""}` : "", balance && !calculation ? "基準残高・確認日の再確認が必要" : ""].filter(Boolean).join("\n");
  return <Link href={`/banking?${query}&account=${encodeURIComponent(row.id)}`} prefetch={false} className="dash-doc" data-account="" title={detail}>
    <span className="min-w-0">
      <span className="dash-doc-title">{bank}</span>
      <span className="dash-doc-sub">{branch.join(" / ") || " "}</span>
    </span>
    <span className="dash-doc-right flex-none">
      <span className="dash-doc-amount" data-empty={calculation ? undefined : ""}>{calculation ? money(calculation.amount) : balance ? "計算不可" : "残高未登録"}</span>
      <span className="dash-doc-sub">{provisional ? <span className="dash-provisional">暫定</span> : null}{balance ? `基準 ${balance.asOf.slice(5)}` : " "}</span>
    </span>
    <span className="sr-only">{detail}</span>
  </Link>;
}

function MonthlyOverview({ summary: s, pending, changeYear }: { summary: DashboardSummary; pending: boolean; changeYear: (year: number) => void }) {
  const [mode, setMode] = useState<"bank" | "invoice">("bank");
  const [month, setMonth] = useState(s.through.slice(0, 7));
  const selected = s.months.find((row) => row.month === month)!;
  const values = s.months.map((row) => ({ ...row, left: mode === "bank" ? row.income : row.issued, right: mode === "bank" ? row.expense : row.received }));
  const max = Math.max(1, ...values.flatMap((row) => [row.left, row.right]));
  const leftLabel = mode === "bank" ? "銀行入金" : "発行請求", rightLabel = mode === "bank" ? "銀行出金" : "受領請求";
  const yearIndex = s.availableYears.indexOf(s.period.year);
  const selectedLeft = mode === "bank" ? selected.income : selected.issued, selectedRight = mode === "bank" ? selected.expense : selected.received;
  return <section aria-labelledby="dashboard-months-title" className="dash-panel">
    <div className="dash-panel-head">
      <h2 id="dashboard-months-title" className="dash-panel-title">月別の動き<small>{s.period.start} ～ {s.period.end} / 8月決算</small></h2>
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
        <div className="dash-key">
          <span><i aria-hidden="true" className="dash-bar-in" />{leftLabel} <b>{money(values.reduce((sum, row) => sum + row.left, 0))}</b></span>
          <span><i aria-hidden="true" className="dash-bar-out" />{rightLabel} <b>{money(values.reduce((sum, row) => sum + row.right, 0))}</b></span>
        </div>
        <div role="group" aria-label="月別集計の種類" className="dash-track" data-inline=""><button type="button" aria-pressed={mode === "bank"} onClick={() => setMode("bank")}>銀行の入出金</button><button type="button" aria-pressed={mode === "invoice"} onClick={() => setMode("invoice")}>請求額</button></div>
        <div className="dash-year">
          <button type="button" title="前の決算期" aria-label="前の決算期" disabled={pending || yearIndex === s.availableYears.length - 1} onClick={() => changeYear(s.availableYears[yearIndex + 1])}><ChevronLeft /></button>
          <select aria-label="決算期" value={s.period.year} disabled={pending} onChange={(event) => changeYear(Number(event.target.value))} className={`${recordSelectClass} dash-select`}>
            {s.availableYears.map((year) => <option key={year} value={year}>{year}年8月期</option>)}
          </select>
          <button type="button" title="次の決算期" aria-label="次の決算期" disabled={pending || yearIndex === 0} onClick={() => changeYear(s.availableYears[yearIndex - 1])}><ChevronRight /></button>
        </div>
      </div>
    </div>
    <div className="dash-month-layout">
      <div className="dash-raised min-w-0">
        <div role="region" aria-label="9月から8月の月次グラフ" tabIndex={0} className="dash-chart">
          <div className="dash-chart-grid">
            <span aria-hidden="true" className="dash-chart-scale">{compact.format(max)}</span>
            {values.map((row) => <button key={row.month} type="button" className="dash-month" aria-pressed={month === row.month} disabled={row.future} aria-label={`${monthLabel(row.month)} ${row.future ? "未到来" : `${leftLabel} ${money(row.left)} ${rightLabel} ${money(row.right)}`}`} title={row.future ? "未到来" : `${monthLabel(row.month)} / ${leftLabel} ${money(row.left)} / ${rightLabel} ${money(row.right)}`} onClick={() => setMonth(row.month)}>
              <span aria-hidden="true" className="dash-month-bars"><span className="dash-bar-in" style={{ height: `${row.left / max * 100}%`, minHeight: row.left > 0 ? 2 : 0 }} /><span className="dash-bar-out" style={{ height: `${row.right / max * 100}%`, minHeight: row.right > 0 ? 2 : 0 }} /></span>
              <span className="dash-month-label">{Number(row.month.slice(5))}月</span>
            </button>)}
          </div>
        </div>
      </div>
      <div className="dash-raised dash-side" aria-live="polite">
        <p className="dash-side-month">{Number(month.slice(5))}月<small>{month.slice(0, 4)}年</small></p>
        <p className="dash-side-row" data-flow="in"><span>{leftLabel}</span><b>{money(selectedLeft)}</b></p>
        <p className="dash-side-row" data-flow="out"><span>{rightLabel}</span><b>{money(selectedRight)}</b></p>
        <p className="dash-side-row" data-net=""><span>差額</span><b>{money(selectedLeft - selectedRight)}</b></p>
        {mode === "bank" ? <p className="dash-side-note" data-warn={selected.covered ? undefined : ""}>{selected.count}件 / {selected.covered ? "取得範囲確認済み" : s.accounts.length ? "取得範囲未確認" : "銀行口座未登録"}</p> : null}
      </div>
    </div>
    <p className="dash-foot">{mode === "bank" ? "取得済み銀行明細のみ。資金移動・カード引落しを含み、カード利用明細は含みません。" : "発行日ベース・税込。下書き・取消・却下・アーカイブを除く。"} 集計は {s.through} まで。</p>
  </section>;
}
