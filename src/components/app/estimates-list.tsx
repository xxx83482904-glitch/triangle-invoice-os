"use client";

import Link from "next/link";
import { Fragment, useDeferredValue, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ContextMenu } from "radix-ui";
import { ArrowRightLeft, ChevronDown, ChevronRight, Ellipsis, ExternalLink, FileText, LoaderCircle, Pencil, Plus, RotateCcw, Save, Search, Trash2, X } from "lucide-react";
import { deleteEstimatesAction, saveEstimateListEditsAction } from "@/app/estimates/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { RowSelectionCheckbox, SelectAllCheckbox, SelectionToolbar } from "@/components/app/list-selection";
import type { ProjectBasicOption } from "@/components/app/editable-project-select";
import { useListSelection } from "@/hooks/use-list-selection";
import { toast } from "@/hooks/use-toast";
import type { CompanyScope } from "@/lib/company";
import type { DocumentRow } from "@/lib/documents";
import { documentCounterpartKey, documentProjectOptions, groupDocuments, orderDocuments } from "@/lib/document-order";
import { estimateListEditFrom, estimateStatusLabels, type EstimateListEdit } from "@/lib/estimate-values";
import type { Estimate } from "@/lib/types";

type Props = { company: CompanyScope; estimates: Estimate[]; rows: DocumentRow[]; projects: ProjectBasicOption[]; clients: { id: string; name: string }[];
  canEdit: boolean; pending: boolean; activeId: string; onOpen: (id: string) => void; onEdit: (estimate: Estimate | "new") => void; onConvert: (estimate: Estimate) => void };
type RowAction = { label: string; icon: typeof Pencil; action: () => void; destructive?: boolean };
const selectClass = "h-11 min-w-0 max-w-full rounded-md border bg-background px-2 text-sm";
const money = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" });
const monthLabel = (month: string) => month === "undated" ? "日付未設定" : month.replace("-", "年") + "月";
const gridClass = "md:grid-cols-[44px_minmax(140px,2fr)_minmax(100px,1fr)_90px_90px_140px_44px]";

function EstimateActions({ actions, label, disabled, children }: { actions: RowAction[]; label: string; disabled: boolean; children?: ReactNode }) {
  if (children) return <ContextMenu.Root><ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger><ContextMenu.Portal>
    <ContextMenu.Content className="z-50 min-w-44 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
      {actions.map((action) => <ContextMenu.Item key={action.label} disabled={disabled} onSelect={action.action} className={`flex min-h-11 cursor-default items-center gap-2 rounded px-3 text-sm outline-none focus:bg-accent data-[disabled]:opacity-50 ${action.destructive ? "text-destructive" : ""}`}><action.icon className="size-4" />{action.label}</ContextMenu.Item>)}
    </ContextMenu.Content></ContextMenu.Portal></ContextMenu.Root>;
  return <DropdownMenu><DropdownMenuTrigger asChild><Button disabled={disabled} variant="ghost" size="icon" className="size-11 shrink-0" aria-label={`${label}の操作`} title="見積書の操作"><Ellipsis className="size-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
    {actions.map((action) => <DropdownMenuItem key={action.label} disabled={disabled} variant={action.destructive ? "destructive" : "default"} onSelect={action.action} className="min-h-11"><action.icon className="size-4" />{action.label}</DropdownMenuItem>)}
  </DropdownMenuContent></DropdownMenu>;
}

export function EstimatesList({ company, estimates, rows, projects, clients, canEdit, pending, activeId, onOpen, onEdit, onConvert }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [status, setStatus] = useState("all");
  const [month, setMonth] = useState("all");
  const [client, setClient] = useState("all");
  const [sort, setSort] = useState("client");
  const [limit, setLimit] = useState(50);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, EstimateListEdit>>({});
  const [deleteTargets, setDeleteTargets] = useState<Estimate[]>([]);
  const [saving, startTransition] = useTransition();
  const [error, setError] = useState("");
  const busy = saving || pending;
  const preview = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const loadMore = useRef<HTMLDivElement>(null);
  const changes = Object.keys(edits).length;
  const estimateMap = useMemo(() => new Map(estimates.map((e) => [e.id, e])), [estimates]);
  const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const clientMap = useMemo(() => new Map(clients.map((c) => [c.id, c.name])), [clients]);
  const projectOptions = useMemo(() => projects.map((p) => ({ value: p.id, label: p.name, clientId: p.clientId })), [projects]);
  const filtered = useMemo(() => {
    const q = deferredQuery.trim().normalize("NFKC").toLocaleLowerCase();
    return orderDocuments(rows.filter((row) => (status === "all" || row.status === status) && (month === "all" || row.month === month) &&
      (client === "all" || documentCounterpartKey(row) === client) && [row.title, row.counterpart, row.projectName, row.billingLabel || ""].join(" ").normalize("NFKC").toLocaleLowerCase().includes(q)), sort);
  }, [rows, deferredQuery, status, month, client, sort]);
  const groups = useMemo(() => groupDocuments(filtered, sort, limit), [filtered, sort, limit]);
  const visibleIds = groups.flatMap(([key, list]) => collapsed.has(key) ? [] : list.map((row) => row.sourceId));
  const selection = useListSelection(visibleIds, { availableIds: estimates.map((e) => e.id), disabled: busy });
  const editable = (e: Estimate) => canEdit && !e.invoiceId && e.status !== "CONVERTED";
  const selected = estimates.filter((e) => selection.selected.has(e.id));
  const editableSelected = selected.filter(editable);
  const active = estimateMap.get(activeId);
  const activeEdit = active ? edits[active.id] || estimateListEditFrom(active) : null;
  const months = [...new Set(rows.map((r) => r.month))].sort().reverse();
  const counterparts = [...new Map(rows.map((row) => [documentCounterpartKey(row), row.counterpart])).entries()].sort((a, b) => a[1].localeCompare(b[1], "ja"));
  const hasFilters = Boolean(query || status !== "all" || month !== "all" || client !== "all");

  useEffect(() => {
    if (!changes) return;
    const beforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    const intercept = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest("a") : null;
      if (link && link.target !== "_blank" && !window.confirm("未保存の変更があります。移動しますか？")) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", beforeUnload); document.addEventListener("click", intercept, true);
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", intercept, true); };
  }, [changes]);
  useEffect(() => {
    if (filtered.length <= limit || !loadMore.current) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) setLimit((value) => value + 50); }, { root: scroller.current, rootMargin: "200px" });
    observer.observe(loadMore.current); return () => observer.disconnect();
  }, [limit, filtered.length]);
  useEffect(() => {
    if (window.innerWidth < 1280) preview.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [active?.id]);

  function resetFilters() { setQuery(""); setStatus("all"); setMonth("all"); setClient("all"); setLimit(50); }
  function stage(estimate: Estimate, patch: Partial<EstimateListEdit>) {
    if (!editable(estimate) || busy) return;
    setEdits((old) => ({ ...old, [estimate.id]: { ...(old[estimate.id] || estimateListEditFrom(estimate)), ...patch } }));
  }
  function guarded(action: () => void) {
    if (busy) return;
    if (changes) { toast({ title: "未保存の変更があります。保存または元に戻してから操作してください" }); return; }
    action();
  }
  function fail(message: string) { setError(message); toast({ title: message, variant: "destructive" }); }
  function saveAll() {
    setError(""); startTransition(async () => {
      try {
        const result = await saveEstimateListEditsAction(company, Object.values(edits));
        if (result.error) { fail(result.error); return; }
        setEdits({}); router.refresh(); toast({ title: `${changes}件を保存しました`, variant: "success" });
      } catch { fail("保存に失敗しました。変更内容を保持しています"); }
    });
  }
  function askDelete(targets: Estimate[]) { guarded(() => { setError(""); setDeleteTargets(targets); }); }
  function remove() {
    setError(""); startTransition(async () => {
      try {
        const result = await deleteEstimatesAction(company, deleteTargets.map(({ id, updatedAt }) => ({ id, updatedAt })));
        if (result.error) { fail(result.error); return; }
        const deleted = new Set(deleteTargets.map((e) => e.id));
        selection.setSelected((old) => new Set([...old].filter((id) => !deleted.has(id))));
        if (deleted.has(activeId)) onOpen("");
        setDeleteTargets([]); router.refresh(); toast({ title: `${deleteTargets.length}件の見積書を削除しました`, variant: "success" });
      } catch { fail("削除に失敗しました。再度お試しください"); }
    });
  }
  const actions = (e: Estimate): RowAction[] => [
    { label: "プレビュー", icon: FileText, action: () => onOpen(e.id) },
    ...(editable(e) ? [{ label: "明細を編集", icon: Pencil, action: () => guarded(() => onEdit(e)) }] : []),
    ...(editable(e) && e.status !== "DECLINED" ? [{ label: "請求書に変換", icon: ArrowRightLeft, action: () => guarded(() => onConvert(e)) }] : []),
    ...(e.invoiceId ? [{ label: "請求書を開く", icon: ExternalLink, action: () => guarded(() => router.push(`/issued-invoices?company=${company}&document=${encodeURIComponent(`issued:${e.invoiceId}`)}`)) }] : []),
    ...(editable(e) ? [{ label: "削除", icon: Trash2, action: () => askDelete([e]), destructive: true }] : []),
  ];
  function projectControl(e: Estimate) {
    const value = edits[e.id]?.projectId || e.projectId;
    const options = documentProjectOptions(projectOptions, value);
    const label = options.find((p) => p.value === value)?.label || "案件未設定";
    return editable(e) ? <select aria-label={`${e.estimateNumber}の案件`} title={label} className={`${selectClass} w-full border-transparent bg-transparent px-1 font-medium hover:border-input focus:border-ring`} disabled={busy} value={value} onChange={(event) => stage(e, { projectId: event.target.value })}>
      {!options.some((p) => p.value === value) ? <option value={value}>{label}</option> : null}{options.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
    </select> : <span className="block break-words font-medium">{label}</span>;
  }
  function statusControl(e: Estimate) {
    const value = edits[e.id] ? edits[e.id].status : e.status;
    return <select aria-label={`${e.estimateNumber}のステータス`} className={`${selectClass} w-full text-xs ${value === "ACCEPTED" || value === "CONVERTED" ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-300" : ""}`} disabled={busy || !editable(e)} value={value} onChange={(event) => stage(e, { status: event.target.value as EstimateListEdit["status"] })}>
      {Object.entries(estimateStatusLabels).map(([key, label]) => <option key={key} value={key} disabled={key === "CONVERTED"}>{label}</option>)}
    </select>;
  }
  function counterpart(e: Estimate) {
    const projectId = edits[e.id]?.projectId;
    return clientMap.get(projectId && projectId !== e.projectId ? projectMap.get(projectId)?.clientId || "" : e.clientId) || "取引先未設定";
  }

  return <section aria-label="発行見積書一覧" className="min-w-0 space-y-3">
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button asChild variant="outline" className="min-h-11"><Link prefetch={false} href={`/issued-invoices?company=${company}`}><FileText className="size-4" />発行請求書</Link></Button>
      {canEdit ? <Button disabled={busy} className="min-h-11" onClick={() => guarded(() => onEdit("new"))}><Plus className="size-4" />見積書を作成</Button> : null}
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-0 flex-1 basis-56"><Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="見積書を検索" placeholder="番号・取引先・案件で検索" className="h-11 pl-9 lg:h-11 lg:pl-9" value={query} onChange={(event) => { setQuery(event.target.value); setLimit(50); }} /></div>
      <select aria-label="月で絞り込み" className={selectClass} value={month} onChange={(event) => { setMonth(event.target.value); setLimit(50); }}><option value="all">すべての月</option>{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select>
      <select aria-label="取引先で絞り込み" className={selectClass} value={client} onChange={(event) => { setClient(event.target.value); setLimit(50); }}><option value="all">すべてのクライアント</option>{counterparts.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
      <select aria-label="見積書の並び順" className={selectClass} value={sort} onChange={(event) => { setSort(event.target.value); setLimit(50); }}><option value="client">クライアントごと</option><option value="date-desc">日付が新しい順</option><option value="date-asc">日付が古い順</option><option value="amount-desc">金額が大きい順</option><option value="project">案件ごと</option></select>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="見積書の状態" className={selectClass} value={status} onChange={(event) => { setStatus(event.target.value); setLimit(50); }}><option value="all">すべての状態</option>{Object.entries(estimateStatusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      <span role="status" className="text-xs text-muted-foreground">{filtered.length} / {rows.length}件</span>
      {hasFilters ? <Button className="min-h-11" variant="ghost" onClick={resetFilters}><X className="size-4" />絞り込みを解除</Button> : null}
    </div>
    <SelectionToolbar selection={selection} />
    {selected.length ? <div aria-label="選択した見積書の一括操作" className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
      <span className="mr-auto text-sm">{selected.length}件選択{selection.hiddenCount ? `（表示外 ${selection.hiddenCount}件を含む）` : ""}</span>
      {editableSelected.length ? <select aria-label="選択した見積書の状態を一括変更" className={selectClass} disabled={busy} value="" onChange={(event) => {
        const value = event.target.value as EstimateListEdit["status"]; if (!value) return;
        setEdits((old) => { const next = { ...old }; for (const e of editableSelected) next[e.id] = { ...(old[e.id] || estimateListEditFrom(e)), status: value }; return next; });
      }}><option value="">見積 {editableSelected.length}件を一括変更</option>{Object.entries(estimateStatusLabels).filter(([key]) => key !== "CONVERTED").map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select> : null}
      {editableSelected.length === selected.length ? <Button variant="outline" className="min-h-11 text-destructive" disabled={busy} onClick={() => askDelete(selected)}><Trash2 className="size-4" />選択した{selected.length}件を削除</Button> : null}
    </div> : null}
    {changes ? <div role="status" className="sticky top-14 z-20 flex flex-wrap items-center gap-2 border-y border-amber-500/30 bg-background p-3 lg:top-0">
      <span className="mr-auto text-sm">{changes}件の未保存変更</span><Button variant="outline" className="min-h-11" disabled={busy} onClick={() => { if (window.confirm("未保存の変更を破棄しますか？")) { setEdits({}); setError(""); } }}><RotateCcw className="size-4" />元に戻す</Button>
      <Button className="min-h-11" disabled={busy} onClick={saveAll}>{saving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}すべて保存</Button>
    </div> : null}
    {error && !deleteTargets.length ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
    <div className={active ? "grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_400px]" : "min-w-0"}>
      <div ref={scroller} className="max-h-[70vh] min-w-0 overflow-auto border-y">
        <div className="md:min-w-[720px]">
          <div className={`sticky top-0 z-10 hidden items-center gap-2 border-b bg-background text-xs text-muted-foreground md:grid ${gridClass}`}><SelectAllCheckbox selection={selection} label="表示中の見積書をすべて選択" /><span>案件名 / 見積番号</span><span>取引先</span><span>見積日 / 有効期限</span><span className="text-right">金額</span><span>状態</span><span /></div>
          {groups.map(([key, list]) => <Fragment key={key}>
            <button className="sticky left-0 flex min-h-11 w-full items-center gap-2 border-y bg-muted/60 px-3 text-left text-xs font-semibold" aria-expanded={!collapsed.has(key)} onClick={() => setCollapsed((old) => { const next = new Set(old); if (next.has(key)) next.delete(key); else next.add(key); return next; })}>
              {collapsed.has(key) ? <ChevronRight className="size-4 shrink-0" /> : <ChevronDown className="size-4 shrink-0" />}<span className="break-words">{sort === "client" ? list[0].counterpart : sort === "project" ? list[0].projectName || "案件未設定" : monthLabel(key)}</span>
            </button>
            {!collapsed.has(key) ? list.map((row) => {
              const e = estimateMap.get(row.sourceId); if (!e) return null;
              const edit = edits[e.id];
              return <EstimateActions key={e.id} label={e.estimateNumber} actions={actions(e)} disabled={busy}>
                <div {...selection.rowProps(e.id)} data-estimate-id={e.id} className={`grid grid-cols-[44px_minmax(0,1fr)_44px] items-start gap-2 border-b py-3 text-sm ${gridClass} ${selection.selected.has(e.id) || activeId === e.id ? "bg-primary/10" : "hover:bg-muted/30"}`}>
                  <RowSelectionCheckbox selection={selection} id={e.id} label={`${e.estimateNumber}を選択`} />
                  <div className="min-w-0">{projectControl(e)}<button data-selection-open className="min-h-11 w-full break-words text-left text-xs text-muted-foreground hover:underline" onClick={() => onOpen(e.id)}>{e.estimateNumber}<span className="block">発行見積書{edit ? " · 未保存" : ""}</span></button>{row.billingLabel ? <span className="block break-words text-xs text-muted-foreground">請求回・内訳: {row.billingLabel}</span> : null}</div>
                  <span className="col-start-2 break-words md:col-start-auto md:pt-3">{counterpart(e)}</span>
                  <span className="col-start-2 text-xs tabular-nums md:col-start-auto md:pt-3">{edit?.issueDate || e.issueDate}<span className="block text-muted-foreground">{edit?.validUntil || e.validUntil}</span></span>
                  <span className="col-start-2 break-words tabular-nums md:col-start-auto md:pt-3 md:text-right">{money.format(e.total)}</span>
                  <div className="col-start-2 min-w-0 md:col-start-auto">{statusControl(e)}</div>
                  <div className="col-start-3 row-start-1 md:col-start-auto md:row-start-auto"><EstimateActions label={e.estimateNumber} actions={actions(e)} disabled={busy} /></div>
                </div>
              </EstimateActions>;
            }) : null}
          </Fragment>)}
          {!filtered.length ? <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-sm text-muted-foreground"><FileText className="size-8" />{rows.length ? "条件に合う見積書がありません" : "見積書はまだありません"}{hasFilters ? <Button variant="outline" onClick={resetFilters}>絞り込みを解除</Button> : null}</div> : null}
        </div>
        {filtered.length > limit ? <div ref={loadMore} className="flex justify-center p-3"><Button variant="outline" className="min-h-11" onClick={() => setLimit((value) => value + 50)}>さらに表示（残り{filtered.length - limit}件）</Button></div> : null}
      </div>
      {active && activeEdit ? <aside ref={preview} aria-label="見積書プレビュー" className="min-w-0 scroll-mt-28 space-y-3 border-t pt-3 xl:sticky xl:top-3 xl:max-h-[80vh] xl:overflow-auto xl:border-l xl:border-t-0 xl:pl-4">
        <div className="flex items-start justify-between gap-2"><h2 className="break-all font-semibold">{active.estimateNumber}</h2><Button variant="ghost" size="icon" className="size-11 shrink-0" title="プレビューを閉じる" aria-label="プレビューを閉じる" onClick={() => onOpen("")}><X className="size-4" /></Button></div>
        <div className="flex flex-wrap gap-2"><Button asChild variant="outline" className="min-h-11"><a href={`/api/estimates/${active.id}/pdf?v=${encodeURIComponent(active.updatedAt)}`} target="_blank" rel="noopener noreferrer"><ExternalLink className="size-4" />PDFを開く</a></Button>
          {actions(active).filter((action) => !["プレビュー", "削除"].includes(action.label)).map((action) => <Button key={action.label} variant="outline" className="min-h-11" disabled={busy} onClick={action.action}><action.icon className="size-4" />{action.label}</Button>)}
        </div>
        {edits[active.id] ? <p className="text-xs text-amber-700 dark:text-amber-300">未保存の変更あり・PDFは保存済みの内容</p> : null}
        <iframe title={`見積書PDF: ${active.estimateNumber}`} src={`/api/estimates/${active.id}/pdf?v=${encodeURIComponent(active.updatedAt)}`} className="h-80 w-full rounded border bg-white sm:h-[440px]" />
        <fieldset disabled={busy || !editable(active)} className="grid min-w-0 gap-3 text-xs">
          <label className="grid min-w-0 gap-1">案件{projectControl(active)}</label><div className="break-words text-muted-foreground">取引先: {counterpart(active)}</div>
          <div className="grid min-w-0 grid-cols-2 gap-3"><label className="min-w-0 space-y-1">見積日<Input aria-label="見積日" type="date" value={activeEdit.issueDate} onChange={(event) => stage(active, { issueDate: event.target.value })} /></label><label className="min-w-0 space-y-1">有効期限<Input aria-label="有効期限" type="date" min={activeEdit.issueDate} value={activeEdit.validUntil} onChange={(event) => stage(active, { validUntil: event.target.value })} /></label></div>
          <label className="grid gap-1">状態{statusControl(active)}</label><div className="flex justify-between gap-2 text-sm"><span>見積金額</span><span className="tabular-nums">{money.format(active.total)}</span></div>
        </fieldset>
        {active.notes ? <div className="border-t pt-3 text-sm"><h3 className="font-medium">備考</h3><p className="whitespace-pre-wrap break-words text-muted-foreground">{active.notes}</p></div> : null}
        {active.internalMemo ? <div className="border-t pt-3 text-sm"><h3 className="font-medium">社内メモ</h3><p className="whitespace-pre-wrap break-words text-muted-foreground">{active.internalMemo}</p></div> : null}
      </aside> : null}
    </div>
    <Dialog open={deleteTargets.length > 0} onOpenChange={(open) => { if (!open && !busy) setDeleteTargets([]); }}><DialogContent showCloseButton={!busy} onInteractOutside={(event) => { if (busy) event.preventDefault(); }} onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}>
      <DialogHeader><DialogTitle>見積書を削除しますか？</DialogTitle><DialogDescription>{deleteTargets.length}件を一覧から削除します。履歴は保持されます。</DialogDescription></DialogHeader>
      <ul className="max-h-40 overflow-auto break-all text-sm">{deleteTargets.map((e) => <li key={e.id}>{e.estimateNumber}</li>)}</ul>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setDeleteTargets([])}>キャンセル</Button><Button variant="destructive" disabled={busy} onClick={remove}>{saving ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}削除する</Button></DialogFooter>
    </DialogContent></Dialog>
  </section>;
}
