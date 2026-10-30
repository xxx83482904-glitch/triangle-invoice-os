"use client";

import { useEffect, useState } from "react";
import { Download, ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { originalPreviewBlob } from "@/lib/original-file-preview";

export function OriginalDocumentPreview({ fileUrl, fileName, mimeType }: { fileUrl?: string; fileName: string; mimeType?: string }) {
  const [attempt, setAttempt] = useState(0);
  const [preview, setPreview] = useState<{ url?: string; type?: string; error?: string }>({});
  const [renderFailed, setRenderFailed] = useState(false);
  useEffect(() => {
    if (!fileUrl) return;
    const controller = new AbortController();
    let active = true;
    let objectUrl: string | undefined;
    const timeout = setTimeout(() => controller.abort(), 15000);
    async function load() {
      try {
        const response = await fetch(fileUrl!, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        const blob = await originalPreviewBlob(response, mimeType);
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setPreview({ url: objectUrl, type: blob.type });
      } catch (error) {
        if (active) setPreview({ error: controller.signal.aborted ? "原本の読み込みがタイムアウトしました。" : error instanceof Error ? error.message : "原本を読み込めませんでした。" });
      } finally {
        clearTimeout(timeout);
      }
    }
    void load();
    return () => { active = false; controller.abort(); clearTimeout(timeout); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [fileUrl, mimeType, attempt]);

  if (!fileUrl) return <p role="status" className="border p-4 text-sm text-muted-foreground">原本ファイルが登録されていません。</p>;
  const failed = preview.error || (renderFailed ? "埋め込み表示を確認できません。原本を別画面で開くかダウンロードしてください。" : "");
  return <div className="min-w-0 space-y-3">
    <div className="flex flex-wrap gap-2">
      <Button asChild size="sm" variant="outline"><a href={fileUrl} target="_blank" rel="noopener noreferrer"><ExternalLink />原本を開く</a></Button>
      <Button asChild size="sm" variant="outline"><a href={fileUrl} download={fileName}><Download />原本を保存</a></Button>
      <Button type="button" size="icon" variant="outline" title="原本を再読み込み" aria-label="原本を再読み込み" onClick={() => { setPreview({}); setRenderFailed(false); setAttempt((value) => value + 1); }}><RefreshCw /></Button>
    </div>
    {failed ? <p role="alert" className="border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950">{failed}</p> : null}
    {!preview.url && !failed ? <p role="status" className="p-4 text-sm">原本を読み込み中…</p> : null}
    {preview.url && !renderFailed ? preview.type === "application/pdf"
      ? <><iframe title={`原本: ${fileName}`} src={preview.url} onError={() => setRenderFailed(true)} className="h-[65vh] min-h-80 w-full border bg-white" />
        <Button type="button" size="sm" variant="outline" onClick={() => setRenderFailed(true)}>プレビューが表示されない</Button></>
      // Original images must retain their full document framing.
      // eslint-disable-next-line @next/next/no-img-element
      : <img src={preview.url} alt={`原本: ${fileName}`} onError={() => setRenderFailed(true)} className="max-h-[65vh] w-full border object-contain" /> : null}
  </div>;
}
