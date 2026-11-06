"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertCircle, ChevronLeft, ChevronRight, ExternalLink, FileQuestion, FileText, FolderOpen, Loader2, Mail, Minus, Plus, ReceiptText, RefreshCw, Unlink, UploadCloud } from "lucide-react";
import { OnScreenPdfFrame } from "@/components/app/on-screen-pdf-frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useOriginalFilePreview } from "@/hooks/use-original-file-preview";
import type { CompanyScope } from "@/lib/company";
import { formatDate } from "@/lib/format";
import type { ImportBoardDocument } from "@/lib/import-shipment-views";
import { importPdfFragment } from "@/lib/original-file-preview";
import { ImportDropzone } from "../import-dropzone";
import { documentTabs, tabDocuments, type DocumentTab } from "./document-tabs";

type ViewerProps = {
  documents: ImportBoardDocument[]; kind: DocumentTab; company: CompanyScope; shipmentId: string;
  canEdit: boolean; pending: boolean; onAdd: () => void; onDetach: (document: ImportBoardDocument) => void;
};

export function DocumentViewer(props: ViewerProps) {
  const documents = tabDocuments(props.documents, props.kind);
  const [selected, setSelected] = useState("");
  const document = documents.find((row) => row.key === selected) ?? documents[0];
  return <Card variant="section" className="min-w-0 gap-3 p-3 lg:p-4">
    {documents.length > 1 ? <div role="group" aria-label="表示するファイル" className="flex min-w-0 gap-1 overflow-x-auto rounded-lg bg-[var(--track)] p-1">
      {documents.map((file) => <button key={file.key} type="button" title={file.fileName} aria-pressed={file.key === document.key}
        className={`min-w-24 max-w-56 shrink-0 truncate rounded-md px-3 py-2 text-xs focus-visible:outline-2 focus-visible:outline-ring ${file.key === document.key ? "bg-[var(--selected)] shadow-[var(--shadow-soft)]" : "hover:bg-[var(--tile)]"}`}
        onClick={() => setSelected(file.key)}>{file.fileName}</button>)}
    </div> : null}
    {document ? <OriginalViewer key={`${document.key}:${document.fileUrl}:${document.updatedAt}`} document={document} canEdit={props.canEdit} pending={props.pending} onAdd={props.onAdd} onDetach={props.onDetach} />
      : <div className="flex min-h-72 flex-col justify-center gap-4 rounded-xl border border-dashed border-input p-4 lg:h-[min(72vh,760px)]">
        <p className="text-center text-sm font-medium">{documentTabs.find((tab) => tab.kind === props.kind)?.label}はまだ添付されていません</p>
        {props.canEdit ? <><ImportDropzone company={props.company} shipmentId={props.shipmentId} compact />
          <Button type="button" variant="ghost" size="sm" className="self-center" disabled={props.pending} onClick={props.onAdd}><FolderOpen />未割当の書類から選ぶ</Button></> : <p className="text-center text-xs text-muted-foreground">未添付</p>}
      </div>}
  </Card>;
}

function OriginalViewer({ document, canEdit, pending, onAdd, onDetach }: {
  document: ImportBoardDocument; canEdit: boolean; pending: boolean; onAdd: () => void; onDetach: (document: ImportBoardDocument) => void;
}) {
  const { preview, source, reload } = useOriginalFilePreview({ fileUrl: document.fileUrl, mimeType: document.mimeType, countPages: true });
  const [page, setPage] = useState(1), [zoom, setZoom] = useState(100), [fit, setFit] = useState(true);
  const [renderFailed, setRenderFailed] = useState(false);
  const pdf = preview.type === "application/pdf" || (!preview.type && (document.mimeType === "application/pdf" || /\.pdf$/i.test(document.fileName)));
  const sourceLabel = document.source === "received" ? "受領請求書を開く" : "郵便仕分けで開く";
  const SourceIcon = document.source === "received" ? ReceiptText : Mail;
  const unsupported = preview.error === "この原本は埋め込み表示に対応していません。";
  const failed = preview.error || (renderFailed ? "原本の埋め込み表示を確認できませんでした。" : "");
  const openOriginal = document.fileUrl ? <Button asChild variant="ghost" size="sm"><a href={document.fileUrl} target="_blank" rel="noopener noreferrer"><ExternalLink />別タブで開く</a></Button> : null;
  const retry = () => { setRenderFailed(false); reload(); };
  return <>
    <header className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2">
      <div className="flex min-w-0 flex-1 basis-48 items-center gap-2"><FileText aria-hidden className="size-4 shrink-0" /><span className="truncate text-sm" title={document.fileName}>{document.fileName}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground">{pdf ? preview.pages ? `PDF・${preview.pages}ページ` : "PDF" : preview.type?.startsWith("image/") ? "画像" : "原本"}</span></div>
      {openOriginal}
      {preview.url && !failed && !source.missing ? <div className={`flex w-full flex-wrap items-center justify-between gap-1 ${pdf ? "max-lg:hidden" : ""}`}>
        {pdf ? <div className="flex items-center gap-1"><Button type="button" variant="ghost" size="icon" aria-label="前のページ" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft /></Button>
          <span aria-live="polite" className="whitespace-nowrap text-xs">{preview.pages ? `${page} / ${preview.pages}` : `${page} ページ目`}</span>
          <Button type="button" variant="ghost" size="icon" aria-label="次のページ" disabled={preview.pages !== undefined && page >= preview.pages} onClick={() => setPage(page + 1)}><ChevronRight /></Button></div> : <span />}
        <div className="flex flex-wrap items-center gap-1"><div className="flex items-center rounded-lg border border-[var(--edge)] bg-[var(--field)]">
          <Button type="button" variant="ghost" size="icon" aria-label="縮小" disabled={zoom <= 25} onClick={() => { setFit(false); setZoom(Math.max(25, zoom - 25)); }}><Minus /></Button>
          <span className="w-12 text-center text-xs">{zoom}%</span>
          <Button type="button" variant="ghost" size="icon" aria-label="拡大" disabled={zoom >= 300} onClick={() => { setFit(false); setZoom(Math.min(300, zoom + 25)); }}><Plus /></Button>
        </div><Button type="button" variant="ghost" size="sm" aria-pressed={fit} onClick={() => { setFit(true); setZoom(100); }}>幅に合わせる</Button></div>
      </div> : null}
    </header>
    <div className={`min-w-0 overflow-auto overscroll-contain rounded-xl bg-[var(--tile)] ${pdf ? "min-h-56 lg:h-[min(72vh,760px)]" : "h-[min(72vh,760px)]"}`}>
      {source.missing ? <div role="status" className="flex min-h-56 h-full flex-col items-center justify-center gap-3 p-5 text-center">
        <FileQuestion aria-hidden className="size-6 text-[var(--tone-amber-fg)]" /><p className="text-sm font-medium">原本ファイルが見つかりません</p><p className="max-w-md text-xs text-muted-foreground">{source.reason}</p>
        <div className="flex flex-wrap justify-center gap-2">{canEdit ? <Button type="button" variant="outline" size="sm" disabled={pending} onClick={onAdd}><UploadCloud />ファイルを追加</Button> : null}
          <Button asChild variant="ghost" size="sm"><Link prefetch={false} href={document.href}><ExternalLink />{sourceLabel}</Link></Button></div>
      </div> : failed ? <div role="alert" className="flex min-h-56 h-full flex-col items-center justify-center gap-3 p-5 text-center">
        <AlertCircle aria-hidden className="size-6 text-[var(--tone-amber-fg)]" /><p className="text-sm font-medium">{unsupported ? "この形式は画面内に表示できません" : "画面内に表示できませんでした"}</p>
        <p className="max-w-md text-xs text-muted-foreground">{failed}</p><div className="flex flex-wrap justify-center gap-2">{openOriginal}
          {!unsupported ? <Button type="button" variant="outline" size="sm" onClick={retry}><RefreshCw />もう一度読み込む</Button> : null}</div>
      </div> : !preview.url ? <div role="status" className="flex min-h-56 h-full items-center justify-center gap-2 p-5 text-sm text-muted-foreground"><Loader2 aria-hidden className="size-4 animate-spin" />原本を読み込み中…</div>
        : pdf ? <><div className="hidden h-full lg:block"><OnScreenPdfFrame key={`${page}:${zoom}:${fit}`} title={`原本: ${document.fileName}`} src={`${preview.url}${importPdfFragment(page, zoom, fit)}`} className="h-full w-full" onError={() => setRenderFailed(true)} /></div>
          <div className="flex min-h-56 flex-col items-center justify-center gap-3 p-4 text-center lg:hidden"><p className="text-xs text-muted-foreground">スマートフォンでは「別タブで開く」からPDFを表示してください。</p>{openOriginal}</div></>
          // Original images retain their document framing and can be zoomed without cropping.
          // eslint-disable-next-line @next/next/no-img-element
          : <img src={preview.url} alt={`原本: ${document.fileName}`} onError={() => setRenderFailed(true)} style={{ width: `${zoom}%`, maxWidth: "none" }} className="block h-auto" />}
    </div>
    {pdf && preview.url && !failed && !source.missing ? <Button type="button" variant="ghost" size="sm" className="hidden self-start text-xs text-muted-foreground lg:inline-flex" onClick={() => setRenderFailed(true)}><AlertCircle />プレビューが表示されない</Button> : null}
    <footer className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5"><SourceIcon aria-hidden className="size-3.5 shrink-0" />
        <span>{document.source === "received" ? "受領請求書から添付" : "郵便仕分けから"} ・ <span className="whitespace-nowrap">{formatDate(document.date)}</span></span>
        {document.source === "received" ? <Badge variant="outline" className={`border-transparent text-[10px] font-normal ${document.paid ? "bg-[var(--tone-emerald-bg)] text-[var(--tone-emerald-fg)]" : "bg-[var(--tone-amber-bg)] text-[var(--tone-amber-fg)]"}`}>{document.paid ? "支払済" : "未払い"}</Badge> : null}
      </div>
      <div className="flex flex-wrap items-center gap-1"><Button asChild variant="ghost" size="sm" className="text-xs"><Link href={document.href} prefetch={false}><ExternalLink />{sourceLabel}</Link></Button>
        {canEdit ? <Button type="button" variant="ghost" size="sm" className="text-xs" disabled={pending} onClick={() => onDetach(document)}><Unlink />この便から外す</Button> : null}</div>
    </footer>
  </>;
}
