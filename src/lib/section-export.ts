import { z } from "zod";
import { documentRows, documentKindLabels, documentCategoryLabels, type DocumentRow } from "@/lib/documents";
import { can, canAccessCompany } from "@/lib/rbac";
import type { AppData, User } from "@/lib/types";

export const exportScopes = { issued: "発行請求書", estimate: "発行見積書", received: "受領請求書", mail: "郵便物", banking: "口座・カード明細", all: "全書類・決算資料" };
export type ExportScope = keyof typeof exportScopes;
export const validExportDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number(s.slice(0, 4)) >= 1901 && Number(s.slice(0, 4)) <= 2199 && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
export const exportQuerySchema = z.object({
  company: z.literal("JAPAN"), scope: z.enum(["issued", "estimate", "received", "mail", "banking", "all"]),
  start: z.string().refine((s) => { try { return validExportDate(s); } catch { return false; } }),
  end: z.string().refine((s) => { try { return validExportDate(s); } catch { return false; } }),
  basis: z.enum(["document", "folder", "transaction"]).default("document"),
  undated: z.enum(["0", "1"]).default("1"),
}).refine((q) => q.start <= q.end, "開始日は終了日以前にしてください");
export type ExportQuery = z.infer<typeof exportQuerySchema>;
export const fiscalRange = (year: number) => ({ start: `${year - 1}-09-01`, end: `${year}-08-31` });

export function canExportSection(user: Pick<User, "role"> | null, scope: ExportScope) {
  if (!user) return false;
  if (scope === "all") return can(user, "export:csv") && can(user, "view:reports");
  if (scope === "banking") return can(user, "export:csv") && can(user, "view:banking");
  if (scope === "mail") return can(user, "view:mailSorter") && (can(user, "export:csv") || can(user, "manage:mailSorter"));
  const permission = { issued: "view:issuedInvoices", estimate: "view:estimates", received: "view:receivedInvoices" }[scope];
  return can(user, permission) && (can(user, "export:csv") || scope !== "received" && can(user, "export:issuedInvoices"));
}

export type ExportDocument = DocumentRow & { exportDate: string; dateLabel: string; fileType: "原本" | "生成PDF" | "原本なし"; warning: string; archivePath?: string; sha256?: string; fileError?: string };
export type ExportBankRow = { id: string; date: string; account: string; side: string; amount: number; content: string; category: string; subCategory: string; treatment: string; reviewed: string; classification: string; sourceMissing: boolean; memo: string; documents: string; transfer: string };
export type SectionExport = { query: ExportQuery; documents: ExportDocument[]; bank: ExportBankRow[]; generatedAt: string; excludedUndated: number };
function exportedFileType(r: DocumentRow): ExportDocument["fileType"] {
  const generated = r.kind === "estimate" || r.kind === "issued" && !r.imported && (!r.fileUrl || r.fileUrl.startsWith("/api/issued-invoices/"));
  return generated ? "生成PDF" : r.fileUrl ? "原本" : "原本なし";
}

export function sectionExport(data: AppData, user: Pick<User, "id" | "role">, input: ExportQuery): SectionExport {
  const q = exportQuerySchema.parse(input);
  if (!canAccessCompany(user, q.company) || !canExportSection(user, q.scope)) throw new Error("書き出し権限がありません");
  const all = documentRows(data, user, q.company);
  const byId = new Map(all.map((r) => [r.id, r]));
  const received = new Map(data.receivedInvoices.filter((i) => !i.deletedAt).map((i) => [i.id, i]));
  const mail = new Map(data.mailDocuments.filter((i) => !i.deletedAt && (i.company || "JAPAN") === q.company).map((i) => [i.id, i]));
  const linkedReceived = new Set([...mail.values()].map((m) => m.relatedReceivedInvoiceId).filter(Boolean));
  const parentOf = (r: DocumentRow) => {
    if (r.kind !== "attachment") return r;
    const a = data.attachments.find((a) => a.id === r.sourceId);
    const prefix = { IssuedInvoice: "issued", ReceivedInvoice: "received", MailDocument: "mail", ProjectContract: "contract" }[a?.relatedType || ""];
    const linked = a?.relatedType === "MailDocument" ? mail.get(a.relatedId)?.relatedReceivedInvoiceId : undefined;
    return byId.get(`${linked ? "received" : prefix}:${linked || a?.relatedId}`) || r;
  };
  let excludedUndated = 0;
  const documents: ExportDocument[] = [];
  if (q.scope !== "banking") for (const r of all) {
    const parent = parentOf(r);
    const inScope = q.scope === "all" || parent.kind === q.scope || q.scope === "mail" && parent.kind === "received" && (linkedReceived.has(parent.sourceId) || Boolean(received.get(parent.sourceId)?.ocrText));
    if (!inScope) continue;
    let exportDate = parent.date, dateLabel = parent.kind === "mail" || parent.kind === "contract" ? "登録日" : "書類日";
    if (q.basis === "folder") { exportDate = /^\d{4}-(0[1-9]|1[0-2])$/.test(parent.month) ? `${parent.month}-01` : ""; dateLabel = "フォルダー月"; }
    if (q.basis === "transaction" && parent.kind === "issued") { exportDate = data.issuedInvoices.find((i) => i.id === parent.sourceId)?.transactionDate || ""; dateLabel = "取引日"; }
    let dated = false;
    try { dated = validExportDate(exportDate); } catch { /* Invalid saved dates remain visible as undated. */ }
    if (!dated) { exportDate = ""; if (q.undated === "0") { excludedUndated++; continue; } }
    else if (q.basis === "folder" ? exportDate.slice(0, 7) < q.start.slice(0, 7) || exportDate.slice(0, 7) > q.end.slice(0, 7) : exportDate < q.start || exportDate > q.end) continue;
    const warnings = [!dated ? "期間未判定" : "", r.needsReview ? "OCR要確認" : "", r.status === "DRAFT" ? "下書き" : "", r.status === "CANCELED" ? "取消" : ""].filter(Boolean);
    documents.push({ ...r, exportDate, dateLabel, fileType: exportedFileType(r), warning: warnings.join(" / ") });
  }
  documents.sort((a, b) => b.exportDate.localeCompare(a.exportDate) || a.id.localeCompare(b.id));
  const bank: ExportBankRow[] = [];
  if (q.scope === "all" || q.scope === "banking") {
    const accounts = new Map(data.bankAccounts.filter((a) => a.company === q.company).map((a) => [a.id, a]));
    const categories = new Map(data.accountingCategories.filter((a) => a.company === q.company).map((a) => [a.id, a.name]));
    for (const t of data.bankTransactions) {
      const account = accounts.get(t.bankAccountId);
      if (t.company !== q.company || !account || t.officeCode !== account.officeCode) continue;
      let dated = false;
      try { dated = validExportDate(t.transactionDate); } catch { /* Preserve malformed records for review. */ }
      if (!dated && q.undated === "0") { excludedUndated++; continue; }
      if (dated && (t.transactionDate < q.start || t.transactionDate > q.end)) continue;
      const links = data.bankReconciliations.filter((l) => !l.deletedAt && l.company === q.company && l.transactionId === t.id && byId.has(`${l.invoiceKind}:${l.invoiceId}`));
      const transfer = data.bankTransfers?.find((l) => !l.deletedAt && l.company === q.company && (l.incomingId === t.id || l.outgoingId === t.id));
      bank.push({ id: t.id, date: dated ? t.transactionDate : "", account: account.name, side: t.side === "INCOME" ? "入金" : "出金", amount: t.amount,
        content: t.content, category: categories.get(t.categoryId || "") || "未保存・未分類", subCategory: categories.get(t.subCategoryId || "") || "",
        treatment: { NORMAL: "通常", TRANSFER: "資金移動", EXCLUDED: "集計対象外" }[t.treatment], reviewed: t.reviewed ? "確認済み" : "未確認",
        classification: t.classificationSource, sourceMissing: t.sourceMissing, memo: t.memo,
        documents: links.map((l) => `${l.invoiceKind}:${l.invoiceId} (${l.amount})`).join("; "), transfer: transfer?.id || "" });
    }
    bank.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
    if (q.scope === "banking") {
      const transactionIds = new Set(bank.map((t) => t.id));
      const linkedIds = new Set(data.bankReconciliations.filter((l) => !l.deletedAt && l.company === q.company && transactionIds.has(l.transactionId)).map((l) => `${l.invoiceKind}:${l.invoiceId}`));
      for (const r of all) if (linkedIds.has(parentOf(r).id)) documents.push({ ...r, exportDate: r.date, dateLabel: "照合書類の書類日", fileType: exportedFileType(r),
        warning: "期間内の明細に照合済み（書類日は期間外の場合あり）" + (r.needsReview ? " / OCR要確認" : "") });
    }
  }
  return { query: q, documents, bank, generatedAt: new Date().toISOString(), excludedUndated };
}

export function exportCsv(rows: unknown[][]) {
  // Quoting alone does not stop spreadsheet formula execution.
  const cell = (value: unknown) => {
    let s = String(value ?? "");
    if (typeof value !== "number" && /^[\s\uFEFF]*[=+\-@\t\r\n]/.test(s)) s = "'" + s;
    return `"${s.replaceAll('"', '""')}"`;
  };
  return "\uFEFF" + rows.map((row) => row.map(cell).join(",")).join("\r\n");
}

export function documentExportCsv(bundle: SectionExport, archived = false) {
  return exportCsv([
    ["書類ID", "種類", "分類", "番号・件名", "取引先", "案件", "請求回", "対象日", "日付基準", "書類日", "フォルダー月", "期限", "金額", "現在の状態", "原本区分", "原本ファイル名", "原本参照", "ファイル確認", "SHA256", "注意事項"],
    ...bundle.documents.map((r) => [r.id, documentKindLabels[r.kind], documentCategoryLabels[r.category] || r.category, r.title, r.counterpart, r.projectName, r.billingLabel,
      r.exportDate, r.dateLabel, r.date, r.month, r.dueDate, r.total, r.statusLabel, r.fileType, r.fileName,
      archived ? r.archivePath : r.fileUrl, r.fileError || (archived ? "同梱済み" : "書き出し時点では未検証"), r.sha256, r.warning]),
  ]);
}

export function bankExportCsv(bundle: SectionExport) {
  return exportCsv([["明細ID", "取引日", "口座・カード", "入出金", "金額", "摘要", "勘定科目（保存済み）", "補助科目", "扱い", "確認状態", "分類根拠", "連携元欠落", "メモ", "照合済み書類IDと金額", "資金移動ID"],
    ...bundle.bank.map((r) => [r.id, r.date, r.account, r.side, r.amount, r.content, r.category, r.subCategory, r.treatment, r.reviewed, r.classification, r.sourceMissing ? "要確認" : "", r.memo, r.documents, r.transfer])]);
}

export function safeExportName(value: string) {
  return value.normalize("NFKC").replace(/[\\/:*?"<>|\x00-\x1f\x7f#%]/g, "_").replace(/\.{2,}/g, "_").replace(/[. ]+$/g, "").slice(0, 70) || "document";
}
