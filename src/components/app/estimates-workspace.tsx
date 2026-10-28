"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, LoaderCircle, Save } from "lucide-react";
import { convertEstimateAction, saveEstimateAction } from "@/app/estimates/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { DocumentItemsEditor } from "@/components/app/document-items-editor";
import { EditableProjectSelect, type ProjectBasicOption } from "@/components/app/editable-project-select";
import { EstimatesList } from "@/components/app/estimates-list";
import { documentItemsFromFormData } from "@/lib/document-items";
import { ZodError } from "zod";
import type { CompanyScope } from "@/lib/company";
import type { DocumentRow } from "@/lib/documents";
import { estimateStatusLabels, type EstimateInput } from "@/lib/estimate-values";
import { todayIso } from "@/lib/format";
import type { Estimate } from "@/lib/types";

type Option = { id: string; name: string };
type Props = { company: CompanyScope; estimates: Estimate[]; rows: DocumentRow[]; projects: ProjectBasicOption[]; clients: Option[]; canEdit: boolean; initialId?: string };
const selectClass = "h-11 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm";
function nextMonth() {
  const date = new Date(`${todayIso()}T12:00:00`); date.setDate(date.getDate() + 30);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function EstimateEditor({ estimate, projects, clients, pending, onSave, company }: {
  estimate?: Estimate; projects: ProjectBasicOption[]; clients: Option[]; pending: boolean; onSave: (input: EstimateInput) => void; company: CompanyScope;
}) {
  const [form, setForm] = useState<Omit<EstimateInput, "items">>(() => ({
    id: estimate?.id, updatedAt: estimate?.updatedAt, projectId: estimate?.projectId || "", clientId: estimate?.clientId || "",
    issueDate: estimate?.issueDate || todayIso(), validUntil: estimate?.validUntil || nextMonth(),
    status: estimate?.status === "CONVERTED" ? "DRAFT" : estimate?.status || "DRAFT", notes: estimate?.notes || "", internalMemo: estimate?.internalMemo || "",
  }));
  return <form onSubmit={(event) => {
    event.preventDefault();
    try { onSave({ ...form, items: documentItemsFromFormData(new FormData(event.currentTarget)) }); }
    catch (error) { toast({ title: error instanceof ZodError ? error.issues[0]?.message : "項目を確認してください", variant: "destructive" }); }
  }} className="min-w-0 space-y-4">
    <fieldset disabled={pending} className="min-w-0 space-y-4">
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <EditableProjectSelect company={company} projects={projects} clients={clients} disabled={pending} value={form.projectId} onChange={(p) => setForm((old) => ({ ...old, projectId: p?.id || "", clientId: p?.clientId || old.clientId }))} />
        <label className="min-w-0 space-y-1">取引先<select aria-label="取引先" className={selectClass} required value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}><option value="">取引先を選択</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="min-w-0 space-y-1">見積日<Input aria-label="見積日" type="date" required value={form.issueDate} onChange={(e) => setForm({ ...form, issueDate: e.target.value })} /></label>
        <label className="min-w-0 space-y-1">有効期限<Input aria-label="有効期限" type="date" required min={form.issueDate} value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} /></label>
        <label className="min-w-0 space-y-1">ステータス<select aria-label="ステータス" className={selectClass} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as EstimateInput["status"] })}>{Object.entries(estimateStatusLabels).filter(([key]) => key !== "CONVERTED").map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      </div>
      <DocumentItemsEditor initialItems={estimate?.items} disabled={pending} />
      <label className="block space-y-1">備考<Textarea aria-label="備考" maxLength={10000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
      <label className="block space-y-1">社内メモ<Textarea aria-label="社内メモ" maxLength={10000} value={form.internalMemo} onChange={(e) => setForm({ ...form, internalMemo: e.target.value })} /></label>
      <Button className="min-h-11 w-full" type="submit" disabled={pending}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}保存してプレビュー</Button>
    </fieldset>
  </form>;
}

export function EstimatesWorkspace({ company, estimates, rows, projects, clients, canEdit, initialId }: Props) {
  const router = useRouter();
  const [activeId, setActiveId] = useState(initialId || "");
  const [editor, setEditor] = useState<Estimate | "new" | null>(null);
  const [convertTarget, setConvertTarget] = useState<Estimate | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  function failure(message: string) { setError(message); toast({ title: message, variant: "destructive" }); }
  function save(input: EstimateInput) {
    setError(""); startTransition(async () => {
      try {
        const result = await saveEstimateAction(company, input);
        if (!result.estimate) { failure(result.error || "保存に失敗しました"); return; }
        setEditor(null); setActiveId(result.estimate.id); router.refresh(); toast({ title: "見積書を保存しました", variant: "success" });
      } catch { failure("通信に失敗しました。入力内容は保持されています"); }
    });
  }
  return <>
    <EstimatesList company={company} estimates={estimates} rows={rows} projects={projects} clients={clients} canEdit={canEdit} pending={pending}
      activeId={activeId} onOpen={setActiveId} onEdit={(estimate) => { setError(""); setEditor(estimate); }} onConvert={(estimate) => { setError(""); setConvertTarget(estimate); }} />
    <Dialog open={editor !== null} onOpenChange={(open) => { if (!open && !pending) setEditor(null); }}><DialogContent aria-describedby={undefined} showCloseButton={!pending} className="max-h-[90dvh] min-w-0 overflow-y-auto rounded-lg sm:max-w-4xl" onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
      <DialogHeader><DialogTitle>{editor === "new" ? "見積書を作成" : "見積書を編集"}</DialogTitle></DialogHeader>
      {error ? <p role="alert" className="break-words text-destructive">{error}</p> : null}
      {editor ? <EstimateEditor key={editor === "new" ? "new" : editor.id} estimate={editor === "new" ? undefined : editor} projects={projects} clients={clients} pending={pending} onSave={save} company={company} /> : null}
    </DialogContent></Dialog>
    <Dialog open={convertTarget !== null} onOpenChange={(open) => { if (!open && !pending) setConvertTarget(null); }}><DialogContent aria-describedby={undefined} showCloseButton={!pending} className="max-h-[90dvh] overflow-y-auto rounded-lg sm:max-w-lg" onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
      <DialogHeader><DialogTitle>請求書に変換</DialogTitle></DialogHeader>
      <p className="break-words text-sm">{convertTarget?.estimateNumber} / {new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" }).format(convertTarget?.total || 0)}</p>
      <p className="text-sm text-muted-foreground">請求書は下書きで作成されます。変換後、元の見積書は編集・削除できません。</p>
      <form className="space-y-3" onSubmit={(e) => {
        e.preventDefault(); if (!convertTarget) return;
        const fields = new FormData(e.currentTarget); setError("");
        startTransition(async () => {
          try {
            const result = await convertEstimateAction(company, { id: convertTarget.id, updatedAt: convertTarget.updatedAt, issueDate: String(fields.get("issueDate")), dueDate: String(fields.get("dueDate")), transactionDate: String(fields.get("transactionDate")) });
            if (!result.invoiceId) { failure(result.error || "変換に失敗しました"); return; }
            setConvertTarget(null); router.push(`/issued-invoices?company=${company}&document=${encodeURIComponent(`issued:${result.invoiceId}`)}`); router.refresh();
          } catch { failure("通信に失敗しました。再実行しても請求書は重複しません"); }
        });
      }}>
        <fieldset disabled={pending} className="space-y-3">
          <label className="block space-y-1">発行日<Input type="date" name="issueDate" aria-label="請求書の発行日" required defaultValue={todayIso()} /></label>
          <label className="block space-y-1">取引年月日<Input type="date" name="transactionDate" aria-label="請求書の取引年月日" required defaultValue={todayIso()} /></label>
          <label className="block space-y-1">支払期限<Input type="date" name="dueDate" aria-label="請求書の支払期限" required defaultValue={nextMonth()} /></label>
          {error ? <p role="alert" className="text-destructive">{error}</p> : null}
          <Button type="submit" className="min-h-11 w-full" disabled={pending}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowRightLeft className="size-4" />}変換して請求書を開く</Button>
        </fieldset>
      </form>
    </DialogContent></Dialog>
  </>;
}
