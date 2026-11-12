"use client";
import { Money } from "@/components/app/money";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Camera, ChevronLeft, ChevronRight, CreditCard, ExternalLink, Files, Landmark, Plus, Search, Unlink, Wallet, X } from "lucide-react";
import { FilterPanel } from "@/components/app/filter-panel";
import { cardPressProps } from "@/components/app/list-selection";
import { MonthTabs } from "@/components/app/month-tabs";
import { OptionTabs } from "@/components/app/option-tabs";
import { RecordDetail } from "@/components/app/record-detail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { MyCardView } from "@/lib/card-receipts";
import type { ExpenseStats } from "@/lib/expense-home-stats";
import { Textarea } from "@/components/ui/textarea";
import { useMediaQuery } from "@/hooks/use-media-query";
import { toast } from "@/hooks/use-toast";
import type { CompanyScope } from "@/lib/company";
import type { ExpenseClaimView, ExpenseWorkflowMutation, expenseSettlementSummary } from "@/lib/expense-claim-edits";
import { expenseActionLabels, expenseMonth, expensePaidWithLabels, expenseStatusLabels } from "@/lib/expense-claims";
import { formatDate } from "@/lib/format";
import { countByMonth } from "@/lib/month-tabs";
import { operationFailureToast } from "@/lib/operation-feedback";
import type { ExpenseClaimStatus } from "@/lib/types";
import type { ExpensePayoutDetail } from "@/lib/expense-payouts";
import { expenseAction, expensePayoutAction, expensePayoutDetailAction } from "./actions";
import { BatchForm } from "./batch-form";
import { CardPanel } from "./card-panel";
import { ExpenseForm, type Option } from "./expense-form";

type Summary = ReturnType<typeof expenseSettlementSummary>;
type RunAction = (input: ExpenseWorkflowMutation, title: string, onSuccess?: () => void) => void;
const statusOptions = [["all", "すべて"], ["SUBMITTED", "申請中"], ["RETURNED", "差戻し"], ["APPROVED", "承認済み"], ["PAID", "精算済み"]] as const;
const statusClasses: Record<ExpenseClaimStatus, string> = {
  SUBMITTED: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  RETURNED: "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200",
  APPROVED: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200",
  PAID: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
  WITHDRAWN: "border-border bg-muted/20 text-muted-foreground",
};

function ExpenseBadge({ status }: { status: ExpenseClaimStatus }) {
  return <Badge variant="outline" className={`font-normal ${statusClasses[status]}`}>{expenseStatusLabels[status]}</Badge>;
}

export function ExpensesWorkspace({ company, views, summary, projects, categories, canManage, canReconcile, today, currentUserId, actors, initialStatus, initialView, initialId, card, stats, initialTab }: {
  company: CompanyScope; views: ExpenseClaimView[]; summary: { all: Summary; mine: Summary }; projects: Option[]; categories: Option[];
  canManage: boolean; canReconcile: boolean; today: string; currentUserId: string; actors: Record<string, string>;
  initialStatus: ExpenseClaimStatus | "all"; initialView: "all" | "mine"; initialId?: string;
  card: MyCardView | null; stats: ExpenseStats; initialTab: "expense" | "card";
}) {
  const router = useRouter(), wide = useMediaQuery("(min-width: 1024px)");
  const [pending, startTransition] = useTransition(), busy = useRef(false);
  const [view, setView] = useState(canManage ? initialView : "mine");
  const [status, setStatus] = useState<ExpenseClaimStatus | "all">(initialStatus);
  const [query, setQuery] = useState(""), [month, setMonth] = useState("");
  const [showWithdrawn, setShowWithdrawn] = useState(false);
  const [activeId, setActiveId] = useState(initialId || ""), [creating, setCreating] = useState(false), [batch, setBatch] = useState(false);
  const [tab, setTab] = useState<"expense" | "card">(card ? initialTab : "expense");
  const scoped = useMemo(() => views.filter((row) => view === "all" || row.submittedById === currentUserId), [views, view, currentUserId]);
  const months = scoped.map(expenseMonth), counts = countByMonth(months);
  const filtered = useMemo(() => {
    const terms = query.normalize("NFKC").toLocaleLowerCase("ja-JP").trim().split(/\s+/).filter(Boolean);
    return scoped.filter((row) => (!month || expenseMonth(row) === month) && (showWithdrawn || row.status !== "WITHDRAWN") && (status === "all" || row.status === status)
      && terms.every((term) => `${row.payee} ${row.purpose} ${row.submitterName} ${row.memo || ""}`.normalize("NFKC").toLocaleLowerCase("ja-JP").includes(term)));
  }, [scoped, month, showWithdrawn, status, query]);
  const active = scoped.find((row) => row.id === activeId), activeIndex = filtered.findIndex((row) => row.id === activeId);
  const totals = summary[view].totals;
  const open = (id: string) => { setCreating(false); setActiveId(id); };
  const close = () => { if (!busy.current) { setCreating(false); setActiveId(""); } };
  const create = () => { setBatch(false); setCreating(true); setActiveId(""); };
  const reset = () => { setQuery(""); setMonth(""); setStatus("all"); setShowWithdrawn(false); };
  const step = (offset: number) => !pending && activeIndex >= 0 && filtered[activeIndex + offset] ? () => open(filtered[activeIndex + offset].id) : undefined;
  const run: RunAction = (input, title, onSuccess) => {
    if (busy.current) return;
    busy.current = true;
    startTransition(async () => {
      try {
        const result = await expenseAction(company, input);
        if (!result.success) throw new Error(result.error);
        toast({ title, variant: "success" }); onSuccess?.(); router.refresh();
      } catch (error) { toast(operationFailureToast(error)); }
      finally { busy.current = false; }
    });
  };
  const save = (formData: FormData) => {
    if (busy.current) return;
    busy.current = true;
    startTransition(async () => {
      try {
        const response = await fetch("/api/uploads/expenses", { method: "POST", body: formData });
        const body = await response.json() as { id?: string; updatedAt?: string; error?: string };
        if (!response.ok) throw new Error(body.error || "保存できませんでした");
        if (!body.id || !body.updatedAt) throw new Error("保存結果を確認できませんでした。再読込してください");
        toast({ title: formData.get("claimId") ? "申請を保存しました。" : "領収書を提出しました。", variant: "success" });
        if (!formData.get("claimId")) reset();
        open(body.id); router.refresh();
      } catch (error) { toast(operationFailureToast(error)); }
      finally { busy.current = false; }
    });
  };

  const tabs = card ? <OptionTabs label="支払い方法" value={tab} onChange={(value) => { setTab(value); close(); setBatch(false); }} options={[["expense", <span key="e" className="inline-flex items-center gap-1"><Wallet className="size-4" />立替の申請</span>],
    ["card", <span key="c" className="inline-flex items-center gap-1"><CreditCard className="size-4" />会社カード{card.missing.length ? `（領収書なし ${card.missing.length}件）` : ""}</span>]]} /> : null;
  if (card && tab === "card") return <div className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">{tabs}<Button asChild variant="outline"><Link href="/expenses/capture"><Camera className="size-4" />スマホで撮って申請</Link></Button></div>
    <MyStats stats={stats} />
    <CardPanel card={card} company={company} today={today} projects={projects} categories={categories} wide={wide} />
  </div>;

  return <div className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">{tabs || <span />}<div className="flex flex-wrap justify-end gap-2"><Button asChild variant="outline"><Link href="/expenses/capture"><Camera className="size-4" />スマホで撮って申請</Link></Button>
      <Button type="button" variant="outline" disabled={pending} onClick={() => { close(); setBatch(true); }}><Files className="size-4" />まとめて提出</Button>
      <Button type="button" disabled={pending} onClick={create}><Plus className="size-4" />領収書を提出</Button></div></div>
    {view === "mine" ? <MyStats stats={stats} /> : null}
    {view === "all" ? <section aria-label="経費精算の集計" className="grid grid-cols-3 gap-2 text-xs text-muted-foreground sm:gap-3">
      {[[`申請中 ${totals.submittedCount}件`, totals.submittedAmount], ["承認済み・未精算", totals.approvedAmount], ["今月の精算済み", totals.paidThisMonth]].map(([label, amount]) =>
        <div key={label} className="min-w-0 rounded-lg border bg-muted/20 px-3 py-2"><div>{label}</div><div className="mt-1 break-all text-sm font-medium text-foreground"><Money value={Number(amount)} /></div></div>)}
    </section> : null}
    {canManage ? <OptionTabs label="表示" caption="表示" value={view} options={[["all", "全員の申請"], ["mine", "自分の申請"]]} disabled={pending}
      onChange={(value) => { setView(value); close(); }} /> : null}
    {view === "all" ? <p className="text-xs text-muted-foreground">集計は全員の全期間の申請です。今月の精算済みは振込日で集計しています。</p> : null}
    {batch ? <BatchForm kind="expense" company={company} today={today} projects={projects} categories={categories} onClose={() => setBatch(false)} onFinished={() => { setBatch(false); reset(); router.refresh(); }} /> : null}
    {canManage && view === "all" ? <SettlementQueue people={summary.all.people} views={views} today={today} pending={pending} run={run} /> : null}
    <Card variant="section" className="min-w-0">
      <CardContent className="space-y-3">
        <MonthTabs label="支払月" value={month} months={months} counts={counts} today={today} onChange={setMonth} />
        <FilterPanel activeCount={Number(showWithdrawn)} onReset={reset} primary={<>
          <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input aria-label="申請を検索" placeholder="支払先・用途・申請者・メモを検索" value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" /></div>
          <OptionTabs label="状態" value={status} options={statusOptions} onChange={setStatus} />
        </>}><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={showWithdrawn} onChange={(event) => setShowWithdrawn(event.target.checked)} />取り下げも表示</label></FilterPanel>
        <div className="grid lg:min-h-[520px] lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_440px]">
          <div className="min-w-0 lg:pr-3">
            <p className="mb-2 text-xs text-muted-foreground">{filtered.length}件</p>
            {filtered.length ? <table className="record-cards record-cards-stack workspace-record-table w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground"><tr><th>支払先</th><th>支払日</th>{view === "all" ? <th>申請者</th> : null}<th>科目</th><th className="text-right">金額</th><th>状態</th></tr></thead>
              <tbody>{filtered.map((row) => <tr key={`${row.id}:${row.updatedAt}`} {...cardPressProps(() => { if (!pending) open(row.id); })} data-active={row.id === activeId ? "" : undefined}>
                <td className="record-card-title"><button type="button" data-selection-open className="record-card-open" title="開く" disabled={pending} onClick={() => open(row.id)}>{row.payee}</button><div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{row.purpose}</div></td>
                <td data-card-sub>{formatDate(row.spentOn)}</td>{view === "all" ? <td data-card-line>{row.submitterName}</td> : null}
                <td data-card-hide className="text-muted-foreground">{row.categoryName}</td><td data-card-end className="text-right"><Money value={row.amount} /></td><td><ExpenseBadge status={row.status} />{canManage && row.status === "PAID" && row.payout ? <span className="ml-1 text-xs text-muted-foreground">明細照合済</span> : null}</td>
              </tr>)}</tbody>
            </table> : <div className="flex flex-col items-center gap-3 py-12 text-sm text-muted-foreground"><p>条件に合う申請がありません</p><Button type="button" variant="outline" onClick={reset}>条件をリセット</Button>{!scoped.length ? <Button type="button" disabled={pending} onClick={create}>最初の領収書を提出する</Button> : null}</div>}
          </div>
          <RecordDetail wide={wide} open={creating || Boolean(active)} title={creating ? "領収書を提出" : active?.payee || "経費の申請"} label="経費申請の詳細" resetKey={creating ? "new" : activeId}
            onClose={close} onPrevious={creating ? undefined : step(-1)} onNext={creating ? undefined : step(1)}>
            <div className="space-y-4 p-3">
              {wide && (creating || active) ? <div className="flex items-center gap-2 border-b pb-3"><h2 className="min-w-0 flex-1 truncate text-sm font-medium">{creating ? "領収書を提出" : active?.payee}</h2>
                {!creating ? <><Button type="button" variant="outline" size="icon" aria-label="前の申請" disabled={!step(-1)} onClick={step(-1)}><ChevronLeft className="size-4" /></Button><Button type="button" variant="outline" size="icon" aria-label="次の申請" disabled={!step(1)} onClick={step(1)}><ChevronRight className="size-4" /></Button></> : null}
                <Button type="button" variant="ghost" size="icon" aria-label="詳細を閉じる" disabled={pending} onClick={close}><X className="size-4" /></Button></div> : null}
              {creating ? <ExpenseForm key="new" company={company} today={today} projects={projects} categories={categories} pending={pending} save={save} />
                : active ? <ExpenseDetail key={`${active.id}:${active.updatedAt}`} row={active} company={company} today={today} projects={projects} categories={categories} actors={actors} wide={wide} canManage={canManage} canReconcile={canReconcile} pending={pending} save={save} run={run} />
                  : <p className="py-12 text-center text-sm text-muted-foreground">{activeId ? "申請を読み込んでいます。" : "申請を開くと詳細を確認できます。"}</p>}
            </div>
          </RecordDetail>
        </div>
      </CardContent>
    </Card>
  </div>;
}

function SettlementQueue({ people, views, today, pending, run }: { people: Summary["people"]; views: ExpenseClaimView[]; today: string; pending: boolean; run: RunAction }) {
  const [selected, setSelected] = useState<{ userId: string; name: string; items: Array<{ id: string; version: string }> } | null>(null);
  const waiting = people.filter((person) => person.approvedCount > 0);
  if (!waiting.length) return null;
  return <section aria-label="精算待ち" className="space-y-3 rounded-lg border bg-muted/20 p-3">
    <h2 className="text-sm font-medium">精算待ち</h2><p className="text-xs text-muted-foreground">人ごとの全期間の承認済み分をまとめて精算します。</p>
    {waiting.map((person) => <div key={person.userId} className="flex flex-wrap items-center gap-2 text-sm"><span>{person.name}</span><span className="text-muted-foreground">承認済み {person.approvedCount}件</span><span><Money value={person.approvedAmount} /></span>
      <Button type="button" variant="outline" className="ml-auto" disabled={pending} onClick={() => setSelected({ userId: person.userId, name: person.name, items: views.filter((row) => row.submittedById === person.userId && row.status === "APPROVED").map((row) => ({ id: row.id, version: row.updatedAt })) })}>精算する</Button></div>)}
    {selected ? <div className="space-y-2 border-t pt-3"><p className="text-sm">{selected.name} の {selected.items.length}件を精算</p>
      <PaymentForm key={selected.userId} today={today} pending={pending} onCancel={() => setSelected(null)} onSubmit={(paidAt, memo) => run({ action: "pay", items: selected.items, paidAt, memo }, "精算済みにしました。", () => setSelected(null))} />
    </div> : null}
  </section>;
}

function PaymentForm({ today, pending, onCancel, onSubmit }: { today: string; pending: boolean; onCancel: () => void; onSubmit: (paidAt: string, memo: string) => void }) {
  return <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); onSubmit(String(data.get("paidAt")), String(data.get("memo") || "")); }}>
    <label className="block space-y-1 text-sm"><span>振込日</span><Input name="paidAt" type="date" defaultValue={today} required disabled={pending} /></label>
    <label className="block space-y-1 text-sm"><span>精算メモ</span><Textarea name="memo" maxLength={1000} disabled={pending} /></label>
    <div className="flex flex-wrap gap-2"><Button type="submit" disabled={pending}>{pending ? "保存中…" : "精算済みにする"}</Button><Button type="button" variant="outline" disabled={pending} onClick={onCancel}>閉じる</Button></div>
  </form>;
}

function MyStats({ stats }: { stats: ExpenseStats }) {
  const max = Math.max(1, ...stats.monthly.map((row) => row.total)), monthLabel = (month: string) => `${Number(month.slice(5))}月`;
  return <section aria-label="自分の利用と申請" className="grid gap-3 rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
    <div className="grid grid-cols-3 gap-3">
      <div className="min-w-0"><div>{monthLabel(stats.month)}の利用額</div><div className="mt-1 break-all text-base font-medium text-foreground"><Money value={stats.thisMonth.total} /></div>
        {stats.hasCard ? <div className="mt-0.5">立替 <Money value={stats.thisMonth.expense} />・カード <Money value={stats.thisMonth.card} /></div> : null}</div>
      <div className="min-w-0"><div>未承認 {stats.unapproved.count}件</div><div className="mt-1 break-all text-sm font-medium text-foreground"><Money value={stats.unapproved.amount} /></div>
        {stats.unapproved.returned ? <div className="mt-0.5 text-rose-700 dark:text-rose-300">うち差戻し {stats.unapproved.returned}件</div> : null}</div>
      <div className="min-w-0"><div>承認済み・振込待ち {stats.awaitingPayout.count}件</div><div className="mt-1 break-all text-sm font-medium text-foreground"><Money value={stats.awaitingPayout.amount} /></div></div>
    </div>
    <div aria-label="毎月の利用額" className="grid grid-cols-6 items-end gap-2">{stats.monthly.map((row) => <div key={row.month} className="flex min-w-0 flex-col items-center gap-1" title={`${monthLabel(row.month)} ${row.total.toLocaleString("ja-JP")}円`}>
      <div className="flex h-12 w-full items-end"><div className={`w-full rounded-sm ${row.month === stats.month ? "bg-foreground/70" : "bg-foreground/20"}`} style={{ height: `${Math.max(row.total ? 6 : 2, Math.round(row.total / max * 100))}%` }} /></div>
      <span>{monthLabel(row.month)}</span></div>)}</div>
  </section>;
}

function ExpenseDetail({ row, company, today, projects, categories, actors, wide, canManage, canReconcile, pending, save, run }: {
  row: ExpenseClaimView; company: CompanyScope; today: string; projects: Option[]; categories: Option[]; actors: Record<string, string>;
  wide: boolean; canManage: boolean; canReconcile: boolean; pending: boolean; save: (data: FormData) => void; run: RunAction;
}) {
  const [returning, setReturning] = useState(false), [paying, setPaying] = useState(false);
  const target = { id: row.id, version: row.updatedAt };
  const dateTime = (value: string) => new Intl.DateTimeFormat("ja-JP", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Tokyo" }).format(new Date(value));
  return <div className="space-y-5">
    {row.fileUrl ? <section aria-label="領収書" className="space-y-2">
      {row.mimeType?.startsWith("image/") ?
        // Authenticated receipts are served directly, without the image optimizer.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={row.fileUrl} alt={`${row.payee}の領収書`} className="max-h-80 w-full rounded-lg border object-contain" />
        : row.mimeType === "application/pdf" && wide ? <iframe src={row.fileUrl} title={`${row.payee}の領収書`} className="h-80 w-full rounded-lg border" /> : null}
      <a href={row.fileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 text-sm underline underline-offset-4"><ExternalLink className="size-4" />原本を開く</a>
    </section> : <p className="text-sm text-muted-foreground">領収書が添付されていません。</p>}
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
      <dt className="text-muted-foreground">状態</dt><dd><ExpenseBadge status={row.status} /></dd>
      {([["支払日", formatDate(row.spentOn)], ["金額", <Money key="amount" value={row.amount} />], ["支払先", row.payee], ["用途", row.purpose], ["科目", row.categoryName], ["案件", row.projectName],
        ["立替方法", row.paidWith ? expensePaidWithLabels[row.paidWith] : "未設定"], ["登録番号", row.registrationNumber || "—"],
        ["消費税", row.taxBreakdown ? [row.taxBreakdown.rate10 ? `10%: ${row.taxBreakdown.rate10.toLocaleString("ja-JP")}円` : "", row.taxBreakdown.rate8 ? `8%: ${row.taxBreakdown.rate8.toLocaleString("ja-JP")}円` : ""].filter(Boolean).join(" / ") : "—"],
        ["メモ", row.memo || "—"], ["申請者", row.submitterName]] as const).map(([label, value]) =>
        <div key={label} className="contents"><dt className="text-muted-foreground">{label}</dt><dd className="min-w-0 whitespace-pre-wrap break-words">{value}</dd></div>)}
      {row.reviewedAt ? <><dt className="text-muted-foreground">確認者</dt><dd>{row.reviewerName} / {dateTime(row.reviewedAt)}</dd></> : null}
      {row.paidAt ? <><dt className="text-muted-foreground">振込日</dt><dd>{formatDate(row.paidAt)}</dd><dt className="text-muted-foreground">精算者</dt><dd>{row.paidByName}</dd><dt className="text-muted-foreground">精算メモ</dt><dd className="whitespace-pre-wrap break-words">{row.paymentMemo || "—"}</dd></> : null}
    </dl>
    {row.status === "RETURNED" ? <div className="space-y-1 rounded-lg border border-rose-200 bg-rose-50/50 p-3 text-sm dark:border-rose-900 dark:bg-rose-950/20"><p className="font-medium">差戻しの理由</p><p className="whitespace-pre-wrap break-words">{row.reviewNote}</p></div> : null}
    {canManage ? <section aria-label="承認と精算" className="space-y-3 border-t pt-4"><div className="flex flex-wrap gap-2">
      {row.status === "SUBMITTED" ? <Button type="button" disabled={pending} onClick={() => run({ action: "approve", ...target }, "申請を承認しました。")}>承認</Button> : null}
      {row.status === "SUBMITTED" || row.status === "APPROVED" ? <Button type="button" variant="outline" disabled={pending} onClick={() => { setReturning(!returning); setPaying(false); }}>差戻し</Button> : null}
      {row.status === "APPROVED" ? <Button type="button" disabled={pending} onClick={() => { setPaying(!paying); setReturning(false); }}>精算済みにする</Button> : null}
      {row.status === "PAID" ? <Button type="button" variant="outline" disabled={pending || Boolean(row.payout)} title={row.payout ? "口座明細との照合を解除してから取り消せます" : undefined} onClick={() => run({ action: "unpay", ...target }, "精算を取り消しました。")}>精算を取り消す</Button> : null}
    </div>
      {returning ? <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); run({ action: "return", ...target, note: String(data.get("note") || "") }, "申請を差し戻しました。", () => setReturning(false)); }}>
        <label className="block space-y-1 text-sm"><span>差戻しの理由</span><Textarea name="note" required maxLength={500} disabled={pending} /></label><Button type="submit" disabled={pending}>理由を添えて差し戻す</Button>
      </form> : null}
      {paying ? <PaymentForm today={today} pending={pending} onCancel={() => setPaying(false)} onSubmit={(paidAt, memo) => run({ action: "pay", items: [target], paidAt, memo }, "精算済みにしました。", () => setPaying(false))} /> : null}
    </section> : null}
    {canManage && canReconcile && row.status === "PAID" ? <PayoutSection key={row.updatedAt} company={company} claimId={row.id} /> : null}
    {row.editable ? <section className="space-y-3 border-t pt-4"><h3 className="text-sm font-medium">申請を編集</h3>
      <ExpenseForm row={row} company={company} today={today} projects={projects} categories={categories} pending={pending} save={save} />
      <Button type="button" variant="outline" disabled={pending} onClick={() => { if (window.confirm("この申請を取り下げますか？")) run({ action: "withdraw", ...target }, "申請を取り下げました。"); }}>取り下げ</Button>
    </section> : null}
    <section className="space-y-3 border-t pt-4"><h3 className="text-sm font-medium">履歴</h3><ol className="space-y-3 text-xs text-muted-foreground">{row.history.slice().reverse().map((entry, index) =>
      <li key={`${entry.at}:${index}`} className="space-y-1"><p><time dateTime={entry.at}>{dateTime(entry.at)}</time> ・ {actors[entry.byId] || entry.byId} ・ {expenseActionLabels[entry.action]}</p>{entry.note ? <p className="whitespace-pre-wrap break-words">{entry.note}</p> : null}</li>)}
    </ol></section>
  </div>;
}

function PayoutSection({ company, claimId }: { company: CompanyScope; claimId: string }) {
  const router = useRouter(), [detail, setDetail] = useState<ExpensePayoutDetail | null>(null), [error, setError] = useState(""), [pending, startTransition] = useTransition();
  useEffect(() => {
    let live = true;
    void expensePayoutDetailAction(company, claimId).then((result) => { if (!live) return; if (result.success) setDetail(result.detail); else setError(result.error); });
    return () => { live = false; };
  }, [company, claimId]);
  const items = detail?.items.map((row) => ({ id: row.id, version: row.updatedAt })) || [];
  const submit = (input: Parameters<typeof expensePayoutAction>[1], title: string) => startTransition(async () => {
    const result = await expensePayoutAction(company, input);
    if (!result.success) { toast(operationFailureToast(new Error(result.error))); return; }
    toast({ title, variant: "success" }); router.refresh();
  });
  return <section aria-label="振込の照合" className="space-y-3 border-t pt-4">
    <h3 className="flex items-center gap-2 text-sm font-medium"><Landmark className="size-4" />振込と口座明細の照合</h3>
    {error ? <p className="text-sm text-muted-foreground">{error}</p> : !detail ? <p className="text-sm text-muted-foreground">口座明細を確認しています…</p> : <>
      <p className="text-xs text-muted-foreground">{detail.submitterName}さんへ {formatDate(detail.paidAt)} に精算した {detail.items.length}件、合計 <Money value={detail.total} /> の振込です。</p>
      {detail.issue ? <p role="alert" className="border-l-2 border-amber-500 p-2 text-sm">{detail.issue}</p> : null}
      {detail.linked ? <div className="space-y-2 rounded-lg border bg-muted/20 p-3 text-sm">
        <p className="font-medium">{detail.linked.date} {detail.linked.content}</p><p className="text-xs text-muted-foreground">{detail.linked.account} / <Money value={detail.linked.amount} maximumFractionDigits={2} /></p>
        <Button type="button" variant="ghost" disabled={pending} onClick={() => submit({ action: "unlink", claimId, items }, "照合を解除しました。")}><Unlink className="size-4" />照合を解除</Button>
      </div> : detail.issue ? <Button type="button" variant="outline" disabled={pending} onClick={() => submit({ action: "unlink", claimId, items }, "照合を解除しました。")}><Unlink className="size-4" />照合を解除</Button>
        : detail.candidates.length ? <ul className="divide-y rounded-lg border" aria-label="口座明細の候補">{detail.candidates.map((bank) => <li key={bank.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
          <div className="min-w-0 flex-1"><p className="break-words font-medium">{bank.date} {bank.content}</p><p className="text-xs text-muted-foreground">{bank.account} / <Money value={bank.amount} maximumFractionDigits={2} />{bank.days ? ` / 振込日の${Math.abs(bank.days)}日${bank.days > 0 ? "後" : "前"}` : " / 振込日と同日"}</p></div>
          <Button type="button" variant="outline" disabled={pending} onClick={() => submit({ action: "link", claimId, items, transactionId: bank.id, transactionUpdatedAt: bank.updatedAt }, "口座明細と照合しました。")}>この明細と照合</Button>
        </li>)}</ul> : <p className="text-sm text-muted-foreground">振込日の前後{31}日に、合計額と同じ金額の出金明細がありません。口座明細を同期したあとに開き直してください。</p>}
    </>}
  </section>;
}
