"use client";

import Image from "next/image";
import { useListSelection } from "@/hooks/use-list-selection";
import { RowSelectionCheckbox, SelectAllCheckbox, SelectionToolbar } from "@/components/app/list-selection";
import Link from "next/link";
import { Fragment, useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Download, ExternalLink, FileText, LoaderCircle, Save, Search, Trash2, X } from "lucide-react";
import { RecordMonthNavigation, RecordSaveBar, recordMonthLabel, recordSelectClass } from "@/components/app/record-list-controls";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { groupIssuedDocuments, issuedListSummary, issuedRowAmounts, type IssuedGrouping } from "@/lib/issued-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { documentCategoryLabels, documentKindLabels, issuedStatusLabels, type DocumentRow } from "@/lib/documents";
import type { CompanyScope } from "@/lib/company";
import { deleteIssuedInvoices, saveIssuedInvoiceEdits, type IssuedEdit } from "@/app/issued-invoices/actions";
import { DocumentContextMenu, DocumentMenuButton } from "@/components/app/document-row-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { todayIso } from "@/lib/format";
import { EstimateStatusSelect } from "@/components/app/estimate-status-select";
import type { Estimate } from "@/lib/types";
import { documentCounterpartKey, documentProjectOptions, groupDocuments, orderDocuments, type DocumentProjectOption } from "@/lib/document-order";

const selectClass = "h-11 max-w-full rounded-md border bg-background px-3 text-sm";
const pageSize = 50;
type ProjectOption = DocumentProjectOption;
const number = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 });
const monthLabel = (month: string) => month === "undated" ? "日付未設定" : month.replace("-", "年") + "月";

function editFrom(row: DocumentRow): IssuedEdit {
  return { id: row.sourceId, updatedAt: row.updatedAt, invoiceNumber: row.title, projectId: row.projectId || "",
    issueDate: row.date, dueDate: row.dueDate || "", total: row.total || 0, status: row.status as IssuedEdit["status"], needsReview: Boolean(row.needsReview) };
}

function StateBadge({ row }: { row: DocumentRow }) {
  const tone = row.state === "done" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : row.state === "review" ? "bg-amber-500/10 text-amber-800 dark:text-amber-300" : "bg-sky-500/10 text-sky-700 dark:text-sky-300";
  return <span className={"inline-flex max-w-full whitespace-nowrap rounded px-2 py-1 text-xs " + tone}>{row.statusLabel}</span>;
}

function DocumentProjectControl({ row, edit, projects, disabled, onEdit }: {
  row: DocumentRow; edit?: IssuedEdit; projects: ProjectOption[]; disabled: boolean; onEdit: (edit: IssuedEdit) => void;
}) {
  const value = edit?.projectId ?? row.projectId ?? "";
  const options = useMemo(() => documentProjectOptions(projects, value), [projects, value]);
  const name = options.find((p) => p.value === value)?.label || row.projectName || "案件未設定";
  if (row.kind !== "issued" || !row.editable) return <span className="block break-words font-medium">{name}</span>;
  const paid = (row.paidAmount || 0) > 0;
  return <select aria-label={`${row.title}の案件`} title={paid ? `${name}（入金記録あり・案件変更不可）` : name} value={value} disabled={disabled || paid}
    className="h-11 w-full min-w-0 max-w-full rounded-md border border-transparent bg-transparent px-1 text-sm font-medium hover:border-input focus:border-ring disabled:opacity-70"
    onChange={(e) => onEdit({ ...(edit || editFrom(row)), projectId: e.target.value })}>
    {!options.some((p) => p.value === value) ? <option value={value}>{name}</option> : null}
    {options.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
  </select>;
}

function editedRow(row: DocumentRow, edit?: IssuedEdit): DocumentRow {
  if (!edit) return row;
  return { ...row, title: edit.invoiceNumber, date: edit.issueDate, total: edit.total, status: edit.status,
    statusLabel: issuedStatusLabels[edit.status],
    state: ["PAID", "CANCELED"].includes(edit.status) ? "done" : edit.needsReview || edit.status === "DRAFT" ? "review" : "open" };
}

function DocumentStatusControl({ row, edit, onEdit, company, disabled }: { row: DocumentRow; edit?: IssuedEdit; onEdit: (edit: IssuedEdit) => void; company: CompanyScope; disabled: boolean }) {
  if (row.kind === "estimate") return <EstimateStatusSelect id={row.sourceId} updatedAt={row.updatedAt} status={row.status as Estimate["status"]} label={row.title} company={company} disabled={!row.editable || disabled} />;
  if (row.kind !== "issued" || !row.editable) return <StateBadge row={row} />;
  const current = edit || editFrom(row);
  return <select aria-label={`${row.title}のステータス`} value={current.status} disabled={disabled} className={`${selectClass} h-11 w-full min-w-0 px-2 text-xs ${current.status === "PAID" ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-300" : ""}`} onChange={(e) => onEdit({ ...current, status: e.target.value as IssuedEdit["status"] })}>
    {Object.entries(issuedStatusLabels).map(([value, label]) => <option key={value} value={value} disabled={value === "PARTIALLY_PAID"}>{label}</option>)}
  </select>;
}

function IssuedAmounts({ row }: { row: DocumentRow }) {
  const amounts = issuedRowAmounts(row);
  return <div className="space-y-1 text-xs tabular-nums" title="保存済みの入金記録">
    <span className="block text-emerald-700 dark:text-emerald-400">入金 {number.format(amounts.paid)}</span>
    <span className="block text-muted-foreground">未入金 {number.format(amounts.outstanding)}</span>
  </div>;
}

function IssuedReviewControl({ row, edit, disabled, onEdit }: { row: DocumentRow; edit?: IssuedEdit; disabled: boolean; onEdit: (edit: IssuedEdit) => void }) {
  return row.imported ? <label className="flex min-h-11 items-center justify-center gap-2 py-2"><input type="checkbox" className="size-5 accent-primary" aria-label={`${row.title}の原本を確認済みにする`} checked={!(edit?.needsReview ?? row.needsReview)} disabled={disabled || !row.editable} onChange={(event) => onEdit({ ...(edit || editFrom(row)), needsReview: !event.target.checked })} /><span className="text-xs md:hidden">原本確認済み（任意）</span></label> : <span className="block p-2 text-center text-xs text-muted-foreground">作成済み</span>;
}

function DocumentDetails({ row, company, edit, onEdit, projects, disabled, view = "all" }: {
  row: DocumentRow; company: CompanyScope; edit?: IssuedEdit; onEdit: (value: IssuedEdit) => void;
  projects: ProjectOption[]; disabled: boolean; view?: "all" | "edit" | "file";
}) {
  const [detail, setDetail] = useState<{ ocrText: string; warnings: string[]; clientName: string; memo: string } | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/documents/" + encodeURIComponent(row.id) + "?company=" + company, { signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error("詳細を読み込めませんでした"); return response.json(); })
      .then((body) => { if (!controller.signal.aborted) { setDetail(body); setError(""); } })
      .catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "読込に失敗しました"); });
    return () => controller.abort();
  }, [row.id, row.updatedAt, company, attempt]);
  const current = edit || editFrom(row);
  const update = (patch: Partial<IssuedEdit>) => onEdit({ ...current, ...patch });
  const editable = row.kind === "issued" && row.editable;
  const generated = row.kind === "estimate" || (row.kind === "issued" && !row.imported);
  const fileUrl = generated && row.fileUrl?.startsWith("/api/") ? `${row.fileUrl}?v=${encodeURIComponent(row.updatedAt)}` : row.fileUrl;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      <StateBadge row={editedRow(row, edit)} />
      {(edit?.needsReview ?? row.needsReview) ? <span className="text-xs text-amber-700 dark:text-amber-300">OCR要確認</span> : null}
      <span className="text-xs text-muted-foreground">{documentKindLabels[row.kind]}</span>
      {fileUrl ? <Button asChild variant="outline" size="sm"><a href={fileUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="size-4" />{generated ? "PDFを開く" : "原本を開く"}</a></Button> : null}
      {view === "all" ? <Button asChild variant="ghost" size="sm"><Link prefetch={false} href={row.sourceHref}>管理画面</Link></Button> : null}
    </div>
    {view !== "edit" ? <>{edit ? <p className="text-xs text-amber-700 dark:text-amber-300">未保存の変更あり・原本は保存済みの内容</p> : null}{fileUrl ? (
      row.mimeType?.startsWith("image/") ? <div className="relative h-72 bg-muted/30 sm:h-96"><Image unoptimized src={fileUrl} alt={row.fileName || row.title} fill sizes="(max-width: 1279px) 100vw, 420px" className="object-contain" /></div>
        : <iframe title={(generated ? `${documentKindLabels[row.kind]}PDF: ` : "原本: ") + row.title} src={fileUrl} loading="lazy" className="h-80 w-full rounded border bg-white sm:h-[440px]" />
    ) : <div className="flex h-32 items-center justify-center bg-muted/30 text-sm text-muted-foreground">原本ファイルなし</div>}</> : null}
    {view !== "file" ? editable ? <fieldset disabled={disabled} className="grid min-w-0 gap-3">
      <label className="space-y-1 text-xs">請求書番号<Input aria-label="請求書番号" value={current.invoiceNumber} onChange={(e) => update({ invoiceNumber: e.target.value })} /></label>
      <label className="grid gap-1 text-xs">案件<select aria-label="編集する案件" disabled={(row.paidAmount || 0) > 0} className={selectClass + " w-full"} value={current.projectId} onChange={(e) => update({ projectId: e.target.value })}>{documentProjectOptions(projects, current.projectId).map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select></label>
      <div className="text-xs text-muted-foreground break-words">請求先: {current.projectId === row.projectId ? row.counterpart : projects.find((p) => p.value === current.projectId)?.clientName || row.counterpart}{detail?.clientName ? " / OCR請求先: " + detail.clientName : ""}</div>
      <div className="grid min-w-0 grid-cols-2 gap-3">
        <label className="min-w-0 space-y-1 text-xs">発行日<Input aria-label="発行日" type="date" value={current.issueDate} onChange={(e) => update({ issueDate: e.target.value })} /></label>
        <label className="min-w-0 space-y-1 text-xs">入金期限<Input aria-label="入金期限" type="date" value={current.dueDate} onChange={(e) => update({ dueDate: e.target.value })} /></label>
      </div>
      <label className="space-y-1 text-xs">請求金額<Input aria-label="請求金額" type="number" min="0" step="0.01" readOnly={!row.imported || (row.paidAmount || 0) > 0} value={current.total} onChange={(e) => update({ total: Number(e.target.value) })} /></label>
      <label className="grid gap-1 text-xs">状態<DocumentStatusControl row={row} edit={edit} onEdit={onEdit} company={company} disabled={disabled} /></label>
      <div className="flex flex-wrap justify-between gap-2 text-xs tabular-nums" title="保存済みの入金記録"><span>入金額 {number.format(issuedRowAmounts(row).paid)}</span><span>未入金額 {number.format(issuedRowAmounts(row).outstanding)}</span></div>
      {row.imported ? <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={!current.needsReview} onChange={(e) => update({ needsReview: !e.target.checked })} />原本と内容を確認済み（任意）</label> : null}
    </fieldset> : <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2 text-sm">
      <dt className="text-muted-foreground">取引先</dt><dd className="break-words">{row.counterpart || "未設定"}</dd>
      <dt className="text-muted-foreground">案件</dt><dd className="break-words">{row.projectName || "未設定"}</dd>
      <dt className="text-muted-foreground">書類日</dt><dd>{row.date || "未設定"}</dd>
      <dt className="text-muted-foreground">分類</dt><dd>{documentCategoryLabels[row.category] || row.category}</dd>
      {row.kind === "estimate" ? <><dt className="text-muted-foreground">状態</dt><dd><DocumentStatusControl row={row} onEdit={onEdit} company={company} disabled={disabled} /></dd></> : null}
      {row.total !== undefined ? <><dt className="text-muted-foreground">金額</dt><dd>{number.format(row.total)}</dd></> : null}
    </dl> : null}
    {detail?.warnings.length ? <ul className="space-y-1 border-l-2 border-amber-500 pl-3 text-xs text-amber-800 dark:text-amber-300">{detail.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul> : null}
    {view !== "edit" ? <div className="space-y-2 border-t pt-3"><h3 className="text-sm font-medium">OCR本文</h3>
      {error ? <div role="alert" className="text-sm text-destructive">{error}<Button variant="ghost" size="sm" onClick={() => setAttempt((v) => v + 1)}>再読込</Button></div> :
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-sans text-xs leading-5 text-muted-foreground">{detail ? detail.ocrText || "OCR本文なし" : "読込中..."}</pre>}
    </div> : null}
  </div>;
}

export function DocumentsWorkspace({ rows, company, projects = [], canExport = false, initialId, issuedOnly = false, showIssuedSummary = false }: {
  rows: DocumentRow[]; company: CompanyScope; projects?: ProjectOption[]; canExport?: boolean; initialId?: string; issuedOnly?: boolean; showIssuedSummary?: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [kind, setKind] = useState("all");
  const [category, setCategory] = useState("all");
  const [state, setState] = useState("all");
  const [month, setMonth] = useState("all");
  const [sort, setSort] = useState("date-desc");
  const [grouping, setGrouping] = useState<IssuedGrouping>("none");
  const [invoiceStatus, setInvoiceStatus] = useState("all");
  const [leaveUrl, setLeaveUrl] = useState<string | null>(null);
  const [afterSave, setAfterSave] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [counterpart, setCounterpart] = useState("all");
  const [limit, setLimit] = useState(pageSize);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState(initialId || "");
  const [edits, setEdits] = useState<Record<string, IssuedEdit>>({});
  const [saving, startSave] = useTransition();
  const [deleting, startDelete] = useTransition();
  const [deleteTargets, setDeleteTargets] = useState<DocumentRow[]>([]);
  const [paymentConfirm, setPaymentConfirm] = useState(false);
  const [paymentFilter, setPaymentFilter] = useState("all");
  const preview = useRef<HTMLElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const changes = Object.keys(edits).length;
  useEffect(() => {
    if (!changes) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    const intercept = (e: MouseEvent) => {
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      const link = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      const url = new URL(link.href);
      if (url.origin !== window.location.origin || url.href === window.location.href) return;
      e.preventDefault(); e.stopPropagation();
      if (!saving && !deleting) setLeaveUrl(url.pathname + url.search + url.hash);
    };
    document.addEventListener("click", intercept, true);
    return () => { window.removeEventListener("beforeunload", handler); document.removeEventListener("click", intercept, true); };
  }, [changes, saving, deleting]);

  const filtered = useMemo(() => {
    const q = deferredQuery.normalize("NFKC").toLocaleLowerCase();
    return orderDocuments(rows.filter((r) => (kind === "all" || r.kind === kind) && (category === "all" || r.category === category) && (state === "all" || r.state === state) &&
      (paymentFilter === "all" || (!issuedOnly && kind !== "issued") || (r.kind === "issued" && (paymentFilter === "paid" ? r.status === "PAID" : !["PAID", "DRAFT", "CANCELED"].includes(r.status)))) &&
      (!issuedOnly || invoiceStatus === "all" || (invoiceStatus === "review" ? r.needsReview : r.status === invoiceStatus)) &&
      (counterpart === "all" || documentCounterpartKey(r) === counterpart) &&
      (month === "all" || r.month === month) && [r.title, r.counterpart, r.projectName, r.billingLabel || "", r.fileName || ""].join(" ").normalize("NFKC").toLocaleLowerCase().includes(q)), sort);
  }, [rows, deferredQuery, kind, category, state, month, sort, paymentFilter, issuedOnly, counterpart, invoiceStatus]);
  const groups = useMemo(() => issuedOnly ? groupIssuedDocuments(filtered, grouping, limit) : groupDocuments(filtered, sort, limit), [filtered, sort, limit, issuedOnly, grouping]);
  const summary = useMemo(() => issuedListSummary(filtered), [filtered]);
  const grouped = !issuedOnly || grouping !== "none";
  useEffect(() => {
    if (!issuedOnly || filtered.length <= limit || !sentinel.current || saving || deleting) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) setLimit((n) => n + pageSize); }, { rootMargin: "300px" });
    observer.observe(sentinel.current); return () => observer.disconnect();
  }, [issuedOnly, filtered.length, limit, saving, deleting]);
  const visibleSequence = groups.flatMap(([m, list]) => collapsed.has(m) ? [] : list);
  const selection = useListSelection(visibleSequence.map((row) => row.id), { availableIds: rows.map((row) => row.id), disabled: saving || deleting });
  const { selected, setSelected } = selection;
  const groupMode = issuedOnly ? grouping : sort;
  const groupLabel = (key: string, list: DocumentRow[]) => groupMode === "client" ? list[0]?.counterpart || "取引先未設定" : groupMode === "project" ? list[0]?.projectName || "案件未設定" : monthLabel(key);
  const counterparts = useMemo(() => [...new Map(rows.map((row) => [documentCounterpartKey(row), row.counterpart])).entries()].sort((a, b) => a[1].localeCompare(b[1], "ja")), [rows]);
  const active = rows.find((r) => r.id === activeId);
  const months = [...new Set(rows.map((r) => r.month))].sort().reverse();
  const selectedRows = rows.filter((r) => selected.has(r.id));
  const hiddenSelectedCount = selection.hiddenCount;
  const hasFilters = Boolean(query || kind !== "all" || category !== "all" || state !== "all" || month !== "all" || paymentFilter !== "all" || counterpart !== "all" || invoiceStatus !== "all");
  function resetFilters() {
    setQuery(""); setSearch(""); setKind("all"); setCategory("all"); setMonth("all"); setState("all"); setPaymentFilter("all"); setCounterpart("all"); setInvoiceStatus("all"); setLimit(pageSize);
  }
  const editableSelected = selectedRows.filter((r) => r.kind === "issued" && r.editable);
  const paymentChanges = Object.entries(edits).flatMap(([id, edit]) => {
    const row = rows.find((r) => r.id === id);
    if (!row) return [];
    if (edit.status === "PAID" && edit.total > (row.paidAmount || 0)) return [{ id, title: edit.invoiceNumber, amount: edit.total - (row.paidAmount || 0), reversal: false }];
    if (edit.status === "WAITING_PAYMENT" && (row.statusPaymentAmount || 0) > 0) return [{ id, title: edit.invoiceNumber, amount: row.statusPaymentAmount || 0, reversal: true }];
    return [];
  });
  function open(row: DocumentRow) {
    setActiveId(row.id);
    if (!issuedOnly && window.innerWidth < 1280) requestAnimationFrame(() => preview.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
  function save(paymentDate?: string, destination?: string) {
    if (paymentChanges.length && !paymentConfirm) { setAfterSave(destination || null); setPaymentConfirm(true); return; }
    startSave(async () => {
      try {
        const result = await saveIssuedInvoiceEdits(company, Object.values(edits).map((edit) => ({ ...edit, ...(edit.status === "PAID" && paymentDate ? { paymentDate } : {}) })));
        if (result.error) { setAfterSave(null); toast({ title: result.error, variant: "destructive" }); return; }
        const target = destination || afterSave;
        setEdits({}); setPaymentConfirm(false); setAfterSave(null); setLeaveUrl(null);
        if (target) router.push(target); else router.refresh();
        toast({ title: changes + "件を保存しました", variant: "success" });
      } catch { setAfterSave(null); toast({ title: "保存に失敗しました。変更内容を保持しています", variant: "destructive" }); }
    });
  }
  function askDelete(targets: DocumentRow[]) {
    if (changes) { toast({ title: "未保存の変更があります。保存または元に戻してから削除してください" }); return; }
    setDeleteTargets(targets);
  }
  function confirmDelete() {
    startDelete(async () => {
      try {
        const result = await deleteIssuedInvoices(company, deleteTargets.map((r) => ({ id: r.sourceId, updatedAt: r.updatedAt })));
        if (result.error) { toast({ title: result.error, variant: "destructive" }); return; }
        const ids = new Set(deleteTargets.map((r) => r.id));
        setSelected((old) => new Set([...old].filter((id) => !ids.has(id))));
        if (ids.has(activeId)) setActiveId("");
        setDeleteTargets([]); router.refresh();
        toast({ title: deleteTargets.length + "件の請求書を削除しました", variant: "success" });
      } catch { toast({ title: "削除に失敗しました。再度お試しください", variant: "destructive" }); }
    });
  }
  function exportCsv() {
    const csv = (v: unknown) => '"' + String(v ?? "").replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""') + '"';
    const data = (selectedRows.length ? selectedRows : filtered).map((r) => [r.title, documentKindLabels[r.kind], documentCategoryLabels[r.category], r.counterpart, r.projectName, r.billingLabel, r.date, r.total, r.statusLabel]);
    const content = [["書類", "種別", "分類", "取引先", "案件", "請求回・内訳", "日付", "金額", "状態"], ...data].map((r) => r.map(csv).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "documents-" + company + ".csv"; a.click(); URL.revokeObjectURL(url);
  }
  return <section aria-label={issuedOnly ? "発行請求書一覧" : "全書類一覧"} className="min-w-0 space-y-3">
    <div className={issuedOnly ? "grid min-w-0 gap-4 xl:grid-cols-[168px_minmax(0,1fr)]" : "min-w-0"}>
    {issuedOnly ? <RecordMonthNavigation label="請求月" months={months} value={month === "all" ? "" : month} disabled={saving || deleting} onChange={(value) => { setMonth(value || "all"); setLimit(pageSize); }} /> : null}
    <div className="min-w-0 space-y-3">
    {issuedOnly ? <>
      <div className="flex flex-wrap items-center gap-3 border-b pb-3"><h2 className="text-base font-semibold">{recordMonthLabel(month)}</h2><span role="status" className="text-sm text-muted-foreground">{filtered.length} / {rows.length}件</span>{changes ? <span className="text-xs text-amber-700 dark:text-amber-300">未保存 {changes}件</span> : null}</div>
      {showIssuedSummary ? <dl aria-label="保存済み請求書の集計" className="grid grid-cols-2 gap-x-3 gap-y-2 border-b pb-3 text-sm md:grid-cols-4">
        <div className="min-w-0"><dt className="text-xs text-muted-foreground">請求額（下書き・取消除く）</dt><dd className="break-all font-semibold tabular-nums">{number.format(summary.total)}</dd></div>
        <div className="min-w-0"><dt className="text-xs text-muted-foreground">入金済み</dt><dd className="break-all font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{number.format(summary.paid)}</dd></div>
        <div className="min-w-0"><dt className="text-xs text-muted-foreground">未入金</dt><dd className="break-all font-semibold tabular-nums">{number.format(summary.outstanding)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">OCR要確認</dt><dd className="font-semibold text-amber-700 dark:text-amber-400">{summary.review}件</dd></div>
      </dl> : null}
      <div className="grid min-w-0 grid-cols-2 gap-2 md:grid-cols-3 2xl:grid-cols-5">
        <select aria-label="請求月" className={`${recordSelectClass} xl:hidden`} value={month} disabled={saving || deleting} onChange={(e) => { setMonth(e.target.value); setLimit(pageSize); }}><option value="all">すべての月</option>{months.map((m) => <option key={m} value={m}>{recordMonthLabel(m)}</option>)}</select>
        <select aria-label="取引先で絞り込み" className={recordSelectClass} value={counterpart} onChange={(e) => { setCounterpart(e.target.value); setLimit(pageSize); }}><option value="all">すべてのクライアント</option>{counterparts.map(([value, name]) => <option key={value} value={value}>{name || "取引先未設定"}</option>)}</select>
        <select aria-label="請求書の状態で絞り込み" className={recordSelectClass} value={invoiceStatus} onChange={(e) => { setInvoiceStatus(e.target.value); setLimit(pageSize); }}><option value="all">すべての状態</option><option value="review">OCR要確認</option>{Object.entries(issuedStatusLabels).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select>
        <select aria-label="入金状態で絞り込み" className={recordSelectClass} value={paymentFilter} onChange={(e) => { setPaymentFilter(e.target.value); setLimit(pageSize); }}><option value="all">すべての入金状態</option><option value="unpaid">入金未完了（一部入金含む）</option><option value="paid">入金完了</option></select>
        <select aria-label="請求書のまとめ方" className={recordSelectClass} value={grouping} onChange={(e) => { setGrouping(e.target.value as IssuedGrouping); setLimit(pageSize); }}><option value="none">まとめない</option><option value="month">月ごと</option><option value="client">クライアントごと</option><option value="project">案件ごと</option></select>
        <select aria-label="並び順" className={recordSelectClass} value={sort} onChange={(e) => { setSort(e.target.value); setLimit(pageSize); }}><option value="date-desc">発行日が新しい順</option><option value="date-asc">発行日が古い順</option><option value="amount-desc">金額が大きい順</option><option value="amount-asc">金額が小さい順</option></select>
      </div>
      <form className="flex min-w-0 flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); setQuery(search); setLimit(pageSize); }}>
        <Input aria-label="書類を検索" placeholder="請求番号・取引先・案件を検索" className="h-11 min-w-0 basis-48 flex-1" value={search} maxLength={200} onChange={(event) => setSearch(event.target.value)} />
        <Button type="submit" variant="outline" size="icon" className="size-11 shrink-0" title="検索" aria-label="検索" disabled={saving || deleting}><Search className="size-4" /></Button>
        {hasFilters ? <Button type="button" className="min-h-11 lg:min-h-11" variant="ghost" onClick={resetFilters}><X className="size-4" />絞り込みを解除</Button> : null}
      </form>
    </> : <>
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-48 flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden /><Input aria-label="書類を検索" placeholder="書類名・取引先・案件を検索" className="h-11 pl-9 lg:pl-9" value={query} onChange={(e) => { setQuery(e.target.value); setLimit(pageSize); }} /></div>
      <select aria-label="月で絞り込み" className={selectClass} value={month} onChange={(e) => { setMonth(e.target.value); setLimit(pageSize); }}><option value="all">すべての月</option>{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select>
      <select aria-label="取引先で絞り込み" className={selectClass} value={counterpart} onChange={(e) => { setCounterpart(e.target.value); setLimit(pageSize); }}><option value="all">{issuedOnly ? "すべてのクライアント" : "すべての取引先"}</option>{counterparts.map(([value, name]) => <option key={value} value={value}>{name || "取引先未設定"}</option>)}</select>
      {!issuedOnly ? <select aria-label="書類種別" className={selectClass} value={kind} onChange={(e) => { setKind(e.target.value); setLimit(pageSize); }}><option value="all">すべての書類</option>{Object.entries(documentKindLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select> : null}
      {!issuedOnly ? <select aria-label="書類分類" className={selectClass} value={category} onChange={(e) => { setCategory(e.target.value); setLimit(pageSize); }}><option value="all">すべての分類</option>{Object.entries(documentCategoryLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select> : null}
      <select aria-label="並び順" className={selectClass} value={sort} onChange={(e) => { setSort(e.target.value); setLimit(pageSize); }}><option value="client">{issuedOnly ? "クライアントごと" : "取引先ごと"}</option><option value="date-desc">日付が新しい順</option><option value="date-asc">日付が古い順</option><option value="amount-desc">金額が大きい順</option><option value="name">取引先名順</option><option value="project">案件ごと</option></select>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label="確認状態" className="flex flex-wrap gap-1">
        {[["all", "すべて"], ["review", "要確認"], ["open", "対応中"], ["done", issuedOnly ? "完了・取消" : "完了"]].map(([v, l]) => <button key={v} type="button" className={`min-h-11 border-b-2 px-3 text-sm ${state === v ? "border-primary font-semibold text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`} aria-pressed={state === v} onClick={() => { setState(v); setLimit(pageSize); }}>{l}</button>)}
      </div>
      {issuedOnly || kind === "issued" ? <select aria-label="入金状態で絞り込み" className={selectClass} value={paymentFilter} onChange={(e) => { setPaymentFilter(e.target.value); setLimit(pageSize); }}><option value="all">すべての入金状態</option><option value="unpaid">入金未完了（一部入金含む）</option><option value="paid">入金完了</option></select> : null}
      <span className="text-xs text-muted-foreground" role="status">{filtered.length} / {rows.length}件</span>
      {hasFilters ? <Button variant="ghost" className="min-h-11 lg:min-h-11" onClick={resetFilters}><X className="size-4" />絞り込みを解除</Button> : null}
      {canExport ? <Button title="CSV出力" aria-label="CSV出力" variant="outline" size="icon" className="ml-auto" onClick={exportCsv}><Download className="size-4" /></Button> : null}
    </div>
    </>}
    <SelectionToolbar selection={selection}>
      {issuedOnly && canExport ? <Button title="CSV出力" aria-label="CSV出力" variant="outline" size="icon" className="ml-auto size-11" onClick={exportCsv}><Download className="size-4" /></Button> : null}
      {issuedOnly && rows.some((row) => row.editable) ? <Button className="ml-auto min-h-11" disabled={!changes || saving || deleting} onClick={() => save()}>{saving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}すべて保存{changes ? ` (${changes})` : ""}</Button> : null}
    </SelectionToolbar>
    {selectedRows.length ? <div aria-label="選択した書類の一括操作" className="flex min-w-0 flex-wrap items-center gap-2 bg-muted/40 p-2 [&_button]:min-h-11">
      <span className="mr-auto text-sm font-medium">{selectedRows.length}件選択{hiddenSelectedCount ? <span className="ml-2 text-xs font-normal text-muted-foreground">表示外 {hiddenSelectedCount}件を含む</span> : null}</span>
      {selectedRows.length > 0 && selectedRows.every((r) => r.kind === "issued" && r.editable) ? <Button variant="outline" size="sm" disabled={saving || deleting} className="text-destructive" onClick={() => askDelete(selectedRows)}><Trash2 className="size-4" />選択した{selectedRows.length}件を削除</Button> : null}
      {editableSelected.length ? <select aria-label="選択した発行請求書の状態を一括変更" disabled={saving || deleting} className={selectClass} value="" onChange={(e) => { const status = e.target.value as IssuedEdit["status"]; if (!status) return; setEdits((old) => { const next = { ...old }; for (const r of editableSelected) next[r.id] = { ...(old[r.id] || editFrom(r)), status }; return next; }); }}>
        <option value="">発行 {editableSelected.length}件を一括変更</option>{Object.entries(issuedStatusLabels).filter(([s]) => s !== "PARTIALLY_PAID").map(([s, label]) => <option key={s} value={s}>{label}</option>)}
      </select> : null}
      {issuedOnly && editableSelected.some((r) => !(r.paidAmount || 0)) ? <select aria-label="選択した発行請求書の案件を一括変更" disabled={saving || deleting} className={selectClass} value="" onChange={(event) => {
        const projectId = event.target.value; if (!projectId) return;
        setEdits((old) => { const next = { ...old }; for (const r of editableSelected.filter((row) => !(row.paidAmount || 0))) next[r.id] = { ...(old[r.id] || editFrom(r)), projectId }; return next; });
      }}><option value="">未入金の{editableSelected.filter((r) => !(r.paidAmount || 0)).length}件の案件を変更</option>{documentProjectOptions(projects, "").map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select> : null}
      {issuedOnly && editableSelected.some((r) => r.imported) ? <select aria-label="選択した発行請求書の原本確認を一括変更" disabled={saving || deleting} className={selectClass} value="" onChange={(event) => {
        const needsReview = event.target.value !== "yes";
        setEdits((old) => { const next = { ...old }; for (const r of editableSelected.filter((row) => row.imported)) next[r.id] = { ...(old[r.id] || editFrom(r)), needsReview }; return next; });
      }}><option value="">原本確認を一括変更</option><option value="yes">確認済み</option><option value="no">未確認</option></select> : null}
    </div> : null}
    <div className={active && !issuedOnly ? "grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_400px]" : "min-w-0"}>
      <div className="min-w-0">
        <div role="region" aria-label={issuedOnly ? "発行請求書の明細一覧" : "書類の明細一覧"} tabIndex={0} className={issuedOnly ? "max-w-full border-y md:max-h-[70dvh] md:overflow-auto md:overscroll-contain" : "max-h-[70vh] overflow-auto border-y"}>
          <div className="md:hidden">
            {groups.map(([m, list]) => <Fragment key={m}>
              {grouped ? <button className="flex min-h-11 w-full items-center gap-2 bg-muted/60 px-3 text-sm font-medium" aria-expanded={!collapsed.has(m)} onClick={() => setCollapsed((old) => { const next = new Set(old); if (next.has(m)) next.delete(m); else next.add(m); return next; })}>{collapsed.has(m) ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}<span className="break-words text-left">{groupLabel(m, list)}</span></button> : null}
              {!collapsed.has(m) ? list.map((r) => <DocumentContextMenu key={r.id} row={r} onEdit={() => open(r)} onDelete={() => askDelete([r])} disabled={saving || deleting}><div {...selection.rowProps(r.id)} className={"flex min-w-0 items-start gap-2 border-b p-2 " + (selected.has(r.id) || activeId === r.id ? "bg-primary/10" : "")}>
                <RowSelectionCheckbox selection={selection} id={r.id} label={r.title + "を選択"} />
                <div className="grid min-w-0 flex-1 gap-1 text-left text-sm">
                  <DocumentProjectControl row={r} edit={edits[r.id]} projects={projects} disabled={saving || deleting} onEdit={(v) => setEdits((old) => ({ ...old, [r.id]: v }))} /><button data-selection-open onClick={() => open(r)} className="min-h-11 break-words text-left text-xs text-muted-foreground hover:underline">{edits[r.id]?.invoiceNumber || r.title} · {documentKindLabels[r.kind]}</button>
                  <span className="break-words text-xs text-muted-foreground">{edits[r.id]?.projectId && edits[r.id].projectId !== r.projectId ? projects.find((p) => p.value === edits[r.id].projectId)?.clientName || r.counterpart : r.counterpart}</span>
                  {r.billingLabel ? <span className="break-words text-xs text-muted-foreground">請求回・内訳: {r.billingLabel}</span> : null}
                  <DocumentStatusControl row={r} edit={edits[r.id]} onEdit={(v) => setEdits((old) => ({ ...old, [r.id]: v }))} company={company} disabled={saving || deleting} />
                  {(edits[r.id]?.needsReview ?? r.needsReview) ? <span className="text-xs text-amber-700 dark:text-amber-300">OCR要確認</span> : null}
                  <span className="flex flex-wrap items-center gap-2 text-xs"><span>{(edits[r.id]?.issueDate ?? r.date) || "未設定"}</span><span className="ml-auto tabular-nums">{r.total === undefined ? "" : number.format(edits[r.id]?.total ?? r.total)}</span></span>
                  {edits[r.id] ? <span className="text-xs text-amber-700 dark:text-amber-300">未保存</span> : null}
                  {issuedOnly ? <><IssuedAmounts row={r} /><IssuedReviewControl row={r} edit={edits[r.id]} disabled={saving || deleting} onEdit={(v) => setEdits((old) => ({ ...old, [r.id]: v }))} /></> : null}
                </div>
                <DocumentMenuButton row={r} onEdit={() => open(r)} onDelete={() => askDelete([r])} disabled={saving || deleting} />
              </div></DocumentContextMenu>) : null}
            </Fragment>)}
          </div>
          <table className={`hidden w-full table-fixed text-left text-sm md:table ${issuedOnly ? "min-w-[960px]" : "min-w-[680px]"}`}>
            <thead className="sticky top-0 z-10 bg-background text-xs text-muted-foreground"><tr>
              <th className="w-11 p-0"><SelectAllCheckbox selection={selection} label="表示中の書類をすべて選択" /></th>
              <th className="w-[28%] p-2">案件名 / 書類</th><th className="w-[21%] p-2">取引先</th><th className="w-28 p-2">{issuedOnly ? "発行日 / 入金期限" : "日付"}</th><th className={issuedOnly ? "w-36 p-2 text-right" : "w-24 p-2 text-right"}>{issuedOnly ? "請求・入金" : "金額"}</th><th className="w-40 p-2">状態</th>{issuedOnly ? <th className="w-20 p-2 text-center">原本確認</th> : null}<th className="w-11"><span className="sr-only">操作</span></th>
            </tr></thead>
            <tbody>{groups.map(([m, list]) => <Fragment key={m}>
              {grouped ? <tr className="border-t bg-muted/60"><td colSpan={issuedOnly ? 8 : 7} className="p-0"><button className="sticky left-0 flex min-h-11 items-center gap-2 px-3 text-xs font-semibold" aria-expanded={!collapsed.has(m)} onClick={() => setCollapsed((old) => { const next = new Set(old); if (next.has(m)) next.delete(m); else next.add(m); return next; })}>{collapsed.has(m) ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}<span className="break-words text-left">{groupLabel(m, list)}</span></button></td></tr> : null}
              {!collapsed.has(m) ? list.map((r) => <DocumentContextMenu key={r.id} row={r} onEdit={() => open(r)} onDelete={() => askDelete([r])} disabled={saving || deleting}><tr {...selection.rowProps(r.id)} data-document-id={r.id} className={"border-t align-top " + (selected.has(r.id) || activeId === r.id ? "bg-primary/10" : "hover:bg-muted/30")}>
                <td className="p-0"><RowSelectionCheckbox selection={selection} id={r.id} label={r.title + "を選択"} /></td>
                <td className="px-2 py-3"><DocumentProjectControl row={r} edit={edits[r.id]} projects={projects} disabled={saving || deleting} onEdit={(v) => setEdits((old) => ({ ...old, [r.id]: v }))} /><button data-selection-open className="min-h-11 w-full text-left text-xs text-muted-foreground hover:underline" onClick={() => open(r)}><span className="block break-words">{edits[r.id]?.invoiceNumber || r.title}</span><span className="block text-xs font-normal text-muted-foreground">{documentKindLabels[r.kind]} · {documentCategoryLabels[r.category] || r.category}{edits[r.id] ? " · 未保存" : ""}</span></button>{r.billingLabel ? <span className="block break-words text-xs text-muted-foreground">請求回・内訳: {r.billingLabel}</span> : null}</td>
                <td className="px-2 py-3"><span className="block break-words">{edits[r.id]?.projectId && edits[r.id].projectId !== r.projectId ? projects.find((p) => p.value === edits[r.id].projectId)?.clientName || r.counterpart : r.counterpart || "—"}</span></td>
                <td className="px-2 py-3 text-xs tabular-nums">{(edits[r.id]?.issueDate ?? r.date) || "未設定"}{issuedOnly ? <span className="mt-1 block text-muted-foreground">{(edits[r.id]?.dueDate ?? r.dueDate) || "期限未設定"}</span> : null}</td><td className="space-y-1 px-2 py-3 text-right tabular-nums">{r.total === undefined ? "—" : number.format(edits[r.id]?.total ?? r.total)}{issuedOnly ? <IssuedAmounts row={r} /> : null}</td>
                <td className="px-2 py-3"><DocumentStatusControl row={r} edit={edits[r.id]} onEdit={(v) => setEdits((old) => ({ ...old, [r.id]: v }))} company={company} disabled={saving || deleting} />{(edits[r.id]?.needsReview ?? r.needsReview) ? <span className="text-xs text-amber-700 dark:text-amber-300">OCR要確認</span> : null}</td>
                {issuedOnly ? <td><IssuedReviewControl row={r} edit={edits[r.id]} disabled={saving || deleting} onEdit={(v) => setEdits((old) => ({ ...old, [r.id]: v }))} /></td> : null}
                <td className="py-2"><DocumentMenuButton row={r} onEdit={() => open(r)} onDelete={() => askDelete([r])} disabled={saving || deleting} /></td>
              </tr></DocumentContextMenu>) : null}
            </Fragment>)}</tbody>
          </table>
          {!filtered.length ? <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-sm text-muted-foreground"><FileText className="size-8" />{rows.length ? "条件に合う書類がありません" : "書類はまだありません"}{rows.length ? <Button variant="outline" onClick={resetFilters}>絞り込みを解除</Button> : null}</div> : null}
          {issuedOnly ? <div ref={sentinel} className="flex min-h-14 flex-wrap items-center justify-center gap-3 py-3 text-sm" aria-live="polite"><span className="text-muted-foreground">{Math.min(limit, filtered.length)} / {filtered.length}件{filtered.length <= limit ? "・すべて表示" : ""}</span>{filtered.length > limit ? <Button variant="ghost" className="min-h-11" disabled={saving || deleting} onClick={() => setLimit((n) => n + pageSize)}>続きを表示</Button> : null}</div> : null}
        </div>
        {!issuedOnly && filtered.length > limit ? <div className="flex justify-center p-3"><Button variant="outline" onClick={() => setLimit((n) => n + pageSize)}>さらに表示（残り{filtered.length - limit}件）</Button></div> : null}
      </div>
      {active && !issuedOnly ? <aside ref={preview} className="min-w-0 scroll-mt-28 border-t pt-3 xl:sticky xl:top-3 xl:max-h-[80vh] xl:overflow-auto xl:border-l xl:border-t-0 xl:pl-4">
        <div className="mb-3 flex items-start justify-between gap-2"><h2 className="break-all font-semibold">{active.title}</h2><Button variant="ghost" size="icon" className="shrink-0" title="プレビューを閉じる" aria-label="プレビューを閉じる" onClick={() => setActiveId("")}><X className="size-4" /></Button></div>
        <DocumentDetails key={active.id} row={active} company={company} projects={projects} edit={edits[active.id]} onEdit={(v) => setEdits((old) => ({ ...old, [active.id]: v }))} disabled={saving || deleting} />
      </aside> : null}
    </div>
    </div>
    </div>
    {changes ? <RecordSaveBar label={`未保存 ${changes}件`} disabled={saving || deleting} saving={saving} onSave={() => save()} onReset={() => setDiscardOpen(true)} /> : null}
    <Dialog open={issuedOnly && Boolean(active)} onOpenChange={(open) => { if (!open && !saving && !deleting) setActiveId(""); }}>
      <DialogContent aria-describedby={undefined} showCloseButton={!saving && !deleting} className="max-h-[90dvh] min-w-0 overflow-y-auto sm:max-w-2xl" onInteractOutside={(event) => event.preventDefault()} onEscapeKeyDown={(event) => event.preventDefault()}>
        <DialogHeader><DialogTitle className="break-words pr-8">{active?.title}</DialogTitle></DialogHeader>
        {active ? <Tabs key={active.id} defaultValue="edit" className="min-w-0">
          <TabsList className="min-h-12 w-full" aria-label="請求書の表示"><TabsTrigger value="edit" className="min-h-11">編集・入金状況</TabsTrigger><TabsTrigger value="file" className="min-h-11">原本・OCR</TabsTrigger></TabsList>
          <TabsContent value="edit"><DocumentDetails row={active} company={company} projects={projects} edit={edits[active.id]} onEdit={(v) => setEdits((old) => ({ ...old, [active.id]: v }))} disabled={saving || deleting} view="edit" /></TabsContent>
          <TabsContent value="file"><DocumentDetails row={active} company={company} projects={projects} edit={edits[active.id]} onEdit={(v) => setEdits((old) => ({ ...old, [active.id]: v }))} disabled={saving || deleting} view="file" /></TabsContent>
        </Tabs> : null}
        <DialogFooter className="sticky bottom-0 border-t bg-background pt-3"><Button variant="outline" disabled={saving || deleting} onClick={() => setActiveId("")}>一覧に戻る</Button>{changes ? <Button disabled={saving || deleting} onClick={() => save()}>{saving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}すべて保存 ({changes})</Button> : null}</DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={discardOpen} onOpenChange={(open) => { if (!saving && !deleting) setDiscardOpen(open); }}><DialogContent>
      <DialogHeader><DialogTitle>未保存の変更を元に戻しますか？</DialogTitle><DialogDescription>{changes}件の変更を破棄します。保存済みの内容は変わりません。</DialogDescription></DialogHeader>
      <DialogFooter><Button variant="outline" onClick={() => setDiscardOpen(false)}>キャンセル</Button><Button onClick={() => { setEdits({}); setDiscardOpen(false); }}>変更を破棄</Button></DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={Boolean(leaveUrl)} onOpenChange={(open) => { if (!open && !saving && !deleting) setLeaveUrl(null); }}><DialogContent showCloseButton={!saving && !deleting} onInteractOutside={(event) => event.preventDefault()} onEscapeKeyDown={(event) => event.preventDefault()}>
      <DialogHeader><DialogTitle>未保存の変更があります</DialogTitle><DialogDescription>{changes}件の編集内容が未保存です。</DialogDescription></DialogHeader>
      <DialogFooter><Button variant="outline" disabled={saving || deleting} onClick={() => setLeaveUrl(null)}>キャンセル</Button><Button variant="ghost" disabled={saving || deleting} onClick={() => { const target = leaveUrl; setEdits({}); setLeaveUrl(null); if (target) router.push(target); }}>破棄して移動</Button><Button disabled={saving || deleting} onClick={() => { const target = leaveUrl; setLeaveUrl(null); save(undefined, target || undefined); }}><Save className="size-4" />保存して移動</Button></DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={deleteTargets.length > 0} onOpenChange={(open) => { if (!open && !deleting) setDeleteTargets([]); }}>
      <DialogContent showCloseButton={!deleting}>
        <DialogHeader><DialogTitle>請求書を削除しますか？</DialogTitle><DialogDescription>{deleteTargets.length}件を一覧から削除します。履歴と原本は保持されます。</DialogDescription></DialogHeader>
        <ul className="max-h-40 space-y-1 overflow-auto break-all text-sm">{deleteTargets.map((r) => <li key={r.id}>{r.title}</li>)}</ul>
        <DialogFooter><Button variant="outline" disabled={deleting} onClick={() => setDeleteTargets([])}>キャンセル</Button><Button variant="destructive" disabled={deleting} onClick={confirmDelete}>{deleting ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}{deleting ? "削除中..." : "削除する"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={paymentConfirm} onOpenChange={(open) => { if (!saving) { setPaymentConfirm(open); if (!open) setAfterSave(null); } }}>
      <DialogContent showCloseButton={!saving} className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" onInteractOutside={(event) => event.preventDefault()} onEscapeKeyDown={(event) => event.preventDefault()}>
        <DialogHeader><DialogTitle>入金状態の変更を確認</DialogTitle><DialogDescription>入金完了は残額を入金記録に追加します。未完了へ戻す場合は、このステータス操作で追加した記録だけを取り消します。別途登録された入金は残ります。</DialogDescription></DialogHeader>
        <ul className="max-h-48 space-y-2 overflow-auto text-sm">{paymentChanges.map((item) => <li key={item.id} className="flex flex-wrap justify-between gap-2"><span className="break-all">{item.title}</span><span className="tabular-nums">{item.reversal ? "取消" : "入金"} {number.format(item.amount)}</span></li>)}</ul>
        <form onSubmit={(event) => { event.preventDefault(); save(String(new FormData(event.currentTarget).get("paymentDate") || "")); }} className="space-y-4">
          {paymentChanges.some((item) => !item.reversal) ? <label className="block space-y-1 text-sm">入金日<Input aria-label="入金日" name="paymentDate" type="date" required defaultValue={todayIso()} disabled={saving} /></label> : null}
          <DialogFooter><Button type="button" variant="outline" disabled={saving} onClick={() => { setPaymentConfirm(false); setAfterSave(null); }}>キャンセル</Button><Button type="submit" disabled={saving}>{saving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}確認して保存</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </section>;
}
