"use client";

import { useEffect, useRef, useState, useTransition, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, CircleAlert, Folder, LoaderCircle, RefreshCw, Save, Search, Settings2, WandSparkles, X } from "lucide-react";
import { applyBankRulesAction, saveBankEditsAction, setBankAutoSyncAction } from "@/app/banking/actions";
import { BankingSettings, BankCategoryFields, bankSelectClass } from "@/components/app/banking-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { BANK_PAGE_SIZE, bankToday, treatmentLabels } from "@/lib/banking";
import type { AccountingCategory, BankAccount, BankEdit, BankFilters, BankRule, BankSyncState, BankTransaction } from "@/lib/banking-types";
import type { CompanyScope } from "@/lib/company";

const money = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 });
const monthName = (value: string) => value ? `${value.slice(0, 4)}年${Number(value.slice(5, 7))}月` : "すべての月";
const editFrom = (row: BankTransaction): BankEdit => ({ id: row.id, updatedAt: row.updatedAt, categoryId: row.categoryId, subCategoryId: row.subCategoryId, treatment: row.treatment, reviewed: row.reviewed, memo: row.memo });

type Props = {
  company: CompanyScope; rows: BankTransaction[]; accounts: BankAccount[]; categories: AccountingCategory[]; rules: BankRule[];
  filters: BankFilters; total: number; page: number; months: string[];
  summary: { income: number; expense: number; excluded: number; unclassified: number };
  configured: boolean; sync?: BankSyncState; busy: boolean; admin: boolean;
};

export function BankingWorkspace(props: Props) {
  const { company, rows, accounts, categories, rules, filters, total, page, months, summary, configured, admin } = props;
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, BankEdit>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const [search, setSearch] = useState(filters.query);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const [settings, setSettings] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [classifyOpen, setClassifyOpen] = useState(false);
  const [classifyScope, setClassifyScope] = useState<"page" | "selected" | "all">("page");
  const [leaveUrl, setLeaveUrl] = useState<string | null>(null);
  const [sync, setSync] = useState(props.sync);
  const [syncing, setSyncing] = useState(props.busy);
  const [mode, setMode] = useState<"recent" | "all" | "range">("recent");
  const [start, setStart] = useState(`${bankToday().slice(0, 7)}-01`);
  const [end, setEnd] = useState(bankToday());
  const dirty = Object.keys(drafts).length;
  const syncWasRunning = useRef(props.busy);
  const accountMap = new Map(accounts.map((row) => [row.id, row.name]));

  useEffect(() => {
    if (!dirty) return;
    const leave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const followLink = (event: globalThis.MouseEvent) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      const url = new URL(link.href);
      if (url.origin !== window.location.origin || url.href === window.location.href) return;
      event.preventDefault(); event.stopPropagation();
      if (!pending) setLeaveUrl(url.pathname + url.search + url.hash);
    };
    window.addEventListener("beforeunload", leave);
    document.addEventListener("click", followLink, true);
    return () => { window.removeEventListener("beforeunload", leave); document.removeEventListener("click", followLink, true); };
  }, [dirty, pending]);

  useEffect(() => {
    if (!configured) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch(`/api/banking/sync?company=${company}`, { cache: "no-store" });
        if (!response.ok) return;
        const result = await response.json() as { state?: BankSyncState; busy: boolean };
        if (disposed) return;
        setSync(result.state); setSyncing(Boolean(result.busy));
        if (syncWasRunning.current && !result.busy) {
          if (!dirty) router.refresh();
          toast({ title: result.state?.status === "SUCCESS" ? "明細の同期が完了しました" : result.state?.error || "同期を確認してください", variant: result.state?.status === "SUCCESS" ? "success" : "destructive" });
        }
        syncWasRunning.current = Boolean(result.busy);
      } catch { /* Keep saved rows visible during transient network failures. */ }
      finally { if (!disposed) timer = setTimeout(poll, 5000); }
    };
    timer = setTimeout(poll, 3000);
    return () => { disposed = true; clearTimeout(timer); };
  }, [company, configured, dirty, router]);

  function navigate(values: Record<string, string>) {
    if (pending) return;
    const keepAnalysis = !["month", "account", "side", "status"].some((key) => key in values);
    const params = new URLSearchParams({ company, month: filters.month, account: filters.account, category: filters.category, side: filters.side, status: filters.status, q: filters.query, sort: filters.sort, analysisThrough: keepAnalysis ? filters.analysisThrough || "" : "", page: "1", ...values });
    for (const [key, value] of Array.from(params.entries())) if (!value) params.delete(key);
    const destination = `/banking?${params}`;
    if (dirty) { setLeaveUrl(destination); return; }
    setSelected(new Set()); startTransition(() => router.push(destination));
  }
  function edit(row: BankTransaction, patch: Partial<BankEdit>) {
    setDrafts((current) => ({ ...current, [row.id]: { ...(current[row.id] || editFrom(row)), ...patch } }));
  }
  function bulk(patch: Partial<BankEdit>) {
    setDrafts((current) => {
      const next = { ...current };
      for (const row of rows) if (selected.has(row.id)) next[row.id] = { ...(next[row.id] || editFrom(row)), ...patch };
      return next;
    });
  }
  function choose(row: BankTransaction, event: MouseEvent<HTMLInputElement>) {
    const checked = event.currentTarget.checked;
    const from = rows.findIndex((item) => item.id === anchor.current), to = rows.findIndex((item) => item.id === row.id);
    const targets = event.shiftKey && from >= 0 ? rows.slice(Math.min(from, to), Math.max(from, to) + 1) : [row];
    setSelected((old) => { const next = new Set(old); for (const target of targets) { if (checked) next.add(target.id); else next.delete(target.id); } return next; });
    anchor.current = row.id;
  }
  function save(destination?: string) {
    setError(""); startTransition(async () => {
      try {
        const result = await saveBankEditsAction(company, Object.values(drafts));
        if (!result.success) { setError(result.error || "保存できませんでした"); return; }
        setDrafts({}); setLeaveUrl(null);
        if (destination) router.push(destination); else router.refresh();
        toast({ title: `${result.count}件を保存しました`, variant: "success" });
      } catch { setError("通信に失敗しました。変更内容は保持されています"); }
    });
  }
  function reclassify() {
    setError(""); startTransition(async () => {
      try {
        const ids = classifyScope === "all" ? undefined : rows.filter((row) => classifyScope === "page" || selected.has(row.id)).map((row) => row.id);
        const result = await applyBankRulesAction(company, ids);
        if (!result.success) { setError(result.error || "分類できませんでした"); return; }
        setClassifyOpen(false); router.refresh();
        toast({ title: `${result.count}件を更新しました（未分類 ${result.unclassified}件）`, variant: "success" });
      } catch { setError("通信に失敗しました"); }
    });
  }
  async function beginSync() {
    setError(""); setSyncing(true);
    try {
      const response = await fetch(`/api/banking/sync?company=${company}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, ...(mode === "range" ? { start, end } : {}) }) });
      const result = await response.json();
      if (!response.ok) { setError(result.error || "同期を開始できませんでした"); setSyncing(false); return; }
      syncWasRunning.current = true; setSyncOpen(false);
    } catch { setError("同期の応答を確認できません。接続状況を確認してください"); setSyncing(false); }
  }
  function selectionBox(row: BankTransaction) {
    return <label className="flex size-11 shrink-0 cursor-pointer items-center justify-center"><input aria-label={`${row.transactionDate} ${row.content}を選択`} type="checkbox" className="size-5 accent-primary" checked={selected.has(row.id)} disabled={pending} onChange={() => undefined} onClick={(event) => choose(row, event)} /></label>;
  }
  function status(row: BankTransaction, value: BankEdit) {
    return <span className={`inline-flex items-center gap-1 text-xs ${row.sourceMissing ? "text-destructive" : value.reviewed ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}>
      {row.sourceMissing ? <CircleAlert className="size-3.5" /> : null}{row.sourceMissing ? "元明細なし" : value.reviewed ? "確認済み" : !value.categoryId && value.treatment === "NORMAL" ? "未分類" : "未確認"}
      {drafts[row.id] ? "・未保存" : row.classificationSource === "RULE" ? "・ルール" : row.classificationSource === "HISTORY" ? "・過去明細から分類" : row.classificationSource === "AUTO" ? "・自動分類" : row.classificationSource === "MANUAL" ? "・手動" : ""}
    </span>;
  }
  function fields(row: BankTransaction, value: BankEdit) {
    return [
      <BankCategoryFields key="category" categories={categories} categoryId={value.categoryId} subCategoryId={value.subCategoryId} label={`${row.content}の`} disabled={pending} onChange={(categoryId, subCategoryId) => edit(row, { categoryId: categoryId || undefined, subCategoryId: subCategoryId || undefined, reviewed: false })} />,
      <select key="treatment" className={bankSelectClass} aria-label={`${row.content}の扱い`} value={value.treatment} disabled={pending} onChange={(e) => edit(row, { treatment: e.target.value as BankEdit["treatment"], reviewed: false })}>{Object.entries(treatmentLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>,
      <Input key="memo" className="h-11" aria-label={`${row.content}のメモ`} placeholder="メモ" value={value.memo} disabled={pending} maxLength={2000} onChange={(e) => edit(row, { memo: e.target.value })} />,
    ];
  }
  const totalPages = Math.max(1, Math.ceil(total / BANK_PAGE_SIZE));

  return <div className="min-w-0 space-y-4">
    <header className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
      <div className="min-w-0"><h1 className="break-words text-xl font-semibold">口座・カード明細</h1><div className="mt-1 text-sm text-muted-foreground">{company === "JAPAN" ? "日本本社" : "中国支社"}{sync?.officeName ? ` / ${sync.officeName}` : ""}</div></div>
      <div className="flex flex-wrap gap-2">
        <Button className="min-h-11" variant="outline" disabled={pending || Boolean(dirty)} onClick={() => setSettings(true)}><Settings2 className="size-4" />科目・ルール</Button>
        <Button className="min-h-11" variant="outline" disabled={!configured || syncing || pending || Boolean(dirty)} onClick={() => setSyncOpen(true)}>{syncing ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}同期</Button>
        <Button className="min-h-11" disabled={!dirty || pending} onClick={() => save()}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}すべて保存{dirty ? ` (${dirty})` : ""}</Button>
      </div>
    </header>
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <div role="status" className="min-w-0 break-words">{!configured ? "Money Forward 未接続（連携キー・事業者番号が未設定）" : syncing ? `同期中${sync?.completedThrough ? ` / ${sync.completedThrough}まで取得済み` : ""}` : sync?.lastSuccessAt ? `最終同期 ${new Date(sync.lastSuccessAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}` : "Money Forward 接続設定済み・初回同期前"}</div>
      <label className="flex min-h-11 items-center gap-2"><input type="checkbox" className="size-5 accent-primary" checked={Boolean(sync?.autoSync)} disabled={!configured || !admin || pending} onChange={(e) => {
        const enabled = e.target.checked;
        startTransition(async () => {
          try {
            const result = await setBankAutoSyncAction(company, enabled);
            if (!result.success) { setError(result.error || "設定できませんでした"); return; }
            const response = await fetch(`/api/banking/sync?company=${company}`, { cache: "no-store" });
            if (response.ok) setSync((await response.json()).state);
            router.refresh();
          } catch { setError("設定を確認できませんでした"); }
        });
      }} />自動同期（6時間ごと）</label>
    </div>
    {error || sync?.error ? <div role="alert" className="flex items-start gap-2 border-l-2 border-destructive bg-destructive/5 p-3 text-sm"><CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" /><span className="min-w-0 break-words">{error || sync?.error}</span>{error ? <Button size="icon" variant="ghost" className="ml-auto size-11 shrink-0" aria-label="エラーを閉じる" title="閉じる" onClick={() => setError("")}><X className="size-4" /></Button> : null}</div> : null}
    <div className="grid min-w-0 gap-4 xl:grid-cols-[168px_minmax(0,1fr)]">
      <aside className="hidden border-r pr-3 xl:block">
        <h2 className="mb-2 text-sm font-medium">取引月</h2>
        <nav aria-label="取引月" className="max-h-[65vh] space-y-1 overflow-y-auto">
          {["", ...months].map((month) => <button key={month} className={`flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm ${filters.month === month ? "bg-primary/10 font-medium text-primary" : "hover:bg-muted"}`} aria-current={filters.month === month ? "page" : undefined} onClick={() => navigate({ month })}><Folder className="size-4 shrink-0" /><span>{monthName(month)}</span></button>)}
        </nav>
      </aside>
      <section className="min-w-0 space-y-3">
        {filters.analysisThrough ? <div className="flex flex-wrap items-center justify-between gap-2 border-l-2 border-primary bg-primary/5 p-2 text-sm"><span>出金分析の対象明細（{filters.analysisThrough}まで）</span><Button className="min-h-11" variant="ghost" disabled={pending} onClick={() => navigate({ analysisThrough: "" })}><X className="size-4" />分析条件を解除</Button></div> : null}
        {filters.transaction ? <div className="flex flex-wrap items-center justify-between gap-2 border-l-2 border-primary bg-primary/5 p-2 text-sm"><span>指定された明細を表示中</span><Button className="min-h-11" variant="ghost" disabled={pending} onClick={() => navigate({ transaction: "" })}><X className="size-4" />指定を解除</Button></div> : null}
        <div className="flex flex-wrap items-center gap-3 border-b pb-3"><h2 className="text-base font-semibold">{monthName(filters.month)}</h2><span className="text-sm text-muted-foreground">{total.toLocaleString()}件</span></div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border-b pb-3 text-sm md:grid-cols-4">
          <div className="min-w-0"><dt className="text-xs text-muted-foreground">入金・返金</dt><dd className="break-all font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{money.format(summary.income)}</dd></div>
          <div className="min-w-0"><dt className="text-xs text-muted-foreground">出金・利用</dt><dd className="break-all font-semibold tabular-nums">{money.format(summary.expense)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">未分類</dt><dd className="font-semibold text-amber-700 dark:text-amber-400">{summary.unclassified}件</dd></div>
          <div><dt className="text-xs text-muted-foreground">集計対象外</dt><dd className="font-semibold">{summary.excluded}件</dd></div>
        </dl>
        <div className="grid min-w-0 grid-cols-2 gap-2 md:grid-cols-3 2xl:grid-cols-5">
          <select className={`${bankSelectClass} xl:hidden`} aria-label="取引月" value={filters.month} disabled={pending} onChange={(e) => navigate({ month: e.target.value })}><option value="">すべての月</option>{months.map((month) => <option key={month} value={month}>{monthName(month)}</option>)}</select>
          <select className={bankSelectClass} aria-label="口座で絞り込み" value={filters.account} disabled={pending} onChange={(e) => navigate({ account: e.target.value })}><option value="">すべての口座・カード</option>{accounts.map((row) => <option key={row.id} value={row.id}>{row.name}{!row.available ? "（連携終了）" : ""}</option>)}</select>
          <select className={bankSelectClass} aria-label="勘定科目で絞り込み" value={filters.category} disabled={pending} onChange={(e) => navigate({ category: e.target.value })}><option value="">すべての勘定科目</option>{categories.filter((row) => !row.deletedAt && !row.parentId).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
          <select className={bankSelectClass} aria-label="入出金で絞り込み" value={filters.side} disabled={pending} onChange={(e) => navigate({ side: e.target.value })}><option value="">入金・出金すべて</option><option value="INCOME">入金・返金</option><option value="EXPENSE">出金・利用</option></select>
          <select className={bankSelectClass} aria-label="分類状態で絞り込み" value={filters.status} disabled={pending} onChange={(e) => navigate({ status: e.target.value })}><option value="">すべての状態</option><option value="unclassified">未分類</option><option value="unreviewed">未確認</option><option value="reviewed">確認済み</option><option value="transfer">振替・カード精算</option><option value="excluded">対象外</option><option value="missing">元明細なし</option></select>
          <select className={bankSelectClass} aria-label="並び順" value={filters.sort} disabled={pending} onChange={(e) => navigate({ sort: e.target.value })}><option value="date-desc">取引日が新しい順</option><option value="date-asc">取引日が古い順</option><option value="amount-desc">金額が大きい順</option><option value="amount-asc">金額が小さい順</option></select>
        </div>
        <form className="flex min-w-0 flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); navigate({ q: search }); }}><Input className="h-11 min-w-0 basis-48 flex-1" aria-label="摘要・メモを検索" placeholder="摘要・メモを検索" value={search} maxLength={200} onChange={(e) => setSearch(e.target.value)} /><Button type="submit" variant="outline" size="icon" className="size-11 shrink-0" aria-label="検索" title="検索" disabled={pending}><Search className="size-4" /></Button>
          {filters.month || filters.account || filters.category || filters.side || filters.status || filters.query || filters.analysisThrough || filters.transaction ? <Button type="button" className="min-h-11 lg:min-h-11" variant="ghost" disabled={pending} onClick={() => navigate({ month: "", account: "", category: "", side: "", status: "", q: "", analysisThrough: "", transaction: "" })}><X className="size-4" />絞り込みを解除</Button> : null}
        </form>
        <div className="flex flex-wrap items-center gap-2 border-y py-2">
          <label className="flex min-h-11 cursor-pointer items-center gap-2 px-1 text-sm"><input type="checkbox" className="size-5 accent-primary" aria-label="表示中の明細をすべて選択" checked={Boolean(rows.length) && rows.every((row) => selected.has(row.id))} disabled={pending || !rows.length} onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((row) => row.id)) : new Set())} />表示中を選択</label>
          <span className="text-sm text-muted-foreground">{selected.size}件選択</span>
          <Button type="button" className="ml-auto min-h-11" variant="outline" disabled={pending || Boolean(dirty) || !months.length} onClick={() => { setClassifyScope(selected.size ? "selected" : rows.length ? "page" : "all"); setError(""); setClassifyOpen(true); }}><WandSparkles className="size-4" />自動分類</Button>
        </div>
        {selected.size ? <div className="grid min-w-0 gap-2 bg-muted/40 p-2 sm:grid-cols-3">
          <select className={bankSelectClass} aria-label="選択明細の勘定科目を一括変更" value="" disabled={pending} onChange={(e) => bulk({ categoryId: e.target.value === "__clear" ? undefined : e.target.value, subCategoryId: undefined, reviewed: false })}><option value="" disabled>勘定科目を一括変更</option><option value="__clear">未分類に戻す</option>{categories.filter((row) => !row.parentId && row.available && !row.deletedAt).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
          <select className={bankSelectClass} aria-label="選択明細の扱いを一括変更" value="" disabled={pending} onChange={(e) => bulk({ treatment: e.target.value as BankEdit["treatment"], reviewed: false })}><option value="" disabled>扱いを一括変更</option>{Object.entries(treatmentLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
          <select className={bankSelectClass} aria-label="選択明細の確認状態を一括変更" value="" disabled={pending} onChange={(e) => bulk({ reviewed: e.target.value === "yes" })}><option value="" disabled>確認状態を一括変更</option><option value="yes">確認済み</option><option value="no">未確認</option></select>
        </div> : null}
        <div className="hidden max-w-full overflow-x-auto md:block">
          <table className="w-full min-w-[1030px] table-fixed text-sm">
            <colgroup><col className="w-11" /><col className="w-[102px]" /><col className="w-[190px]" /><col className="w-[120px]" /><col className="w-[120px]" /><col className="w-[172px]" /><col className="w-[176px]" /><col className="w-[154px]" /><col className="w-[72px]" /></colgroup>
            <thead className="border-b text-xs text-muted-foreground"><tr>{["", "取引日", "摘要・状態", "口座・カード", "金額", "勘定科目 / 補助", "扱い", "メモ", "確認済み"].map((title, i) => <th key={i} scope="col" className="px-2 py-3 text-left font-medium">{title}</th>)}</tr></thead>
            <tbody>{rows.map((row) => {
              const value = drafts[row.id] || editFrom(row);
              const controls = fields(row, value);
              return <tr key={row.id} className={`border-b align-top ${selected.has(row.id) ? "bg-primary/5" : "hover:bg-muted/30"}`}>
                <td>{selectionBox(row)}</td><td className="px-2 py-3 text-xs tabular-nums">{row.transactionDate}</td>
                <td className="break-words px-2 py-3"><div>{row.content || "摘要なし"}</div><div className="mt-1">{status(row, value)}</div>{!drafts[row.id] && row.classificationReason ? <div className="mt-1 text-xs text-muted-foreground">{row.classificationReason}</div> : null}{row.sourceMemo ? <div className="mt-1 text-xs text-muted-foreground">{row.sourceMemo}</div> : null}</td>
                <td className="break-words px-2 py-3 text-xs text-muted-foreground">{accountMap.get(row.bankAccountId) || "口座未取得"}</td>
                <td className={`px-2 py-3 text-right tabular-nums ${row.side === "INCOME" ? "text-emerald-700 dark:text-emerald-400" : ""}`}><span className="whitespace-nowrap">{row.side === "INCOME" ? "+" : "-"}{money.format(row.amount)}</span></td>
                <td className="px-1 py-2">{controls[0]}</td><td className="px-1 py-2">{controls[1]}</td><td className="px-1 py-2">{controls[2]}</td>
                <td><label className="flex min-h-11 cursor-pointer justify-center py-3"><input type="checkbox" className="size-5 accent-primary" aria-label={`${row.content}を確認済みにする`} checked={value.reviewed} disabled={pending || row.sourceMissing} onChange={(e) => edit(row, { reviewed: e.target.checked })} /></label></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        <div className="divide-y md:hidden">{rows.map((row) => { const value = drafts[row.id] || editFrom(row); return <article key={row.id} className={`min-w-0 space-y-2 py-3 ${selected.has(row.id) ? "bg-primary/5" : ""}`}>
          <div className="flex min-w-0 items-start gap-1">{selectionBox(row)}<div className="min-w-0 flex-1"><div className="flex flex-wrap justify-between gap-1"><time className="text-xs">{row.transactionDate}</time><span className={`break-all text-sm font-medium tabular-nums ${row.side === "INCOME" ? "text-emerald-700 dark:text-emerald-400" : ""}`}>{row.side === "INCOME" ? "+" : "-"}{money.format(row.amount)}</span></div><h3 className="mt-1 break-words text-sm font-medium">{row.content || "摘要なし"}</h3><div className="break-words text-xs text-muted-foreground">{accountMap.get(row.bankAccountId)}</div>{status(row, value)}</div></div>
          {row.sourceMemo ? <div className="break-words text-xs text-muted-foreground">{row.sourceMemo}</div> : null}
          {!drafts[row.id] && row.classificationReason ? <div className="break-words text-xs text-muted-foreground">{row.classificationReason}</div> : null}
          <div className="grid min-w-0 gap-2">{fields(row, value)}</div>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-5 accent-primary" aria-label={`${row.content}を確認済みにする`} checked={value.reviewed} disabled={pending || row.sourceMissing} onChange={(e) => edit(row, { reviewed: e.target.checked })} />確認済み</label>
        </article>; })}</div>
        {!rows.length ? <p className="border-b py-12 text-center text-sm text-muted-foreground">{!configured ? "接続待ち" : "該当する明細はありません"}</p> : null}
        <footer className="flex flex-wrap items-center justify-between gap-2 text-sm"><span className="text-muted-foreground">{total ? (page - 1) * BANK_PAGE_SIZE + 1 : 0}〜{Math.min(page * BANK_PAGE_SIZE, total)} / {total}件</span><div className="flex items-center gap-2"><Button variant="outline" size="icon" className="size-11" aria-label="前のページ" title="前のページ" disabled={page <= 1 || pending} onClick={() => navigate({ page: String(page - 1) })}><ChevronLeft className="size-4" /></Button><span>{page} / {totalPages}</span><Button variant="outline" size="icon" className="size-11" aria-label="次のページ" title="次のページ" disabled={page >= totalPages || pending} onClick={() => navigate({ page: String(page + 1) })}><ChevronRight className="size-4" /></Button></div></footer>
      </section>
    </div>
    {dirty ? <div className="sticky bottom-20 z-10 flex flex-wrap items-center justify-between gap-2 border bg-background px-3 py-2 shadow-sm lg:bottom-2"><span className="text-sm">未保存 {dirty}件</span><Button className="min-h-11" disabled={pending} onClick={() => save()}><Save className="size-4" />すべて保存</Button></div> : null}
    <Dialog open={Boolean(leaveUrl)} onOpenChange={(open) => { if (!open && !pending) setLeaveUrl(null); }}>
      <DialogContent showCloseButton={!pending} onInteractOutside={(event) => event.preventDefault()} onEscapeKeyDown={(event) => event.preventDefault()}>
        <DialogHeader><DialogTitle>未保存の変更があります</DialogTitle><DialogDescription>{dirty}件の編集内容が未保存です。</DialogDescription></DialogHeader>
        {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button className="min-h-11" variant="outline" disabled={pending} onClick={() => setLeaveUrl(null)}>キャンセル</Button>
          <Button className="min-h-11" variant="ghost" disabled={pending} onClick={() => { const destination = leaveUrl; setDrafts({}); setSelected(new Set()); setLeaveUrl(null); if (destination) startTransition(() => router.push(destination)); }}>破棄して移動</Button>
          <Button className="min-h-11" disabled={pending} onClick={() => save(leaveUrl || undefined)}><Save className="size-4" />保存して移動</Button>
        </div>
      </DialogContent>
    </Dialog>
    <BankingSettings key={settings ? "open" : "closed"} company={company} accounts={accounts} categories={categories} rules={rules} open={settings} onOpenChange={setSettings} />
    <Dialog open={classifyOpen} onOpenChange={(value) => { if (!pending) setClassifyOpen(value); }}>
      <DialogContent showCloseButton={!pending} onInteractOutside={(event) => event.preventDefault()} onEscapeKeyDown={(event) => event.preventDefault()}>
        <DialogHeader><DialogTitle>勘定科目の自動分類</DialogTitle><DialogDescription>手動変更・確認済みの明細は対象外です。分類結果は未確認で保存されます。</DialogDescription></DialogHeader>
        <label className="grid min-w-0 gap-1 text-sm">対象<select aria-label="自動分類の対象" className={bankSelectClass} value={classifyScope} disabled={pending} onChange={(event) => setClassifyScope(event.target.value as typeof classifyScope)}>
          {selected.size ? <option value="selected">選択した明細（{selected.size}件）</option> : null}
          {rows.length ? <option value="page">表示中のページ（{rows.length}件）</option> : null}
          <option value="all">{company === "JAPAN" ? "日本" : "中国"}の全期間・全口座</option>
        </select></label>
        {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
        <Button className="min-h-11" disabled={pending} onClick={reclassify}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <WandSparkles className="size-4" />}自動分類して保存</Button>
      </DialogContent>
    </Dialog>
    <Dialog open={syncOpen} onOpenChange={(value) => { if (!syncing) setSyncOpen(value); }}>
      <DialogContent aria-describedby={undefined} showCloseButton={!syncing} onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogHeader><DialogTitle>Money Forward 明細同期</DialogTitle></DialogHeader>
        <label className="grid min-w-0 gap-1 text-sm">取得範囲<select className={bankSelectClass} value={mode} disabled={syncing} onChange={(e) => setMode(e.target.value as typeof mode)}><option value="recent">通常同期（初回は全期間）</option><option value="all">取得可能な全期間を再同期</option><option value="range">期間指定</option></select></label>
        {mode === "range" ? <div className="grid min-w-0 gap-3"><label className="grid min-w-0 gap-1 text-sm">開始日<Input type="date" className="h-11 min-w-0" value={start} max={end} disabled={syncing} onChange={(e) => setStart(e.target.value)} /></label><label className="grid min-w-0 gap-1 text-sm">終了日<Input type="date" className="h-11 min-w-0" value={end} min={start} max={bankToday()} disabled={syncing} onChange={(e) => setEnd(e.target.value)} /></label></div> : null}
        {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
        <Button className="min-h-11" disabled={syncing || !configured} onClick={beginSync}>{syncing ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}すべての口座・カードを同期</Button>
      </DialogContent>
    </Dialog>
  </div>;
}
