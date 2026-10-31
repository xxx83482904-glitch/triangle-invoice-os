"use client";
import { SectionExportDialog } from "@/components/app/section-export-dialog";

import type { BankAccountOption } from "@/lib/bank-account-options";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useListSelection } from "@/hooks/use-list-selection";
import { RowSelectionCheckbox, SelectAllCheckbox } from "@/components/app/list-selection";
import { useRouter } from "next/navigation";
import { Bot, CheckCheck, CircleAlert, FileCheck2, History, ListTree, LoaderCircle, MessageSquareText, Pencil, RefreshCw, Save, Search, Settings2, ShieldCheck, WandSparkles, X } from "lucide-react";
import { WorkflowNav } from "@/components/app/company-switch";
import { BankFiscalMonthTabs, BankReviewTag, BankSelectionReview } from "@/components/app/bank-ledger-controls";
import { bankSelectionAmount, reviewBankDrafts } from "@/lib/bank-ledger";
import Link from "next/link";
import { BankBalanceSummary, type BankBalanceSummaryProps } from "@/components/app/bank-balance-summary";
import { loadBankLinksAction } from "@/app/banking/link-actions";
import { BankLinksDialog, type BankLinkData } from "@/components/app/bank-links-dialog";
import { loadBankDraftRowsAction, loadBankTransactionsAction, previewBankRulesAction, saveBankEditsAction, setBankAutoSyncAction } from "@/app/banking/actions";
import { BankAuditDialog } from "@/components/app/bank-audit-dialog";
import { BankSyncRunsDialog } from "@/components/app/bank-sync-runs-dialog";
import { BankBookkeepingDialog } from "@/components/app/bank-bookkeeping-dialog";
import { BankSavePreviewDialog, type BankSavePreview } from "@/components/app/bank-save-preview";
import { bankEditFrom, bankMatchingSelection, bankSaveChanges, bankSaveIds, patchBankDraft, removeSavedBankDrafts, type BankDrafts, type BankSaveScope } from "@/lib/bank-workspace-drafts";
import { bankSearchHighlights } from "@/lib/bank-search-highlight";
import { BankLoadGuard, bankWorkspaceRevision, mergeBankWorkspaceRows } from "@/lib/bank-workspace-loading";
import { BankingSettings, bankSelectClass } from "@/components/app/banking-settings";
import { BankCategoryPicker } from "@/components/app/bank-category-picker";
import { applyBankCategoryDrafts, bankCategoryCatalog, bankCategorySection } from "@/lib/bank-category-catalog";
import { BankAiSettings } from "@/components/app/bank-ai-settings";
import { BankClassificationAiDialog } from "@/components/app/bank-classification-ai-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/hooks/use-toast";
import { BANK_PAGE_SIZE, bankToday, treatmentLabels, type BankDisplayRow } from "@/lib/banking";
import { BankClassificationBadge } from "@/components/app/bank-classification-badge";
import { BankGuessReviewDialog } from "@/components/app/bank-guess-review-dialog";
import { isGuessClassification } from "@/lib/bank-classification";
import type { AccountingCategory, BankAccount, BankEdit, BankFilters, BankRule, BankSyncState, BankTransaction } from "@/lib/banking-types";
import type { CompanyScope } from "@/lib/company";
import type { UserRole } from "@/lib/types";

const money = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 });
const monthName = (value: string) => value ? `${value.slice(0, 4)}年${Number(value.slice(5, 7))}月` : "すべての月";
const editFrom = bankEditFrom;
const manualClassification = { classificationSource: "MANUAL" as const, classificationConfidence: "INFERRED" as const, classificationReason: "手動選択（未確定）" };

type Props = {
  role: UserRole;
  company: CompanyScope; rows: BankDisplayRow[]; accounts: BankAccount[]; accountOptions: BankAccountOption[]; selectedAccountOption: string; categories: AccountingCategory[]; rules: BankRule[];
  filters: BankFilters; total: number; page: number; months: string[]; revision: string;
  summary: { income: number; expense: number; excluded: number; unclassified: number };
  configured: boolean; sync?: BankSyncState; busy: boolean; admin: boolean;
  selectedBalance?: BankBalanceSummaryProps["row"] & { id: string; name: string };
  aiSettings?: { configured: boolean; model: string; keyFromEnv: boolean; modelFromEnv: boolean };
  syncImpact?: { pending: number };
};

export function BankingWorkspace(props: Props) {
  const { company, accounts, categories, rules, filters, months, summary, configured, admin } = props;
  const router = useRouter();
  const [drafts, setDrafts] = useState<BankDrafts>({});
  const [search, setSearch] = useState(filters.query);
  const [filterEdits, setFilterEdits] = useState<Record<string, string>>({ queryMode: filters.queryMode || "contains", excludeQuery: filters.excludeQuery || "" });
  const [savePreview, setSavePreview] = useState<BankSavePreview | null>(null);
  const [guessReview, setGuessReview] = useState<{ guesses: BankTransaction[]; others: number } | null>(null);
  const [saveResult, setSaveResult] = useState<{ saved: number; remaining: number; uncertain: boolean } | null>(null);
  const [savedRows, setSavedRows] = useState<Record<string, BankDisplayRow>>({});
  const [matchingSnapshot, setMatchingSnapshot] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const [settings, setSettings] = useState(false);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const categoryRail = useRef<HTMLElement>(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const [classifyOpen, setClassifyOpen] = useState(false);
  const [classifyScope, setClassifyScope] = useState<"page" | "selected" | "all">("all");
  const [classificationEmpty, setClassificationEmpty] = useState<number | null>(null);
  const [classificationPreview, setClassificationPreview] = useState<BankTransaction[] | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiHistory, setAiHistory] = useState(false);
  const [linkData, setLinkData] = useState<BankLinkData | null>(null);
  const [aiScope, setAiScope] = useState<"page" | "selected" | "all">("page");
  const [aiResult, setAiResult] = useState<{ suggested: number; lowConfidence: number; model: string } | null>(null);
  const [stream, setStream] = useState({ revision: props.revision, baseRevision: props.revision, rows: [] as BankDisplayRow[], page: props.page, total: props.total });
  const activeStream = stream;
  const effectiveRevision = bankWorkspaceRevision(props.revision, stream);
  const loadedPage = activeStream.page;
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [loadStale, setLoadStale] = useState(false);
  const loadGuard = useRef(new BankLoadGuard());
  const sentinel = useRef<HTMLDivElement>(null);
  const [savedCount, setSavedCount] = useState(0);
  const [leaveUrl, setLeaveUrl] = useState<string | null>(null);
  const [sync, setSync] = useState(props.sync);
  const [syncing, setSyncing] = useState(props.busy);
  const [mode, setMode] = useState<"recent" | "all" | "range">("recent");
  const [start, setStart] = useState(`${bankToday().slice(0, 7)}-01`);
  const [end, setEnd] = useState(bankToday());
  const dirty = Object.keys(drafts).length;
  const total = classificationPreview?.length ?? activeStream.total;
  const baseRows = classificationPreview ? classificationPreview as BankDisplayRow[] : mergeBankWorkspaceRows(props.rows, activeStream.rows);
  const rows = mergeBankWorkspaceRows(baseRows, baseRows.flatMap((row) => savedRows[row.id] ? [savedRows[row.id]] : []));
  if (!classificationPreview) rows.sort((a, b) => (filters.sort.endsWith("asc") ? 1 : -1) * (filters.sort.startsWith("amount") ? a.amount - b.amount : a.transactionDate.localeCompare(b.transactionDate)) || a.id.localeCompare(b.id));
  const filterDirty = search !== filters.query || Object.entries(filterEdits).some(([key, value]) => value !== String(filters[key as keyof BankFilters] ?? (key === "queryMode" ? "contains" : "")));
  const listSelection = useListSelection(rows.map((row) => row.id), { disabled: pending || filterDirty });
  const selection = { ...listSelection, selectAll: (checked: boolean) => {
    if (pending || filterDirty) return;
    listSelection.setSelected((current) => checked
      ? new Set([...current, ...bankMatchingSelection(rows, current)])
      : new Set());
  } };
  const { selected, setSelected } = selection;
  const categoryTargets = rows.filter((row) => selected.has(row.id)).map((row) => ({ ...row, ...drafts[row.id] }));
  const reviewedCount = categoryTargets.filter((row) => row.reviewed).length;
  const candidates = rows.filter((row) => row.predictionPending && !drafts[row.id]);
  const selectedSaveCount = bankSaveIds(rows, drafts, selected, "selected").length;
  const reviewedSaveCount = bankSaveIds(rows, drafts, selected, "reviewed").length;
  const hasMore = !classificationPreview && loadedPage * BANK_PAGE_SIZE < total;
  const syncWasRunning = useRef(props.busy);
  const accountMap = new Map(accounts.map((row) => [row.id, row.name]));
  const categoryMap = new Map(categories.map((row) => [row.id, row]));

  const loadMore = useCallback(async () => {
    if (pending || !hasMore) return;
    const guard = loadGuard.current;
    const token = guard.begin();
    if (token === null) return;
    setLoadingMore(true); setLoadError("");
    try {
      const reload = effectiveRevision !== activeStream.revision;
      const result = await loadBankTransactionsAction(company, { ...filters, page: reload ? "1" : String(loadedPage + 1), q: filters.query }, effectiveRevision, reload);
      if (!guard.isCurrent(token)) return;
      if (!result.success) { setLoadStale(result.code === "STALE"); throw new Error(result.error); }
      setStream((current) => {
        const previous = current.rows;
        const existing = new Set([...props.rows, ...previous].map((row) => row.id));
        return { revision: result.revision, baseRevision: props.revision, rows: reload ? mergeBankWorkspaceRows(previous, result.rows) : [...previous, ...result.rows.filter((row) => !existing.has(row.id))], page: reload ? Math.ceil(result.total / BANK_PAGE_SIZE) : result.page, total: result.total };
      });
    } catch (error) { if (guard.isCurrent(token)) setLoadError(error instanceof Error ? error.message : "明細を読み込めませんでした"); }
    finally { if (guard.finish(token)) setLoadingMore(false); }
  }, [company, filters, hasMore, loadedPage, pending, props.rows, props.revision, activeStream.revision, effectiveRevision]);

  useEffect(() => {
    const guard = loadGuard.current;
    return () => { guard.invalidate(); setLoadingMore(false); };
  }, [props.revision]);

  useEffect(() => {
    const target = sentinel.current;
    if (!target || !hasMore || loadError || loadingMore || pending) return;
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) void loadMore(); }, { rootMargin: "300px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, loadError, loadingMore, loadMore, pending]);

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
    const params = new URLSearchParams({ company, month: filters.month, account: filters.account, category: filters.category, side: filters.side, status: filters.status, q: search, sort: filters.sort, transaction: filters.transaction || "", analysisThrough: keepAnalysis ? filters.analysisThrough || "" : "", page: "1", ...filterEdits, ...values });
    for (const [key, value] of Array.from(params.entries())) if (!value) params.delete(key);
    const destination = `/banking?${params}`;
    if (dirty) { setLeaveUrl(destination); return; }
    setClassificationPreview(null); setAiResult(null);
    setSelected(new Set()); startTransition(() => router.push(destination));
  }
  function edit(row: BankTransaction, patch: Partial<BankEdit>) {
    if (pending || filterDirty) return;
    setDrafts((current) => ({ ...current, [row.id]: patchBankDraft(current, row, { ...("categoryId" in patch || "treatment" in patch ? { ...manualClassification, reviewed: false } : {}), ...patch }) }));
  }
  function bulk(patch: Partial<BankEdit>) {
    if (pending || filterDirty) return;
    if (("categoryId" in patch || "treatment" in patch) && categoryTargets.some((row) => row.bookkeeping?.splits?.length)) { setError("科目分割の明細を選択から外して、扱い・単一科目を変更してください"); return; }
    setDrafts((current) => {
      const next = { ...current };
      for (const row of rows) if (selected.has(row.id)) next[row.id] = patchBankDraft(current, row, { ...("categoryId" in patch || "treatment" in patch ? { ...manualClassification, reviewed: false } : {}), ...patch });
      return next;
    });
  }
  function reviewSelection(reviewed: boolean, decision?: { acknowledgeGuesses: boolean }) {
    if (pending || filterDirty || !selected.size) return;
    try {
      let targets = rows.filter((row) => selected.has(row.id));
      // Guessed categories need a person to look at them before they count as reviewed.
      const guesses = new Set(reviewed ? targets.filter((row) => { const value = drafts[row.id] || editFrom(row); return !value.reviewed && isGuessClassification({ ...row, ...value }); }).map((row) => row.id) : []);
      if (guesses.size && !decision) { setGuessReview({ guesses: targets.filter((row) => guesses.has(row.id)).map((row) => ({ ...row, ...drafts[row.id] })), others: targets.length - guesses.size }); return; }
      if (decision && !decision.acknowledgeGuesses) targets = targets.filter((row) => !guesses.has(row.id));
      setGuessReview(null);
      if (!targets.length) { setError("推測のままの明細だけが選択されています。科目を選び直すか、内容を確認して確定してください"); return; }
      const reviewedDrafts = reviewBankDrafts(targets, drafts, reviewed);
      setDrafts((current) => {
        const next = { ...current };
        for (const row of targets) {
          if (!reviewedDrafts[row.id]) continue;
          const value = reviewedDrafts[row.id];
          next[row.id] = patchBankDraft(current, row, reviewed ? { ...editFrom(value), reviewed, acknowledgeGuess: guesses.has(row.id) ? true : undefined } : { reviewed, acknowledgeGuess: undefined });
        }
        return next;
      });
      setError("");
      toast({ title: `${targets.length}件を${reviewed ? "確認済み" : "未確認"}に変更（未保存）${reviewed && guesses.size && decision?.acknowledgeGuesses ? `。推測のまま確定 ${guesses.size}件` : ""}` });
    } catch (error) { setError(error instanceof Error ? error.message : "確認状態を変更できませんでした"); }
  }
  function openCategories(row?: BankTransaction) {
    if (row && !selected.has(row.id)) setSelected(new Set([row.id]));
    if (window.matchMedia("(min-width: 1280px)").matches) {
      categoryRail.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
    } else setCategoryPickerOpen(true);
  }
  function applyCategory(category: AccountingCategory, child?: AccountingCategory) {
    if (pending || filterDirty || !categoryTargets.length) return;
    if (categoryTargets.some((row) => row.bookkeeping?.splits?.length)) { setError("科目分割の明細は内訳画面から変更してください"); return; }
    try {
      const applied = applyBankCategoryDrafts(categoryTargets, drafts, category, child);
      setDrafts((current) => {
        const next = { ...current };
        for (const row of categoryTargets) next[row.id] = patchBankDraft(current, row, { categoryId: applied[row.id].categoryId, subCategoryId: applied[row.id].subCategoryId, reviewed: false, ...manualClassification });
        return next;
      });
    } catch (error) { setError(error instanceof Error ? error.message : "科目を変更できませんでした"); return; }
    setCategoryPickerOpen(false);
    toast({ title: `${categoryTargets.length}件を「${category.name}${child ? ` / ${child.name}` : ""}」に変更（未保存）` });
  }
  function prepareSave(scope: BankSaveScope, destination?: string) {
    if (pending) return;
    setError("");
    startTransition(async () => {
      try {
        const ids = bankSaveIds(rows, drafts, selected, scope);
        const originals: BankTransaction[] = [];
        for (let offset = 0; offset < ids.length; offset += 500) {
          const result = await loadBankDraftRowsAction(company, ids.slice(offset, offset + 500));
          if (!result.success) throw new Error(result.error);
          originals.push(...result.rows);
        }
        const changes = bankSaveChanges(originals, rows, drafts, selected, scope);
        const changedIds = new Set(changes.map((row) => row.before.id));
        const unchanged = originals.filter((row) => !changedIds.has(row.id));
        setDrafts((current) => removeSavedBankDrafts(current, unchanged.map(editFrom)));
        setSavedRows((current) => ({ ...current, ...Object.fromEntries(unchanged.map((row) => [row.id, { ...rows.find((item) => item.id === row.id), ...row, predictionPending: false }])) }));
        if (!changes.length && destination) { setLeaveUrl(null); router.push(destination); return; }
        setSavePreview({ scope, changes, destination, omitted: (scope === "selected" ? selected.size : ids.length) - changes.length, unselected: matchingSnapshot?.filter((id) => !selected.has(id)).length || 0 });
      } catch (error) { setError(error instanceof Error ? error.message : "保存内容を取得できませんでした。編集内容は保持されています"); }
    });
  }
  function save() {
    if (!savePreview || pending) return;
    const preview = savePreview;
    const edits = preview.changes.map((row) => row.after);
    loadGuard.current.invalidate(); setLoadingMore(false);
    setSavePreview(null); setError(""); setSavedCount(0); setSaveResult(null);
    startTransition(async () => {
      let saved = 0;
      let uncertain = false;
      try {
        for (let offset = 0; offset < edits.length; offset += 100) {
          const batch = edits.slice(offset, offset + 100);
          uncertain = true;
          const result = await saveBankEditsAction(company, batch);
          uncertain = false;
          if (!result.success) throw new Error(result.error || "保存できませんでした");
          if (result.count !== batch.length) { uncertain = true; throw new Error("保存件数が一致しません。現在の保存状態を確認してください"); }
          saved += result.count; setSavedCount(saved);
          setDrafts((current) => removeSavedBankDrafts(current, batch));
          setSelected((current) => new Set([...current].filter((id) => !batch.some((row) => row.id === id))));
          // Immediately remove prediction labels; fetch real versions before allowing further edits.
          setSavedRows((current) => ({ ...current, ...Object.fromEntries(batch.map((edit) => [edit.id, { ...rows.find((row) => row.id === edit.id), ...preview.changes.find((row) => row.before.id === edit.id)!.before, ...edit, classificationSource: "MANUAL" as const, predictionPending: false }])) }));
          setSaveResult({ saved, remaining: edits.length - saved, uncertain: false });
          const verified = await loadBankDraftRowsAction(company, batch.map((row) => row.id));
          if (!verified.success) throw new Error(`保存済みですが最新状態を取得できませんでした: ${verified.error}`);
          setSavedRows((current) => ({ ...current, ...Object.fromEntries(verified.displayRows.map((row) => [row.id, row])) }));
        }
        setLeaveUrl(null);
        if (preview.destination) router.push(preview.destination);
        toast({ title: `${saved}件を保存しました`, variant: "success" });
      } catch (error) {
        const message = error instanceof Error ? error.message : "通信に失敗しました";
        setSaveResult({ saved, remaining: edits.length - saved, uncertain });
        setError(`${saved}件保存済み。${message}。${uncertain ? "応答のないバッチは結果未確認です。再保存前に最新状態を確認してください。" : ""}残りの変更・選択は保持されています`);
      }
    });
  }
  function selectMatching() {
    if (pending || filterDirty) return;
    loadGuard.current.invalidate(); setLoadingMore(false); setLoadError("");
    startTransition(async () => {
      try {
        const result = classificationPreview ? { success: true as const, rows: classificationPreview as BankDisplayRow[], total: classificationPreview.length, page: 1, revision: effectiveRevision } : await loadBankTransactionsAction(company, { ...filters, page: "1", q: filters.query }, effectiveRevision, true);
        if (!result.success) { setLoadStale(result.code === "STALE"); throw new Error(result.error); }
        if (!classificationPreview) setStream({ revision: result.revision, baseRevision: props.revision, rows: result.rows, page: Math.ceil(result.total / BANK_PAGE_SIZE), total: result.total });
        setMatchingSnapshot(result.rows.map((row) => row.id));
        setSelected(bankMatchingSelection(result.rows, selected));
        setLoadStale(false);
      } catch (error) { setLoadError(error instanceof Error ? error.message : "全件を取得できませんでした。選択・編集は保持されています"); }
    });
  }
  function reclassify(scope = classifyScope) {
    setError(""); setClassificationEmpty(null); setClassifyScope(scope); startTransition(async () => {
      try {
        const ids = scope === "all" ? undefined : rows.filter((row) => scope === "page" || selected.has(row.id)).map((row) => row.id);
        const batches = ids ? Array.from({ length: Math.ceil(ids.length / 500) }, (_, index) => ids.slice(index * 500, (index + 1) * 500)) : [undefined];
        const result = { rows: [] as BankTransaction[], count: 0, unclassified: 0 };
        for (const batch of batches) {
          const response = await previewBankRulesAction(company, batch);
          if (!response.success) { setError(response.error || "分類できませんでした"); return; }
          result.rows.push(...response.rows); result.count += response.count; result.unclassified += response.unclassified;
        }
        if (!result.rows.length) { setClassificationEmpty(result.unclassified); return; }
        if (result.rows.length) {
          setClassificationPreview(result.rows.sort((a, b) => b.transactionDate.localeCompare(a.transactionDate) || a.id.localeCompare(b.id)));
          setAiResult(null);
          setMatchingSnapshot(null); setSelected(new Set());
        }
        setClassifyOpen(false);
        toast({ title: `${result.count}件の分類候補（未保存）` });
      } catch { setError("通信に失敗しました"); }
    });
  }
  function openAi(scope: typeof aiScope, history = false) {
    setAiScope(scope); setAiHistory(history); setClassifyOpen(false); setAiOpen(true);
  }
  function openLinks(row: BankTransaction) {
    setError(""); startTransition(async () => {
      try {
        const result = await loadBankLinksAction(company, row.id);
        if (!result.success) throw new Error(result.error);
        setLinkData(result);
      } catch (error) { setError(error instanceof Error ? error.message : "照合情報を取得できませんでした"); }
    });
  }
  function linkButton(row: BankDisplayRow) {
    return <div className="inline-flex max-w-full flex-wrap items-center justify-end gap-0.5">
      <Button className="bank-row-link max-w-full whitespace-normal px-1 text-xs text-muted-foreground" variant="ghost" title={`${row.content} / ${row.side === "INCOME" ? "入金を照合" : "出金を照合"}`} disabled={pending || Boolean(dirty)} onClick={() => openLinks(row)}><FileCheck2 className="size-3.5 shrink-0" />{row.linkLabel || "照合"}</Button>
      <span className="inline-flex md:[&>button]:size-7 md:[&>button]:min-h-7"><BankBookkeepingDialog company={company} transaction={row} categories={categories} disabled={pending || Boolean(dirty)} onSaved={(saved) => setSavedRows((current) => ({ ...current, [saved.id]: { ...row, ...saved, predictionPending: false } }))} /></span>
      {row.settlementConflict ? <p className="mt-1 max-w-full basis-full break-words text-xs text-amber-700 dark:text-amber-400" title={row.settlementConflict}>既存分類・照合を要確認</p> : null}
    </div>;
  }
  function refreshLoadedRows() {
    if (pending) return;
    loadGuard.current.invalidate(); setLoadingMore(false);
    startTransition(async () => {
      try {
        if (classificationPreview) {
          const refreshed: BankDisplayRow[] = [];
          for (let offset = 0; offset < rows.length; offset += 500) {
            const result = await loadBankDraftRowsAction(company, rows.slice(offset, offset + 500).map((row) => row.id));
            if (!result.success) throw new Error(result.error);
            refreshed.push(...result.displayRows);
          }
          setSavedRows(Object.fromEntries(refreshed.map((row) => [row.id, row])));
          setLoadError(""); setLoadStale(false); router.refresh();
          return;
        }
        const refreshed = await loadBankTransactionsAction(company, { ...filters, page: "1", q: filters.query }, props.revision, true, true);
        if (!refreshed.success) throw new Error(refreshed.error);
        const matchedIds = new Set(refreshed.rows.map((row) => row.id));
        const retained = rows.filter((row) => !matchedIds.has(row.id) && (selected.has(row.id) || drafts[row.id]));
        const fresh: BankDisplayRow[] = [...refreshed.rows];
        for (let offset = 0; offset < retained.length; offset += 500) {
          const result = await loadBankDraftRowsAction(company, retained.slice(offset, offset + 500).map((row) => row.id));
          if (!result.success) throw new Error(result.error);
          fresh.push(...result.displayRows);
        }
        setSavedRows(Object.fromEntries(fresh.map((row) => [row.id, row])));
        setStream({ revision: refreshed.revision, baseRevision: props.revision, rows: fresh, page: Math.ceil(refreshed.total / BANK_PAGE_SIZE), total: refreshed.total });
        setLoadError(""); setLoadStale(false); router.refresh();
      } catch (error) { setLoadError(error instanceof Error ? error.message : "最新状態を取得できませんでした"); }
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
    return <RowSelectionCheckbox selection={selection} id={row.id} label={`${row.transactionDate} ${row.content}を選択`} />;
  }
  function status(row: BankDisplayRow, value: BankEdit) {
    const sales = row.salesSuggestion && value.treatment === "NORMAL" && (!value.categoryId || !row.salesSuggestion.acceptedIds.includes(value.categoryId)) ? row.salesSuggestion : undefined;
    return <div className="bank-classification-state flex flex-wrap items-center gap-1"><BankClassificationBadge row={{ ...row, ...value }} />{drafts[row.id] ? <><span className="text-[11px] text-amber-700 dark:text-amber-300">編集・未保存{drafts[row.id].updatedAt !== row.updatedAt ? "（競合）" : ""}</span><Button variant="ghost" size="icon" className="size-6" title="この明細の編集を破棄" aria-label={`${row.content}の編集を破棄`} disabled={pending} onClick={() => { if (window.confirm("この明細の未保存の編集を破棄しますか？")) setDrafts((current) => { const next = { ...current }; delete next[row.id]; return next; }); }}><X className="size-3" /></Button></> : row.predictionPending ? <span className="text-[11px] text-muted-foreground">自動候補・未採用</span> : null}{sales ? <div className="bank-sales-hint flex basis-full flex-wrap items-center gap-1 text-[11px] text-emerald-800 dark:text-emerald-300" title={sales.reason}><span>請求書と照合済みの入金。{sales.categoryName ? `売上系の科目「${sales.categoryName}」を提案` : "売上系の科目を提案"}</span><Button variant="outline" size="xs" disabled={pending || filterDirty || Boolean(row.bookkeeping?.splits?.length)} aria-label={`${row.content}に${sales.categoryName ? `売上科目「${sales.categoryName}」を適用` : "売上系の科目を選ぶ"}`} onClick={() => sales.categoryId ? edit(row, { categoryId: sales.categoryId, subCategoryId: undefined, classificationReason: "発行請求書と照合済みの入金（売上科目の提案を採用・未確定）" }) : openCategories(row)}>{sales.categoryId ? "提案を採用" : "科目を選ぶ"}</Button></div> : null}</div>;
  }
  function classificationReason(row: BankTransaction, value: BankEdit) {
    return value.classificationReason;
  }
  function fields(row: BankTransaction, value: BankEdit) {
    const category = categoryMap.get(value.categoryId || "");
    const child = categoryMap.get(value.subCategoryId || "");
    return [
      <button key="category" type="button" className="bank-category-cell group flex w-full min-w-0 items-center gap-1 rounded-md border px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50" title={category ? bankCategorySection(category.group).label : undefined} aria-label={`${row.content}の勘定科目を選ぶ`} disabled={pending || filterDirty || Boolean(row.bookkeeping?.splits?.length)} onClick={() => openCategories(row)}><span className="min-w-0 flex-1 break-words">{row.bookkeeping?.splits?.length ? `分割 ${row.bookkeeping.splits.length}科目` : category?.name || "科目を選択"}{child ? <span className="mt-0.5 block text-xs text-muted-foreground">{child.name}</span> : null}</span><Pencil className="size-3 shrink-0 text-muted-foreground opacity-50 group-hover:opacity-100" /></button>,
      <select key="treatment" className={bankSelectClass} aria-label={`${row.content}の扱い`} value={value.treatment} disabled={pending || filterDirty || Boolean(row.bookkeeping?.splits?.length)} onChange={(e) => edit(row, { treatment: e.target.value as BankEdit["treatment"], reviewed: false })}>{Object.entries(treatmentLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>,
      <Input key="memo" className="h-11" aria-label={`${row.content}のメモ`} placeholder="メモ" value={value.memo} disabled={pending || filterDirty} maxLength={2000} onChange={(e) => edit(row, { memo: e.target.value })} />,
    ];
  }

  const reviewPanel = <BankSelectionReview count={categoryTargets.length} amount={bankSelectionAmount(categoryTargets)} reviewedCount={reviewedCount} disabled={pending || filterDirty} onClear={selection.clear} onReview={reviewSelection} />;
  const matchedContent = (text: string) => bankSearchHighlights(text || "摘要なし", filters.query).map((part, index) => part.matched ? <mark key={index} className="bg-yellow-200 text-black">{part.text}</mark> : part.text);
  const categoryDisabled = pending || filterDirty || categoryTargets.some((row) => Boolean(row.bookkeeping?.splits?.length));

  return <div className="bank-ledger min-w-0 pb-48 md:pb-24">
    <header className="bank-ledger-header flex flex-wrap items-center justify-between gap-3 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-3"><h1 className="break-words text-xl font-semibold">口座・カード明細</h1><select className={`${bankSelectClass} bank-account-filter`} aria-label="口座で絞り込み" value={filterEdits.account ?? props.selectedAccountOption} disabled={pending} onChange={(e) => setFilterEdits((current) => ({ ...current, account: e.target.value, analysisThrough: "" }))}><option value="">すべての口座・カード</option>{props.accountOptions.map((row) => <option key={row.id} value={row.id}>{row.name}{!row.available ? "（連携終了）" : ""}</option>)}</select></div>
      <div className="flex flex-wrap gap-2">
        <Link className="inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm hover:bg-muted" href={`/banking/integrity?company=${company}`}><ShieldCheck className="size-4" />整合性チェック</Link>
        <SectionExportDialog scope="banking" role={props.role} disabled={pending || Boolean(dirty)} />
        {props.aiSettings ? <BankAiSettings {...props.aiSettings} disabled={pending || Boolean(dirty)} /> : null}
        <Button className="min-h-11" variant="outline" disabled={pending || Boolean(dirty)} onClick={() => setSettings(true)}><Settings2 className="size-4" />科目・ルール</Button>
        <Button className="min-h-11" variant="outline" disabled={!configured || syncing || pending || Boolean(dirty)} onClick={() => setSyncOpen(true)}>{syncing ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}同期</Button>
      </div>
    </header>
    <div className="bank-workflow-line"><WorkflowNav role={props.role} compact />{!classificationPreview ? <div className="bank-ledger-totals flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label="表示条件の集計"><span>{monthName(filters.month)} / {total.toLocaleString()}件</span><span>入金 <strong className="font-medium tabular-nums text-emerald-700 dark:text-emerald-400">{money.format(summary.income)}</strong></span><span>出金 <strong className="font-medium tabular-nums text-foreground">{money.format(summary.expense)}</strong></span><span>候補の保存待ち {summary.unclassified}件</span>{summary.excluded ? <span>集計対象外 {summary.excluded}件</span> : null}</div> : null}</div>
    <div className="bank-sync-status flex flex-wrap items-center justify-between gap-x-3 text-xs text-muted-foreground">
      <div role="status" className="min-w-0 break-words">{!configured ? "Money Forward 未接続（連携キー・事業者番号が未設定）" : syncing ? `同期中${sync?.completedThrough ? ` / ${sync.completedThrough}まで取得済み` : ""}` : sync?.lastSuccessAt ? `最終同期 ${new Date(sync.lastSuccessAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}` : "Money Forward 接続設定済み・初回同期前"}</div>
      <BankSyncRunsDialog company={company} disabled={pending || Boolean(dirty)} pending={props.syncImpact?.pending ?? 0} />
      <label className="flex min-h-8 items-center gap-2"><input type="checkbox" className="size-4 accent-primary" checked={Boolean(sync?.autoSync)} disabled={!configured || !admin || pending} onChange={(e) => {
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
    {props.selectedBalance?.kind === "BANK" && !props.selectedBalance.unspecified ? <details className="bank-balance-details border-b py-2"><summary className="cursor-pointer text-sm">計算残高 <strong className="tabular-nums">{props.selectedBalance.balanceCalculation ? money.format(props.selectedBalance.balanceCalculation.amount) : "未計算"}</strong>{props.selectedBalance.balanceCalculation && !props.selectedBalance.balanceCalculation.complete ? <span className="ml-2 text-xs text-amber-700 dark:text-amber-300">暫定</span> : null}</summary><section aria-label="選択口座の計算残高" className="flex min-w-0 flex-wrap items-start justify-between gap-4 py-3">
      <div className="min-w-0 flex-1 basis-56"><h2 className="mb-2 break-words text-sm font-medium">{props.selectedBalance.name}</h2><BankBalanceSummary row={props.selectedBalance} /></div>
      <div className="min-w-0 space-y-2 text-xs text-muted-foreground">
        {props.selectedBalance.balanceCalculation ? <dl className="grid grid-cols-2 gap-x-4 gap-y-1"><dt>基準日後の入金</dt><dd className="text-right tabular-nums text-emerald-700 dark:text-emerald-400">+{money.format(props.selectedBalance.balanceCalculation.income)}</dd><dt>基準日後の出金</dt><dd className="text-right tabular-nums">−{money.format(props.selectedBalance.balanceCalculation.expense)}</dd></dl> : null}
        <p>残高は全明細が対象・下の絞り込みとは別</p>
        <Button asChild variant="outline" className="min-h-11"><Link href={`/banking/accounts?company=${company}`}><Settings2 className="size-4" />基準残高を確認・変更</Link></Button>
      </div>
    </section></details> : null}
    <div className="bank-ledger-layout">
      <section className="min-w-0 space-y-2">
        {classificationPreview ? <div role="status" className="flex flex-wrap items-center justify-between gap-2 border-l-2 border-amber-500 bg-amber-500/5 px-3 py-2"><div className="min-w-0"><h2 className="text-base font-semibold">{aiResult ? `AI判定結果 ${total.toLocaleString()}件・未保存 ${dirty}件` : `分類候補 ${total.toLocaleString()}件・未保存`}</h2>{aiResult ? <p className="mt-1 break-words text-xs text-muted-foreground">候補 {aiResult.suggested}件・うち低確度の推定 {aiResult.lowConfidence}件 / {aiResult.model}</p> : null}</div><Button className="min-h-11" variant="ghost" disabled={pending} onClick={() => navigate({})}><X className="size-4" />候補を閉じる</Button></div> : <>
        {filters.analysisThrough ? <div className="flex flex-wrap items-center justify-between gap-2 border-l-2 border-primary bg-primary/5 p-2 text-sm"><span>出金分析の対象明細（{filters.analysisThrough}まで）</span><Button className="min-h-11" variant="ghost" disabled={pending} onClick={() => navigate({ analysisThrough: "" })}><X className="size-4" />分析条件を解除</Button></div> : null}
        {filters.transaction ? <div className="flex flex-wrap items-center justify-between gap-2 border-l-2 border-primary bg-primary/5 p-2 text-sm"><span>指定された明細を表示中</span><Button className="min-h-11" variant="ghost" disabled={pending} onClick={() => navigate({ transaction: "" })}><X className="size-4" />指定を解除</Button></div> : null}
        <BankFiscalMonthTabs value={filters.month} months={months} today={bankToday()} disabled={pending} onChange={(month) => navigate({ month })} />
        <div className="bank-ledger-filters">
          <select className={bankSelectClass} aria-label="勘定科目で絞り込み" value={filterEdits.category ?? filters.category} disabled={pending} onChange={(e) => setFilterEdits((current) => ({ ...current, category: e.target.value }))}><option value="">すべての勘定科目</option>{bankCategoryCatalog(categories.map((row) => ({ ...row, available: true }))).map((section) => <optgroup key={section.id} label={section.label}>{section.entries.map(({ category }) => <option key={category.id} value={category.id}>{category.name}</option>)}</optgroup>)}</select>
          <select className={bankSelectClass} aria-label="入出金で絞り込み" value={filterEdits.side ?? filters.side} disabled={pending} onChange={(e) => setFilterEdits((current) => ({ ...current, side: e.target.value, analysisThrough: "" }))}><option value="">入金・出金すべて</option><option value="INCOME">入金・返金</option><option value="EXPENSE">出金・利用</option></select>
          <select className={bankSelectClass} aria-label="確認状態で絞り込み" value={filterEdits.status ?? filters.status} disabled={pending} onChange={(e) => setFilterEdits((current) => ({ ...current, status: e.target.value, analysisThrough: "" }))}><option value="">すべての状態</option><option value="unclassified">候補の保存待ち</option><option value="unreviewed">未確認</option><option value="reviewed">確認済み</option><option value="held">保留</option><option value="no-invoice">請求書不要</option><option value="transfer">振替・カード精算</option><option value="excluded">対象外</option><option value="missing">元明細なし</option></select>
          <select className={bankSelectClass} aria-label="並び順" value={filterEdits.sort ?? filters.sort} disabled={pending} onChange={(e) => setFilterEdits((current) => ({ ...current, sort: e.target.value }))}><option value="date-desc">取引日が新しい順</option><option value="date-asc">取引日が古い順</option><option value="amount-desc">金額が大きい順</option><option value="amount-asc">金額が小さい順</option></select>
        <form id="bank-filters" className="bank-ledger-search flex min-w-0 gap-1" onSubmit={(e) => { e.preventDefault(); navigate({ q: search }); }}><Input className="h-11 min-w-0 flex-1" aria-label="摘要・メモを検索" placeholder="摘要・メモを検索" value={search} maxLength={200} disabled={pending} onChange={(e) => setSearch(e.target.value)} /><Button type="submit" variant="ghost" size="icon" className="size-11 shrink-0" aria-label="絞り込みを適用" title="絞り込みを適用" disabled={pending}><Search className="size-4" /></Button></form>
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-[160px_minmax(0,1fr)_auto] md:items-center">
          <select className={`${bankSelectClass} md:h-9`} aria-label="検索の一致条件" value={filterEdits.queryMode} disabled={pending} onChange={(event) => setFilterEdits((current) => ({ ...current, queryMode: event.target.value }))}><option value="contains">部分一致</option><option value="exact">摘要の完全一致</option></select>
          <Input form="bank-filters" className="h-11 min-w-0 md:h-9" aria-label="除外する検索語" placeholder="除外する語（カンマ区切り）" maxLength={500} value={filterEdits.excludeQuery} disabled={pending} onChange={(event) => setFilterEdits((current) => ({ ...current, excludeQuery: event.target.value }))} />
          <Button form="bank-filters" type="submit" className="h-11 md:h-9" variant="outline" disabled={pending}><Search className="size-4" />条件を適用</Button>
        </div>
        {filterDirty ? <div role="status" className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300">検索条件は未適用<Button variant="ghost" size="icon" title="条件の変更を取り消す" aria-label="条件の変更を取り消す" disabled={pending} onClick={() => { setSearch(filters.query); setFilterEdits({ queryMode: filters.queryMode || "contains", excludeQuery: filters.excludeQuery || "" }); }}><X className="size-4" /></Button></div> : null}
        </>}
        <div className="bank-ledger-toolbar flex min-w-0 flex-wrap items-center gap-2" aria-label="明細の操作">
          <div className="flex items-center text-xs md:hidden"><SelectAllCheckbox selection={selection} />表示中を選択</div>
          <Button type="button" variant="outline" disabled={pending || filterDirty || !total} onClick={selectMatching}><CheckCheck className="size-4" />検索結果を全件選択（{total.toLocaleString()}件）</Button>
          <BankAuditDialog company={company} disabled={pending || Boolean(dirty)} />
          <Button type="button" className="min-h-11 xl:hidden" variant="outline" disabled={pending} onClick={() => openCategories()}><ListTree className="size-4" />科目・確認</Button>
          <Button type="button" className="min-h-11" variant="outline" disabled={pending || Boolean(dirty) || !months.length} onClick={() => { setClassifyScope(selected.size ? "selected" : "all"); setClassificationEmpty(null); setError(""); setClassifyOpen(true); }}><WandSparkles className="size-4" />自動分類</Button>
          <Button type="button" className="min-h-11" variant="outline" disabled={pending || Boolean(dirty) || !months.length} onClick={() => openAi(selected.size ? "selected" : rows.length ? "page" : "all")}><Bot className="size-4" />AI分類</Button>
          <Button type="button" className="min-h-11" variant="outline" disabled={pending || Boolean(dirty) || !months.length} onClick={() => openAi(selected.size ? "selected" : rows.length ? "page" : "all", true)}><History className="size-4" />過去実績でAI再判定</Button>
          {selected.size ? <select className={`${bankSelectClass} bank-bulk-treatment`} aria-label="選択明細の扱いを一括変更" value="" disabled={categoryDisabled} onChange={(e) => bulk({ treatment: e.target.value as BankEdit["treatment"], reviewed: false })}><option value="" disabled>扱いを一括変更</option>{Object.entries(treatmentLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select> : null}
          {filters.month || filters.account || filters.category || filters.side || filters.status || filters.query || filters.excludeQuery || filters.analysisThrough || filters.transaction ? <Button type="button" size="icon" variant="ghost" title="絞り込みを解除" aria-label="絞り込みを解除" disabled={pending} onClick={() => navigate({ month: "", account: "", category: "", side: "", status: "", q: "", queryMode: "contains", excludeQuery: "", analysisThrough: "", transaction: "" })}><X className="size-4" /></Button> : null}
        </div>
        {matchingSnapshot ? <p role="status" className="text-xs text-muted-foreground">検索結果の確定範囲 {matchingSnapshot.length}件 / 選択 {selected.size}件 / 選択解除 {matchingSnapshot.filter((id) => !selected.has(id)).length}件（対象外は自動選択しません）</p> : null}
        <div role="region" aria-label="口座・カード明細一覧" tabIndex={0} className="bank-ledger-scroll min-w-0 max-w-full md:overflow-auto md:overscroll-contain">
        <div className="hidden md:block">
          <table className="bank-ledger-table w-full min-w-[840px] table-fixed text-sm">
            <colgroup><col className="w-11" /><col className="w-[84px]" /><col /><col className="w-[104px]" /><col className="w-[160px]" /><col className="w-[104px]" /><col className="w-[116px]" /><col className="w-[88px]" /></colgroup>
            <thead className="sticky top-0 z-10 border-b bg-background text-xs text-muted-foreground"><tr><th scope="col"><SelectAllCheckbox selection={selection} /></th>{["日付", "摘要・口座", "金額", "勘定科目 / 補助", "扱い", "メモ", "確認状態"].map((title) => <th key={title} scope="col" className={`px-2 py-2 font-medium ${title === "金額" ? "text-right" : "text-left"}`}>{title}</th>)}</tr></thead>
            <tbody>{rows.map((row) => {
              const value = drafts[row.id] || editFrom(row);
              const controls = fields(row, value);
              return <tr key={row.id} {...selection.rowProps(row.id)} style={{ contentVisibility: "auto", containIntrinsicSize: "auto 100px" }} className={`border-b align-top ${selected.has(row.id) ? "bg-primary/10" : "hover:bg-muted/30"}`}>
                <td>{selectionBox(row)}</td>
                <td className="px-1 py-3"><time className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">{row.transactionDate}</time></td>
                <td className="break-words px-2 py-2"><div className="font-medium">{matchedContent(row.content)}</div><div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground"><span className="line-clamp-2" title={accountMap.get(row.bankAccountId)}>{accountMap.get(row.bankAccountId) || "口座未取得"}</span>{row.sourceMemo ? <Popover><PopoverTrigger asChild><Button variant="ghost" size="icon" className="bank-source-note size-6 shrink-0" title="元明細メモ" aria-label={`${row.content}の元明細メモ`}><MessageSquareText className="size-3" /></Button></PopoverTrigger><PopoverContent className="max-w-[min(320px,90vw)] break-words text-sm">{row.sourceMemo}</PopoverContent></Popover> : null}</div></td>
                <td className={`px-2 py-3 text-right tabular-nums ${row.side === "INCOME" ? "text-emerald-700 dark:text-emerald-400" : ""}`}><span className="whitespace-nowrap">{row.side === "INCOME" ? "+" : "-"}{money.format(row.amount)}</span>{linkButton(row)}</td>
                <td className="px-1 py-2">{controls[0]}{status(row, value)}</td><td className="px-1 py-2">{controls[1]}</td><td className="px-1 py-2">{controls[2]}</td>
                <td className="px-1 py-3"><BankReviewTag reviewed={value.reviewed} missing={row.sourceMissing} /></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        <div className="divide-y md:hidden">{rows.map((row) => { const value = drafts[row.id] || editFrom(row); return <article key={row.id} {...selection.rowProps(row.id)} style={{ contentVisibility: "auto", containIntrinsicSize: "auto 380px" }} className={`min-w-0 space-y-2 py-3 ${selected.has(row.id) ? "bg-primary/10" : ""}`}>
          <div className="flex min-w-0 items-start gap-1">{selectionBox(row)}<div className="min-w-0 flex-1"><div className="flex flex-wrap justify-between gap-1"><time className="text-xs">{row.transactionDate}</time><span className={`break-all text-sm font-medium tabular-nums ${row.side === "INCOME" ? "text-emerald-700 dark:text-emerald-400" : ""}`}>{row.side === "INCOME" ? "+" : "-"}{money.format(row.amount)}</span></div><h3 className="mt-1 break-words text-sm font-medium">{matchedContent(row.content)}</h3><div className="break-words text-xs text-muted-foreground">{accountMap.get(row.bankAccountId)}</div>{status(row, value)}</div></div>
          {row.sourceMemo ? <div className="break-words text-xs text-muted-foreground">{row.sourceMemo}</div> : null}
          {classificationReason(row, value) ? <div className="break-words text-xs text-muted-foreground">{classificationReason(row, value)}</div> : null}
          <div className="grid min-w-0 gap-2">{fields(row, value)}</div>
          {linkButton(row)}
          <BankReviewTag reviewed={value.reviewed} missing={row.sourceMissing} />
        </article>; })}</div>
        {!rows.length ? <p className="border-b py-12 text-center text-sm text-muted-foreground">{!configured ? "接続待ち" : "該当する明細はありません"}</p> : null}
        <div ref={sentinel} className="flex min-h-14 flex-wrap items-center justify-center gap-3 py-3 text-sm" aria-live="polite">
          <span className="text-muted-foreground">読み込み済み {rows.length.toLocaleString()} / {total.toLocaleString()}件</span>
          {loadingMore ? <LoaderCircle aria-label="明細を読み込み中" className="size-4 animate-spin" /> : null}
          {loadError ? <span role="alert" className="text-destructive">{loadError}</span> : null}
          {loadError || saveResult?.uncertain ? <Button variant="outline" className="min-h-11" disabled={pending} onClick={refreshLoadedRows}><RefreshCw className="size-4" />選択・編集を保持して更新</Button> : null}
          {hasMore ? <Button variant="ghost" className="min-h-11" disabled={pending || loadingMore || loadStale} onClick={() => void loadMore()}><RefreshCw className="size-4" />{loadError ? "再試行" : "続きを読み込む"}</Button> : null}
        </div>
        </div>
      </section>
      <aside ref={categoryRail} aria-label="勘定科目の選択" className="bank-category-rail hidden xl:flex">{reviewPanel}<div className="min-h-0 flex-1"><BankCategoryPicker categories={categories} targets={categoryTargets} disabled={categoryDisabled} onApply={applyCategory} /></div></aside>
    </div>
    <footer className="bank-ledger-savebar" aria-label="明細の保存">
      <div className="grid w-full min-w-0 gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs"><span role="status">選択 {selected.size}件 / 確認済み {reviewedCount}件 / 編集未保存 {dirty}件 / 自動候補 {candidates.length}件</span><Button variant="ghost" size="icon" className="size-9" title="選択解除" aria-label="選択解除" disabled={pending || !selected.size} onClick={selection.clear}><X className="size-4" /></Button>{pending ? <span role="status" className="flex items-center gap-1"><LoaderCircle className="size-4 animate-spin" />処理中{savedCount ? ` / ${savedCount}件保存済み` : ""}</span> : null}{saveResult ? <span role="status">保存済み {saveResult.saved}件 / 残り {saveResult.remaining}件{saveResult.uncertain ? "（結果未確認あり）" : ""}</span> : null}</div>
        <div className="flex flex-wrap gap-2">
          <Button className="min-h-11" variant="outline" disabled={pending || filterDirty || !selected.size} onClick={() => reviewSelection(true)}><CheckCheck className="size-4" />選択を確認済みに</Button>
          <Button className="min-h-11" variant="ghost" disabled={pending || filterDirty || !reviewedCount} onClick={() => reviewSelection(false)}>未確認に戻す</Button>
          <Button className="min-h-11 xl:hidden" variant="outline" disabled={categoryDisabled} onClick={() => openCategories()}><ListTree className="size-4" />科目</Button>
          <Button className="min-h-11" variant="outline" disabled={pending || !selectedSaveCount} onClick={() => prepareSave("selected")}><Save className="size-4" />選択を保存 ({selectedSaveCount})</Button>
          <Button className="min-h-11" variant="outline" disabled={pending || !reviewedSaveCount} onClick={() => prepareSave("reviewed")}><Save className="size-4" />確認済みを保存 ({reviewedSaveCount})</Button>
          <Button className="min-h-11" disabled={pending || !dirty} onClick={() => prepareSave("edited")}><Save className="size-4" />編集を保存 ({dirty})</Button>
        </div>
      </div>
    </footer>
    {savePreview ? <BankSavePreviewDialog preview={savePreview} categories={categories} busy={pending} onClose={() => setSavePreview(null)} onSave={save} /> : null}
    {guessReview ? <BankGuessReviewDialog guesses={guessReview.guesses} others={guessReview.others} categories={categories} busy={pending} onClose={() => setGuessReview(null)} onConfirm={(acknowledgeGuesses) => reviewSelection(true, { acknowledgeGuesses })} /> : null}
    <Dialog open={categoryPickerOpen} onOpenChange={setCategoryPickerOpen}>
      <DialogContent aria-describedby={undefined} showCloseButton={false} className="top-0 left-auto right-0 h-dvh max-h-dvh w-full max-w-sm translate-x-0 translate-y-0 grid-rows-[auto_minmax(0,1fr)] gap-0 rounded-none p-0 sm:max-w-sm" onInteractOutside={(event) => event.preventDefault()}>
        <DialogHeader className="border-b py-4 pl-3 pr-14"><DialogTitle>科目・確認</DialogTitle></DialogHeader>
        <Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1 size-11" aria-label="科目一覧を閉じる" title="閉じる" onClick={() => setCategoryPickerOpen(false)}><X className="size-4" /></Button>
        <div className="bank-ledger min-h-0 flex flex-col">{reviewPanel}<div className="min-h-0 flex-1"><BankCategoryPicker categories={categories} targets={categoryTargets} disabled={categoryDisabled} onApply={applyCategory} /></div></div>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(leaveUrl)} onOpenChange={(open) => { if (!open && !pending) setLeaveUrl(null); }}>
      <DialogContent showCloseButton={!pending} onInteractOutside={(event) => event.preventDefault()} onEscapeKeyDown={(event) => event.preventDefault()}>
        <DialogHeader><DialogTitle>未保存の変更があります</DialogTitle><DialogDescription>{dirty}件の編集内容が未保存です。</DialogDescription></DialogHeader>
        {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button className="min-h-11" variant="outline" disabled={pending} onClick={() => setLeaveUrl(null)}>キャンセル</Button>
          <Button className="min-h-11" variant="ghost" disabled={pending} onClick={() => { const destination = leaveUrl; setDrafts({}); setClassificationPreview(null); setAiResult(null); setSelected(new Set()); setLeaveUrl(null); if (destination) startTransition(() => router.push(destination)); }}>破棄して移動</Button>
          <Button className="min-h-11" disabled={pending} onClick={() => { const destination = leaveUrl || undefined; setLeaveUrl(null); prepareSave("edited", destination); }}><Save className="size-4" />保存内容を確認して移動</Button>
        </div>
      </DialogContent>
    </Dialog>
    <BankingSettings key={settings ? "open" : "closed"} company={company} accounts={accounts} categories={categories} rules={rules} open={settings} onOpenChange={setSettings} />
    {linkData ? <BankLinksDialog key={linkData.bank.id} company={company} initial={linkData} onClose={() => setLinkData(null)} /> : null}
    <BankClassificationAiDialog key={aiOpen ? "ai-open" : "ai-closed"} company={company} open={aiOpen} onOpenChange={setAiOpen} rowIds={rows.map((row) => row.id)} selectedIds={rows.filter((row) => selected.has(row.id)).map((row) => row.id)} initialScope={aiScope} initialHistory={aiHistory} onResult={(result) => {
      setClassificationPreview(result.rows.map((row) => ({ ...row, predictionPending: true }))); setAiResult({ suggested: result.suggested, lowConfidence: result.lowConfidence, model: result.model });
      setError(""); setMatchingSnapshot(null); setSelected(new Set());
    }} />
    <Dialog open={classifyOpen} onOpenChange={(value) => { if (!pending) setClassifyOpen(value); }}>
      <DialogContent showCloseButton={!pending} onInteractOutside={(event) => event.preventDefault()} onEscapeKeyDown={(event) => event.preventDefault()}>
        <DialogHeader><DialogTitle>勘定科目の自動分類</DialogTitle><DialogDescription>分類結果は未保存の候補です。手動変更・確認済みの明細は対象外です。</DialogDescription></DialogHeader>
        <label className="grid min-w-0 gap-1 text-sm">対象<select aria-label="自動分類の対象" className={bankSelectClass} value={classifyScope} disabled={pending} onChange={(event) => { setClassifyScope(event.target.value as typeof classifyScope); setClassificationEmpty(null); setError(""); }}>
          {selected.size ? <option value="selected">選択した明細（{selected.size}件）</option> : null}
          <option value="all">{company === "JAPAN" ? "日本" : "中国"}の全期間・全口座</option>
          {rows.length ? <option value="page">表示中の明細（{rows.length}件）</option> : null}
        </select></label>
        {classificationEmpty !== null ? <div role="status" className="space-y-1 border-l-2 border-muted-foreground bg-muted/40 p-3 text-sm">
          <p className="font-medium">新しい分類候補はありません</p>
          <p className="text-muted-foreground">対象内の未分類 {classificationEmpty.toLocaleString()}件・変更なし</p>
        </div> : null}
        {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
        <Button className="min-h-11" variant="outline" disabled={pending} onClick={() => openAi(classifyScope)}><Bot className="size-4" />AIで未分類を判定</Button>
        {classificationEmpty !== null && classifyScope !== "all" ? <Button className="min-h-11" disabled={pending} onClick={() => reclassify("all")}><WandSparkles className="size-4" />全期間・全口座で再実行</Button> : null}
        <Button className="min-h-11" variant={classificationEmpty !== null && classifyScope !== "all" ? "outline" : "default"} disabled={pending} onClick={() => reclassify()}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <WandSparkles className="size-4" />}{pending ? "分類中..." : "分類候補を作成"}</Button>
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
