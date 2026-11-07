"use client";
import { Money } from "@/components/app/money";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, ExternalLink, LoaderCircle, RotateCcw, Save, SlidersHorizontal } from "lucide-react";
import { saveEstimatePdfEdits } from "@/app/estimates/actions";
import { saveIssuedInvoicePdfEdits } from "@/app/issued-invoices/actions";
import { DocumentItemsEditor } from "@/components/app/document-items-editor";
import { OptionTabs } from "@/components/app/option-tabs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import type { CompanyScope } from "@/lib/company";
import { documentItemTotals } from "@/lib/document-items";
import { defaultPdfLayout, pdfDensities, pdfDensityLabels, pdfFontScales, pdfFontSizeLabels, pdfFontSizes, pdfLayoutQuery, pdfMarginLabels, pdfMargins, samePdfLayout, type AppliedPdfLayout, type ResolvedPdfLayout } from "@/lib/invoice-pdf-layout";
import { pdfAmountsChanged, pdfContentIssue, pdfTextFields, pdfTextGroupLabels, samePdfContent, type PdfContent, type PdfTextGroup } from "@/lib/pdf-document-values";
import type { PdfLayoutMeta } from "@/lib/pdf-layout-meta";
import type { InvoicePdfTextKey } from "@/lib/types";

type Props = { kind: "issued" | "estimate"; id: string; title: string; company: CompanyScope; canSave: boolean; updatedAt?: string; size?: "sm" | "default"; listEditPending?: boolean };
type Preview = { url?: string; key?: string; pages?: number; applied?: AppliedPdfLayout; error?: string; loading: boolean };
type TextValues = Record<InvoicePdfTextKey, string>;
const base = (kind: Props["kind"]) => kind === "estimate" ? "/api/estimates" : "/api/issued-invoices";
const checkClass = "flex min-h-11 items-center gap-3 text-sm lg:min-h-9";
const shortLabel = (value: string) => { const label = value.trim().replace(/\s+/g, " "); return label.length > 18 ? `${label.slice(0, 18)}…` : label; };

// The preview, the download and the save all go through one builder, so what is shown is what gets written.
export function PdfLayoutDialog({ kind, id, title, company, canSave, updatedAt, size = "sm", listEditPending = false }: Props) {
  const [open, setOpen] = useState(false);
  return <>
    <Button type="button" variant="outline" size={size} onClick={() => setOpen(true)}><SlidersHorizontal className="size-4" />{canSave ? "PDFプレビュー・編集" : "PDFプレビュー"}</Button>
    {open ? <PdfLayoutEditor kind={kind} id={id} title={title} company={company} canSave={canSave} updatedAt={updatedAt} listEditPending={listEditPending} onClose={() => setOpen(false)} /> : null}
  </>;
}

function PdfLayoutEditor({ kind, id, title, company, canSave, updatedAt, listEditPending, onClose }: Omit<Props, "size"> & { onClose: () => void }) {
  const router = useRouter();
  const [meta, setMeta] = useState<PdfLayoutMeta | null>(null);
  const [metaError, setMetaError] = useState("");
  const [layout, setLayout] = useState<ResolvedPdfLayout>(defaultPdfLayout);
  const [savedLayout, setSavedLayout] = useState<ResolvedPdfLayout>(defaultPdfLayout);
  const [text, setText] = useState<TextValues | null>(null);
  const [savedText, setSavedText] = useState<TextValues | null>(null);
  const [content, setContent] = useState<PdfContent | null>(null);
  const [savedContent, setSavedContent] = useState<PdfContent | null>(null);
  const [savedTotal, setSavedTotal] = useState(0);
  const [version, setVersion] = useState(updatedAt);
  const [itemsKey, setItemsKey] = useState(0);
  const [preview, setPreview] = useState<Preview>({ loading: true });
  const [saveError, setSaveError] = useState("");
  const [saving, startSave] = useTransition();
  const objectUrl = useRef<string>(undefined);

  const query = pdfLayoutQuery(layout);
  const pdfUrl = `${base(kind)}/${encodeURIComponent(id)}/pdf?${query}${version ? `&v=${encodeURIComponent(version)}` : ""}`;
  const canEdit = Boolean(canSave && meta?.canEditContent);
  const contentLocked = Boolean(listEditPending);
  const contentDirty = Boolean(content && savedContent && !samePdfContent(content, savedContent));
  const textDirty = Boolean(text && savedText && JSON.stringify(text) !== JSON.stringify(savedText));
  const layoutDirty = !samePdfLayout(layout, savedLayout);
  const dirty = contentDirty || textDirty || layoutDirty;
  // Only edits are checked: an older document that breaks a newer rule can still be previewed and laid out.
  const contentIssue = content && meta && canEdit && contentDirty ? pdfContentIssue(content, meta.kind) : "";
  // Unsaved wording and lines travel in a request body, never in a link.
  const draftBody = contentDirty || textDirty ? JSON.stringify({ layout, text: textDirty ? text : undefined, content: contentDirty ? content : undefined }) : "";
  const requestKey = `${pdfUrl}|${draftBody}`;
  const previewReady = Boolean(preview.url && preview.key === requestKey && !contentIssue);
  const amountsChanged = Boolean(content && savedContent && !contentIssue && contentDirty && pdfAmountsChanged(savedContent.items, content.items));

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${base(kind)}/${encodeURIComponent(id)}/pdf-layout`, { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || "内容を読み込めませんでした"); return response.json() as Promise<PdfLayoutMeta>; })
      .then((body) => { setMeta(body); setLayout(body.layout); setSavedLayout(body.layout); setText(body.text); setSavedText(body.text); setContent(body.content); setSavedContent(body.content); setSavedTotal(body.total); setVersion(body.updatedAt); })
      .catch((error) => { if (!controller.signal.aborted) setMetaError(error instanceof Error ? error.message : "内容を読み込めませんでした"); });
    return () => controller.abort();
  }, [kind, id]);

  useEffect(() => {
    if (!meta || contentIssue) return;
    const controller = new AbortController();
    // A short pause lets a run of typing or quick changes become one request.
    const timer = setTimeout(async () => {
      setPreview((old) => ({ ...old, loading: true, error: undefined }));
      try {
        const response = draftBody
          ? await fetch(`${base(kind)}/${encodeURIComponent(id)}/pdf`, { method: "POST", headers: { "Content-Type": "application/json" }, body: draftBody, credentials: "same-origin", cache: "no-store", signal: controller.signal })
          : await fetch(pdfUrl, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || "PDFを生成できませんでした");
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
        objectUrl.current = URL.createObjectURL(blob);
        let applied: AppliedPdfLayout | undefined;
        try { applied = JSON.parse(response.headers.get("X-Pdf-Applied") || "") as AppliedPdfLayout; } catch { applied = undefined; }
        setPreview({ url: objectUrl.current, key: `${pdfUrl}|${draftBody}`, pages: Number(response.headers.get("X-Pdf-Pages")) || undefined, applied, loading: false });
      } catch (error) {
        // The last good preview stays on screen while the problem is shown above it.
        if (!controller.signal.aborted) setPreview((old) => ({ ...old, loading: false, error: error instanceof Error ? error.message : "PDFを生成できませんでした" }));
      }
    }, 450);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [meta, kind, id, pdfUrl, draftBody, contentIssue]);
  useEffect(() => () => { if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); }, []);

  const change = (patch: Partial<ResolvedPdfLayout>) => setLayout((old) => ({ ...old, ...patch }));
  const changeContent = (patch: Partial<PdfContent>) => setContent((old) => old ? { ...old, ...patch } : old);
  const breakOptions = content ? [...content.items.map((item, index) => [index + 1, `${index + 1}. ${shortLabel(item.description) || "（品名なし）"} の前`] as const), [content.items.length + 1, "合計の前"] as const] : [];
  const breakValue = breakOptions.some(([value]) => value === layout.pageBreakBefore) ? layout.pageBreakBefore : "";
  function close() {
    if (saving) return;
    if (dirty && !window.confirm("保存していない変更を破棄して閉じますか？")) return;
    onClose();
  }
  function discard() {
    setContent(savedContent); setText(savedText); setItemsKey((value) => value + 1); setSaveError("");
  }
  function save() {
    setSaveError("");
    startSave(async () => {
      const input = { id, updatedAt: version, layout: { ...layout }, text: textDirty && text ? text : undefined, content: contentDirty && content ? content : undefined };
      try {
        const result = kind === "estimate" ? await saveEstimatePdfEdits(company, input) : await saveIssuedInvoicePdfEdits(company, input);
        if (result.error) { setSaveError(result.error); toast({ title: result.error, variant: "destructive" }); return; }
        if (amountsChanged && content) setSavedTotal(documentItemTotals(content.items).total);
        setSavedLayout(layout); setSavedText(text); setSavedContent(content);
        if (result.updatedAt) setVersion(result.updatedAt);
        router.refresh();
        toast({ title: "保存しました", variant: "success" });
      } catch { setSaveError("保存に失敗しました。入力内容は保持しています"); toast({ title: "保存に失敗しました", variant: "destructive" }); }
    });
  }
  const fitted = preview.applied?.fitted ? [
    preview.applied.density !== layout.density ? `密度=${pdfDensityLabels[preview.applied.density]}` : "",
    preview.applied.margin !== layout.margin ? `余白=${pdfMarginLabels[preview.applied.margin]}` : "",
    preview.applied.fontScale !== pdfFontScales[layout.fontSize] ? `文字=${Math.round(preview.applied.fontScale * 100)}%` : "",
  ].filter(Boolean).join("・") : "";
  const documentKind = meta?.kind ?? (kind === "estimate" ? "estimate" : "invoice");
  const textFields = pdfTextFields.filter((field) => !field.only || field.only === documentKind);
  const textGroups = (Object.keys(pdfTextGroupLabels) as PdfTextGroup[]).filter((group) => textFields.some((field) => field.group === group));
  const problem = contentIssue || preview.error || "";

  const layoutPanel = <fieldset disabled={!meta || saving} className="workspace-detail-group min-w-0 space-y-4">
    <legend className="sr-only">レイアウトの設定</legend>
    <OptionTabs label="密度" caption="密度" value={layout.density} options={pdfDensities.map((value) => [value, pdfDensityLabels[value]] as const)} onChange={(density) => change({ density })} />
    <OptionTabs label="文字の大きさ" caption="文字" value={layout.fontSize} options={pdfFontSizes.map((value) => [value, pdfFontSizeLabels[value]] as const)} onChange={(fontSize) => change({ fontSize })} />
    <OptionTabs label="余白" caption="余白" value={layout.margin} options={pdfMargins.map((value) => [value, pdfMarginLabels[value]] as const)} onChange={(margin) => change({ margin })} />
    <div className="space-y-1">
      <label className={checkClass}><input type="checkbox" className="size-5 accent-primary" checked={layout.fitOnePage} onChange={(event) => change({ fitOnePage: event.target.checked })} /><span>自動で詰めて枚数を減らす<span className="block text-xs text-muted-foreground">本文は8pt以上を保ちます</span></span></label>
      <label className={checkClass}><input type="checkbox" className="size-5 accent-primary" checked={layout.showNotes} disabled={!content?.notes.trim()} onChange={(event) => change({ showNotes: event.target.checked })} /><span>備考を載せる{content && !content.notes.trim() ? <span className="block text-xs text-muted-foreground">備考は未入力です</span> : null}</span></label>
      {kind === "issued" ? <label className={checkClass}><input type="checkbox" className="size-5 accent-primary" checked={layout.showBank} onChange={(event) => change({ showBank: event.target.checked })} /><span>振込先を載せる</span></label> : null}
      <label className={checkClass}><input type="checkbox" className="size-5 accent-primary" checked={layout.showDueDate} onChange={(event) => change({ showDueDate: event.target.checked })} /><span>{kind === "issued" ? "支払期限を載せる" : "有効期限を載せる"}</span></label>
      <label className={checkClass}><input type="checkbox" className="size-5 accent-primary" checked={layout.showSeal} onChange={(event) => change({ showSeal: event.target.checked })} /><span>社印を載せる</span></label>
    </div>
    <label className="grid gap-1 text-sm">改ページ
      <select aria-label="改ページの位置" className="h-11 w-full min-w-0 rounded-md border bg-background px-2 text-sm lg:h-9" value={breakValue} onChange={(event) => change({ pageBreakBefore: event.target.value ? Number(event.target.value) : undefined })}>
        <option value="">自動</option>
        {breakOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </label>
    <Button type="button" variant="ghost" size="sm" className="w-full" disabled={samePdfLayout(layout, defaultPdfLayout)} onClick={() => setLayout({ ...defaultPdfLayout })}><RotateCcw className="size-4" />レイアウトを標準に戻す</Button>
  </fieldset>;

  const contentPanel = content && text && meta ? <div className="min-w-0 space-y-4">
    {contentDirty || textDirty ? <Button type="button" variant="ghost" size="sm" className="w-full" disabled={saving} onClick={discard}><RotateCcw className="size-4" />内容の変更を取り消す</Button> : null}
    <section className="workspace-detail-group min-w-0 space-y-3" aria-label="書類の内容">
      <h3 className="text-sm font-medium">書類の内容</h3>
      <p className="text-xs text-muted-foreground">保存すると{kind === "issued" ? "請求書" : "見積書"}そのものが変わり、一覧と集計にも反映されます。合計は明細から自動で計算します。</p>
      {contentLocked ? <p role="status" className="text-xs text-amber-700 dark:text-amber-300">一覧に未保存の変更があるため、ここでは変更できません。先に一覧で保存してください。</p> : null}
      <fieldset disabled={contentLocked || saving} className="grid min-w-0 gap-3">
        <legend className="sr-only">番号と日付</legend>
        <label className="grid min-w-0 gap-1 text-xs">{kind === "issued" ? "請求書番号" : "見積書番号"}<Input aria-label="書類番号" maxLength={100} value={content.number} onChange={(event) => changeContent({ number: event.target.value })} /></label>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <label className="grid min-w-0 gap-1 text-xs">{kind === "issued" ? "発行日" : "見積日"}<Input aria-label="発行日" type="date" value={content.issueDate} onChange={(event) => changeContent({ issueDate: event.target.value })} /></label>
          <label className="grid min-w-0 gap-1 text-xs">{kind === "issued" ? "支払期限" : "有効期限"}<Input aria-label="期限" type="date" value={content.dueDate} onChange={(event) => changeContent({ dueDate: event.target.value })} /></label>
        </div>
      </fieldset>
      {meta.amountsLocked ? <p role="status" className="text-xs text-amber-700 dark:text-amber-300">入金記録があるため金額は変更できません。品名・内訳は変更できます。</p> : null}
      <DocumentItemsEditor key={itemsKey} initialItems={content.items} disabled={contentLocked || saving} lockAmounts={meta.amountsLocked} compact onItemsChange={(items) => changeContent({ items })} />
      {amountsChanged && content ? <p role="status" className="text-xs text-amber-700 dark:text-amber-300">合計 <Money value={savedTotal} maximumFractionDigits={3} /> → <Money value={documentItemTotals(content.items).total} maximumFractionDigits={3} />。保存すると売上と未入金の集計も変わります。</p> : null}
      <label className="block min-w-0 space-y-1 text-xs">備考<Textarea aria-label="備考" maxLength={10000} rows={3} disabled={contentLocked || saving} value={content.notes} onChange={(event) => changeContent({ notes: event.target.value })} /></label>
    </section>
    <section className="workspace-detail-group min-w-0 space-y-3" aria-label="PDFの文言">
      <h3 className="text-sm font-medium">PDFの文言</h3>
      <p className="text-xs text-muted-foreground">この書類のPDFだけに反映され、取引先などの登録内容は変わりません。空にするとその文言は印字しません。</p>
      <fieldset disabled={saving} className="min-w-0 divide-y">
        <legend className="sr-only">PDFに印字する文言</legend>
        {textGroups.map((group) => <details key={group} open={group === "heading"} className="min-w-0 py-1">
          <summary className="min-h-11 cursor-pointer content-center text-sm">{pdfTextGroupLabels[group]}</summary>
          <div className="grid min-w-0 gap-3 pb-3">
            {textFields.filter((field) => field.group === group).map((field) => <label key={field.key} className="grid min-w-0 gap-1 text-xs">{field.label}<Input aria-label={field.label} maxLength={500} value={text[field.key]} onChange={(event) => setText((old) => old ? { ...old, [field.key]: event.target.value } : old)} /></label>)}
          </div>
        </details>)}
      </fieldset>
      <Button type="button" variant="ghost" size="sm" className="w-full" disabled={saving || JSON.stringify(text) === JSON.stringify(meta.defaults)} onClick={() => setText(meta.defaults)}><RotateCcw className="size-4" />文言を標準に戻す</Button>
    </section>
  </div> : null;

  return <Dialog open onOpenChange={(next) => { if (!next) close(); }}>
    <DialogContent showCloseButton={!saving} className="max-h-[94dvh] min-w-0 overflow-y-auto sm:max-w-6xl" onInteractOutside={(event) => event.preventDefault()} onEscapeKeyDown={(event) => { if (saving || dirty) event.preventDefault(); }}>
      <DialogHeader><DialogTitle className="break-words pr-8">{canEdit ? "PDFプレビュー・編集" : "PDFプレビュー"}: {content?.number || title}</DialogTitle><DialogDescription>{canEdit ? "変更はすぐプレビューに反映されます。保存するまで書類は変わりません。" : "調整した内容はプレビューと同じ設定で書き出されます。"}</DialogDescription></DialogHeader>
      {metaError ? <p role="alert" className="rounded-lg border border-destructive/40 bg-card p-3 text-sm text-destructive">{metaError}</p> : null}
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-2">
          <p role="status" aria-live="polite" className="flex min-h-6 flex-wrap items-center gap-x-3 text-sm">
            {preview.loading ? <span className="inline-flex items-center gap-1 text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />プレビューを更新中…</span>
              : preview.pages ? <><span className="font-medium">{preview.pages}ページ</span>{fitted ? <span className="text-xs text-muted-foreground">自動で詰めました（{fitted}）</span> : null}</> : null}
            {dirty ? <span className="text-xs text-amber-700 dark:text-amber-300">保存していない変更があります</span> : null}
          </p>
          {problem ? <p role="alert" className="rounded-lg border border-destructive/40 bg-card p-3 text-sm text-destructive">{problem}{preview.url ? "（プレビューは直前の内容です）" : ""}</p> : null}
          {preview.url ? <iframe key={preview.url} title={`PDFプレビュー: ${title}`} src={preview.url} className="hidden h-[66dvh] min-h-80 w-full rounded border bg-muted md:block" /> : <div className="hidden h-[66dvh] min-h-80 w-full rounded border bg-muted md:block" aria-hidden />}
          <p className="text-xs text-muted-foreground md:hidden">スマートフォンでは「PDFを開く」で表示してください。</p>
        </div>
        <aside aria-label="PDFの設定と内容" className="min-w-0 lg:h-[70dvh] lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
          {canEdit ? <Tabs defaultValue="layout" className="min-w-0">
            <TabsList className="min-h-12 w-full" aria-label="編集する項目"><TabsTrigger value="layout" className="min-h-11">レイアウト</TabsTrigger><TabsTrigger value="content" className="min-h-11">内容</TabsTrigger></TabsList>
            <TabsContent value="layout">{layoutPanel}</TabsContent>
            <TabsContent value="content">{contentPanel}</TabsContent>
          </Tabs> : layoutPanel}
        </aside>
      </div>
      {saveError ? <p role="alert" className="rounded-lg border border-destructive/40 bg-card p-3 text-sm text-destructive">{saveError}</p> : null}
      {/* On a phone the four buttons stack, so the footer scrolls with the settings instead of covering them. Elsewhere it stays in view, so it needs its own background over the global transparent one. */}
      <DialogFooter className="z-10 border-t bg-popover! pt-3 max-sm:grid max-sm:grid-cols-2 sm:sticky sm:bottom-0">
        <Button type="button" variant="outline" disabled={saving} onClick={close}>閉じる</Button>
        {draftBody ? previewReady ? <Button asChild variant="outline"><a href={preview.url} target="_blank" rel="noopener noreferrer"><ExternalLink className="size-4" />PDFを開く</a></Button> : <Button variant="outline" disabled><ExternalLink className="size-4" />PDFを開く</Button>
          : <Button asChild variant="outline"><a href={pdfUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="size-4" />PDFを開く</a></Button>}
        {previewReady ? <Button asChild variant="outline"><a href={preview.url} download={`${content?.number || title}.pdf`}><Download className="size-4" />この内容でダウンロード</a></Button> : <Button variant="outline" disabled><Download className="size-4" />この内容でダウンロード</Button>}
        {canSave ? <Button type="button" disabled={!meta || !dirty || saving || Boolean(contentIssue)} onClick={save}>{saving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}変更を保存</Button> : null}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
