import type { PdfDocumentKind } from "@/lib/pdf-document-values";
import type { AppData, InvoicePdfText, InvoicePdfTextKey } from "@/lib/types";

export const invoiceIssuer = {
  name: "株式会社トライアングル.JP",
  registrationNumber: "T2010401133651",
  postalCode: "106-0031",
  address: "東京都港区西麻布3-20-9",
  building: "ハイネス麻布901",
  phone: "03-6260-9614",
  bank: "三菱UFJ銀行",
  branch: "六本木支店",
  accountType: "普通",
  accountNumber: "0683879",
  accountName: "カ)トライアングルドットジェーピー",
} as const;

export type PdfTextValues = Record<InvoicePdfTextKey, string>;

// The standard wording of a document, before anything chosen for this document.
export function pdfTextDefaults(document: { clientId: string; projectId: string; billingLabel?: string }, data: Pick<AppData, "clients" | "projects">, kind: PdfDocumentKind): PdfTextValues {
  const estimate = kind === "estimate";
  const title = estimate ? "見積書" : "請求書";
  const client = data.clients.find((c) => c.id === document.clientId);
  const project = data.projects.find((p) => p.id === document.projectId);
  return {
    title,
    recipient: `${client?.companyName || "請求先未設定"} 御中`,
    subject: [project?.name, document.billingLabel].filter(Boolean).join(" "),
    greeting: estimate ? "下記のとおりお見積もり申し上げます。" : "下記のとおりご請求申し上げます。",
    issuerName: invoiceIssuer.name,
    issuerPostalCode: `〒${invoiceIssuer.postalCode}`,
    issuerAddress: invoiceIssuer.address,
    issuerBuilding: invoiceIssuer.building,
    issuerPhone: `T.${invoiceIssuer.phone}`,
    issuerRegistration: `登録番号 ${invoiceIssuer.registrationNumber}`,
    bankLine: `${invoiceIssuer.bank}　${invoiceIssuer.branch}　${invoiceIssuer.accountType} ${invoiceIssuer.accountNumber}`,
    accountName: invoiceIssuer.accountName,
    feeNote: "振込手数料は貴社にてご負担をお願いいたします。",
    numberLabel: `${title}番号`,
    dateLabel: "DATE.",
    amountLabel: estimate ? "見積金額" : "合計金額",
    subjectLabel: "件名",
    descriptionHeader: "摘要",
    quantityHeader: "数量",
    unitPriceHeader: "単価",
    amountHeader: "金額",
    subtotalLabel: "税抜計",
    taxLabel: "消費税",
    totalLabel: "合計",
    notesLabel: "備考",
    bankLabel: "振込先",
    dueLabel: "お支払期限：",
    validityLabel: "見積有効期限：",
    continuedLabel: "（続き）",
  };
}

export function resolvePdfText(saved: InvoicePdfText | undefined, defaults: PdfTextValues): PdfTextValues {
  return { ...defaults, ...saved };
}
