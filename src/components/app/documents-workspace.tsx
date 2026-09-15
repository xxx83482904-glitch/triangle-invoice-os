"use client";

import Image from "next/image";
import Link from "next/link";
import { Fragment, useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Download, ExternalLink, FileText, LoaderCircle, RotateCcw, Save, Search, Trash2, X } from "lucide-react";
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
import { groupDocuments, orderDocuments } from "@/lib/document-order";

const selectClass = "h-10 max-w-full rounded-md border bg-background px-3 text-sm";
const pageSize = 50;
type ProjectOption = { value: string; label: string; clientName?: string };
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
  const name = projects.find((p) => p.value === value)?.label || row.projectName || "案件未設定";
  if (row.kind !== "issued" || !row.editable) return <span className="block break-words font-medium">{name}</span>;
  const paid = (row.paidAmount || 0) > 0;
  return <select aria-label={`${row.title}の案件`} title={paid ? `${name}（入金記録あり・案件変更不可）` : name} value={value} disabled={disabled || paid}
    className="h-11 w-full min-w-0 max-w-full rounded-md border border-transparent bg-transparent px-1 text-sm font-medium hover:border-input focus:border-ring disabled:opacity-70"
    onChange={(e) => onEdit({ ...(edit || editFrom(row)), projectId: e.target.value })}>
    {!projects.some((p) => p.value === value) ? <option value={value}>{name}</option> : null}
    {projects.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
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

function DocumentDetails({ row, company, edit, onEdit, projects, disabled }: {
  row: DocumentRow; company: CompanyScope; edit?: IssuedEdit; onEdit: (value: IssuedEdit) => void;
  projects: ProjectOption[]; disabled: boolean;
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
      <Button asChild variant="ghost" size="sm"><Link prefetch={false} href={row.sourceHref}>管理画面</Link></Button>
    </div>
    {fileUrl ? (
      row.mimeType?.startsWith("image/") ? <div className="relative h-72 bg-muted/30 sm:h-96"><Image unoptimized src={fileUrl} alt={row.fileName || row.title} fill sizes="(max-width: 1279px) 100vw, 420px" className="object-contain" /></div>
        : <iframe title={(generated ? `${documentKindLabels[row.kind]}PDF: ` : "原本: ") + row.title} src={fileUrl} loading="lazy" className="h-80 w-full rounded border bg-white sm:h-[440px]" />
    ) : <div className="flex h-32 items-center justify-center bg-muted/30 text-sm text-muted-foreground">原本ファイルなし</div>}
    {editable ? <fieldset disabled={disabled} className="grid min-w-0 gap-3">
      <label className="space-y-1 text-xs">請求書番号<Input aria-label="請求書番号" value={current.invoiceNumber} onChange={(e) => update({ invoiceNumber: e.target.value })} /></label>
      <label className="grid gap-1 text-xs">案件<select aria-label="編集する案件" className={selectClass + " w-full"} value={current.projectId} onChange={(e) => update({ projectId: e.target.value })}>{projects.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select></label>
      <div className="text-xs text-muted-foreground break-words">請求先: {current.projectId === row.projectId ? row.counterpart : projects.find((p) => p.value === current.projectId)?.clientName || row.counterpart}{detail?.clientName ? " / OCR請求先: " + detail.clientName : ""}</div>
      <div className="grid min-w-0 grid-cols-2 gap-3">
        <label className="min-w-0 space-y-1 text-xs">発行日<Input aria-label="発行日" type="date" value={current.issueDate} onChange={(e) => update({ issueDate: e.target.value })} /></label>
        <label className="min-w-0 space-y-1 text-xs">入金期限<Input aria-label="入金期限" type="date" value={current.dueDate} onChange={(e) => update({ dueDate: e.target.value })} /></label>
      </div>
      <label className="space-y-1 text-xs">請求金額<Input aria-label="請求金額" type="number" min="0" step="0.01" readOnly={!row.imported} value={current.total} onChange={(e) => update({ total: Number(e.target.value) })} /></label>
      <label className="grid gap-1 text-xs">状態<DocumentStatusControl row={row} edit={edit} onEdit={onEdit} company={company} disabled={disabled} /></label>
      <div className="flex flex-wrap justify-between gap-2 text-xs tabular-nums"><span>入金額 {number.format(row.paidAmount || 0)}</span><span>未入金額 {number.format(Math.max(0, (row.total || 0) - (row.paidAmount || 0)))}</span></div>
      {row.imported ? <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={!current.needsReview} onChange={(e) => update({ needsReview: !e.target.checked })} />原本と内容を確認済み（任意）</label> : null}
    </fieldset> : <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2 text-sm">
      <dt className="text-muted-foreground">取引先</dt><dd className="break-words">{row.counterpart || "未設定"}</dd>
      <dt className="text-muted-foreground">案件</dt><dd className="break-words">{row.projectName || "未設定"}</dd>
      <dt className="text-muted-foreground">書類日</dt><dd>{row.date || "未設定"}</dd>
      <dt className="text-muted-foreground">分類</dt><dd>{documentCategoryLabels[row.category] || row.category}</dd>
      {row.kind === "estimate" ? <><dt className="text-muted-foreground">状態</dt><dd><DocumentStatusControl row={row} onEdit={onEdit} company={company} disabled={disabled} /></dd></> : null}
      {row.total !== undefined ? <><dt className="text-muted-foreground">金額</dt><dd>{number.format(row.total)}</dd></> : null}
    </dl>}
    {detail?.warnings.length ? <ul className="space-y-1 border-l-2 border-amber-500 pl-3 text-xs text-amber-800 dark:text-amber-300">{detail.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul> : null}
    <div className="space-y-2 border-t pt-3"><h3 className="text-sm font-medium">OCR本文</h3>
      {error ? <div role="alert" className="text-sm text-destructive">{error}<Button variant="ghost" size="sm" onClick={() => setAttempt((v) => v + 1)}>再読込</Button></div> :
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-sans text-xs leading-5 text-muted-foreground">{detail ? detail.ocrText || "OCR本文なし" : "読込中..."}</pre>}
    </div>
  </div>;
}

export function DocumentsWorkspace({ rows, company, projects = [], canExport = false, initialId, issuedOnly = false }: {
  rows: DocumentRow[]; company: CompanyScope; projects?: ProjectOption[]; canExport?: boolean; initialId?: string; issuedOnly?: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [kind, setKind] = useState("all");
  const [category, setCategory] = useState("all");
  const [state, setState] = useState("all");
  const [month, setMonth] = useState("all");
  const [sort, setSort] = useState("date-desc");
  const [limit, setLimit] = useState(pageSize);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const [activeId, setActiveId] = useState(initialId || "");
  const [edits, setEdits] = useState<Record<string, IssuedEdit>>({});
  const [saving, startSave] = useTransition();
  const [deleting, startDelete] = useTransition();
  const [deleteTargets, setDeleteTargets] = useState<DocumentRow[]>([]);
  const [paymentConfirm, setPaymentConfirm] = useState(false);
  const [paymentFilter, setPaymentFilter] = useState("all");
  const preview = useRef<HTMLElement>(null);
  const changes = Object.keys(edits).length;
  useEffect(() => {
    if (!changes) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    const intercept = (e: MouseEvent) => {
      const link = (e.target as Element).closest("a");
      if (link && link.target !== "_blank" && !window.confirm("未保存の変更があります。移動しますか？")) { e.preventDefault(); e.stopPropagation(); }
    };
    document.addEventListener("click", intercept, true);
    return () => { window.removeEventListener("beforeunload", handler); document.removeEventListener("click", intercept, true); };
  }, [changes]);

  const filtered = useMemo(() => {
    const q = deferredQuery.normalize("NFKC").toLocaleLowerCase();
    return orderDocuments(rows.filter((r) => (kind === "all" || r.kind === kind) && (category === "all" || r.category === category) && (state === "all" || r.state === state) &&
      (paymentFilter === "all" || (!issuedOnly && kind !== "issued") || (r.kind === "issued" && (paymentFilter === "paid" ? r.status === "PAID" : !["PAID", "DRAFT", "CANCELED"].includes(r.status)))) &&
      (month === "all" || r.month === month) && [r.title, r.counterpart, r.projectName, r.fileName || ""].join(" ").normalize("NFKC").toLocaleLowerCase().includes(q)), sort);
  }, [rows, deferredQuery, kind, category, state, month, sort, paymentFilter, issuedOnly]);
  const groups = useMemo(() => groupDocuments(filtered, sort, limit), [filtered, sort, limit]);
  const groupLabel = (key: string, list: DocumentRow[]) => sort === "project" ? list[0]?.projectName || "案件未設定" : monthLabel(key);
  const active = rows.find((r) => r.id === activeId);
  const months = [...new Set(rows.map((r) => r.month))].sort().reverse();
  const allSelected = Boolean(filtered.length && filtered.every((r) => selected.has(r.id)));
  const selectedRows = rows.filter((r) => selected.has(r.id));
  const editableSelected = selectedRows.filter((r) => r.kind === "issued" && r.editable);
  const paymentChanges = Object.entries(edits).flatMap(([id, edit]) => {
    const row = rows.find((r) => r.id === id);
    if (!row) return [];
    if (edit.status === "PAID" && edit.total > (row.paidAmount || 0)) return [{ id, title: edit.invoiceNumber, amount: edit.total - (row.paidAmount || 0), reversal: false }];
    if (edit.status === "WAITING_PAYMENT" && (row.statusPaymentAmount || 0) > 0) return [{ id, title: edit.invoiceNumber, amount: row.statusPaymentAmount || 0, reversal: true }];
    return [];
  });
  const visibleSequence = groups.flatMap(([m, list]) => collapsed.has(m) ? [] : list);

  function toggle(row: DocumentRow, shift: boolean) {
    const anchorId = anchor.current;
    setSelected((previous) => {
      const next = new Set(previous);
      const from = visibleSequence.findIndex((r) => r.id === anchorId);
      const to = visibleSequence.findIndex((r) => r.id === row.id);
      const ids = shift && from >= 0 && to >= 0 ? visibleSequence.slice(Math.min(from, to), Math.max(from, to) + 1).map((r) => r.id) : [row.id];
      const add = !previous.has(row.id);
      for (const id of ids) { if (add) next.add(id); else next.delete(id); }
      return next;
    });
    anchor.current = row.id;
  }
  function open(row: DocumentRow) {
    setActiveId(row.id);
    if (window.innerWidth < 1280) requestAnimationFrame(() => preview.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
  function save(paymentDate?: string) {
    if (paymentChanges.length && !paymentConfirm) { setPaymentConfirm(true); return; }
    startSave(async () => {
      try {
        const result = await saveIssuedInvoiceEdits(company, Object.values(edits).map((edit) => ({ ...edit, ...(edit.status === "PAID" && paymentDate ? { paymentDate } : {}) })));
        if (result.error) { toast({ title: result.error, variant: "destructive" }); return; }
        setEdits({}); setPaymentConfirm(false); router.refresh(); toast({ title: changes + "件を保存しました", variant: "success" });
      } catch { toast({ title: "保存に失敗しました。変更内容を保持しています", variant: "destructive" }); }
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
    const data = (selectedRows.length ? selectedRows : filtered).map((r) => [r.title, documentKindLabels[r.kind], documentCategoryLabels[r.category], r.counterpart, r.projectName, r.date, r.total, r.statusLabel]);
    const content = [["書類", "種別", "分類", "取引先", "案件", "日付", "金額", "状態"], ...data].map((r) => r.map(csv).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "documents-" + company + ".csv"; a.click(); URL.revokeObjectURL(url);
  }
  return <section aria-label={issuedOnly ? "発行請求書一覧" : "全書類一覧"} className="min-w-0 space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-48 flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden /><Input aria-label="書類を検索" placeholder="書類名・取引先・案件を検索" className="h-11 pl-9 lg:pl-9" value={query} onChange={(e) => { setQuery(e.target.value); setLimit(pageSize); }} /></div>
      <select aria-label="月で絞り込み" className={selectClass} value={month} onChange={(e) => { setMonth(e.target.value); setLimit(pageSize); }}><option value="all">すべての月</option>{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select>
      {!issuedOnly ? <select aria-label="書類種別" className={selectClass} value={kind} onChange={(e) => { setKind(e.target.value); setLimit(pageSize); }}><option value="all">すべての書類</option>{Object.entries(documentKindLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select> : null}
      {!issuedOnly ? <select aria-label="書類分類" className={selectClass} value={category} onChange={(e) => { setCategory(e.target.value); setLimit(pageSize); }}><option value="all">すべての分類</option>{Object.entries(documentCategoryLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select> : null}
      <select aria-label="並び順" className={selectClass} value={sort} onChange={(e) => setSort(e.target.value)}><option value="date-desc">日付が新しい順</option><option value="date-asc">日付が古い順</option><option value="amount-desc">金額が大きい順</option><option value="name">取引先名順</option><option value="project">案件ごと</option></select>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label="確認状態" className="flex flex-wrap gap-1">
        {[["all", "すべて"], ["review", "要確認"], ["open", "未完了"], ["done", "完了"]].map(([v, l]) => <Button key={v} size="sm" variant={state === v ? "default" : "ghost"} aria-pressed={state === v} onClick={() => { setState(v); setLimit(pageSize); }}>{l}</Button>)}
      </div>
      {issuedOnly || kind === "issued" ? <select aria-label="入金状態で絞り込み" className={selectClass} value={paymentFilter} onChange={(e) => { setPaymentFilter(e.target.value); setLimit(pageSize); }}><option value="all">すべての入金状態</option><option value="unpaid">入金未完了（一部入金含む）</option><option value="paid">入金完了</option></select> : null}
      <span className="text-xs text-muted-foreground">{filtered.length}件{selectedRows.length ? " / " + selectedRows.length + "件選択" : ""}</span>
      {canExport ? <Button title="CSV出力" aria-label="CSV出力" variant="outline" size="icon" className="ml-auto" onClick={exportCsv}><Download className="size-4" /></Button> : null}
      {selectedRows.length ? <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>選択解除</Button> : null}
      {selectedRows.length > 0 && selectedRows.every((r) => r.kind === "issued" && r.editable) ? <Button variant="outline" size="sm" disabled={saving || deleting} className="text-destructive" onClick={() => askDelete(selectedRows)}><Trash2 className="size-4" />選択した{selectedRows.length}件を削除</Button> : null}
      {editableSelected.length ? <select aria-label="選択した発行請求書の状態を一括変更" disabled={saving} className={selectClass} value="" onChange={(e) => { const status = e.target.value as IssuedEdit["status"]; if (!status) return; setEdits((old) => { const next = { ...old }; for (const r of editableSelected) next[r.id] = { ...(old[r.id] || editFrom(r)), status }; return next; }); }}>
        <option value="">発行 {editableSelected.length}件を一括変更</option>{Object.entries(issuedStatusLabels).filter(([s]) => s !== "PARTIALLY_PAID").map(([s, label]) => <option key={s} value={s}>{label}</option>)}
      </select> : null}
    </div>
    {changes ? <div className="sticky top-14 z-20 flex flex-wrap items-center gap-2 border-y border-amber-500/30 bg-background p-3 lg:top-0" role="status">
      <span className="mr-auto text-sm">{changes}件の未保存変更</span>
      <Button variant="outline" disabled={saving} onClick={() => { if (window.confirm("未保存の変更を破棄しますか？")) setEdits({}); }}><RotateCcw className="size-4" />元に戻す</Button>
      <Button disabled={saving} onClick={() => save()}>{saving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}すべて保存</Button>
    </div> : null}
    <div className={active ? "grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_400px]" : "min-w-0"}>
      <div className="min-w-0">
        <div className="max-h-[70vh] overflow-auto border-y">
          <div className="md:hidden">
            <label className="flex min-h-11 items-center gap-3 border-b px-3 text-sm"><input className="size-5" type="checkbox" aria-label="表示結果をすべて選択" checked={allSelected} disabled={!filtered.length} onChange={() => setSelected(allSelected ? new Set() : new Set(filtered.map((r) => r.id)))} />すべて選択</label>
            {groups.map(([m, list]) => <Fragment key={m}>
              <button className="flex min-h-11 w-full items-center gap-2 bg-muted/60 px-3 text-sm font-medium" aria-expanded={!collapsed.has(m)} onClick={() => setCollapsed((old) => { const next = new Set(old); if (next.has(m)) next.delete(m); else next.add(m); return next; })}>{collapsed.has(m) ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}<span className="break-words text-left">{groupLabel(m, list)}</span></button>
              {!collapsed.has(m) ? list.map((r) => <DocumentContextMenu key={r.id} row={r} onEdit={() => open(r)} onDelete={() => askDelete([r])} disabled={saving || deleting}><div className={"flex min-w-0 items-start gap-3 border-b p-3 " + (selected.has(r.id) || activeId === r.id ? "bg-primary/10" : "")}>
                <input className="mt-3 size-5 shrink-0" type="checkbox" aria-label={r.title + "を選択"} checked={selected.has(r.id)} onChange={() => {}} onClick={(e) => toggle(r, e.shiftKey)} />
                <div className="grid min-w-0 flex-1 gap-1 text-left text-sm">
                  <DocumentProjectControl row={r} edit={edits[r.id]} projects={projects} disabled={saving || deleting} onEdit={(v) => setEdits((old) => ({ ...old, [r.id]: v }))} /><button onClick={() => open(r)} className="min-h-11 break-words text-left text-xs text-muted-foreground hover:underline">{edits[r.id]?.invoiceNumber || r.title} · {documentKindLabels[r.kind]}</button>
                  <span className="break-words text-xs text-muted-foreground">{edits[r.id]?.projectId && edits[r.id].projectId !== r.projectId ? projects.find((p) => p.value === edits[r.id].projectId)?.clientName || r.counterpart : r.counterpart}</span>
                  <DocumentStatusControl row={r} edit={edits[r.id]} onEdit={(v) => setEdits((old) => ({ ...old, [r.id]: v }))} company={company} disabled={saving || deleting} />
                  {r.needsReview ? <span className="text-xs text-amber-700 dark:text-amber-300">OCR要確認</span> : null}
                  <span className="flex flex-wrap items-center gap-2 text-xs"><span>{edits[r.id]?.issueDate || r.date}</span><span className="ml-auto tabular-nums">{r.total === undefined ? "" : number.format(edits[r.id]?.total ?? r.total)}</span></span>
                  {edits[r.id] ? <span className="text-xs text-amber-700 dark:text-amber-300">未保存</span> : null}
                </div>
                <DocumentMenuButton row={r} onEdit={() => open(r)} onDelete={() => askDelete([r])} disabled={saving || deleting} />
              </div></DocumentContextMenu>) : null}
            </Fragment>)}
          </div>
          <table className="hidden w-full min-w-[680px] table-fixed text-left text-sm md:table">
            <thead className="sticky top-0 z-10 bg-background text-xs text-muted-foreground"><tr>
              <th className="w-11 p-2"><input className="size-4" type="checkbox" aria-label="検索結果をすべて選択" checked={allSelected} disabled={!filtered.length} onChange={() => setSelected((old) => { const next = new Set(old); for (const r of filtered) { if (allSelected) next.delete(r.id); else next.add(r.id); } return next; })} /></th>
              <th className="w-[28%] p-2">案件名 / 書類</th><th className="w-[21%] p-2">取引先</th><th className="w-24 p-2">日付</th><th className="w-24 p-2 text-right">金額</th><th className="w-40 p-2">状態</th><th className="w-11"><span className="sr-only">操作</span></th>
            </tr></thead>
            <tbody>{groups.map(([m, list]) => <Fragment key={m}>
              <tr className="border-t bg-muted/60"><td colSpan={7} className="p-0"><button className="sticky left-0 flex min-h-10 items-center gap-2 px-3 text-xs font-semibold" aria-expanded={!collapsed.has(m)} onClick={() => setCollapsed((old) => { const next = new Set(old); if (next.has(m)) next.delete(m); else next.add(m); return next; })}>{collapsed.has(m) ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}<span className="break-words text-left">{groupLabel(m, list)}</span></button></td></tr>
              {!collapsed.has(m) ? list.map((r) => <DocumentContextMenu key={r.id} row={r} onEdit={() => open(r)} onDelete={() => askDelete([r])} disabled={saving || deleting}><tr data-document-id={r.id} className={"border-t align-top " + (activeId === r.id ? "bg-primary/10" : selected.has(r.id) ? "bg-accent/50" : "hover:bg-muted/30")}>
                <td className="p-3"><input className="size-4" type="checkbox" aria-label={r.title + "を選択"} checked={selected.has(r.id)} onChange={() => {}} onClick={(e) => toggle(r, e.shiftKey)} /></td>
                <td className="px-2 py-3"><DocumentProjectControl row={r} edit={edits[r.id]} projects={projects} disabled={saving || deleting} onEdit={(v) => setEdits((old) => ({ ...old, [r.id]: v }))} /><button className="min-h-11 w-full text-left text-xs text-muted-foreground hover:underline" onClick={() => open(r)}><span className="block break-words">{edits[r.id]?.invoiceNumber || r.title}</span><span className="block text-xs font-normal text-muted-foreground">{documentKindLabels[r.kind]} · {documentCategoryLabels[r.category] || r.category}{edits[r.id] ? " · 未保存" : ""}</span></button></td>
                <td className="px-2 py-3"><span className="block break-words">{edits[r.id]?.projectId && edits[r.id].projectId !== r.projectId ? projects.find((p) => p.value === edits[r.id].projectId)?.clientName || r.counterpart : r.counterpart || "—"}</span></td>
                <td className="px-2 py-3 text-xs tabular-nums">{(edits[r.id]?.issueDate ?? r.date) || "未設定"}</td><td className="px-2 py-3 text-right tabular-nums">{r.total === undefined ? "—" : number.format(edits[r.id]?.total ?? r.total)}</td>
                <td className="px-2 py-3"><DocumentStatusControl row={r} edit={edits[r.id]} onEdit={(v) => setEdits((old) => ({ ...old, [r.id]: v }))} company={company} disabled={saving || deleting} />{r.needsReview ? <span className="text-xs text-amber-700 dark:text-amber-300">OCR要確認</span> : null}</td>
                <td className="py-2"><DocumentMenuButton row={r} onEdit={() => open(r)} onDelete={() => askDelete([r])} disabled={saving || deleting} /></td>
              </tr></DocumentContextMenu>) : null}
            </Fragment>)}</tbody>
          </table>
          {!filtered.length ? <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-sm text-muted-foreground"><FileText className="size-8" />{rows.length ? "条件に合う書類がありません" : "書類はまだありません"}{rows.length ? <Button variant="outline" onClick={() => { setQuery(""); setKind("all"); setCategory("all"); setMonth("all"); setState("all"); setPaymentFilter("all"); }}>絞り込みを解除</Button> : null}</div> : null}
        </div>
        {filtered.length > limit ? <div className="flex justify-center p-3"><Button variant="outline" onClick={() => setLimit((n) => n + pageSize)}>さらに表示（残り{filtered.length - limit}件）</Button></div> : null}
      </div>
      {active ? <aside ref={preview} className="min-w-0 scroll-mt-28 border-t pt-3 xl:sticky xl:top-3 xl:max-h-[80vh] xl:overflow-auto xl:border-l xl:border-t-0 xl:pl-4">
        <div className="mb-3 flex items-start justify-between gap-2"><h2 className="break-all font-semibold">{active.title}</h2><Button variant="ghost" size="icon" className="shrink-0" title="プレビューを閉じる" aria-label="プレビューを閉じる" onClick={() => setActiveId("")}><X className="size-4" /></Button></div>
        <DocumentDetails key={active.id} row={active} company={company} projects={projects} edit={edits[active.id]} onEdit={(v) => setEdits((old) => ({ ...old, [active.id]: v }))} disabled={saving || deleting} />
      </aside> : null}
    </div>
    <Dialog open={deleteTargets.length > 0} onOpenChange={(open) => { if (!open && !deleting) setDeleteTargets([]); }}>
      <DialogContent showCloseButton={!deleting}>
        <DialogHeader><DialogTitle>請求書を削除しますか？</DialogTitle><DialogDescription>{deleteTargets.length}件を一覧から削除します。履歴と原本は保持されます。</DialogDescription></DialogHeader>
        <ul className="max-h-40 space-y-1 overflow-auto break-all text-sm">{deleteTargets.map((r) => <li key={r.id}>{r.title}</li>)}</ul>
        <DialogFooter><Button variant="outline" disabled={deleting} onClick={() => setDeleteTargets([])}>キャンセル</Button><Button variant="destructive" disabled={deleting} onClick={confirmDelete}>{deleting ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}{deleting ? "削除中..." : "削除する"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={paymentConfirm} onOpenChange={(open) => { if (!saving) setPaymentConfirm(open); }}>
      <DialogContent showCloseButton={!saving} className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>入金状態の変更を確認</DialogTitle><DialogDescription>入金完了は残額を入金記録に追加します。未完了へ戻す場合は、このステータス操作で追加した記録だけを取り消します。別途登録された入金は残ります。</DialogDescription></DialogHeader>
        <ul className="max-h-48 space-y-2 overflow-auto text-sm">{paymentChanges.map((item) => <li key={item.id} className="flex flex-wrap justify-between gap-2"><span className="break-all">{item.title}</span><span className="tabular-nums">{item.reversal ? "取消" : "入金"} {number.format(item.amount)}</span></li>)}</ul>
        <form onSubmit={(event) => { event.preventDefault(); save(String(new FormData(event.currentTarget).get("paymentDate") || "")); }} className="space-y-4">
          {paymentChanges.some((item) => !item.reversal) ? <label className="block space-y-1 text-sm">入金日<Input aria-label="入金日" name="paymentDate" type="date" required defaultValue={todayIso()} disabled={saving} /></label> : null}
          <DialogFooter><Button type="button" variant="outline" disabled={saving} onClick={() => setPaymentConfirm(false)}>キャンセル</Button><Button type="submit" disabled={saving}>{saving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}確認して保存</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </section>;
}
