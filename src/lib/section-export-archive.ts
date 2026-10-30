import "server-only";
import { ZipArchive } from "archiver";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { readUploadedFile } from "@/lib/files";
import { createEstimatePdf, createIssuedInvoicePdf } from "@/lib/issued-invoice-pdf";
import { bankExportCsv, documentExportCsv, exportScopes, safeExportName, type ExportDocument, type SectionExport } from "@/lib/section-export";
import type { AppData } from "@/lib/types";

export function exportUploadName(url: string) {
  const match = /^(?:\/api\/files\/|\/uploads\/received-invoices\/)([^/?#]+)$/.exec(url);
  if (!match) return null;
  try {
    const name = decodeURIComponent(match[1]);
    return !name || /[\\/\x00]/.test(name) || name === "." || name === ".." ? null : name;
  } catch { return null; }
}

export async function loadExportDocument(row: ExportDocument, data: AppData) {
  if (row.fileType === "生成PDF") {
    if (row.kind === "issued") {
      const invoice = data.issuedInvoices.find((i) => i.id === row.sourceId && !i.deletedAt);
      if (!invoice || invoice.fileUrl) throw new Error("書類の状態が一致しません");
      return { data: await createIssuedInvoicePdf(invoice, data), mimeType: "application/pdf" };
    }
    const estimate = data.estimates.find((e) => e.id === row.sourceId && !e.deletedAt);
    if (!estimate) throw new Error("見積書がありません");
    return { data: await createEstimatePdf(estimate, data), mimeType: "application/pdf" };
  }
  const name = exportUploadName(row.fileUrl || "");
  if (!name) return null;
  return readUploadedFile(name);
}

const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (s) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[s]!);
export function exportIndexHtml(bundle: SectionExport) {
  const title = `${exportScopes[bundle.query.scope]} ${bundle.query.start} - ${bundle.query.end}`;
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escapeHtml(title)}</title><style>body{font:14px system-ui,sans-serif;margin:24px;color:#202124}h1{font-size:22px}table{border-collapse:collapse;width:100%}th,td{text-align:left;border-bottom:1px solid #ccc;padding:10px;overflow-wrap:anywhere}th{background:#f3f4f5}a{color:#0068b7}.scroll{overflow:auto}td{min-width:80px}</style><h1>${escapeHtml(title)}</h1><p>作成日時 ${escapeHtml(bundle.generatedAt)} / 書類 ${bundle.documents.length}件 / 口座明細 ${bundle.bank.length}件</p><p>状態・分類は書き出し時点の保存済みデータです。原本なし・読込失敗・期間未判定は要確認。見積・下書き・取消・添付書類は確定売上を表しません。取引明細と請求書を合算しないでください。</p><div class="scroll"><table><thead><tr><th>ID</th><th>対象日</th><th>番号・件名</th><th>取引先 / 案件</th><th>金額</th><th>状態</th><th>原本</th><th>注意事項</th></tr></thead><tbody>${bundle.documents.map((r) => `<tr><td>${escapeHtml(r.id)}</td><td>${escapeHtml(r.exportDate || "期間未判定")}</td><td>${escapeHtml(r.title)}</td><td>${escapeHtml(r.counterpart)}<br>${escapeHtml(r.projectName)}</td><td>${escapeHtml(r.total)}</td><td>${escapeHtml(r.statusLabel)}</td><td>${r.archivePath ? `<a href="${r.archivePath.split("/").map(encodeURIComponent).join("/")}">${escapeHtml(r.fileType)}</a>` : escapeHtml(r.fileError || "原本なし")}</td><td>${escapeHtml(r.warning)}</td></tr>`).join("")}</tbody></table></div></html>`;
}

// Append one original at a time and respect output backpressure. No archive or
// financial files are staged on disk, and a failed stream is never a valid ZIP.
export function sectionArchive(bundle: SectionExport, data: AppData, signal?: AbortSignal,
  loadFile = loadExportDocument) {
  const archive = new ZipArchive({ zlib: { level: 1 } });
  archive.on("error", () => { /* The response stream forwards the failure to the downloader. */ });
  archive.on("warning", (error) => archive.destroy(error));
  const abort = () => { archive.abort(); archive.destroy(new Error("書き出しを中止しました")); };
  signal?.addEventListener("abort", abort, { once: true });
  archive.once("close", () => signal?.removeEventListener("abort", abort));
  async function append(bytes: Buffer | string, name: string) {
    if (archive.destroyed || signal?.aborted) throw new Error("書き出しを中止しました");
    const written = once(archive, "entry", { signal });
    archive.append(bytes, { name });
    await written;
  }
  void (async () => {
    try {
      let bytes = 0;
      const files = new Map<string, { archivePath: string; sha256: string }>();
      for (const [index, row] of bundle.documents.entries()) {
        if (archive.destroyed || signal?.aborted) throw new Error("書き出しを中止しました");
        const key = row.fileType === "生成PDF" ? row.id : exportUploadName(row.fileUrl || "");
        const existing = key && files.get(key);
        if (existing) { Object.assign(row, existing); continue; }
        let file;
        try { file = await loadFile(row, data); }
        catch { row.fileError = "読込・PDF生成失敗"; continue; }
        if (!file) { row.fileError = "原本なし・参照先不明"; continue; }
        bytes += file.data.length;
        if (bytes > 2 * 1024 ** 3) throw new Error("原本が2GBを超えました。期間を分けて書き出してください");
        const extension = { "application/pdf": ".pdf", "image/png": ".png", "image/jpeg": ".jpg" }[file.mimeType] || ".bin";
        row.archivePath = `files/${row.exportDate.slice(0, 7) || "undated"}/${row.kind}/${String(index + 1).padStart(6, "0")}_${safeExportName(row.title)}${extension}`;
        row.sha256 = createHash("sha256").update(file.data).digest("hex");
        await append(file.data, row.archivePath);
        if (key) files.set(key, { archivePath: row.archivePath, sha256: row.sha256 });
      }
      await append(documentExportCsv(bundle, true), "documents.csv");
      if (bundle.query.scope === "all" || bundle.query.scope === "banking") await append(bankExportCsv(bundle), "bank-transactions.csv");
      await append(exportIndexHtml(bundle), "index.html");
      await append(JSON.stringify({ query: bundle.query, generatedAt: bundle.generatedAt, excludedUndated: bundle.excludedUndated,
        files: bundle.documents.map(({ id, archivePath, sha256, fileType, fileError, warning }) => ({ id, archivePath, sha256, fileType, fileError, warning })) }, null, 2), "manifest.json");
      await append(`書き出し対象: ${exportScopes[bundle.query.scope]}\n期間: ${bundle.query.start} - ${bundle.query.end}\n日付基準: ${bundle.query.basis}\n日付未設定: ${bundle.query.undated === "1" ? "期間未判定として含む" : "除外"}\n除外した日付未設定: ${bundle.excludedUndated}件\n原本なし・読込失敗: ${bundle.documents.filter((r) => r.fileError).length}件\n\nZIPを展開してindex.htmlを開くと一覧から同梱ファイルを参照できます。\nアップロード原本は無加工。生成PDFは書き出し時点の保存内容です。SHA256はmanifest.jsonとdocuments.csvに記録しています。\n状態・入出金照合・勘定科目は保存済みの現在値です。決算日時点の残高や税務上の確定仕訳を示すものではありません。\n日付未設定・OCR要確認・下書き・取消を確認してください。郵便物と連携受領請求書は一行に統合し、同じ原本参照は一つのファイルを共有します。\n口座CSVは資金移動・カード利用・連携元欠落も区分付きで収録しています。請求書金額と銀行・カード明細金額を合算しないでください。\n銀行明細は取得済みの保存データのみです。未同期期間の明細は含まれません。\n`, "README.txt");
      await archive.finalize();
    } catch (error) { archive.abort(); archive.destroy(error instanceof Error ? error : new Error("書き出し失敗")); }
  })();
  return archive;
}
