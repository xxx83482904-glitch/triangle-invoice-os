"use client";

import { useEffect, useState } from "react";
import { originalPdfPageCount, originalPreviewBlob, originalSourceState } from "@/lib/original-file-preview";

type Preview = { url?: string; type?: string; error?: string; status?: number; pages?: number };

// Keep missing-source handling optional: the older, non-Japan invoice view reports HTTP errors as before.
export function useOriginalFilePreview({ fileUrl, mimeType, sourceMissing, detectMissing = true, countPages = false }: {
  fileUrl?: string; mimeType?: string; sourceMissing?: boolean; detectMissing?: boolean; countPages?: boolean;
}) {
  const [attempt, setAttempt] = useState(0);
  const [preview, setPreview] = useState<Preview>({});
  useEffect(() => {
    if (detectMissing ? originalSourceState(fileUrl, sourceMissing).missing : !fileUrl) return;
    const controller = new AbortController();
    let active = true, objectUrl: string | undefined;
    const timeout = setTimeout(() => controller.abort(), 15000);
    async function load() {
      try {
        const response = await fetch(fileUrl!, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        if (detectMissing && originalSourceState(fileUrl, false, response.status).missing) {
          if (active) setPreview({ status: response.status });
          return;
        }
        const blob = await originalPreviewBlob(response, mimeType);
        const pages = countPages && blob.type === "application/pdf" && blob.size <= 8 * 1024 * 1024
          ? originalPdfPageCount(await blob.text()) : undefined;
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setPreview({ url: objectUrl, type: blob.type, pages });
      } catch (error) {
        if (active) setPreview({ error: controller.signal.aborted ? "原本の読み込みがタイムアウトしました。"
          : error instanceof Error ? error.message : "原本を読み込めませんでした。" });
      } finally { clearTimeout(timeout); }
    }
    void load();
    return () => { active = false; controller.abort(); clearTimeout(timeout); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [fileUrl, mimeType, sourceMissing, attempt, detectMissing, countPages]);
  return {
    preview, source: originalSourceState(fileUrl, sourceMissing, preview.status),
    reload: () => { setPreview({}); setAttempt((value) => value + 1); },
  };
}
