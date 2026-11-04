"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Download, ExternalLink, LoaderCircle, RotateCcw, Save, SlidersHorizontal } from "lucide-react";
import { saveEstimatePdfLayout } from "@/app/estimates/actions";
import { saveIssuedInvoicePdfLayout } from "@/app/issued-invoices/actions";
import { OptionTabs } from "@/components/app/option-tabs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import type { CompanyScope } from "@/lib/company";
import { defaultPdfLayout, pdfDensities, pdfDensityLabels, pdfFontScales, pdfFontSizeLabels, pdfFontSizes, pdfLayoutQuery, pdfMarginLabels, pdfMargins, samePdfLayout, type AppliedPdfLayout, type ResolvedPdfLayout } from "@/lib/invoice-pdf-layout";
import type { PdfLayoutMeta } from "@/lib/pdf-layout-meta";

type Props = { kind: "issued" | "estimate"; id: string; title: string; company: CompanyScope; canSave: boolean; updatedAt?: string; size?: "sm" | "default" };
type Preview = { url?: string; pages?: number; applied?: AppliedPdfLayout; error?: string; loading: boolean };
const base = (kind: Props["kind"]) => kind === "estimate" ? "/api/estimates" : "/api/issued-invoices";
const checkClass = "flex min-h-11 items-center gap-3 text-sm lg:min-h-9";

// The settings here go to the PDF route as a query string; the preview, the download and the saved layout all use the same plan.
export function PdfLayoutDialog({ kind, id, title, company, canSave, updatedAt, size = "sm" }: Props) {
  const [open, setOpen] = useState(false);
  return <>
    <Button type="button" variant="outline" size={size} onClick={() => setOpen(true)}><SlidersHorizontal className="size-4" />レイアウト調整</Button>
    {open ? <PdfLayoutEditor kind={kind} id={id} title={title} company={company} canSave={canSave} updatedAt={updatedAt} onClose={() => setOpen(false)} /> : null}
  </>;
}

function PdfLayoutEditor({ kind, id, title, company, canSave, updatedAt, onClose }: Omit<Props, "size"> & { onClose: () => void }) {
  const [meta, setMeta] = useState<PdfLayoutMeta | null>(null);
  const [metaError, setMetaError] = useState("");
  const [layout, setLayout] = useState<ResolvedPdfLayout>(defaultPdfLayout);
  const [saved, setSaved] = useState<ResolvedPdfLayout>(defaultPdfLayout);
  const [preview, setPreview] = useState<Preview>({ loading: true });
  const [saving, startSave] = useTransition();
  const objectUrl = useRef<string>(undefined);
  const query = pdfLayoutQuery(layout);
  const pdfUrl = `${base(kind)}/${encodeURIComponent(id)}/pdf?${query}${updatedAt ? `&v=${encodeURIComponent(updatedAt)}` : ""}`;

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${base(kind)}/${encodeURIComponent(id)}/pdf-layout`, { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || "レイアウト設定を読み込めませんでした"); return response.json() as Promise<PdfLayoutMeta>; })
      .then((body) => { setMeta(body); setLayout(body.layout); setSaved(body.layout); })
      .catch((error) => { if (!controller.signal.aborted) setMetaError(error instanceof Error ? error.message : "レイアウト設定を読み込めませんでした"); });
    return () => controller.abort();
  }, [kind, id]);

  useEffect(() => {
    if (!meta) return;
    const controller = new AbortController();
    // A short pause lets several quick changes become one request.
    const timer = setTimeout(async () => {
      setPreview((old) => ({ ...old, loading: true, error: undefined }));
      try {
        const response = await fetch(pdfUrl, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || "PDFを生成できませんでした");
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
        objectUrl.current = URL.createObjectURL(blob);
        let applied: AppliedPdfLayout | undefined;
        try { applied = JSON.parse(response.headers.get("X-Pdf-Applied") || "") as AppliedPdfLayout; } catch { applied = undefined; }
        setPreview({ url: objectUrl.current, pages: Number(response.headers.get("X-Pdf-Pages")) || undefined, applied, loading: false });
      } catch (error) {
        if (!controller.signal.aborted) setPreview({ loading: false, error: error instanceof Error ? error.message : "PDFを生成できませんでした" });
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [meta, pdfUrl]);
  useEffect(() => () => { if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); }, []);

  const change = (patch: Partial<ResolvedPdfLayout>) => setLayout((old) => ({ ...old, ...patch }));
  const dirty = !samePdfLayout(layout, saved);
  const busy = saving;
  const breakOptions = meta ? [...meta.items.map((label, index) => [index + 1, `${index + 1}. ${label || "（品名なし）"} の前`] as const), [meta.items.length + 1, "合計の前"] as const] : [];
  function save() {
    startSave(async () => {
      const input = { id, layout: { ...layout } };
      const result = kind === "estimate" ? await saveEstimatePdfLayout(company, input) : await saveIssuedInvoicePdfLayout(company, input);
      if (result.error) { toast({ title: result.error, variant: "destructive" }); return; }
      setSaved(layout);
      toast({ title: "PDFのレイアウトを保存しました", variant: "success" });
    });
  }
  const fitted = preview.applied?.fitted ? [
    preview.applied.density !== layout.density ? `密度=${pdfDensityLabels[preview.applied.density]}` : "",
    preview.applied.margin !== layout.margin ? `余白=${pdfMarginLabels[preview.applied.margin]}` : "",
    preview.applied.fontScale !== pdfFontScales[layout.fontSize] ? `文字=${Math.round(preview.applied.fontScale * 100)}%` : "",
  ].filter(Boolean).join("・") : "";

  return <Dialog open onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
    <DialogContent showCloseButton={!busy} className="max-h-[94dvh] min-w-0 overflow-y-auto sm:max-w-5xl" onInteractOutside={(event) => event.preventDefault()} onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}>
      <DialogHeader><DialogTitle className="break-words pr-8">PDFレイアウト調整: {title}</DialogTitle><DialogDescription>調整した内容はプレビューと同じ設定で書き出されます。金額や明細は変わりません。</DialogDescription></DialogHeader>
      {metaError ? <p role="alert" className="rounded-lg border border-destructive/40 bg-card p-3 text-sm text-destructive">{metaError}</p> : null}
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-2 lg:order-1">
          <p role="status" aria-live="polite" className="flex min-h-6 flex-wrap items-center gap-x-3 text-sm">
            {preview.loading ? <span className="inline-flex items-center gap-1 text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />プレビューを更新中…</span>
              : preview.pages ? <><span className="font-medium">{preview.pages}ページ</span>{fitted ? <span className="text-xs text-muted-foreground">自動で詰めました（{fitted}）</span> : null}</> : null}
            {dirty ? <span className="text-xs text-amber-700 dark:text-amber-300">保存していない調整があります</span> : null}
          </p>
          {preview.error ? <p role="alert" className="rounded-lg border border-destructive/40 bg-card p-3 text-sm text-destructive">{preview.error}</p> : null}
          {preview.url ? <iframe key={preview.url} title={`PDFプレビュー: ${title}`} src={preview.url} className="hidden h-[62dvh] min-h-80 w-full rounded border bg-muted md:block" /> : <div className="hidden h-[62dvh] min-h-80 w-full rounded border bg-muted md:block" aria-hidden />}
          <p className="text-xs text-muted-foreground md:hidden">スマートフォンでは「PDFを開く」で表示してください。ページ数は上に表示されます。</p>
        </div>
        <aside aria-label="レイアウトの設定" className="workspace-detail-group min-w-0 space-y-4 lg:order-2">
          <fieldset disabled={!meta || busy} className="min-w-0 space-y-4">
            <legend className="sr-only">レイアウトの設定</legend>
            <OptionTabs label="密度" caption="密度" value={layout.density} options={pdfDensities.map((value) => [value, pdfDensityLabels[value]] as const)} onChange={(density) => change({ density })} />
            <OptionTabs label="文字の大きさ" caption="文字" value={layout.fontSize} options={pdfFontSizes.map((value) => [value, pdfFontSizeLabels[value]] as const)} onChange={(fontSize) => change({ fontSize })} />
            <OptionTabs label="余白" caption="余白" value={layout.margin} options={pdfMargins.map((value) => [value, pdfMarginLabels[value]] as const)} onChange={(margin) => change({ margin })} />
            <div className="space-y-1">
              <label className={checkClass}><input type="checkbox" className="size-5 accent-primary" checked={layout.fitOnePage} onChange={(event) => change({ fitOnePage: event.target.checked })} /><span>自動で詰めて枚数を減らす<span className="block text-xs text-muted-foreground">本文は8pt以上を保ちます</span></span></label>
              <label className={checkClass}><input type="checkbox" className="size-5 accent-primary" checked={layout.showNotes} disabled={meta ? !meta.hasNotes : true} onChange={(event) => change({ showNotes: event.target.checked })} /><span>備考を載せる{meta && !meta.hasNotes ? <span className="block text-xs text-muted-foreground">備考は未入力です</span> : null}</span></label>
              {kind === "issued" ? <label className={checkClass}><input type="checkbox" className="size-5 accent-primary" checked={layout.showBank} onChange={(event) => change({ showBank: event.target.checked })} /><span>振込先・支払期限を載せる</span></label> : null}
              <label className={checkClass}><input type="checkbox" className="size-5 accent-primary" checked={layout.showSeal} onChange={(event) => change({ showSeal: event.target.checked })} /><span>社印を載せる</span></label>
            </div>
            <label className="grid gap-1 text-sm">改ページ
              <select aria-label="改ページの位置" className="h-11 w-full min-w-0 rounded-md border bg-background px-2 text-sm lg:h-9" value={layout.pageBreakBefore ?? ""} onChange={(event) => change({ pageBreakBefore: event.target.value ? Number(event.target.value) : undefined })}>
                <option value="">自動</option>
                {breakOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <Button type="button" variant="ghost" size="sm" className="w-full" disabled={samePdfLayout(layout, defaultPdfLayout)} onClick={() => setLayout({ ...defaultPdfLayout })}><RotateCcw className="size-4" />標準に戻す</Button>
          </fieldset>
        </aside>
      </div>
      {/* On a phone the four buttons stack, so the footer scrolls with the settings instead of covering them. */}
      <DialogFooter className="border-t bg-background pt-3 max-sm:grid max-sm:grid-cols-2 sm:sticky sm:bottom-0">
        <Button type="button" variant="outline" disabled={busy} onClick={onClose}>閉じる</Button>
        <Button asChild variant="outline"><a href={pdfUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="size-4" />PDFを開く</a></Button>
        {preview.url ? <Button asChild variant="outline"><a href={preview.url} download={`${title}.pdf`}><Download className="size-4" />この設定でダウンロード</a></Button> : <Button variant="outline" disabled><Download className="size-4" />この設定でダウンロード</Button>}
        {canSave ? <Button type="button" disabled={!meta || !dirty || busy} onClick={save}>{saving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}この設定を保存</Button> : null}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
