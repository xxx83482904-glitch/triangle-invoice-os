"use client";
import { bankSaveFailureMessage, operationFailureToast } from "@/lib/operation-feedback";
import { OperationError } from "@/components/app/operation-feedback";
import { SectionExportDialog } from "@/components/app/section-export-dialog";

import type { BankAccountOption } from "@/lib/bank-account-options";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useListSelection } from "@/hooks/use-list-selection";
import { useBankAutosave } from "@/hooks/use-bank-autosave";
import { bankAutosaveSummary, bankAutosaveVisibleRows, bankBulkNeedsConfirmation, bankCandidateChanges, type BankAutosaveChange } from "@/lib/bank-autosave";
import { BankAutosaveStatus } from "@/components/app/bank-autosave-status";
import { RowSelectionCheckbox } from "@/components/app/list-selection";
import { OptionTabs } from "@/components/app/option-tabs";
import { FilterPanel } from "@/components/app/filter-panel";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Bot, CheckCheck, ChevronDown, CircleAlert, Download, FileCheck2, History, ListTree, LoaderCircle, MessageSquareText, MoreHorizontal, Paperclip, RefreshCw, Save, ScrollText, Search, Settings2, ShieldCheck, WandSparkles, X } from "lucide-react";
import { WorkflowNav } from "@/components/app/company-switch";
import { navigationIntentEvent, type NavigationIntent } from "@/lib/navigation-intent";
import { BankCategoryControl, BankReviewTag, BankSelectAllCheckbox, BankSelectionReview } from "@/components/app/bank-ledger-controls";
import { MonthTabs } from "@/components/app/month-tabs";
import { bankSelectionAmount, reviewBankDrafts } from "@/lib/bank-ledger";
import Link from "next/link";
import { BankBalanceSummary, type BankBalanceSummaryProps } from "@/components/app/bank-balance-summary";
import { loadBankLinksAction } from "@/app/banking/link-actions";
import { BankLinksDialog, type BankLinkData } from "@/components/app/bank-links-dialog";
import { loadBankDraftRowsAction, loadBankTransactionsAction, previewBankRulesAction, saveBankEditsAction, setBankAutoSyncAction } from "@/app/banking/actions";
import { BankAuditDialog } from "@/components/app/bank-audit-dialog";
import { BankSyncRunsDialog } from "@/components/app/bank-sync-runs-dialog";
import { BankBookkeepingDialog } from "@/components/app/bank-bookkeeping-dialog";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { BankSavePreviewDialog, type BankSavePreview } from "@/components/app/bank-save-preview";
import { bankEditFrom, bankMatchingSelection, bankSaveChanges, bankSaveIds, patchBankDraft, removeSavedBankDrafts, type BankDrafts, type BankSaveScope } from "@/lib/bank-workspace-drafts";
import { bankSearchHighlights } from "@/lib/bank-search-highlight";
import { BankLoadGuard, bankWorkspaceRevision, mergeBankWorkspaceRows } from "@/lib/bank-workspace-loading";
import { BankingSettings, bankSelectClass } from "@/components/app/banking-settings";
import { BankCategoryPicker } from "@/components/app/bank-category-picker";
import { applyBankCategoryDrafts, bankCategoryCatalog } from "@/lib/bank-category-catalog";
import { BankAiSettings } from "@/components/app/bank-ai-settings";
import { BankClassificationAiDialog } from "@/components/app/bank-classification-ai-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/hooks/use-toast";
import { BANK_PAGE_SIZE, bankToday, treatmentLabels, type BankDisplayRow } from "@/lib/banking";
import { BankClassificationState } from "@/components/app/bank-classification-state";
import { BankClassificationBadge } from "@/components/app/bank-classification-badge";
import { BankGuessReviewDialog } from "@/components/app/bank-guess-review-dialog";
import { BankBulkReclassifyDialog } from "@/components/app/bank-bulk-reclassify-dialog";
import { isGuessClassification } from "@/lib/bank-classification";
import type { AccountingCategory, BankAccount, BankEdit, BankFilters, BankRule, BankSyncState, BankTransaction } from "@/lib/banking-types";
import type { CompanyScope } from "@/lib/company";
import type { UserRole } from "@/lib/types";
import { Money } from "@/components/app/money";
import { RecordDetail } from "@/components/app/record-detail";
import { BankDetailDocuments } from "@/components/app/bank-detail-documents";
import { invoiceAccountScopeIssue } from "@/lib/bank-reconciliation-accounts";
import { bankActionBarVisible, bankAdvancedFilterCount, bankLedgerDate, bankLedgerSort, bankLoadedSelection, bankQuickStatus } from "@/lib/bank-ledger-view";
import { isSelectionGesture } from "@/lib/list-selection";
import { canExportSection } from "@/lib/section-export";

const monthName = (value: string) => value ? `${Number(value.slice(5, 7))}月` : "すべての月";
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
  const [legacyDrafts, setDrafts] = useState<BankDrafts>({});
  const autosave = useBankAutosave(company);
  const drafts = company === "JAPAN" ? autosave.drafts : legacyDrafts;
  const saveCounts = bankAutosaveSummary(autosave.entries, autosave.undoing.length);
  const failedCount = saveCounts.failed + saveCounts.conflict;
  const [bulkConfirmation, setBulkConfirmation] = useState<{ changes: BankAutosaveChange[]; label: string; description: string; notify: boolean } | null>(null);
  const [unloadedSelection, setUnloadedSelection] = useState<Set<string>>(new Set());
  const [latestConflict, setLatestConflict] = useState<Record<string, BankDisplayRow>>({});
  const [leaving, setLeaving] = useState(false);
  const [search, setSearch] = useState(filters.query);
  const [filterEdits, setFilterEdits] = useState<Record<string, string>>({ queryMode: filters.queryMode || "contains", excludeQuery: filters.excludeQuery || "" });
  const [savePreview, setSavePreview] = useState<BankSavePreview | null>(null);
  const [guessReview, setGuessReview] = useState<{ guesses: BankTransaction[]; others: number; targets: BankTransaction[]; confirmUnloaded: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ saved: number; remaining: number; uncertain: boolean; confirmed?: boolean } | null>(null);
  const [savedRows, setSavedRows] = useState<Record<string, BankDisplayRow>>({});
  const [matchingSnapshot, setMatchingSnapshot] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const [settings, setSettings] = useState(false);
  const [headerDialog, setHeaderDialog] = useState<"audit" | "sync-runs" | "ai-settings" | "export" | null>(null);
  const headerMenu = useRef<HTMLButtonElement>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const categoryRail = useRef<HTMLElement>(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const [classifyOpen, setClassifyOpen] = useState(false);
  const [classifyScope, setClassifyScope] = useState<"page" | "selected" | "all">("all");
  const [classificationEmpty, setClassificationEmpty] = useState<number | null>(null);
  const [classificationPreview, setClassificationPreview] = useState<BankTransaction[] | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiHistory, setAiHistory] = useState(false);
  const [linkData, setLinkData] = useState<BankLinkData | null>(null), [documentsVersion, setDocumentsVersion] = useState(0);
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
  const leaveBlocked = company === "JAPAN" ? saveCounts.saving + failedCount > 0 : dirty > 0;
  const total = classificationPreview?.length ?? activeStream.total;
  const baseRows = classificationPreview ? classificationPreview as BankDisplayRow[] : mergeBankWorkspaceRows(props.rows, activeStream.rows);
  const rows = mergeBankWorkspaceRows(company === "JAPAN" ? bankAutosaveVisibleRows(baseRows, autosave.rows, autosave.entries) : [], baseRows, baseRows.flatMap((row) => savedRows[row.id] ? [savedRows[row.id]] : []));
  if (!classificationPreview) rows.sort((a, b) => (filters.sort.endsWith("asc") ? 1 : -1) * (filters.sort.startsWith("amount") ? a.amount - b.amount : a.transactionDate.localeCompare(b.transactionDate)) || a.id.localeCompare(b.id));
  const filterDirty = search !== filters.query || Object.entries(filterEdits).some(([key, value]) => value !== String(filters[key as keyof BankFilters] ?? (key === "queryMode" ? "contains" : "")));
  const listSelection = useListSelection(rows.map((row) => row.id), { disabled: pending || filterDirty, pickMode: true });
  const selection = { ...listSelection, clear: () => { listSelection.clear(); setMatchingSnapshot(null); setUnloadedSelection(new Set()); }, selectAll: (checked: boolean) => {
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
  const selectedCandidates = candidates.filter((row) => selected.has(row.id));
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
    if (!saveResult?.confirmed || saving) return;
    const timer = setTimeout(() => setSaveResult((current) => current === saveResult ? null : current), 4000);
    return () => clearTimeout(timer);
  }, [saveResult, saving]);

  useEffect(() => {
    if (!leaveBlocked) return;
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
    const followCommand = (event: Event) => {
      const url = new URL((event as NavigationIntent).detail.href, window.location.href);
      if (url.href === window.location.href) return;
      event.preventDefault();
      if (!pending) setLeaveUrl(url.pathname + url.search + url.hash);
    };
    document.addEventListener(navigationIntentEvent, followCommand);
    return () => {
      window.removeEventListener("beforeunload", leave);
      document.removeEventListener("click", followLink, true);
      document.removeEventListener(navigationIntentEvent, followCommand);
    };
  }, [leaveBlocked, pending]);

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
    if (leaveBlocked) { setLeaveUrl(destination); return; }
    if (classificationPreview) autosave.queue.clearCompleted();
    setClassificationPreview(null); setAiResult(null);
    setSelected(new Set()); startTransition(() => router.push(destination));
  }
  function edit(row: BankTransaction, patch: Partial<BankEdit>, memo = false) {
    if (pending || filterDirty) return;
    const change = { ...("categoryId" in patch || "treatment" in patch ? { ...manualClassification, reviewed: false } : {}), ...patch };
    if (company === "JAPAN") { autosave.queue.enqueue([{ row, patch: change }], undefined, false, memo); return; }
    setDrafts((current) => ({ ...current, [row.id]: patchBankDraft(current, row, change) }));
  }
  function submitChanges(changes: BankAutosaveChange[], label: string, description: string, notify = changes.length > 1, confirmUnloaded = true) {
    if (!changes.length) return;
    if (confirmUnloaded && bankBulkNeedsConfirmation(changes.map(({ row }) => row.id), unloadedSelection)) {
      setBulkConfirmation({ changes, label, description, notify }); return;
    }
    autosave.queue.enqueue(changes, label, notify);
  }
  function adoptCandidates(targets: BankDisplayRow[], all = false, confirmUnloaded = true) {
    if (pending || filterDirty) return;
    const changes = bankCandidateChanges(targets, drafts);
    submitChanges(changes, "の候補を採用しました", "表示されている科目・補助科目・扱いの候補を採用", all || changes.length > 1, confirmUnloaded);
  }
  function bulk(patch: Partial<BankEdit>) {
    if (pending || filterDirty) return;
    if (company === "JAPAN") {
      submitChanges(rows.filter((row) => selected.has(row.id)).map((row) => ({ row, patch: { ...manualClassification, reviewed: false, ...patch } })),
        `の扱いを「${treatmentLabels[patch.treatment!]}」に変更しました`, `扱いを「${treatmentLabels[patch.treatment!]}」に変更`);
      return;
    }
    if (("categoryId" in patch || "treatment" in patch) && categoryTargets.some((row) => row.bookkeeping?.splits?.length)) { setError("科目分割の明細を選択から外して、扱い・単一科目を変更してください"); return; }
    setDrafts((current) => {
      const next = { ...current };
      for (const row of rows) if (selected.has(row.id)) next[row.id] = patchBankDraft(current, row, { ...("categoryId" in patch || "treatment" in patch ? { ...manualClassification, reviewed: false } : {}), ...patch });
      return next;
    });
  }
  function reviewSelection(reviewed: boolean, decision?: { acknowledgeGuesses: boolean }, explicitTargets?: BankTransaction[], confirmUnloaded = true) {
    if (pending || filterDirty || (!selected.size && !explicitTargets?.length)) return;
    try {
      let targets = explicitTargets || rows.filter((row) => selected.has(row.id));
      // Guessed categories need a person to look at them before they count as reviewed.
      const guesses = new Set(reviewed ? targets.filter((row) => { const value = drafts[row.id] || editFrom(row); return !value.reviewed && isGuessClassification({ ...row, ...value }); }).map((row) => row.id) : []);
      if (guesses.size && !decision) { setGuessReview({ guesses: targets.filter((row) => guesses.has(row.id)).map((row) => ({ ...row, ...drafts[row.id] })), others: targets.length - guesses.size, targets, confirmUnloaded }); return; }
      if (decision && !decision.acknowledgeGuesses) targets = targets.filter((row) => !guesses.has(row.id));
      setGuessReview(null);
      if (!targets.length) { setError("推測のままの明細だけが選択されています。科目を選び直すか、内容を確認して確定してください"); return; }
      if (company === "JAPAN") {
        const changes = targets.filter((row) => (drafts[row.id] || row).reviewed !== reviewed).map((row) => {
          const value = drafts[row.id] || editFrom(row);
          return { row, patch: reviewed ? { ...editFrom(value), reviewed, acknowledgeGuess: guesses.has(row.id) || undefined } : { reviewed, acknowledgeGuess: undefined } };
        });
        submitChanges(changes, `を${reviewed ? "確認済み" : "未確認"}にしました`, reviewed ? "確認済みにする" : "未確認に戻す", changes.length > 1, confirmUnloaded);
        setError(""); return;
      }
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
    if (row) { setSelected(new Set([row.id])); setMatchingSnapshot(null); setUnloadedSelection(new Set()); }
    // A modal detail cannot move focus to the rail behind its focus trap.
    if (!detailId && categoryRail.current?.getClientRects().length) {
      categoryRail.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
    } else setCategoryPickerOpen(true);
  }
  function applyCategory(category: AccountingCategory, child?: AccountingCategory) {
    if (pending || filterDirty || !categoryTargets.length) return;
    if (company === "JAPAN") {
      const name = `${category.name}${child ? ` / ${child.name}` : ""}`;
      submitChanges(categoryTargets.map((row) => ({ row, patch: { categoryId: category.id, subCategoryId: child?.id, reviewed: false, ...manualClassification } })), `の科目を「${name}」に変更しました`, `科目を「${name}」に変更`);
      setCategoryPickerOpen(false); return;
    }
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
    if (pending || company === "JAPAN") return;
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
    setSaving(true);
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
        setSaveResult({ saved, remaining: 0, uncertain: false, confirmed: true });
        setLeaveUrl(null);
        if (preview.destination) router.push(preview.destination);
        toast({ title: `${saved}件を保存しました`, variant: "success" });
      } catch (error) {
        const message = error instanceof Error ? error.message : "通信に失敗しました";
        setSaveResult({ saved, remaining: edits.length - saved, uncertain });
        const feedback = company === "JAPAN" ? bankSaveFailureMessage(message, saved, uncertain) : `${saved}件保存済み。${message}。${uncertain ? "応答のないバッチは結果未確認です。再保存前に最新状態を確認してください。" : ""}残りの変更・選択は保持されています`;
        setError(feedback);
        if (company === "JAPAN") toast(operationFailureToast(feedback));
      } finally { setSaving(false); }
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
        const loadedIds = new Set(rows.map((row) => row.id));
        setUnloadedSelection(new Set(result.rows.filter((row) => !loadedIds.has(row.id)).map((row) => row.id)));
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
          autosave.queue.clearCompleted();
          setClassificationPreview(result.rows.sort((a, b) => b.transactionDate.localeCompare(a.transactionDate) || a.id.localeCompare(b.id)));
          setAiResult(null);
          setMatchingSnapshot(null); setUnloadedSelection(new Set()); setSelected(new Set());
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
    return <Button className="bank-row-link" variant="soft" size="sm" title={`${row.content} / ${row.linkLabel || "照合"}`} disabled={pending || Boolean(dirty)} onClick={() => openLinks(row)}><FileCheck2 className="size-3.5 shrink-0" /><span className="truncate">{row.linkLabel || "照合"}</span></Button>;
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
  function salesSuggestion(row: BankDisplayRow, value: BankEdit) {
    return row.salesSuggestion && value.treatment === "NORMAL" && (!value.categoryId || !row.salesSuggestion.acceptedIds.includes(value.categoryId)) ? row.salesSuggestion : undefined;
  }
  function status(row: BankDisplayRow, value: BankEdit) {
    const entry = autosave.entries[row.id];
    if (company === "JAPAN" && (entry || autosave.undoing.includes(row.id))) return <BankAutosaveStatus entry={autosave.undoing.includes(row.id) ? { status: "saving", composing: false, dueAt: 0 } : entry} onRetry={() => autosave.queue.retry(row.id)} onDetails={() => setDetailId(row.id)} />;
    const conflict = drafts[row.id] && drafts[row.id].updatedAt !== row.updatedAt;
    return <div className="bank-row-state bank-classification-state">
      {company === "JAPAN" ? <BankClassificationState row={{ ...row, ...value }} /> : <><BankClassificationBadge row={{ ...row, ...value }} /><BankReviewTag reviewed={value.reviewed} missing={row.sourceMissing} /></>}
      {drafts[row.id] ? <span className="bank-unsaved-label" title="編集・未保存">未保存</span> : row.predictionPending ? <span className="bank-candidate-label" title="自動候補・未採用">自動候補</span> : null}
      {conflict ? <span className="bank-unsaved-label" title="元の明細が更新されています。保存前に競合を確認してください">競合</span> : null}
      {salesSuggestion(row, value) ? <span className="bank-sales-mark" title={row.salesSuggestion?.reason}>売上提案</span> : null}
    </div>;
  }
  function discardRow(row: BankTransaction) {
    if (!window.confirm("この明細の未保存の編集を破棄しますか？")) return;
    if (company === "JAPAN") { autosave.queue.discard(row.id); reloadConflict(row.id); return; }
    setDrafts((current) => { const next = { ...current }; delete next[row.id]; return next; });
  }
  function reloadConflict(id: string) {
    startTransition(async () => {
      try {
        const result = await loadBankDraftRowsAction(company, [id]);
        if (!result.success) throw new Error(result.error);
        autosave.queue.receive(result.displayRows);
        setLatestConflict((current) => ({ ...current, [id]: result.rows[0] }));
      } catch (error) { setError(error instanceof Error ? error.message : "最新の内容を取得できませんでした"); }
    });
  }
  function fields(row: BankTransaction, value: BankEdit) {
    const category = categoryMap.get(value.categoryId || "");
    const child = categoryMap.get(value.subCategoryId || "");
    return [
      <BankCategoryControl key="category" row={row} category={category} child={child} disabled={pending || filterDirty || autosave.undoing.includes(row.id)} onChoose={openCategories} />,
      <select key="treatment" className={bankSelectClass} aria-label={`${row.content}の扱い`} title={treatmentLabels[value.treatment]} value={value.treatment} disabled={pending || filterDirty || autosave.undoing.includes(row.id) || Boolean(row.bookkeeping?.splits?.length)} onChange={(e) => edit(row, { treatment: e.target.value as BankEdit["treatment"], reviewed: false })}>{Object.entries(treatmentLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>,
      <Input key="memo" className="h-11" aria-label={`${row.content}のメモ`} placeholder="メモ" value={value.memo} disabled={pending || filterDirty || autosave.undoing.includes(row.id)} maxLength={2000}
        onChange={(e) => edit(row, { memo: e.target.value }, true)}
        onCompositionStart={() => autosave.queue.setComposing(row.id, true)}
        onCompositionEnd={(e) => { edit(row, { memo: e.currentTarget.value }, true); autosave.queue.setComposing(row.id, false); }}
        onBlur={() => autosave.queue.flushMemo(row.id)} />,
    ];
  }
  function openClassification() {
    setClassifyScope(selected.size ? "selected" : "all"); setClassificationEmpty(null); setError(""); setClassifyOpen(true);
  }
  function changeAutoSync(enabled: boolean) {
    startTransition(async () => {
      try {
        const result = await setBankAutoSyncAction(company, enabled);
        if (!result.success) { setError(result.error || "設定できませんでした"); return; }
        const response = await fetch(`/api/banking/sync?company=${company}`, { cache: "no-store" });
        if (response.ok) setSync((await response.json()).state);
        router.refresh();
      } catch { setError("設定を確認できませんでした"); }
    });
  }
  function closeHeaderDialog(open: boolean) {
    if (!open) { setHeaderDialog(null); requestAnimationFrame(() => headerMenu.current?.focus()); }
  }
  const reviewPanel = <BankSelectionReview count={categoryTargets.length} amount={bankSelectionAmount(categoryTargets)} reviewedCount={reviewedCount} disabled={pending || filterDirty} onClear={selection.clear} onReview={reviewSelection} />;
  const matchedContent = (text: string) => bankSearchHighlights(text || "摘要なし", filters.query).map((part, index) => part.matched ? <mark key={index} className="bg-yellow-200 text-black">{part.text}</mark> : part.text);
  const categoryDisabled = pending || filterDirty || categoryTargets.some((row) => autosave.undoing.includes(row.id)) || (company !== "JAPAN" && categoryTargets.some((row) => Boolean(row.bookkeeping?.splits?.length)));

  const loadedSelection = bankLoadedSelection(bankMatchingSelection(rows, selected), selected);
  const showActions = bankActionBarVisible(selected.size);
  const detailIndex = rows.findIndex((row) => row.id === detailId);
  const detailRow = rows[detailIndex];
  const detailValue = detailRow ? drafts[detailRow.id] || editFrom(detailRow) : undefined;
  const detailSales = detailRow && detailValue ? salesSuggestion(detailRow, detailValue) : undefined;
  const detailSave = detailRow ? autosave.entries[detailRow.id] : undefined;
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  // Rows still waiting for an invoice match, in the order shown: no link yet (or partial), normal treatment, on an invoice account.
  const awaitingMatch = (row: BankDisplayRow) => (!row.linkLabel || row.linkLabel === "一部照合") && row.treatment === "NORMAL" && !row.sourceMissing && row.sourceStatus !== "excluded"
    && Boolean(accountById.get(row.bankAccountId)) && !invoiceAccountScopeIssue(accountById.get(row.bankAccountId)!);
  const linkIndex = linkData ? rows.findIndex((row) => row.id === linkData.bank.id) : -1;
  const nextMatch = linkIndex >= 0 ? rows.slice(linkIndex + 1).find(awaitingMatch) : undefined;
  const detailLatest = detailRow ? latestConflict[detailRow.id] : undefined;
  const classificationDisabled = pending || Boolean(dirty) || !months.length;
  const canExport = canExportSection({ role: props.role }, "banking");
  const syncStatus = !configured ? "Money Forward 未接続（連携キー・事業者番号が未設定）" : syncing ? `同期中${sync?.completedThrough ? ` / ${sync.completedThrough}まで取得済み` : ""}` : sync?.lastSuccessAt ? `最終同期 ${new Date(sync.lastSuccessAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}` : "Money Forward 接続設定済み・初回同期前";
  const advancedCount = bankAdvancedFilterCount({ ...filters, category: filterEdits.category ?? filters.category, queryMode: filterEdits.queryMode as BankFilters["queryMode"], excludeQuery: filterEdits.excludeQuery });
  const hasFilters = Boolean(filters.month || filters.account || filters.category || filters.side || filters.status || filters.query || filters.excludeQuery || filters.analysisThrough || filters.transaction || filters.queryMode === "exact" || filterDirty);
  const resetFilters = () => navigate({ month: "", account: "", category: "", side: "", status: "", q: "", queryMode: "contains", excludeQuery: "", analysisThrough: "", transaction: "" });
  const sideTabs = <OptionTabs label="入出金で絞り込み" value={filters.side} disabled={pending} options={[["", "すべて"], ["INCOME", "入金・返金"], ["EXPENSE", "出金・利用"]]} onChange={(side) => navigate({ side })} />;
  const classificationItems = <>
    <DropdownMenuItem disabled={classificationDisabled} onSelect={openClassification}><WandSparkles />自動分類…</DropdownMenuItem>
    <DropdownMenuItem disabled={classificationDisabled} onSelect={() => openAi(selected.size ? "selected" : rows.length ? "page" : "all")}><Bot />AI分類…</DropdownMenuItem>
    <DropdownMenuItem disabled={classificationDisabled} onSelect={() => openAi(selected.size ? "selected" : rows.length ? "page" : "all", true)}><History />過去実績でAI再判定…</DropdownMenuItem>
  </>;
  const saveFeedback = saveResult ? `保存済み ${saveResult.saved}件 / 残り ${saveResult.remaining}件${saveResult.uncertain ? "（結果未確認あり）" : ""}` : "";

  return <div data-company={company} data-actions={showActions || company !== "JAPAN" ? "true" : undefined} className="bank-ledger min-w-0">
    <header className="bank-ledger-header">
      <h1 className="font-medium">口座・カード明細</h1>
      <select className={`${bankSelectClass} bank-account-filter`} aria-label="口座で絞り込み" value={filterEdits.account ?? props.selectedAccountOption} disabled={pending} onChange={(e) => setFilterEdits((current) => ({ ...current, account: e.target.value, analysisThrough: "" }))}><option value="">すべての口座・カード</option>{props.accountOptions.map((row) => <option key={row.id} value={row.id}>{row.name}{!row.available ? "（連携終了）" : ""}</option>)}</select>
      <div className="bank-header-actions">
        <div className="hidden lg:contents"><DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="sm"><WandSparkles className="size-4" />分類<ChevronDown className="size-3" /></Button></DropdownMenuTrigger><DropdownMenuContent className="bank-ledger-menu w-64" align="end">{classificationItems}</DropdownMenuContent></DropdownMenu>
          {canExport ? <Button variant="outline" size="sm" disabled={pending || Boolean(dirty)} onClick={() => setHeaderDialog("export")}><Download className="size-4" />書き出し</Button> : null}
          <Button variant="outline" size="sm" disabled={!configured || syncing || pending || Boolean(dirty)} onClick={() => setSyncOpen(true)}>{syncing ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}同期</Button>
        </div>
        <DropdownMenu><DropdownMenuTrigger asChild><Button ref={headerMenu} className="relative" variant="outline" size="icon-sm" aria-label={`口座明細のその他の操作${props.syncImpact?.pending ? `（同期の確認解除 ${props.syncImpact.pending}件）` : ""}`} title="その他の操作"><MoreHorizontal className="size-4" />{props.syncImpact?.pending ? <span aria-hidden className="absolute right-1 top-1 size-1.5 rounded-full bg-[var(--tone-amber-fg)]" /> : null}</Button></DropdownMenuTrigger><DropdownMenuContent className="bank-ledger-menu w-72" align="end">
          <div className="lg:hidden">{classificationItems}
            {canExport ? <DropdownMenuItem disabled={pending || Boolean(dirty)} onSelect={() => setHeaderDialog("export")}><Download />書き出し</DropdownMenuItem> : null}
            <DropdownMenuItem disabled={!configured || syncing || pending || Boolean(dirty)} onSelect={() => setSyncOpen(true)}><RefreshCw />同期</DropdownMenuItem><DropdownMenuSeparator />
          </div>
          <DropdownMenuItem asChild><Link href={`/banking/integrity?company=${company}`}><ShieldCheck />整合性チェック</Link></DropdownMenuItem>
          <DropdownMenuItem disabled={pending || Boolean(dirty)} onSelect={() => setHeaderDialog("audit")}><History />変更履歴</DropdownMenuItem>
          <DropdownMenuItem disabled={pending || Boolean(dirty)} onSelect={() => setHeaderDialog("sync-runs")}><ScrollText />同期の影響{props.syncImpact?.pending ? <span className="ml-auto text-xs text-[var(--tone-amber-fg)]">確認解除 {props.syncImpact.pending}件</span> : null}</DropdownMenuItem>
          <DropdownMenuCheckboxItem checked={Boolean(sync?.autoSync)} disabled={!configured || !admin || pending} onCheckedChange={changeAutoSync}>自動同期（6時間ごと）</DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          {props.aiSettings ? <DropdownMenuItem disabled={pending || Boolean(dirty)} onSelect={() => setHeaderDialog("ai-settings")}><Bot />AI設定</DropdownMenuItem> : null}
          <DropdownMenuItem disabled={pending || Boolean(dirty)} onSelect={() => setSettings(true)}><Settings2 />科目・ルール</DropdownMenuItem>
        </DropdownMenuContent></DropdownMenu>
      </div>
      <div className="bank-sync-status">
        <span role="status" className="min-w-0 truncate" title={syncStatus}>{syncStatus}</span>
        {company === "JAPAN" ? failedCount ? <button type="button" className="bank-autosave-summary text-[var(--tone-amber-fg)]" onClick={() => setDetailId(Object.entries(autosave.entries).find(([, entry]) => entry.status === "failed" || entry.status === "conflict")?.[0] || null)}>保存できなかった明細 {failedCount}件{saveCounts.saving ? `・保存中 ${saveCounts.saving}件` : ""}</button> : <span role="status" className="bank-autosave-summary">{saveCounts.saving ? `保存中 ${saveCounts.saving}件` : "すべて保存済み"}</span> : null}
        {props.selectedBalance?.kind === "BANK" && !props.selectedBalance.unspecified ? <Popover><PopoverTrigger asChild><Button variant="ghost" size="sm" className="bank-balance-trigger">計算残高 {props.selectedBalance.balanceCalculation ? <Money value={props.selectedBalance.balanceCalculation.amount} /> : "未計算"}{props.selectedBalance.balanceCalculation && !props.selectedBalance.balanceCalculation.complete ? <span className="text-[var(--tone-amber-fg)]">暫定</span> : null}<ChevronDown className="size-3" /></Button></PopoverTrigger><PopoverContent className="bank-balance-details w-[min(480px,calc(100vw-24px))]" align="start"><section aria-label="選択口座の計算残高" className="space-y-3 text-sm">
          <h2 className="font-medium">{props.selectedBalance.name}</h2><BankBalanceSummary row={props.selectedBalance} />
          {props.selectedBalance.balanceCalculation ? <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs"><dt>基準日後の入金</dt><dd className="text-right"><Money value={props.selectedBalance.balanceCalculation.income} sign="always" tone="income" /></dd><dt>基準日後の出金</dt><dd className="text-right"><Money value={-props.selectedBalance.balanceCalculation.expense} /></dd></dl> : null}
          <p className="text-xs text-muted-foreground">残高は全明細が対象・下の絞り込みとは別</p>
          <Button asChild variant="outline"><Link href={`/banking/accounts?company=${company}`}><Settings2 className="size-4" />基準残高を確認・変更</Link></Button>
        </section></PopoverContent></Popover> : null}
      </div>
    </header>
    <div className="bank-workflow-line lg:hidden"><WorkflowNav role={props.role} compact /></div>
    <div className="bank-ledger-controls">
      <MonthTabs label="取引月" value={filters.month} months={months} today={bankToday()} disabled={pending} onChange={(month) => navigate({ month })} />
      <FilterPanel activeCount={advancedCount} onReset={hasFilters ? resetFilters : undefined} resetDisabled={pending} primary={<>
        <form id="bank-filters" className="filter-panel-search flex gap-1" onSubmit={(e) => { e.preventDefault(); navigate({ q: search }); }}><Input className="min-w-0 flex-1" aria-label="摘要・メモを検索" placeholder="摘要・メモを検索" value={search} maxLength={200} disabled={pending} onChange={(e) => setSearch(e.target.value)} /><Button type="submit" variant="ghost" size="icon" aria-label="絞り込みを適用" title="絞り込みを適用" disabled={pending}><Search className="size-4" /></Button></form>
        <div className="bank-quick-filters hidden lg:contents">{sideTabs}<OptionTabs label="確認状態の早見" value={bankQuickStatus(filters.status) ?? "advanced"} disabled={pending} options={[["unreviewed", "未確認"], ["reviewed", "確認済み"], ["", "すべて"]]} onChange={(status) => navigate({ status })} /></div>
      </>}>
        <div className="lg:hidden">{sideTabs}</div>
        <select className={`${bankSelectClass} lg:w-60`} aria-label="勘定科目で絞り込み" value={filterEdits.category ?? filters.category} disabled={pending} onChange={(e) => setFilterEdits((current) => ({ ...current, category: e.target.value }))}><option value="">すべての勘定科目</option>{bankCategoryCatalog(categories.map((row) => ({ ...row, available: true }))).map((section) => <optgroup key={section.id} label={section.label}>{section.entries.map(({ category }) => <option key={category.id} value={category.id}>{category.name}</option>)}</optgroup>)}</select>
        <OptionTabs label="並び順" caption="並び順" value={filters.sort} disabled={pending} options={[["date-desc", "取引日が新しい順"], ["date-asc", "取引日が古い順"], ["amount-desc", "金額が大きい順"], ["amount-asc", "金額が小さい順"]]} onChange={(sort) => navigate({ sort })} />
        <OptionTabs label="確認状態で絞り込み" caption="状態" value={filters.status} disabled={pending} options={[["", "すべて"], ["unclassified", "候補の保存待ち"], ["unreviewed", "未確認"], ["reviewed", "確認済み"], ["held", "保留"], ["no-invoice", "請求書不要"], ["transfer", "振替・カード精算"], ["excluded", "対象外"], ["missing", "元明細なし"]]} onChange={(status) => navigate({ status })} />
        <div className="grid min-w-0 flex-1 basis-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 md:grid-cols-[auto_minmax(0,1fr)_auto]">
          <div className="col-span-2 md:col-span-1"><OptionTabs label="検索の一致条件" value={filterEdits.queryMode} disabled={pending} options={[["contains", "部分一致"], ["exact", "摘要の完全一致"]]} onChange={(queryMode) => setFilterEdits((current) => ({ ...current, queryMode }))} /></div>
          <Input form="bank-filters" className="min-w-0" aria-label="除外する検索語" placeholder="除外する語（カンマ区切り）" maxLength={500} value={filterEdits.excludeQuery} disabled={pending} onChange={(event) => setFilterEdits((current) => ({ ...current, excludeQuery: event.target.value }))} />
          <Button form="bank-filters" type="submit" variant="outline" disabled={pending}><Search className="size-4" />条件を適用</Button>
        </div>
      </FilterPanel>
    </div>
    {filterDirty ? <div role="status" className="bank-ledger-notice text-[var(--tone-amber-fg)]">検索条件は未適用<Button variant="ghost" size="icon-sm" title="条件の変更を取り消す" aria-label="条件の変更を取り消す" disabled={pending} onClick={() => { setSearch(filters.query); setFilterEdits({ queryMode: filters.queryMode || "contains", excludeQuery: filters.excludeQuery || "" }); }}><X className="size-4" /></Button></div> : null}
    {classificationPreview ? <div role="status" className="bank-ledger-notice border-l-2 border-[var(--tone-amber-fg)] bg-[var(--tone-amber-bg)] px-2"><span>{aiResult ? `AI判定結果 ${total.toLocaleString()}件` : `分類候補 ${total.toLocaleString()}件`}{aiResult ? <span className="ml-2 text-muted-foreground">候補 {aiResult.suggested}件・うち低確度の推定 {aiResult.lowConfidence}件 / {aiResult.model}</span> : null}</span>{company === "JAPAN" ? <Button variant="outline" size="sm" disabled={pending || filterDirty || !candidates.length} onClick={() => adoptCandidates(candidates, true)}>表示中の候補をすべて採用（{candidates.length}件）</Button> : null}<Button variant="ghost" size="sm" disabled={pending} onClick={() => navigate({})}><X className="size-4" />候補を閉じる</Button></div> : <>
      {filters.analysisThrough ? <div className="bank-ledger-notice border-l-2 border-primary bg-selected px-2"><span>出金分析の対象明細（{filters.analysisThrough}まで）</span><Button variant="ghost" size="sm" disabled={pending} onClick={() => navigate({ analysisThrough: "" })}><X className="size-4" />分析条件を解除</Button></div> : null}
      {filters.transaction ? <div className="bank-ledger-notice border-l-2 border-primary bg-selected px-2"><span>指定された明細を表示中</span><Button variant="ghost" size="sm" disabled={pending} onClick={() => navigate({ transaction: "" })}><X className="size-4" />指定を解除</Button></div> : null}
    </>}
    {(error || sync?.error) && !(company === "JAPAN" && error && saveResult && showActions) ? <div role="alert" className="bank-ledger-notice border-l-2 border-destructive bg-destructive/5 px-2"><CircleAlert className="size-4 shrink-0 text-destructive" /><span className="min-w-0 break-words">{error || sync?.error}</span>{error ? <Button size="icon-sm" variant="ghost" className="ml-auto shrink-0" aria-label="エラーを閉じる" title="閉じる" onClick={() => setError("")}><X className="size-4" /></Button> : null}</div> : null}
    {company !== "JAPAN" && !showActions && (saveResult || saving) ? <p role="status" className="text-xs text-muted-foreground">{saving ? `保存中… / ${savedCount}件保存済み` : saveFeedback}</p> : null}
    <div className="bank-ledger-body"><div className="bank-ledger-layout">
      <section className="bank-ledger-sheet">
        <div className="bank-ledger-totals" aria-label="表示条件の集計">
          <span className="font-medium text-foreground">{monthName(filters.month)} · {total.toLocaleString()}件</span>
          {!classificationPreview ? <><span>入金 <Money value={summary.income} tone="income" /></span><span>出金 <Money value={summary.expense} /></span><span>候補の保存待ち {summary.unclassified}件</span>{summary.excluded ? <span>集計対象外 {summary.excluded}件</span> : null}</> : null}
          <span className="bank-ledger-card-select ml-auto"><BankSelectAllCheckbox {...loadedSelection} disabled={selection.disabled || !rows.length} onChange={selection.selectAll} /></span>
        </div>
        <div role="region" aria-label="口座・カード明細一覧" tabIndex={0} className="bank-ledger-scroll">
          <div className="bank-ledger-table-view">
            <table className="bank-ledger-table" aria-label="口座・カード明細" data-month={Boolean(filters.month)}>
              <colgroup><col className="bank-col-select" /><col className="bank-col-date" /><col /><col className="bank-col-amount" /><col className="bank-col-category" /><col className="bank-col-treatment" /><col className="bank-col-state" /><col className="bank-col-link" /><col className="bank-col-detail" /></colgroup>
              <thead><tr>
                <th scope="col"><BankSelectAllCheckbox {...loadedSelection} disabled={selection.disabled || !rows.length} onChange={selection.selectAll} /></th>
                <th scope="col" aria-sort={filters.sort === "date-desc" ? "descending" : filters.sort === "date-asc" ? "ascending" : "none"}><button type="button" disabled={pending} onClick={() => navigate({ sort: bankLedgerSort(filters.sort, "date") })}>日付{filters.sort.startsWith("date") ? filters.sort.endsWith("desc") ? <ArrowDown /> : <ArrowUp /> : null}</button></th>
                <th scope="col">摘要・口座</th>
                <th scope="col" className="text-right" aria-sort={filters.sort === "amount-desc" ? "descending" : filters.sort === "amount-asc" ? "ascending" : "none"}><button type="button" className="ml-auto" disabled={pending} onClick={() => navigate({ sort: bankLedgerSort(filters.sort, "amount") })}>金額{filters.sort.startsWith("amount") ? filters.sort.endsWith("desc") ? <ArrowDown /> : <ArrowUp /> : null}</button></th>
                <th scope="col">勘定科目</th><th scope="col">扱い</th><th scope="col">根拠・状態</th><th scope="col">照合</th><th scope="col"><span className="sr-only">詳細</span></th>
              </tr></thead>
              <tbody>{rows.map((row) => {
                const value = drafts[row.id] || editFrom(row), controls = fields(row, value);
                const account = accountMap.get(row.bankAccountId) || "口座未取得";
                return <tr key={row.id} {...selection.rowProps(row.id)} tabIndex={0} data-unsaved={Boolean(drafts[row.id]) || undefined} style={{ contentVisibility: "auto", containIntrinsicSize: "auto 42px" }} onKeyDown={(event) => { if (event.target === event.currentTarget && event.key === "Enter" && !isSelectionGesture(event)) { event.preventDefault(); setDetailId(row.id); } }}>
                  <td>{selectionBox(row)}</td>
                  <td><time dateTime={row.transactionDate} title={row.transactionDate} className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">{bankLedgerDate(row.transactionDate, filters.month)}</time></td>
                  <td title={`${row.content || "摘要なし"} / ${account}`}><div className="bank-description"><span className="truncate font-medium">{matchedContent(row.content)}</span><span className="bank-row-account">{account}</span>{value.memo || row.sourceMemo ? <MessageSquareText className="size-3 shrink-0 text-muted-foreground" aria-label={[value.memo ? "メモあり" : "", row.sourceMemo ? "元明細メモあり" : ""].filter(Boolean).join("・")} /> : null}{row.receiptCount ? <Paperclip className="size-3 shrink-0 text-muted-foreground" aria-label={`領収書${row.receiptCount}件添付`} /> : null}</div></td>
                  <td className="text-right"><Money value={row.side === "INCOME" ? row.amount : -row.amount} sign="always" tone={row.side === "INCOME" ? "income" : "plain"} /></td>
                  <td>{controls[0]}</td><td>{controls[1]}</td><td>{status(row, value)}</td>
                  <td><div className="bank-link-cell">{linkButton(row)}{row.settlementConflict ? <span className="bank-link-warning" title={row.settlementConflict} aria-label={`要確認: ${row.settlementConflict}`}><CircleAlert className="size-3" /><span className="sr-only">要確認</span></span> : null}</div></td>
                  <td><Button className="bank-detail-button" variant="ghost" size="sm" aria-label={`${row.content || "摘要なし"}の詳細`} title="詳細" onClick={() => setDetailId(row.id)}><ScrollText className="size-3.5" />詳細</Button></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
          <div className="bank-ledger-cards grid gap-2">{rows.map((row) => {
            const value = drafts[row.id] || editFrom(row), category = categoryMap.get(value.categoryId || ""), child = categoryMap.get(value.subCategoryId || "");
            return <article key={row.id} {...selection.rowProps(row.id)} tabIndex={0} data-unsaved={Boolean(drafts[row.id]) || undefined} style={{ contentVisibility: "auto", containIntrinsicSize: "auto 158px" }} className="record-card min-w-0 p-2" onKeyDown={(event) => { if (event.target === event.currentTarget && event.key === "Enter" && !isSelectionGesture(event)) { event.preventDefault(); setDetailId(row.id); } }}>
              <div className="flex items-center gap-1">{selectionBox(row)}<time className="text-xs tabular-nums text-muted-foreground" title={row.transactionDate}>{row.transactionDate}</time><Money className="ml-auto text-sm font-medium" value={row.side === "INCOME" ? row.amount : -row.amount} sign="always" tone={row.side === "INCOME" ? "income" : "plain"} /></div>
              <h3 className="line-clamp-2 break-words text-sm font-medium" title={row.content}>{matchedContent(row.content)}</h3>
              <p className="truncate text-xs text-muted-foreground">{accountMap.get(row.bankAccountId) || "口座未取得"}</p>
              <p className="truncate text-xs" title={`${category?.name || "科目未設定"}${child ? ` / ${child.name}` : ""}`}>{row.bookkeeping?.splits?.length ? `分割 ${row.bookkeeping.splits.length}科目` : category?.name || "科目未設定"}{child ? ` / ${child.name}` : ""}{value.treatment !== "NORMAL" ? ` · ${treatmentLabels[value.treatment]}` : ""}</p>
              <div className="flex items-center gap-1"><div className="min-w-0 flex-1">{status(row, value)}{row.settlementConflict ? <p className="text-xs text-[var(--tone-amber-fg)]" title={row.settlementConflict}>既存分類・照合を要確認</p> : null}</div>{value.memo || row.sourceMemo ? <MessageSquareText className="size-3 shrink-0 text-muted-foreground" aria-label="メモあり（詳細で確認）" /> : null}{row.receiptCount ? <Paperclip className="size-3 shrink-0 text-muted-foreground" aria-label={`領収書${row.receiptCount}件添付（詳細で確認）`} /> : null}<Button className="bank-detail-button" variant="ghost" size="sm" aria-label={`${row.content || "摘要なし"}の詳細`} title="詳細" onClick={() => setDetailId(row.id)}><ScrollText className="size-4" />詳細</Button></div>
            </article>;
          })}</div>
          {!rows.length ? <p className="py-12 text-center text-sm text-muted-foreground">{!configured ? "接続待ち" : "該当する明細はありません"}</p> : null}
          <div ref={sentinel} className="flex min-h-14 flex-wrap items-center justify-center gap-3 py-3 text-sm" aria-live="polite">
            <span className="text-muted-foreground">読み込み済み {rows.length.toLocaleString()} / {total.toLocaleString()}件</span>
            {loadingMore ? <LoaderCircle aria-label="明細を読み込み中" className="size-4 animate-spin" /> : null}
            {loadError ? <span role="alert" className="text-destructive">{loadError}</span> : null}
            {loadError || saveResult?.uncertain ? <Button variant="outline" disabled={pending} onClick={refreshLoadedRows}><RefreshCw className="size-4" />選択・編集を保持して更新</Button> : null}
            {hasMore ? <Button variant="ghost" disabled={pending || loadingMore || loadStale} onClick={() => void loadMore()}><RefreshCw className="size-4" />{loadError ? "再試行" : "続きを読み込む"}</Button> : null}
          </div>
        </div>
      </section>
      <aside ref={categoryRail} aria-label="勘定科目の選択" className="bank-category-rail">{reviewPanel}<div className="min-h-0 flex-1"><BankCategoryPicker categories={categories} targets={categoryTargets} disabled={categoryDisabled} onApply={applyCategory} /></div></aside>
    </div>
    </div>
    {company === "JAPAN" ? showActions ? <footer className="bank-ledger-savebar is-unified" aria-label="明細の選択の操作">
      <div className="bank-actions-content">
        {selected.size ? <>
          <div className="bank-selected-summary" role="status"><div className="flex items-baseline gap-2"><span className="whitespace-nowrap">{selected.size}件<span className="bank-selected-desktop">を選択中</span></span><Money className="bank-selection-amount text-xs" value={bankSelectionAmount(categoryTargets)} tone="muted" /></div>
            {loadedSelection.all && total > rows.length ? <button type="button" className="bank-select-matching" disabled={pending || filterDirty} onClick={selectMatching}>検索結果の全 {total.toLocaleString()}件を選択</button> : null}
            {matchingSnapshot ? <span className="bank-selection-snapshot" title={`検索結果の確定範囲 ${matchingSnapshot.length}件 / 選択 ${selected.size}件 / 選択解除 ${matchingSnapshot.filter((id) => !selected.has(id)).length}件（対象外は自動選択しません）`}>確定範囲 {matchingSnapshot.length}件</span> : null}
          </div>
          <Button className="bank-review-selected" size="sm" aria-label="確認済みにする" disabled={pending || filterDirty} onClick={() => reviewSelection(true)}><CheckCheck className="size-4" /><span className="hidden lg:inline">確認済みにする</span><span className="lg:hidden">確認</span></Button>
          {selectedCandidates.length ? <Button className="bank-adopt-candidates" variant="outline" size="sm" disabled={pending || filterDirty} onClick={() => adoptCandidates(selectedCandidates)}>候補を採用（{selectedCandidates.length}件）</Button> : null}
          {reviewedCount ? <Button className="bank-unreview-selected" variant="ghost" size="sm" disabled={pending || filterDirty} onClick={() => reviewSelection(false)}>未確認に戻す</Button> : null}
          <Button className="bank-change-category" variant="outline" size="sm" aria-label="科目を変更" disabled={categoryDisabled} onClick={() => openCategories()}><ListTree className="size-4" /><span>科目<span className="hidden lg:inline">を変更</span></span></Button>
          <div className="bank-extra-actions">
            <select className={`${bankSelectClass} bank-bulk-treatment`} aria-label="選択明細の扱いを一括変更" value="" disabled={categoryDisabled} onChange={(e) => bulk({ treatment: e.target.value as BankEdit["treatment"], reviewed: false })}><option value="" disabled>扱いを変更</option>{Object.entries(treatmentLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
            <Button variant="outline" size="sm" disabled={classificationDisabled} onClick={openClassification}><WandSparkles className="size-4" />自動分類</Button>
            <Button variant="outline" size="sm" disabled={classificationDisabled} onClick={() => openAi("selected")}><Bot className="size-4" />AI分類</Button>
          </div>
          <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="icon-sm" aria-label="選択の操作" title="選択の操作" disabled={pending || filterDirty}><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger><DropdownMenuContent className="bank-ledger-menu w-72" align="end">
            <DropdownMenuLabel>{selected.size}件を選択中 · <Money value={bankSelectionAmount(categoryTargets)} /></DropdownMenuLabel>
            {matchingSnapshot ? <DropdownMenuLabel className="whitespace-normal">検索結果の確定範囲 {matchingSnapshot.length}件 / 選択解除 {matchingSnapshot.filter((id) => !selected.has(id)).length}件（対象外は自動選択しません）</DropdownMenuLabel> : null}
            {loadedSelection.all && total > rows.length ? <DropdownMenuItem onSelect={selectMatching}>検索結果の全 {total.toLocaleString()}件を選択</DropdownMenuItem> : null}
            {reviewedCount ? <DropdownMenuItem onSelect={() => reviewSelection(false)}>未確認に戻す</DropdownMenuItem> : null}
            <DropdownMenuSub><DropdownMenuSubTrigger disabled={categoryDisabled}>扱いを変更</DropdownMenuSubTrigger><DropdownMenuSubContent className="bank-ledger-menu w-52">{Object.entries(treatmentLabels).map(([key, label]) => <DropdownMenuItem key={key} onSelect={() => bulk({ treatment: key as BankEdit["treatment"], reviewed: false })}>{label}</DropdownMenuItem>)}</DropdownMenuSubContent></DropdownMenuSub>
            <DropdownMenuItem disabled={classificationDisabled} onSelect={openClassification}><WandSparkles />自動分類</DropdownMenuItem>
            <DropdownMenuItem disabled={classificationDisabled} onSelect={() => openAi("selected")}><Bot />AI分類</DropdownMenuItem>
            <DropdownMenuSeparator /><DropdownMenuItem onSelect={selection.clear}><X />選択解除</DropdownMenuItem>
          </DropdownMenuContent></DropdownMenu>
          <Button className="bank-clear-selection" variant="ghost" size="icon-sm" title="選択解除" aria-label="選択解除" disabled={pending} onClick={selection.clear}><X className="size-4" /></Button>
        </> : null}
      </div>
    </footer> : null : <footer className="bank-ledger-savebar shadow-sm" aria-label="明細の保存">
      <div className="grid w-full min-w-0 gap-2 rounded-xl border border-primary/20 bg-selected p-2">
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
    </footer>}
    <RecordDetail wide={false} open={Boolean(detailRow)} title="口座明細の詳細" label="口座明細の詳細" resetKey={detailId} onClose={() => setDetailId(null)} onPrevious={detailIndex > 0 ? () => setDetailId(rows[detailIndex - 1].id) : undefined} onNext={detailIndex >= 0 && detailIndex < rows.length - 1 ? () => setDetailId(rows[detailIndex + 1].id) : undefined}>
      {detailRow && detailValue ? <div className="bank-ledger-detail space-y-5">
        {error ? <OperationError message={error} /> : null}
        <h2 className="break-words text-lg font-medium">{matchedContent(detailRow.content)}</h2>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm"><dt className="text-muted-foreground">日付</dt><dd>{detailRow.transactionDate}</dd><dt className="text-muted-foreground">口座</dt><dd className="break-words">{accountMap.get(detailRow.bankAccountId) || "口座未取得"}</dd><dt className="text-muted-foreground">金額</dt><dd><Money className="text-lg font-medium" value={detailRow.side === "INCOME" ? detailRow.amount : -detailRow.amount} sign="always" tone={detailRow.side === "INCOME" ? "income" : "plain"} /></dd></dl>
        {detailRow.sourceMemo ? <section className="space-y-1"><h3 className="text-xs text-muted-foreground">元明細メモ</h3><p className="whitespace-pre-wrap break-words text-sm">{detailRow.sourceMemo}</p></section> : null}
        <div className="grid gap-3 text-sm"><div className="space-y-1"><span className="text-xs text-muted-foreground">勘定科目</span>{fields(detailRow, detailValue)[0]}</div><label className="grid gap-1"><span className="text-xs text-muted-foreground">扱い</span>{fields(detailRow, detailValue)[1]}</label><label className="grid gap-1"><span className="text-xs text-muted-foreground">メモ</span>{fields(detailRow, detailValue)[2]}</label></div>
        <section className="space-y-2">{company === "JAPAN" && detailSave?.error ? null : status(detailRow, detailValue)}<p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">根拠の理由: {detailValue.classificationReason || "分類の理由は記録されていません"}</p></section>
        {company === "JAPAN" && detailSave?.error ? <section role="alert" className="space-y-2 rounded-lg border border-[var(--tone-amber-fg)] p-3 text-sm">
          <p className="font-medium">{detailSave.status === "conflict" ? "競合" : "保存できませんでした"}</p><p className="whitespace-pre-wrap break-words">{detailSave.error}</p>
          {detailSave.status === "conflict" ? <><p>自分の変更を保持しています。最新の内容を確認し、変更を取り消してから編集し直してください。</p><Button variant="outline" disabled={pending} onClick={() => reloadConflict(detailRow.id)}>最新の内容を読み込む</Button></> : <Button variant="outline" onClick={() => autosave.queue.retry(detailRow.id)}>この明細を再試行</Button>}
          {detailLatest ? <div className="space-y-1 border-t pt-2"><p className="font-medium">保存済みの最新内容</p><p>{categoryMap.get(detailLatest.categoryId || "")?.name || "科目未設定"}{detailLatest.subCategoryId ? ` / ${categoryMap.get(detailLatest.subCategoryId)?.name || "補助科目"}` : ""}・{treatmentLabels[detailLatest.treatment]}・{detailLatest.reviewed ? "確認済み" : "未確認"}</p><p className="whitespace-pre-wrap break-words">メモ: {detailLatest.memo || "なし"}</p></div> : null}
        </section> : null}
        {company === "JAPAN" ? <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={pending || filterDirty || autosave.undoing.includes(detailRow.id)} onClick={() => reviewSelection(!detailValue.reviewed, undefined, [detailRow], false)}>{detailValue.reviewed ? "未確認に戻す" : "確認済みにする"}</Button>{detailRow.predictionPending && !drafts[detailRow.id] ? <Button variant="outline" disabled={pending || filterDirty} onClick={() => adoptCandidates([detailRow], false, false)}>候補を採用</Button> : null}</div> : null}
        {detailSales ? <section className="bank-sales-hint space-y-2 rounded-lg border p-3 text-sm"><p>請求書と照合済みの入金。{detailSales.categoryName ? `売上系の科目「${detailSales.categoryName}」を提案` : "売上系の科目を提案"}</p><p className="break-words text-xs text-muted-foreground">{detailSales.reason}</p><div className="flex flex-wrap gap-2">{detailSales.categoryId ? <Button variant="outline" disabled={pending || filterDirty || Boolean(detailRow.bookkeeping?.splits?.length)} aria-label={`${detailRow.content}に売上科目「${detailSales.categoryName}」を適用`} onClick={() => edit(detailRow, { categoryId: detailSales.categoryId, subCategoryId: undefined, classificationReason: "発行請求書と照合済みの入金（売上科目の提案を採用・未確定）" })}>提案を採用</Button> : null}<Button variant="outline" disabled={pending || filterDirty || Boolean(detailRow.bookkeeping?.splits?.length)} onClick={() => openCategories(detailRow)}>科目を選ぶ</Button></div></section> : null}
        <section className="space-y-2"><div className="flex flex-wrap items-center gap-2">{linkButton(detailRow)}<BankBookkeepingDialog key={`bookkeeping:${detailRow.id}`} company={company} transaction={detailRow} categories={categories} showLabel disabled={pending || Boolean(dirty)} onSaved={(saved) => setSavedRows((current) => ({ ...current, [saved.id]: { ...detailRow, ...saved, predictionPending: false } }))} /><BankBulkReclassifyDialog key={`bulk:${detailRow.id}`} company={company} row={detailRow} accountName={accountMap.get(detailRow.bankAccountId)} categories={categories} showLabel disabled={pending || Boolean(dirty) || detailRow.sourceMissing} onApplied={() => router.refresh()} /></div>{detailRow.settlementConflict ? <p className="break-words text-sm text-[var(--tone-amber-fg)]">既存分類・照合を要確認: {detailRow.settlementConflict}</p> : null}</section>
        <BankDetailDocuments key={`documents:${detailRow.id}:${documentsVersion}`} company={company} transactionId={detailRow.id} disabled={pending} onChanged={() => router.refresh()} />
        {drafts[detailRow.id] ? <Button variant="ghost" aria-label={`${detailRow.content}の編集を破棄`} disabled={pending || detailSave?.status === "saving"} onClick={() => discardRow(detailRow)}><X className="size-4" />この変更を取り消す</Button> : null}
      </div> : null}
    </RecordDetail>
    {headerDialog === "audit" ? <BankAuditDialog company={company} open onOpenChange={closeHeaderDialog} /> : null}
    {headerDialog === "sync-runs" ? <BankSyncRunsDialog company={company} open onOpenChange={closeHeaderDialog} pending={props.syncImpact?.pending ?? 0} /> : null}
    {headerDialog === "ai-settings" && props.aiSettings ? <BankAiSettings {...props.aiSettings} open onOpenChange={closeHeaderDialog} /> : null}
    {headerDialog === "export" ? <SectionExportDialog scope="banking" role={props.role} open onOpenChange={closeHeaderDialog} /> : null}

    {company !== "JAPAN" && savePreview ? <BankSavePreviewDialog preview={savePreview} categories={categories} busy={pending} onClose={() => setSavePreview(null)} onSave={save} error={error} /> : null}
    {guessReview ? <BankGuessReviewDialog guesses={guessReview.guesses} others={guessReview.others} categories={categories} busy={pending} onClose={() => setGuessReview(null)} onConfirm={(acknowledgeGuesses) => reviewSelection(true, { acknowledgeGuesses }, guessReview.targets, guessReview.confirmUnloaded)} /> : null}
    <Dialog open={Boolean(bulkConfirmation)} onOpenChange={(open) => { if (!open) setBulkConfirmation(null); }}><DialogContent>
      <DialogHeader><DialogTitle>{bulkConfirmation?.changes.length}件の明細を変更します</DialogTitle><DialogDescription>「検索結果の全件を選択」で読み込み済みの範囲を超えて選択した明細を含みます。</DialogDescription></DialogHeader>
      <p className="break-words text-sm">変更内容: {bulkConfirmation?.description}</p><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setBulkConfirmation(null)}>キャンセル</Button><Button disabled={pending || filterDirty} onClick={() => { if (bulkConfirmation) autosave.queue.enqueue(bulkConfirmation.changes, bulkConfirmation.label, bulkConfirmation.notify); setBulkConfirmation(null); }}>変更して保存</Button></div>
    </DialogContent></Dialog>
    <Dialog open={categoryPickerOpen} onOpenChange={setCategoryPickerOpen}>
      <DialogContent aria-describedby={undefined} showCloseButton={false} className="top-0 left-auto right-0 h-dvh max-h-dvh w-full max-w-sm translate-x-0 translate-y-0 grid-rows-[auto_minmax(0,1fr)] gap-0 rounded-none p-0 sm:max-w-sm" onInteractOutside={(event) => event.preventDefault()}>
        <DialogHeader className="border-b py-4 pl-3 pr-14"><DialogTitle>科目・確認</DialogTitle></DialogHeader>
        <Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1 size-11" aria-label="科目一覧を閉じる" title="閉じる" onClick={() => setCategoryPickerOpen(false)}><X className="size-4" /></Button>
        <div className="min-h-0 flex flex-col">{reviewPanel}<div className="min-h-0 flex-1"><BankCategoryPicker categories={categories} targets={categoryTargets} disabled={categoryDisabled} onApply={applyCategory} /></div></div>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(leaveUrl)} onOpenChange={(open) => { if (!open && !pending && !leaving) setLeaveUrl(null); }}>
      <DialogContent showCloseButton={!pending && !leaving} onInteractOutside={(event) => event.preventDefault()} onEscapeKeyDown={(event) => event.preventDefault()}>
        <DialogHeader><DialogTitle>{company !== "JAPAN" ? "未保存の変更があります" : failedCount ? `保存できなかった変更が ${failedCount}件あります` : saveCounts.saving ? "保存中の変更があります" : "すべて保存済みです"}</DialogTitle><DialogDescription>{company !== "JAPAN" ? `${dirty}件の編集内容が未保存です。` : saveCounts.saving ? "保存が終わるまで待つか、未送信の変更を捨てて移動できます。送信済みの変更は完了を待って移動します。" : failedCount ? "変更内容はこの画面に保持されています。" : "変更は保存されました。そのまま移動できます。"}</DialogDescription></DialogHeader>
        {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button className="min-h-11" variant="outline" disabled={pending || leaving} onClick={() => setLeaveUrl(null)}>{company === "JAPAN" ? saveCounts.saving ? "待つ" : "この画面に残る" : "キャンセル"}</Button>
          <Button className="min-h-11" variant="ghost" disabled={pending || leaving || Boolean(autosave.undoing.length)} onClick={async () => { const destination = leaveUrl; setLeaving(true); if (company === "JAPAN") await autosave.queue.discardAll(); setDrafts({}); setClassificationPreview(null); setAiResult(null); setSelected(new Set()); setLeaveUrl(null); setLeaving(false); if (destination) startTransition(() => router.push(destination)); }}>{leaving ? "送信済みの変更を確認中…" : company === "JAPAN" ? leaveBlocked ? "変更を捨てて移動" : "移動する" : "破棄して移動"}</Button>
          {company !== "JAPAN" ? <Button className="min-h-11" disabled={pending} onClick={() => { const destination = leaveUrl || undefined; setLeaveUrl(null); prepareSave("edited", destination); }}><Save className="size-4" />保存内容を確認して移動</Button> : null}
        </div>
      </DialogContent>
    </Dialog>
    <BankingSettings key={settings ? "open" : "closed"} company={company} accounts={accounts} categories={categories} rules={rules} open={settings} onOpenChange={setSettings} onCloseAutoFocus={(event) => { event.preventDefault(); headerMenu.current?.focus(); }} />
    {linkData ? <BankLinksDialog key={linkData.bank.id} company={company} initial={linkData} onClose={() => { setLinkData(null); setDocumentsVersion((value) => value + 1); }}
      next={nextMatch ? { label: `${nextMatch.transactionDate} ${nextMatch.content || "摘要なし"}`, open: () => { setLinkData(null); setDocumentsVersion((value) => value + 1); if (detailId) setDetailId(nextMatch.id); openLinks(nextMatch); } } : undefined} /> : null}
    <BankClassificationAiDialog key={aiOpen ? "ai-open" : "ai-closed"} company={company} open={aiOpen} onOpenChange={setAiOpen} rowIds={rows.map((row) => row.id)} selectedIds={rows.filter((row) => selected.has(row.id)).map((row) => row.id)} initialScope={aiScope} initialHistory={aiHistory} onResult={(result) => {
      autosave.queue.clearCompleted();
      setClassificationPreview(result.rows.map((row) => ({ ...row, predictionPending: true }))); setAiResult({ suggested: result.suggested, lowConfidence: result.lowConfidence, model: result.model });
      setError(""); setMatchingSnapshot(null); setUnloadedSelection(new Set()); setSelected(new Set());
    }} />
    <Dialog open={classifyOpen} onOpenChange={(value) => { if (!pending) setClassifyOpen(value); }}>
      <DialogContent showCloseButton={!pending} onInteractOutside={(event) => event.preventDefault()} onEscapeKeyDown={(event) => event.preventDefault()}>
        <DialogHeader><DialogTitle>勘定科目の自動分類</DialogTitle><DialogDescription>分類結果は未保存の候補です。手動変更・確認済みの明細は対象外です。</DialogDescription></DialogHeader>
        <div className="grid min-w-0 gap-1 text-sm">対象<OptionTabs label="自動分類の対象" value={classifyScope} disabled={pending} options={[...(selected.size ? [["selected", `選択した明細（${selected.size}件）`] as const] : []), ["all", `${company === "JAPAN" ? "日本" : "中国"}の全期間・全口座`] as const, ...(rows.length ? [["page", `表示中の明細（${rows.length}件）`] as const] : [])]} onChange={(value) => { setClassifyScope(value as typeof classifyScope); setClassificationEmpty(null); setError(""); }} /></div>
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
        <div className="grid min-w-0 gap-1 text-sm">取得範囲<OptionTabs label="取得範囲" value={mode} disabled={syncing} options={[["recent", "通常同期（初回は全期間）"], ["all", "取得可能な全期間を再同期"], ["range", "期間指定"]]} onChange={(value) => setMode(value as typeof mode)} /></div>
        {mode === "range" ? <div className="grid min-w-0 gap-3"><label className="grid min-w-0 gap-1 text-sm">開始日<Input type="date" className="h-11 min-w-0" value={start} max={end} disabled={syncing} onChange={(e) => setStart(e.target.value)} /></label><label className="grid min-w-0 gap-1 text-sm">終了日<Input type="date" className="h-11 min-w-0" value={end} min={start} max={bankToday()} disabled={syncing} onChange={(e) => setEnd(e.target.value)} /></label></div> : null}
        {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
        <Button className="min-h-11" disabled={syncing || !configured} onClick={beginSync}>{syncing ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}すべての口座・カードを同期</Button>
      </DialogContent>
    </Dialog>
  </div>;
}
