import { z } from "zod";
import { documentItemsSchema, type DocumentItemInput } from "@/lib/document-items";
import { pdfLayoutSchema } from "@/lib/invoice-pdf-layout";
import type { InvoicePdfText, InvoicePdfTextKey } from "@/lib/types";

// What the PDF dialog can change. `PdfContent` is stored on the document itself, so it also reaches
// lists and reports; `InvoicePdfText` is wording for this document's PDF only. Totals are never here:
// they always come from the lines, so a PDF cannot disagree with the books.

export type PdfDocumentKind = "invoice" | "estimate";
export type PdfContent = { number: string; issueDate: string; dueDate: string; notes: string; items: DocumentItemInput[] };
export type PdfTextGroup = "heading" | "issuer" | "bank" | "labels";

export const pdfTextGroupLabels: Record<PdfTextGroup, string> = { heading: "宛先・件名", issuer: "発行元", bank: "振込先", labels: "見出し・ラベル" };

// `only` limits a field to the document kind that prints it.
export const pdfTextFields: readonly { key: InvoicePdfTextKey; group: PdfTextGroup; label: string; only?: PdfDocumentKind }[] = [
  { key: "title", group: "heading", label: "書類名" },
  { key: "recipient", group: "heading", label: "宛先" },
  { key: "subject", group: "heading", label: "件名" },
  { key: "greeting", group: "heading", label: "あいさつ文" },
  { key: "issuerName", group: "issuer", label: "会社名" },
  { key: "issuerPostalCode", group: "issuer", label: "郵便番号" },
  { key: "issuerAddress", group: "issuer", label: "住所" },
  { key: "issuerBuilding", group: "issuer", label: "建物名" },
  { key: "issuerPhone", group: "issuer", label: "電話番号" },
  { key: "issuerRegistration", group: "issuer", label: "登録番号" },
  { key: "bankLine", group: "bank", label: "口座", only: "invoice" },
  { key: "accountName", group: "bank", label: "口座名義", only: "invoice" },
  { key: "feeNote", group: "bank", label: "手数料の案内", only: "invoice" },
  { key: "numberLabel", group: "labels", label: "番号の見出し" },
  { key: "dateLabel", group: "labels", label: "日付の見出し" },
  { key: "amountLabel", group: "labels", label: "金額欄の見出し" },
  { key: "subjectLabel", group: "labels", label: "件名の見出し" },
  { key: "descriptionHeader", group: "labels", label: "明細: 摘要" },
  { key: "quantityHeader", group: "labels", label: "明細: 数量" },
  { key: "unitPriceHeader", group: "labels", label: "明細: 単価" },
  { key: "amountHeader", group: "labels", label: "明細: 金額" },
  { key: "subtotalLabel", group: "labels", label: "税抜計の見出し" },
  { key: "taxLabel", group: "labels", label: "消費税の見出し" },
  { key: "totalLabel", group: "labels", label: "合計の見出し" },
  { key: "notesLabel", group: "labels", label: "備考の見出し" },
  { key: "bankLabel", group: "labels", label: "振込先の見出し", only: "invoice" },
  { key: "dueLabel", group: "labels", label: "支払期限の見出し", only: "invoice" },
  { key: "validityLabel", group: "labels", label: "有効期限の見出し", only: "estimate" },
  { key: "continuedLabel", group: "labels", label: "2枚目以降の書類名に付ける語" },
];

const validDate = (value: string) => value === "" || (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);

export const pdfContentSchema = z.object({
  number: z.string().trim().min(1, "番号を入力してください").max(100, "番号が長すぎます"),
  issueDate: z.string().refine(validDate, "発行日を確認してください"),
  dueDate: z.string().refine(validDate, "期限を確認してください"),
  notes: z.string().max(10000, "備考が長すぎます"),
  items: documentItemsSchema,
}).refine((value) => !value.issueDate || !value.dueDate || value.dueDate >= value.issueDate, { message: "期限は発行日以降にしてください", path: ["dueDate"] });

export const pdfTextSchema = z.object(Object.fromEntries(pdfTextFields.map((field) => [field.key, z.string().max(500, `${field.label}が長すぎます`).optional()]))).strict() as unknown as z.ZodType<InvoicePdfText>;

export const pdfDraftSchema = z.object({ layout: pdfLayoutSchema.optional(), text: pdfTextSchema.optional(), content: pdfContentSchema.optional() }).strict();
export type PdfDraft = z.infer<typeof pdfDraftSchema>;

export const pdfEditsSchema = z.object({ id: z.string().min(1), updatedAt: z.string().optional(), layout: pdfLayoutSchema, text: pdfTextSchema.optional(), content: pdfContentSchema.optional() }).strict();
export type PdfEditsInput = z.input<typeof pdfEditsSchema>;

const itemFieldLabels: Record<string, string> = { description: "名称", details: "詳細・内訳", quantity: "数量", unitPrice: "単価", taxRate: "税区分" };

// Zod's own wording is English; everything the dialog shows names the field that needs attention.
export function pdfIssueMessage(issue: { path: PropertyKey[]; message: string }) {
  // Requests nest the content one level deeper than the dialog's own check.
  const [root, index, field] = issue.path[0] === "content" ? issue.path.slice(1) : issue.path;
  if (root === "items" && typeof index === "number" && typeof field === "string") return `項目${index + 1}の${itemFieldLabels[field] ?? field}を確認してください`;
  return /[぀-ヿ一-鿿]/.test(issue.message) ? issue.message : "入力内容を確認してください";
}

export function pdfContentIssue(content: PdfContent, kind: PdfDocumentKind) {
  if (kind === "estimate" && (!content.issueDate || !content.dueDate)) return "見積日と有効期限を入力してください";
  const result = pdfContentSchema.safeParse(content);
  return result.success ? "" : pdfIssueMessage(result.error.issues[0]);
}

const sameItem = (a: DocumentItemInput, b: DocumentItemInput) => a.description.trim() === b.description.trim() && (a.details || "") === (b.details || "") && a.quantity === b.quantity && a.unitPrice === b.unitPrice && a.taxRate === b.taxRate;

export function samePdfContent(a: PdfContent, b: PdfContent) {
  return a.number.trim() === b.number.trim() && a.issueDate === b.issueDate && a.dueDate === b.dueDate && a.notes === b.notes
    && a.items.length === b.items.length && a.items.every((item, index) => sameItem(item, b.items[index]));
}

// Rewording or reordering lines must not touch the saved amounts, which may predate per-rate rounding.
export function pdfAmountsChanged(saved: (Pick<DocumentItemInput, "quantity" | "unitPrice" | "taxRate"> & { amount?: number })[], next: DocumentItemInput[]) {
  const signature = (item: Pick<DocumentItemInput, "quantity" | "unitPrice" | "taxRate">, amount: number) => `${item.quantity}|${item.unitPrice}|${item.taxRate}|${amount}`;
  const before = saved.map((item) => signature(item, item.amount ?? Math.round(item.quantity * item.unitPrice))).sort();
  const after = next.map((item) => signature(item, Math.round(item.quantity * item.unitPrice))).sort();
  return before.length !== after.length || before.some((value, index) => value !== after[index]);
}

// Only wording that differs from the standard text is kept, so later changes to a client name still apply.
export function normalizePdfText(text: InvoicePdfText | undefined, defaults: Record<InvoicePdfTextKey, string>): InvoicePdfText | undefined {
  const stored: InvoicePdfText = {};
  for (const field of pdfTextFields) {
    const value = text?.[field.key];
    if (value !== undefined && value !== defaults[field.key]) stored[field.key] = value;
  }
  return Object.keys(stored).length ? stored : undefined;
}
