// A broken invoice link is not evidence that its original file is missing.
export function originalSourceState(fileUrl?: string, sourceMissing = false, responseStatus?: number) {
  if (!fileUrl?.trim()) return { missing: true, reason: "原本の登録先がありません。" };
  if (sourceMissing) return { missing: true, reason: "登録された参照先に原本ファイルがありません。再アップロード後に画面を更新してください。" };
  if (responseStatus === 404 || responseStatus === 410) return { missing: true, reason: `原本の参照先が見つかりません（HTTP ${responseStatus}）。登録先を確認してください。` };
  return { missing: false, reason: "" };
}

export async function originalPreviewBlob(response: Response, mimeType?: string) {
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "原本へのアクセス権限を確認してください。" : `原本を取得できませんでした (HTTP ${response.status})。`);
  const blob = await response.blob();
  if (!blob.size) throw new Error("原本ファイルが空です。");
  const header = await blob.slice(0, 5).text();
  const type = header === "%PDF-" ? "application/pdf" : blob.type || mimeType || "";
  if (type === "application/pdf" && header !== "%PDF-") throw new Error("PDFの内容を確認できませんでした。");
  if (!["application/pdf", "image/png", "image/jpeg"].includes(type)) throw new Error("この原本は埋め込み表示に対応していません。");
  return new Blob([blob], { type });
}

// A deliberately conservative count for small, plain PDFs. Compressed/incremental page trees stay unknown.
export function originalPdfPageCount(bytes: string): number | undefined {
  if (!bytes.startsWith("%PDF-") || /\/ObjStm\b|\/Encrypt\b|\/Prev\b/.test(bytes)) return;
  const objects = bytes.replace(/stream\r?\n[\s\S]*?\r?\nendstream/g, "").match(/\d+\s+\d+\s+obj\b[\s\S]*?endobj/g) ?? [];
  const pages = objects.filter((object) => /\/Type\s*\/Page\b/.test(object)).length;
  const counts = objects.filter((object) => /\/Type\s*\/Pages\b/.test(object))
    .flatMap((object) => [...object.matchAll(/\/Count\s+(\d+)\b/g)].map((match) => Number(match[1])));
  return pages > 0 && counts.length > 0 && Math.max(...counts) === pages ? pages : undefined;
}
