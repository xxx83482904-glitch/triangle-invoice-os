"use client";

import Image from "next/image";
import Link from "next/link";
import { Fragment, useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Download, ExternalLink, FileText, LoaderCircle, RotateCcw, Save, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { documentCategoryLabels, documentKindLabels, issuedStatusLabels, type DocumentRow } from "@/lib/documents";
import type { CompanyScope } from "@/lib/company";
import { saveIssuedInvoiceEdits, type IssuedEdit } from "@/app/issued-invoices/actions";
import { toast } from "@/hooks/use-toast";

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

function editedRow(row: DocumentRow, edit?: IssuedEdit): DocumentRow {
  if (!edit) return row;
  return { ...row, title: edit.invoiceNumber, date: edit.issueDate, total: edit.total, status: edit.status,
    statusLabel: edit.needsReview ? "OCR要確認" : issuedStatusLabels[edit.status],
    state: edit.needsReview || edit.status === "DRAFT" ? "review" : ["PAID", "CANCELED"].includes(edit.status) ? "done" : "open" };
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
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      <StateBadge row={editedRow(row, edit)} />
      <span className="text-xs text-muted-foreground">{documentKindLabels[row.kind]}</span>
      {row.fileUrl ? <Button asChild variant="outline" size="sm"><a href={row.fileUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="size-4" />原本を開く</a></Button> : null}
      <Button asChild variant="ghost" size="sm"><Link prefetch={false} href={row.sourceHref}>管理画面</Link></Button>
    </div>
    {row.fileUrl ? (
      row.mimeType?.startsWith("image/") ? <div className="relative h-72 bg-muted/30 sm:h-96"><Image unoptimized src={row.fileUrl} alt={row.fileName || row.title} fill sizes="(max-width: 1279px) 100vw, 420px" className="object-contain" /></div>
        : <iframe title={"原本: " + row.title} src={row.fileUrl} loading="lazy" className="h-80 w-full rounded border bg-white sm:h-[440px]" />
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
      <label className="grid gap-1 text-xs">状態<select aria-label="発行請求書の状態" className={selectClass} value={current.status} onChange={(e) => update({ status: e.target.value as IssuedEdit["status"] })}>
        {Object.entries(issuedStatusLabels).map(([value, label]) => <option key={value} value={value} disabled={value === "PAID" && row.status !== "PAID"}>{label}</option>)}
      </select></label>
      {row.imported ? <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={!current.needsReview} onChange={(e) => update({ needsReview: !e.target.checked })} />原本と内容を確認済み</label> : null}
    </fieldset> : <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2 text-sm">
      <dt className="text-muted-foreground">取引先</dt><dd className="break-words">{row.counterpart || "未設定"}</dd>
      <dt className="text-muted-foreground">案件</dt><dd className="break-words">{row.projectName || "未設定"}</dd>
      <dt className="text-muted-foreground">書類日</dt><dd>{row.date || "未設定"}</dd>
      <dt className="text-muted-foreground">分類</dt><dd>{documentCategoryLabels[row.category] || row.category}</dd>
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
    return rows.filter((r) => (kind === "all" || r.kind === kind) && (category === "all" || r.category === category) && (state === "all" || r.state === state) &&
      (month === "all" || r.month === month) && [r.title, r.counterpart, r.projectName, r.fileName || ""].join(" ").normalize("NFKC").toLocaleLowerCase().includes(q))
      .sort((a, b) => sort === "amount-desc" ? (b.total || 0) - (a.total || 0) : sort === "name" ? a.counterpart.localeCompare(b.counterpart, "ja") : sort === "date-asc" ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date));
  }, [rows, deferredQuery, kind, category, state, month, sort]);
  const groups = useMemo(() => {
    const map = new Map<string, DocumentRow[]>();
    for (const r of filtered.slice(0, limit)) map.set(r.month, [...(map.get(r.month) || []), r]);
    return [...map];
  }, [filtered, limit]);
  const active = rows.find((r) => r.id === activeId);
  const months = [...new Set(rows.map((r) => r.month))].sort().reverse();
  const allSelected = Boolean(filtered.length && filtered.every((r) => selected.has(r.id)));
  const selectedRows = rows.filter((r) => selected.has(r.id));
  const editableSelected = selectedRows.filter((r) => r.kind === "issued" && r.editable && !["PAID", "PARTIALLY_PAID"].includes(r.status));
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
  function save() {
    startSave(async () => {
      try {
        const result = await saveIssuedInvoiceEdits(company, Object.values(edits));
        if (result.error) { toast({ title: result.error, variant: "destructive" }); return; }
        setEdits({}); router.refresh(); toast({ title: changes + "件を保存しました", variant: "success" });
      } catch { toast({ title: "保存に失敗しました。変更内容を保持しています", variant: "destructive" }); }
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
      <div className="relative min-w-48 flex-1"><Search className="absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden /><Input aria-label="書類を検索" placeholder="書類名・取引先・案件を検索" className="h-10 pl-9" value={query} onChange={(e) => { setQuery(e.target.value); setLimit(pageSize); }} /></div>
      <select aria-label="月で絞り込み" className={selectClass} value={month} onChange={(e) => { setMonth(e.target.value); setLimit(pageSize); }}><option value="all">すべての月</option>{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select>
      {!issuedOnly ? <select aria-label="書類種別" className={selectClass} value={kind} onChange={(e) => { setKind(e.target.value); setLimit(pageSize); }}><option value="all">すべての書類</option>{Object.entries(documentKindLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select> : null}
      {!issuedOnly ? <select aria-label="書類分類" className={selectClass} value={category} onChange={(e) => { setCategory(e.target.value); setLimit(pageSize); }}><option value="all">すべての分類</option>{Object.entries(documentCategoryLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select> : null}
      <select aria-label="並び順" className={selectClass} value={sort} onChange={(e) => setSort(e.target.value)}><option value="date-desc">日付が新しい順</option><option value="date-asc">日付が古い順</option><option value="amount-desc">金額が大きい順</option><option value="name">取引先名順</option></select>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label="確認状態" className="flex flex-wrap gap-1">
        {[["all", "すべて"], ["review", "要確認"], ["open", "未完了"], ["done", "完了"]].map(([v, l]) => <Button key={v} size="sm" variant={state === v ? "default" : "ghost"} aria-pressed={state === v} onClick={() => { setState(v); setLimit(pageSize); }}>{l}</Button>)}
      </div>
      <span className="text-xs text-muted-foreground">{filtered.length}件{selectedRows.length ? " / " + selectedRows.length + "件選択" : ""}</span>
      {canExport ? <Button title="CSV出力" aria-label="CSV出力" variant="outline" size="icon" className="ml-auto" onClick={exportCsv}><Download className="size-4" /></Button> : null}
      {selectedRows.length ? <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>選択解除</Button> : null}
      {editableSelected.length ? <select aria-label="選択した発行請求書の状態を一括変更" disabled={saving} className={selectClass} value="" onChange={(e) => { const status = e.target.value as IssuedEdit["status"]; if (!status) return; setEdits((old) => { const next = { ...old }; for (const r of editableSelected) next[r.id] = { ...(old[r.id] || editFrom(r)), status }; return next; }); }}>
        <option value="">発行 {editableSelected.length}件を一括変更</option>{["DRAFT", "ISSUED", "SENT", "WAITING_PAYMENT"].map((s) => <option key={s} value={s}>{issuedStatusLabels[s]}</option>)}
      </select> : null}
    </div>
    {changes ? <div className="sticky top-14 z-20 flex flex-wrap items-center gap-2 border-y border-amber-500/30 bg-background p-3 lg:top-0" role="status">
      <span className="mr-auto text-sm">{changes}件の未保存変更</span>
      <Button variant="outline" disabled={saving} onClick={() => { if (window.confirm("未保存の変更を破棄しますか？")) setEdits({}); }}><RotateCcw className="size-4" />元に戻す</Button>
      <Button disabled={saving} onClick={save}>{saving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}すべて保存</Button>
    </div> : null}
    <div className={active ? "grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_400px]" : "min-w-0"}>
      <div className="min-w-0">
        <div className="max-h-[70vh] overflow-auto border-y">
          <div className="md:hidden">
            <label className="flex min-h-11 items-center gap-3 border-b px-3 text-sm"><input className="size-5" type="checkbox" aria-label="表示結果をすべて選択" checked={allSelected} disabled={!filtered.length} onChange={() => setSelected(allSelected ? new Set() : new Set(filtered.map((r) => r.id)))} />すべて選択</label>
            {groups.map(([m, list]) => <Fragment key={m}>
              <button className="flex min-h-11 w-full items-center gap-2 bg-muted/60 px-3 text-sm font-medium" aria-expanded={!collapsed.has(m)} onClick={() => setCollapsed((old) => { const next = new Set(old); if (next.has(m)) next.delete(m); else next.add(m); return next; })}>{collapsed.has(m) ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}{monthLabel(m)}</button>
              {!collapsed.has(m) ? list.map((r) => <div key={r.id} className={"flex min-w-0 items-start gap-3 border-b p-3 " + (selected.has(r.id) || activeId === r.id ? "bg-primary/10" : "")}>
                <input className="mt-3 size-5 shrink-0" type="checkbox" aria-label={r.title + "を選択"} checked={selected.has(r.id)} onChange={() => {}} onClick={(e) => toggle(r, e.shiftKey)} />
                <button onClick={() => open(r)} className="grid min-w-0 flex-1 gap-1 text-left text-sm">
                  <span className="break-words font-medium">{edits[r.id]?.invoiceNumber || r.title}</span>
                  <span className="break-words text-xs text-muted-foreground">{r.counterpart} / {r.projectName || documentKindLabels[r.kind]}</span>
                  <span className="flex flex-wrap items-center gap-2 text-xs"><StateBadge row={editedRow(r, edits[r.id])} /><span>{edits[r.id]?.issueDate || r.date}</span><span className="ml-auto tabular-nums">{r.total === undefined ? "" : number.format(edits[r.id]?.total ?? r.total)}</span></span>
                  {edits[r.id] ? <span className="text-xs text-amber-700 dark:text-amber-300">未保存</span> : null}
                </button>
              </div>) : null}
            </Fragment>)}
          </div>
          <table className="hidden w-full min-w-[680px] table-fixed text-left text-sm md:table">
            <thead className="sticky top-0 z-10 bg-background text-xs text-muted-foreground"><tr>
              <th className="w-11 p-2"><input className="size-4" type="checkbox" aria-label="検索結果をすべて選択" checked={allSelected} disabled={!filtered.length} onChange={() => setSelected((old) => { const next = new Set(old); for (const r of filtered) { if (allSelected) next.delete(r.id); else next.add(r.id); } return next; })} /></th>
              <th className="w-[28%] p-2">書類</th><th className="w-[21%] p-2">取引先 / 案件</th><th className="w-24 p-2">日付</th><th className="w-24 p-2 text-right">金額</th><th className="w-28 p-2">状態</th>
            </tr></thead>
            <tbody>{groups.map(([m, list]) => <Fragment key={m}>
              <tr className="border-t bg-muted/60"><td colSpan={6} className="p-0"><button className="sticky left-0 flex min-h-10 items-center gap-2 px-3 text-xs font-semibold" aria-expanded={!collapsed.has(m)} onClick={() => setCollapsed((old) => { const next = new Set(old); if (next.has(m)) next.delete(m); else next.add(m); return next; })}>{collapsed.has(m) ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}{monthLabel(m)}</button></td></tr>
              {!collapsed.has(m) ? list.map((r) => <tr key={r.id} data-document-id={r.id} className={"border-t align-top " + (activeId === r.id ? "bg-primary/10" : selected.has(r.id) ? "bg-accent/50" : "hover:bg-muted/30")}>
                <td className="p-3"><input className="size-4" type="checkbox" aria-label={r.title + "を選択"} checked={selected.has(r.id)} onChange={() => {}} onClick={(e) => toggle(r, e.shiftKey)} /></td>
                <td className="px-2 py-3"><button className="min-h-8 w-full text-left hover:underline" onClick={() => open(r)}><span className="block break-words font-medium">{edits[r.id]?.invoiceNumber || r.title}</span><span className="block text-xs font-normal text-muted-foreground">{documentKindLabels[r.kind]} · {documentCategoryLabels[r.category] || r.category}{edits[r.id] ? " · 未保存" : ""}</span></button></td>
                <td className="px-2 py-3"><span className="block truncate" title={r.counterpart}>{r.counterpart || "—"}</span><span className="block truncate text-xs text-muted-foreground" title={r.projectName}>{r.projectName}</span></td>
                <td className="px-2 py-3 text-xs tabular-nums">{(edits[r.id]?.issueDate ?? r.date) || "未設定"}</td><td className="px-2 py-3 text-right tabular-nums">{r.total === undefined ? "—" : number.format(edits[r.id]?.total ?? r.total)}</td>
                <td className="px-2 py-3"><StateBadge row={editedRow(r, edits[r.id])} /></td>
              </tr>) : null}
            </Fragment>)}</tbody>
          </table>
          {!filtered.length ? <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-sm text-muted-foreground"><FileText className="size-8" />{rows.length ? "条件に合う書類がありません" : "書類はまだありません"}{rows.length ? <Button variant="outline" onClick={() => { setQuery(""); setKind("all"); setCategory("all"); setMonth("all"); setState("all"); }}>絞り込みを解除</Button> : null}</div> : null}
        </div>
        {filtered.length > limit ? <div className="flex justify-center p-3"><Button variant="outline" onClick={() => setLimit((n) => n + pageSize)}>さらに表示（残り{filtered.length - limit}件）</Button></div> : null}
      </div>
      {active ? <aside ref={preview} className="min-w-0 scroll-mt-28 border-t pt-3 xl:sticky xl:top-3 xl:max-h-[80vh] xl:overflow-auto xl:border-l xl:border-t-0 xl:pl-4">
        <div className="mb-3 flex items-start justify-between gap-2"><h2 className="break-all font-semibold">{active.title}</h2><Button variant="ghost" size="icon" className="shrink-0" title="プレビューを閉じる" aria-label="プレビューを閉じる" onClick={() => setActiveId("")}><X className="size-4" /></Button></div>
        <DocumentDetails key={active.id} row={active} company={company} projects={projects} edit={edits[active.id]} onEdit={(v) => setEdits((old) => ({ ...old, [active.id]: v }))} disabled={saving} />
      </aside> : null}
    </div>
  </section>;
}
