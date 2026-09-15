"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ContextMenu } from "radix-ui";
import { ArrowRightLeft, Ellipsis, ExternalLink, FileText, LoaderCircle, Pencil, Plus, Save, Search, Trash2 } from "lucide-react";
import { convertEstimateAction, deleteEstimateAction, saveEstimateAction } from "@/app/estimates/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { EstimateStatusSelect } from "@/components/app/estimate-status-select";
import type { CompanyScope } from "@/lib/company";
import { estimateStatusLabels, estimateTotals, type EstimateInput } from "@/lib/estimate-values";
import { todayIso } from "@/lib/format";
import type { Estimate, TaxRate } from "@/lib/types";

type Option = { id: string; name: string };
type ProjectOption = Option & { clientId: string };
type Props = { company: CompanyScope; estimates: Estimate[]; projects: ProjectOption[]; clients: Option[]; canEdit: boolean; initialId?: string };
const selectClass = "h-11 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm";
const menuClass = "flex min-h-11 cursor-default items-center gap-2 rounded px-3 text-sm outline-none focus:bg-accent data-[disabled]:opacity-50 [&_svg]:size-4";
const money = (value: number) => `¥${new Intl.NumberFormat("ja-JP").format(value)}`;
const pdfUrl = (e: Estimate) => `/api/estimates/${e.id}/pdf?v=${encodeURIComponent(e.updatedAt)}`;
const invoiceHref = (company: CompanyScope, id: string) => `/issued-invoices?company=${company}&document=${encodeURIComponent(`issued:${id}`)}`;
const blankItem = () => ({ description: "", quantity: 1, unitPrice: 0, taxRate: 10 as TaxRate });
function nextMonth() {
  const date = new Date(`${todayIso()}T12:00:00`); date.setDate(date.getDate() + 30);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function EstimateEditor({ estimate, projects, clients, pending, onSave }: {
  estimate?: Estimate; projects: ProjectOption[]; clients: Option[]; pending: boolean; onSave: (input: EstimateInput) => void;
}) {
  const [form, setForm] = useState<EstimateInput>(() => ({
    id: estimate?.id, updatedAt: estimate?.updatedAt, projectId: estimate?.projectId || "", clientId: estimate?.clientId || "",
    issueDate: estimate?.issueDate || todayIso(), validUntil: estimate?.validUntil || nextMonth(),
    status: estimate?.status === "CONVERTED" ? "DRAFT" : estimate?.status || "DRAFT", notes: estimate?.notes || "", internalMemo: estimate?.internalMemo || "",
    items: estimate?.items.map((item) => ({ ...item })) || [blankItem()],
  }));
  const totals = estimateTotals(form.items);
  function itemChange(index: number, patch: Partial<EstimateInput["items"][number]>) {
    setForm((prev) => ({ ...prev, items: prev.items.map((item, i) => i === index ? { ...item, ...patch } : item) }));
  }
  return <form onSubmit={(event) => { event.preventDefault(); onSave(form); }} className="min-w-0 space-y-4">
    <fieldset disabled={pending} className="min-w-0 space-y-4">
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <label className="min-w-0 space-y-1">案件<select aria-label="案件" className={selectClass} required value={form.projectId} onChange={(e) => {
          const project = projects.find((p) => p.id === e.target.value);
          setForm({ ...form, projectId: e.target.value, clientId: clients.some((c) => c.id === project?.clientId) ? project!.clientId : form.clientId });
        }}><option value="">案件を選択</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="min-w-0 space-y-1">取引先<select aria-label="取引先" className={selectClass} required value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}><option value="">取引先を選択</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="min-w-0 space-y-1">見積日<Input aria-label="見積日" type="date" required value={form.issueDate} onChange={(e) => setForm({ ...form, issueDate: e.target.value })} /></label>
        <label className="min-w-0 space-y-1">有効期限<Input aria-label="有効期限" type="date" required min={form.issueDate} value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} /></label>
        <label className="min-w-0 space-y-1">ステータス<select aria-label="ステータス" className={selectClass} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as EstimateInput["status"] })}>{Object.entries(estimateStatusLabels).filter(([key]) => key !== "CONVERTED").map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      </div>
      <div className="min-w-0 divide-y border-y">
        {form.items.map((item, index) => <div key={index} className="grid min-w-0 grid-cols-2 gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_75px_110px_95px_44px]">
          <label className="col-span-2 min-w-0 space-y-1 sm:col-span-1"><span className="text-xs text-muted-foreground">明細 {index + 1}</span><Textarea aria-label={`明細${index + 1} 内容`} required maxLength={2000} value={item.description} onChange={(e) => itemChange(index, { description: e.target.value })} /></label>
          <label className="min-w-0 space-y-1"><span className="text-xs text-muted-foreground">数量</span><Input aria-label={`明細${index + 1} 数量`} required type="number" min="0.01" max="1000000" step="0.01" value={item.quantity} onChange={(e) => itemChange(index, { quantity: Number(e.target.value) })} /></label>
          <label className="min-w-0 space-y-1"><span className="text-xs text-muted-foreground">単価</span><Input aria-label={`明細${index + 1} 単価`} required type="number" min="0" max="1000000000" step="0.01" value={item.unitPrice} onChange={(e) => itemChange(index, { unitPrice: Number(e.target.value) })} /></label>
          <label className="min-w-0 space-y-1"><span className="text-xs text-muted-foreground">税区分</span><select aria-label={`明細${index + 1} 税区分`} className={selectClass} value={item.taxRate} onChange={(e) => itemChange(index, { taxRate: Number(e.target.value) as TaxRate })}><option value={10}>10%</option><option value={8}>8%</option><option value={0}>非課税</option><option value={-1}>対象外</option></select></label>
          <Button type="button" variant="ghost" size="icon" className="mt-5 size-11 justify-self-end" title={`明細${index + 1}を削除`} aria-label={`明細${index + 1}を削除`} disabled={form.items.length === 1} onClick={() => setForm({ ...form, items: form.items.filter((_, i) => i !== index) })}><Trash2 className="size-4" /></Button>
          <span className="col-span-full text-right text-xs tabular-nums text-muted-foreground">{money(Math.round(item.quantity * item.unitPrice))}</span>
        </div>)}
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3"><Button variant="outline" type="button" disabled={form.items.length >= 100} onClick={() => setForm({ ...form, items: [...form.items, blankItem()] })}><Plus className="size-4" />明細を追加</Button>
        <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1 text-right tabular-nums"><dt>税抜計</dt><dd>{money(totals.subtotal)}</dd><dt>消費税</dt><dd>{money(totals.taxTotal)}</dd><dt className="font-semibold">合計</dt><dd className="font-semibold">{money(totals.total)}</dd></dl>
      </div>
      <label className="block space-y-1">備考<Textarea aria-label="備考" maxLength={10000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
      <label className="block space-y-1">社内メモ<Textarea aria-label="社内メモ" maxLength={10000} value={form.internalMemo} onChange={(e) => setForm({ ...form, internalMemo: e.target.value })} /></label>
      <Button className="min-h-11 w-full" type="submit" disabled={pending}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}保存してプレビュー</Button>
    </fieldset>
  </form>;
}

export function EstimatesWorkspace({ company, estimates, projects, clients, canEdit, initialId }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [preview, setPreview] = useState<Estimate | null>(() => estimates.find((e) => e.id === initialId) || null);
  const [editor, setEditor] = useState<Estimate | "new" | null>(null);
  const [convertTarget, setConvertTarget] = useState<Estimate | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Estimate | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const clientMap = useMemo(() => new Map(clients.map((c) => [c.id, c.name])), [clients]);
  const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);
  const filtered = useMemo(() => estimates.filter((e) => (status === "all" || e.status === status) &&
    [e.estimateNumber, clientMap.get(e.clientId), projectMap.get(e.projectId)].join(" ").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [estimates, status, query, clientMap, projectMap]);
  const editable = (e: Estimate) => canEdit && !e.invoiceId && e.status !== "CONVERTED";
  function edit(e: Estimate | "new") { setError(""); setPreview(null); setEditor(e); }
  function failure(message: string) { setError(message); toast({ title: message, variant: "destructive" }); }
  function save(input: EstimateInput) {
    setError(""); startTransition(async () => {
      try {
        const result = await saveEstimateAction(company, input);
        if (!result.estimate) { failure(result.error || "保存に失敗しました"); return; }
        setEditor(null); setPreview(result.estimate); router.refresh(); toast({ title: "見積書を保存しました", variant: "success" });
      } catch { failure("通信に失敗しました。入力内容は保持されています"); }
    });
  }
  function remove() {
    if (!deleteTarget) return;
    setError(""); startTransition(async () => {
      try {
        const result = await deleteEstimateAction(company, deleteTarget);
        if (result.error) { failure(result.error); return; }
        setDeleteTarget(null); setPreview(null); router.refresh(); toast({ title: "見積書を削除しました", variant: "success" });
      } catch { failure("削除に失敗しました"); }
    });
  }
  const actions = (e: Estimate) => [
    { label: "プレビュー", icon: FileText, action: () => setPreview(e) },
    ...(editable(e) ? [{ label: "編集", icon: Pencil, action: () => edit(e) }] : []),
    ...(editable(e) && e.status !== "DECLINED" ? [{ label: "請求書に変換", icon: ArrowRightLeft, action: () => { setError(""); setConvertTarget(e); } }] : []),
    ...(e.invoiceId ? [{ label: "請求書を開く", icon: ExternalLink, action: () => router.push(invoiceHref(company, e.invoiceId!)) }] : []),
    ...(editable(e) ? [{ label: "削除", icon: Trash2, action: () => { setError(""); setDeleteTarget(e); } }] : []),
  ];
  return <div className="min-w-0 space-y-4">
    <div className="flex flex-wrap gap-2">
      <div className="relative min-w-0 flex-1 basis-56"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="見積書を検索" placeholder="番号・取引先・案件で検索" className="h-11 pl-9 lg:h-11 lg:pl-9" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
      <select aria-label="見積書の状態" className={selectClass + " sm:w-44"} value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">すべての状態</option>{Object.entries(estimateStatusLabels).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select>
      <Button asChild variant="outline" className="min-h-11"><Link prefetch={false} href={`/issued-invoices?company=${company}`}><FileText className="size-4" />発行請求書</Link></Button>
      {canEdit ? <Button className="min-h-11" onClick={() => edit("new")}><Plus className="size-4" />見積書を作成</Button> : null}
    </div>
    <div className="text-xs text-muted-foreground">{filtered.length}件</div>
    <div className="min-w-0 border-y">
      <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1fr)_110px_145px_44px] gap-3 border-b bg-muted/40 px-3 py-2 text-xs text-muted-foreground md:grid"><span>見積番号・案件</span><span>取引先</span><span>見積日 / 有効期限</span><span className="text-right">金額・状態</span><span /></div>
      {filtered.map((e) => <ContextMenu.Root key={e.id}><ContextMenu.Trigger asChild>
        <div data-estimate-id={e.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_44px] items-center gap-2 border-b px-3 py-3 last:border-b-0 hover:bg-muted/30 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_110px_145px_44px] md:gap-3">
          <button type="button" onClick={() => setPreview(e)} className="min-h-11 min-w-0 text-left"><span className="block break-words font-medium hover:underline">{e.estimateNumber}</span><span className="block break-words text-xs text-muted-foreground">{projectMap.get(e.projectId)}</span></button>
          <span className="col-start-1 break-words text-sm md:col-start-auto">{clientMap.get(e.clientId)}</span>
          <span className="col-start-1 text-xs text-muted-foreground md:col-start-auto">{e.issueDate}<br /><span>{e.validUntil}</span></span>
          <div className="col-start-1 min-w-0 space-y-1 md:col-start-auto md:text-right"><span className="block break-words font-medium tabular-nums">{money(e.total)}</span><EstimateStatusSelect id={e.id} updatedAt={e.updatedAt} status={e.status} label={e.estimateNumber} company={company} disabled={!editable(e) || pending} onSaved={(next) => { if (preview?.id === next.id) setPreview(next); }} /></div>
          <div className="col-start-2 row-start-1 md:col-start-auto md:row-start-auto"><DropdownMenu><DropdownMenuTrigger asChild><Button className="size-11" variant="ghost" size="icon" aria-label={`${e.estimateNumber}の操作`} title="見積書の操作"><Ellipsis className="size-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">{actions(e).map((action) => <DropdownMenuItem key={action.label} className="min-h-11" disabled={pending} onSelect={action.action}><action.icon className="size-4" />{action.label}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu></div>
        </div>
      </ContextMenu.Trigger><ContextMenu.Portal><ContextMenu.Content className="z-50 min-w-44 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">{actions(e).map((action) => <ContextMenu.Item key={action.label} className={menuClass} disabled={pending} onSelect={action.action}><action.icon />{action.label}</ContextMenu.Item>)}</ContextMenu.Content></ContextMenu.Portal></ContextMenu.Root>)}
      {!filtered.length ? <p className="py-16 text-center text-sm text-muted-foreground">{estimates.length ? "該当する見積書がありません" : "見積書はまだありません"}</p> : null}
    </div>
    <Dialog open={editor !== null} onOpenChange={(open) => { if (!open && !pending) setEditor(null); }}><DialogContent aria-describedby={undefined} className="max-h-[90dvh] min-w-0 overflow-y-auto rounded-lg sm:max-w-4xl" onInteractOutside={(e) => e.preventDefault()}>
      <DialogHeader><DialogTitle>{editor === "new" ? "見積書を作成" : "見積書を編集"}</DialogTitle></DialogHeader>
      {error ? <p role="alert" className="break-words text-destructive">{error}</p> : null}
      {editor ? <EstimateEditor key={editor === "new" ? "new" : editor.id} estimate={editor === "new" ? undefined : editor} projects={projects} clients={clients} pending={pending} onSave={save} /> : null}
    </DialogContent></Dialog>
    <Dialog open={preview !== null} onOpenChange={(open) => { if (!open) setPreview(null); }}><DialogContent aria-describedby={undefined} className="max-h-[92dvh] min-w-0 overflow-y-auto rounded-lg sm:max-w-4xl">
      <DialogHeader><DialogTitle className="break-words pr-8">{preview?.estimateNumber}</DialogTitle></DialogHeader>
      {preview ? <><div className="flex flex-wrap gap-2">
        <div className="w-44"><EstimateStatusSelect id={preview.id} updatedAt={preview.updatedAt} status={preview.status} label={preview.estimateNumber} company={company} disabled={!editable(preview) || pending} onSaved={setPreview} /></div>
        <Button asChild variant="outline"><a href={pdfUrl(preview)} target="_blank" rel="noopener noreferrer"><ExternalLink className="size-4" />PDFを開く</a></Button>
        {editable(preview) ? <Button variant="outline" onClick={() => edit(preview)}><Pencil className="size-4" />編集</Button> : null}
        {preview.invoiceId ? <Button asChild><Link href={invoiceHref(company, preview.invoiceId)}><FileText className="size-4" />請求書を開く</Link></Button> : editable(preview) && preview.status !== "DECLINED" ? <Button onClick={() => { setError(""); setConvertTarget(preview); }}><ArrowRightLeft className="size-4" />請求書に変換</Button> : null}
      </div><iframe title={`見積書PDF: ${preview.estimateNumber}`} src={pdfUrl(preview)} className="h-[65dvh] min-h-72 w-full border bg-white" /></> : null}
    </DialogContent></Dialog>
    <Dialog open={convertTarget !== null} onOpenChange={(open) => { if (!open && !pending) setConvertTarget(null); }}><DialogContent aria-describedby={undefined} className="max-h-[90dvh] overflow-y-auto rounded-lg sm:max-w-lg">
      <DialogHeader><DialogTitle>請求書に変換</DialogTitle></DialogHeader>
      <p className="break-words text-sm">{convertTarget?.estimateNumber} / {money(convertTarget?.total || 0)}</p>
      <p className="text-sm text-muted-foreground">請求書は下書きで作成されます。変換後、元の見積書は編集・削除できません。</p>
      <form className="space-y-3" onSubmit={(e) => {
        e.preventDefault(); if (!convertTarget) return;
        const fields = new FormData(e.currentTarget); setError("");
        startTransition(async () => {
          try {
            const result = await convertEstimateAction(company, { id: convertTarget.id, updatedAt: convertTarget.updatedAt, issueDate: String(fields.get("issueDate")), dueDate: String(fields.get("dueDate")), transactionDate: String(fields.get("transactionDate")) });
            if (!result.invoiceId) { failure(result.error || "変換に失敗しました"); return; }
            setConvertTarget(null); setPreview(null); router.push(invoiceHref(company, result.invoiceId)); router.refresh();
          } catch { failure("通信に失敗しました。再実行しても請求書は重複しません"); }
        });
      }}>
        <label className="block space-y-1">発行日<Input type="date" name="issueDate" aria-label="請求書の発行日" required defaultValue={todayIso()} /></label>
        <label className="block space-y-1">取引年月日<Input type="date" name="transactionDate" aria-label="請求書の取引年月日" required defaultValue={todayIso()} /></label>
        <label className="block space-y-1">支払期限<Input type="date" name="dueDate" aria-label="請求書の支払期限" required defaultValue={nextMonth()} /></label>
        {error ? <p role="alert" className="text-destructive">{error}</p> : null}
        <Button type="submit" className="min-h-11 w-full" disabled={pending}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowRightLeft className="size-4" />}変換して請求書を開く</Button>
      </form>
    </DialogContent></Dialog>
    <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open && !pending) setDeleteTarget(null); }}><DialogContent aria-describedby={undefined} className="rounded-lg">
      <DialogHeader><DialogTitle>見積書を削除しますか？</DialogTitle></DialogHeader><p className="break-words">{deleteTarget?.estimateNumber}</p>
      {error ? <p role="alert" className="text-destructive">{error}</p> : null}
      <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={pending} onClick={() => setDeleteTarget(null)}>キャンセル</Button><Button variant="destructive" disabled={pending} onClick={remove}><Trash2 className="size-4" />削除</Button></div>
    </DialogContent></Dialog>
  </div>;
}
