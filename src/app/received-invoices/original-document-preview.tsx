"use client";

import { useState } from "react";
import { Download, ExternalLink, RefreshCw } from "lucide-react";
import { ZoomableDocument } from "@/components/app/zoomable-document";
import { Button } from "@/components/ui/button";
import { originalSourceState } from "@/lib/original-file-preview";
import { useOriginalFilePreview } from "@/hooks/use-original-file-preview";
import type { CompanyScope } from "@/lib/company";

// frameClassName overrides the viewer height where the space is tighter than a full page (e.g. inside a dialog).
type PreviewProps = { fileUrl?: string; fileName: string; mimeType?: string; company?: CompanyScope; sourceMissing?: boolean; frameClassName?: string };

export function OriginalDocumentPreview(props: PreviewProps) {
  return props.company === "JAPAN" ? <JapanOriginalPreview key={`${props.fileUrl}:${props.fileName}:${props.mimeType}:${props.sourceMissing}`} {...props} /> : <LegacyOriginalDocumentPreview {...props} />;
}

// PDFs and images share one in-app viewer (zoom, pan, pages, rotation), on desktop and phones alike.
function DocumentViewer({ title, src, type, className, onFailed }: { title: string; src: string; type?: string; className: string; onFailed: () => void }) {
  return <ZoomableDocument key={src} src={src} type={type || ""} title={title} className={className} onFailed={onFailed} />;
}

function JapanOriginalPreview({ fileUrl, fileName, mimeType, sourceMissing, frameClassName = "h-[65vh] min-h-80" }: PreviewProps) {
  const { preview, source, reload } = useOriginalFilePreview({ fileUrl, mimeType, sourceMissing });
  const [renderFailed, setRenderFailed] = useState(false);
  const failed = preview.error || (renderFailed ? "埋め込み表示を確認できません。原本を開くかダウンロードしてください。" : "");
  return <div className="min-w-0 space-y-3">
    <div className="flex flex-wrap gap-2">
      {source.missing ? <><Button disabled size="sm" variant="outline"><ExternalLink />原本を開く</Button><Button disabled size="sm" variant="outline"><Download />ダウンロード</Button></>
        : <><Button asChild size="sm" variant="outline"><a href={fileUrl} target="_blank" rel="noopener noreferrer"><ExternalLink />原本を開く</a></Button><Button asChild size="sm" variant="outline"><a href={fileUrl} download={fileName}><Download />ダウンロード</a></Button></>}
      {!originalSourceState(fileUrl, sourceMissing).missing ? <Button type="button" size="icon" variant="outline" title="原本を再読み込み" aria-label="原本を再読み込み" onClick={() => { reload(); setRenderFailed(false); }}><RefreshCw /></Button> : null}
    </div>
    {source.missing ? <div role="status" className="rounded-lg border bg-muted p-4 text-sm"><p className="font-medium">原本ファイルが見つかりません</p><p className="mt-1 text-muted-foreground">{source.reason}</p></div> : <>
      {failed ? <p role="alert" className="rounded-lg border border-destructive/40 bg-card p-3 text-sm text-destructive">{failed}</p> : null}
      {!preview.url && !failed ? <p role="status" className="p-4 text-sm">原本を読み込み中…</p> : null}
      {preview.url && !renderFailed ? <DocumentViewer title={`原本: ${fileName}`} src={preview.url} type={preview.type} className={`${frameClassName} w-full`} onFailed={() => setRenderFailed(true)} /> : null}
    </>}
  </div>;
}

function LegacyOriginalDocumentPreview({ fileUrl, fileName, mimeType, frameClassName = "h-[65vh] min-h-80" }: PreviewProps) {
  const { preview, reload } = useOriginalFilePreview({ fileUrl, mimeType, detectMissing: false });
  const [renderFailed, setRenderFailed] = useState(false);

  if (!fileUrl) return <p role="status" className="border p-4 text-sm text-muted-foreground">原本ファイルが登録されていません。</p>;
  const failed = preview.error || (renderFailed ? "埋め込み表示を確認できません。原本を別画面で開くかダウンロードしてください。" : "");
  return <div className="min-w-0 space-y-3">
    <div className="flex flex-wrap gap-2">
      <Button asChild size="sm" variant="outline"><a href={fileUrl} target="_blank" rel="noopener noreferrer"><ExternalLink />原本を開く</a></Button>
      <Button asChild size="sm" variant="outline"><a href={fileUrl} download={fileName}><Download />原本を保存</a></Button>
      <Button type="button" size="icon" variant="outline" title="原本を再読み込み" aria-label="原本を再読み込み" onClick={() => { reload(); setRenderFailed(false); }}><RefreshCw /></Button>
    </div>
    {failed ? <p role="alert" className="border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950">{failed}</p> : null}
    {!preview.url && !failed ? <p role="status" className="p-4 text-sm">原本を読み込み中…</p> : null}
    {preview.url && !renderFailed ? <DocumentViewer title={`原本: ${fileName}`} src={preview.url} type={preview.type} className={`${frameClassName} w-full`} onFailed={() => setRenderFailed(true)} /> : null}
  </div>;
}
