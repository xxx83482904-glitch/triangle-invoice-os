"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, ExternalLink, Plus, Search, X } from "lucide-react";
import { FilterPanel } from "@/components/app/filter-panel";
import { cardPressProps } from "@/components/app/list-selection";
import { MonthTabs } from "@/components/app/month-tabs";
import { OptionTabs } from "@/components/app/option-tabs";
import { RecordDetail } from "@/components/app/record-detail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useMediaQuery } from "@/hooks/use-media-query";
import { toast } from "@/hooks/use-toast";
import type { CompanyScope } from "@/lib/company";
import type { ExpenseClaimView, ExpenseWorkflowMutation, expenseSettlementSummary } from "@/lib/expense-claim-edits";
import { expenseActionLabels, expenseMonth, expensePaidWithLabels, expenseStatusLabels } from "@/lib/expense-claims";
import { formatDate, yen } from "@/lib/format";
import { countByMonth } from "@/lib/month-tabs";
import { operationFailureToast } from "@/lib/operation-feedback";
import type { ExpenseClaimStatus, ExpensePaidWith } from "@/lib/types";
import { expenseAction } from "./actions";

type Option = { value: string; label: string };
type Summary = ReturnType<typeof expenseSettlementSummary>;
type RunAction = (input: ExpenseWorkflowMutation, title: string, onSuccess?: () => void) => void;
const selectClass = "h-9 w-full min-w-0 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
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

export function ExpensesWorkspace({ company, views, summary, projects, categories, canManage, today, currentUserId, actors, initialStatus, initialView, initialId }: {
  company: CompanyScope; views: ExpenseClaimView[]; summary: { all: Summary; mine: Summary }; projects: Option[]; categories: Option[];
  canManage: boolean; today: string; currentUserId: string; actors: Record<string, string>;
  initialStatus: ExpenseClaimStatus | "all"; initialView: "all" | "mine"; initialId?: string;
}) {
  const router = useRouter(), wide = useMediaQuery("(min-width: 1024px)");
  const [pending, startTransition] = useTransition(), busy = useRef(false);
  const [view, setView] = useState(canManage ? initialView : "mine");
  const [status, setStatus] = useState<ExpenseClaimStatus | "all">(initialStatus);
  const [query, setQuery] = useState(""), [month, setMonth] = useState("");
  const [showWithdrawn, setShowWithdrawn] = useState(false);
  const [activeId, setActiveId] = useState(initialId || ""), [creating, setCreating] = useState(false);
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
  const create = () => { setCreating(true); setActiveId(""); };
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

  return <div className="min-w-0 space-y-4">
    <div className="flex justify-end"><Button type="button" disabled={pending} onClick={create}><Plus className="size-4" />領収書を提出</Button></div>
    <section aria-label="経費精算の集計" className="grid grid-cols-3 gap-2 text-xs text-muted-foreground sm:gap-3">
      {[[`申請中 ${totals.submittedCount}件`, totals.submittedAmount], ["承認済み・未精算", totals.approvedAmount], ["今月の精算済み", totals.paidThisMonth]].map(([label, amount]) =>
        <div key={label} className="min-w-0 rounded-lg border bg-muted/20 px-3 py-2"><div>{label}</div><div className="mt-1 break-all font-mono text-sm font-medium text-foreground">{yen.format(Number(amount))}</div></div>)}
    </section>
    {canManage ? <OptionTabs label="表示" caption="表示" value={view} options={[["all", "全員の申請"], ["mine", "自分の申請"]]} disabled={pending}
      onChange={(value) => { setView(value); close(); }} /> : null}
    <p className="text-xs text-muted-foreground">集計は{view === "all" ? "全員" : "自分"}の全期間の申請です。今月の精算済みは振込日で集計しています。</p>
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
                <td data-card-hide className="text-muted-foreground">{row.categoryName}</td><td data-card-end className="text-right font-mono">{yen.format(row.amount)}</td><td><ExpenseBadge status={row.status} /></td>
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
                : active ? <ExpenseDetail key={`${active.id}:${active.updatedAt}`} row={active} company={company} today={today} projects={projects} categories={categories} actors={actors} wide={wide} canManage={canManage} pending={pending} save={save} run={run} />
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
    {waiting.map((person) => <div key={person.userId} className="flex flex-wrap items-center gap-2 text-sm"><span>{person.name}</span><span className="text-muted-foreground">承認済み {person.approvedCount}件</span><span className="font-mono">{yen.format(person.approvedAmount)}</span>
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

function ExpenseForm({ row, company, today, projects, categories, pending, save }: {
  row?: ExpenseClaimView; company: CompanyScope; today: string; projects: Option[]; categories: Option[]; pending: boolean; save: (data: FormData) => void;
}) {
  const [spentOn, setSpentOn] = useState(row?.spentOn || today), [amount, setAmount] = useState(row ? String(row.amount) : ""), [payee, setPayee] = useState(row?.payee || "");
  const [paidWith, setPaidWith] = useState<ExpensePaidWith>(row?.paidWith || "CASH"), [ocrText, setOcrText] = useState(row?.ocrText || "");
  const [reading, setReading] = useState(false), [ocrRead, setOcrRead] = useState(false), [ocrError, setOcrError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const readReceipt = async (file?: File) => {
    request.current?.abort(); request.current = null;
    setOcrText(""); setOcrRead(false); setOcrError(""); setReading(false);
    if (!file) return;
    const controller = new AbortController(); request.current = controller; setReading(true);
    try {
      const data = new FormData(); data.set("company", company); data.set("file", file);
      const response = await fetch("/api/uploads/expenses/ocr", { method: "POST", body: data, signal: controller.signal });
      const body = await response.json() as { spentOn?: string; amount?: number; payee?: string; ocrText?: string; error?: string };
      if (!response.ok) throw new Error(body.error || "領収書を読み取れませんでした");
      if (controller.signal.aborted) return;
      // Input entered while OCR runs always wins over the draft.
      setSpentOn((current) => current || body.spentOn || "");
      setAmount((current) => current || (typeof body.amount === "number" && body.amount > 0 ? String(body.amount) : ""));
      setPayee((current) => current || body.payee || "");
      setOcrText(body.ocrText || ""); setOcrRead(true);
    } catch (error) {
      if (!controller.signal.aborted) { setOcrError("読み取れませんでした。領収書を確認して手入力で続けられます。"); toast(operationFailureToast(error)); }
    } finally { if (request.current === controller) setReading(false); }
  };
  return <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (!pending && !reading) save(new FormData(event.currentTarget)); }}>
    <input type="hidden" name="company" value={company} /><input type="hidden" name="ocrText" value={ocrText} />
    {row ? <><input type="hidden" name="claimId" value={row.id} /><input type="hidden" name="version" value={row.updatedAt} /></> : null}
    <label className="block space-y-1 text-sm"><span>{row ? "領収書を差し替え（任意）" : "領収書の写真・PDF"}</span>
      <Input name="file" type="file" accept="image/*,application/pdf" capture="environment" required={!row} disabled={pending} className="h-auto py-2" onChange={(event) => { void readReceipt(event.target.files?.[0]); }} />
      <span className="block text-xs text-muted-foreground">PDF・JPEG・PNG、10MB以内</span>
    </label>
    {reading ? <p role="status" className="text-xs text-muted-foreground">領収書を読み取り中…</p> : null}
    {ocrRead ? <p role="status" className="text-xs text-muted-foreground">OCRで読み取った値です。領収書と見比べて直してください。</p> : null}
    {ocrError ? <p role="status" className="text-xs text-muted-foreground">{ocrError}</p> : null}
    <div className="grid grid-cols-2 gap-3">
      <label className="min-w-0 space-y-1 text-sm"><span>支払日</span><Input name="spentOn" type="date" value={spentOn} max={today} required disabled={pending} onChange={(event) => setSpentOn(event.target.value)} /></label>
      <label className="min-w-0 space-y-1 text-sm"><span>金額（円）</span><Input name="amount" type="number" value={amount} min={1} step={1} required disabled={pending} onChange={(event) => setAmount(event.target.value)} /></label>
    </div>
    <label className="block space-y-1 text-sm"><span>支払先</span><Input name="payee" value={payee} maxLength={100} required disabled={pending} onChange={(event) => setPayee(event.target.value)} /></label>
    <label className="block space-y-1 text-sm"><span>用途</span><Input name="purpose" defaultValue={row?.purpose || ""} maxLength={200} required disabled={pending} /></label>
    <label className="block space-y-1 text-sm"><span>勘定科目</span><select name="categoryId" defaultValue={row?.categoryId || ""} className={selectClass} disabled={pending}>
      <option value="">未設定</option>{row?.categoryId && !categories.some((item) => item.value === row.categoryId) ? <option value={row.categoryId} disabled>{row.categoryName}（利用不可）</option> : null}
      {categories.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
    </select></label>
    <label className="block space-y-1 text-sm"><span>案件</span><select name="projectId" defaultValue={row?.projectId || ""} className={selectClass} disabled={pending}>
      <option value="">共通経費（案件なし）</option>{row?.projectId && !projects.some((item) => item.value === row.projectId) ? <option value={row.projectId} disabled>{row.projectName}（利用不可）</option> : null}
      {projects.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
    </select></label>
    <OptionTabs label="立替方法" caption="立替方法" name="paidWith" value={paidWith} options={[["CASH", "現金"], ["PERSONAL_CARD", "個人カード"], ["OTHER", "その他"]]} disabled={pending} onChange={setPaidWith} />
    <label className="block space-y-1 text-sm"><span>メモ</span><Textarea name="memo" defaultValue={row?.memo || ""} maxLength={1000} disabled={pending} /></label>
    <Button type="submit" disabled={pending || reading}>{pending ? "保存中…" : row?.status === "RETURNED" ? "修正して再提出" : row ? "変更を保存" : "領収書を提出"}</Button>
  </form>;
}

function ExpenseDetail({ row, company, today, projects, categories, actors, wide, canManage, pending, save, run }: {
  row: ExpenseClaimView; company: CompanyScope; today: string; projects: Option[]; categories: Option[]; actors: Record<string, string>;
  wide: boolean; canManage: boolean; pending: boolean; save: (data: FormData) => void; run: RunAction;
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
      {[["支払日", formatDate(row.spentOn)], ["金額", yen.format(row.amount)], ["支払先", row.payee], ["用途", row.purpose], ["科目", row.categoryName], ["案件", row.projectName],
        ["立替方法", row.paidWith ? expensePaidWithLabels[row.paidWith] : "未設定"], ["メモ", row.memo || "—"], ["申請者", row.submitterName]].map(([label, value]) =>
        <div key={label} className="contents"><dt className="text-muted-foreground">{label}</dt><dd className={`min-w-0 whitespace-pre-wrap break-words ${label === "金額" ? "font-mono" : ""}`}>{value}</dd></div>)}
      {row.reviewedAt ? <><dt className="text-muted-foreground">確認者</dt><dd>{row.reviewerName} / {dateTime(row.reviewedAt)}</dd></> : null}
      {row.paidAt ? <><dt className="text-muted-foreground">振込日</dt><dd>{formatDate(row.paidAt)}</dd><dt className="text-muted-foreground">精算者</dt><dd>{row.paidByName}</dd><dt className="text-muted-foreground">精算メモ</dt><dd className="whitespace-pre-wrap break-words">{row.paymentMemo || "—"}</dd></> : null}
    </dl>
    {row.status === "RETURNED" ? <div className="space-y-1 rounded-lg border border-rose-200 bg-rose-50/50 p-3 text-sm dark:border-rose-900 dark:bg-rose-950/20"><p className="font-medium">差戻しの理由</p><p className="whitespace-pre-wrap break-words">{row.reviewNote}</p></div> : null}
    {canManage ? <section aria-label="承認と精算" className="space-y-3 border-t pt-4"><div className="flex flex-wrap gap-2">
      {row.status === "SUBMITTED" ? <Button type="button" disabled={pending} onClick={() => run({ action: "approve", ...target }, "申請を承認しました。")}>承認</Button> : null}
      {row.status === "SUBMITTED" || row.status === "APPROVED" ? <Button type="button" variant="outline" disabled={pending} onClick={() => { setReturning(!returning); setPaying(false); }}>差戻し</Button> : null}
      {row.status === "APPROVED" ? <Button type="button" disabled={pending} onClick={() => { setPaying(!paying); setReturning(false); }}>精算済みにする</Button> : null}
      {row.status === "PAID" ? <Button type="button" variant="outline" disabled={pending} onClick={() => run({ action: "unpay", ...target }, "精算を取り消しました。")}>精算を取り消す</Button> : null}
    </div>
      {returning ? <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); run({ action: "return", ...target, note: String(data.get("note") || "") }, "申請を差し戻しました。", () => setReturning(false)); }}>
        <label className="block space-y-1 text-sm"><span>差戻しの理由</span><Textarea name="note" required maxLength={500} disabled={pending} /></label><Button type="submit" disabled={pending}>理由を添えて差し戻す</Button>
      </form> : null}
      {paying ? <PaymentForm today={today} pending={pending} onCancel={() => setPaying(false)} onSubmit={(paidAt, memo) => run({ action: "pay", items: [target], paidAt, memo }, "精算済みにしました。", () => setPaying(false))} /> : null}
    </section> : null}
    {row.editable ? <section className="space-y-3 border-t pt-4"><h3 className="text-sm font-medium">申請を編集</h3>
      <ExpenseForm row={row} company={company} today={today} projects={projects} categories={categories} pending={pending} save={save} />
      <Button type="button" variant="outline" disabled={pending} onClick={() => { if (window.confirm("この申請を取り下げますか？")) run({ action: "withdraw", ...target }, "申請を取り下げました。"); }}>取り下げ</Button>
    </section> : null}
    <section className="space-y-3 border-t pt-4"><h3 className="text-sm font-medium">履歴</h3><ol className="space-y-3 text-xs text-muted-foreground">{row.history.slice().reverse().map((entry, index) =>
      <li key={`${entry.at}:${index}`} className="space-y-1"><p><time dateTime={entry.at}>{dateTime(entry.at)}</time> ・ {actors[entry.byId] || entry.byId} ・ {expenseActionLabels[entry.action]}</p>{entry.note ? <p className="whitespace-pre-wrap break-words">{entry.note}</p> : null}</li>)}
    </ol></section>
  </div>;
}
