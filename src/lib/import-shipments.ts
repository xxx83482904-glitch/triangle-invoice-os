import type { ImportDocumentKind, ImportShipment, ImportShipmentStatus } from "@/lib/types";

// Client-safe part of the import board: labels, keyword detection and arithmetic. Store access lives in import-shipment-views.ts.
export const importDocumentKinds = ["SUPPLIER_INVOICE", "PACKING_LIST", "WAYBILL", "IMPORT_PERMIT", "BROKER_INVOICE", "TAX_PAYMENT", "OTHER"] as const satisfies readonly ImportDocumentKind[];
export const importDocumentKindLabels: Record<ImportDocumentKind, string> = {
  SUPPLIER_INVOICE: "仕入先インボイス", PACKING_LIST: "パッキングリスト", WAYBILL: "AWB・B/L", IMPORT_PERMIT: "輸入許可通知書",
  BROKER_INVOICE: "通関業者の請求書", TAX_PAYMENT: "関税・消費税の納付", OTHER: "その他",
};
// The paper trail one shipment should hold before it is closed; the permit is also the evidence for the import consumption tax.
export const importChecklistKinds: ImportDocumentKind[] = ["SUPPLIER_INVOICE", "PACKING_LIST", "WAYBILL", "IMPORT_PERMIT", "BROKER_INVOICE"];
// Import paperwork that is not an invoice to pay, so the mail sorter files it under 輸入・通関 instead of 請求書.
export const customsDocumentKinds: ImportDocumentKind[] = ["IMPORT_PERMIT", "PACKING_LIST", "WAYBILL", "TAX_PAYMENT"];
export const importShipmentStatuses = ["OPEN", "CLEARED", "CLOSED"] as const satisfies readonly ImportShipmentStatus[];
export const importShipmentStatusLabels: Record<ImportShipmentStatus, string> = { OPEN: "書類待ち", CLEARED: "通関済み", CLOSED: "完了" };

export type ImportLinkedDocument = {
  key: string; source: "mail" | "received"; id: string; title: string; party: string; date: string; amount?: number;
  kind: ImportDocumentKind; suggestedKind?: ImportDocumentKind; evidence?: string; href: string; updatedAt: string; paid?: boolean;
};

export type ImportShipmentAmounts = {
  goodsValue: number; dutyAmount: number; importTaxNational: number; importTaxLocal: number; importTax: number;
  brokerFee: number; otherCost: number; costTotal: number; landedCost: number;
};

const round = (value: number) => Math.round(value * 100) / 100;
const amount = (value?: number) => Number.isFinite(value) ? round(value as number) : 0;

export function importShipmentAmounts(row: Pick<ImportShipment, "goodsValue" | "dutyAmount" | "importTaxNational" | "importTaxLocal" | "brokerFee" | "otherCost">): ImportShipmentAmounts {
  const goodsValue = amount(row.goodsValue), dutyAmount = amount(row.dutyAmount), importTaxNational = amount(row.importTaxNational);
  const importTaxLocal = amount(row.importTaxLocal), brokerFee = amount(row.brokerFee), otherCost = amount(row.otherCost);
  const importTax = round(importTaxNational + importTaxLocal);
  const costTotal = round(dutyAmount + importTax + brokerFee + otherCost);
  return { goodsValue, dutyAmount, importTaxNational, importTaxLocal, importTax, brokerFee, otherCost, costTotal, landedCost: round(goodsValue + costTotal) };
}

// Month tab: the person's own month first, then the permit or arrival date, then when the record was made.
export function importShipmentMonth(row: Pick<ImportShipment, "folderMonth" | "permitDate" | "arrivalDate" | "createdAt">) {
  return row.folderMonth || row.permitDate?.slice(0, 7) || row.arrivalDate?.slice(0, 7) || row.createdAt.slice(0, 7);
}

export function importChecklist(documents: ImportLinkedDocument[]) {
  return importChecklistKinds.map((kind) => ({ kind, label: importDocumentKindLabels[kind], documents: documents.filter((document) => document.kind === kind) }));
}

export function missingImportDocuments(documents: ImportLinkedDocument[]) {
  return importChecklist(documents).filter((entry) => !entry.documents.length).map((entry) => entry.kind);
}

// Keywords only suggest the kind; the person confirms it when attaching the document to a shipment.
const invoiceWords = /請求書|invoice/i;
const brokerWords = /通関(料|手数料|業務|費用|代行)|立替|customs (clearance|brokerage)|clearance fee/i;
const importWords = /関税|輸入消費税|通関|税関/;
const kindPatterns: Array<[ImportDocumentKind, RegExp]> = [
  ["IMPORT_PERMIT", /輸入許可通知書|輸入許可書|輸入(申告|許可)番号|import permit|輸入申告/i],
  ["PACKING_LIST", /packing list|パッキングリスト|梱包明細/i],
  ["WAYBILL", /air waybill|\bAWB\b|bill of lading|\bB\/L\b|船荷証券|sea waybill/i],
  ["TAX_PAYMENT", /(関税|輸入消費税|税関).{0,20}納付|納付.{0,20}(関税|輸入消費税|税関)/],
  ["SUPPLIER_INVOICE", /commercial invoice|proforma invoice|incoterms|\bFOB\b|\bCIF\b|\bEXW\b|HS ?code|country of origin/i],
  ["BROKER_INVOICE", importWords],
];

export function detectImportDocument(text = "", fileName = ""): { kind: ImportDocumentKind; evidence: string } | undefined {
  const source = `${fileName}\n${text}`.normalize("NFKC");
  // A broker's invoice quotes the permit number, so the invoice signal wins over the permit words.
  if (invoiceWords.test(source) && brokerWords.test(source) && importWords.test(source)) return { kind: "BROKER_INVOICE", evidence: source.match(brokerWords)![0] };
  for (const [kind, pattern] of kindPatterns) {
    const match = source.match(pattern);
    if (match) return { kind, evidence: match[0] };
  }
  return undefined;
}

export function suggestsCustomsCategory(text = "", fileName = "") {
  const detected = detectImportDocument(text, fileName);
  return Boolean(detected && customsDocumentKinds.includes(detected.kind));
}
