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

export type ImportShipmentFields = Partial<Pick<ImportShipment, "permitNumber" | "permitDate" | "arrivalDate" | "supplierName" | "goodsValue" | "dutyAmount" | "importTaxNational" | "importTaxLocal" | "brokerFee">>;
export type ImportFillKey = keyof ImportShipmentFields | "brokerVendorId";
export const importFillLabels: Record<ImportFillKey, string> = {
  permitNumber: "許可番号", permitDate: "許可日", arrivalDate: "到着日", supplierName: "仕入先", goodsValue: "課税価格",
  dutyAmount: "関税", importTaxNational: "輸入消費税", importTaxLocal: "地方消費税", brokerFee: "通関手数料", brokerVendorId: "通関業者",
};
// What each paper is trusted to state: duty and tax come from the permit or the payment slip, never from a broker's own invoice lines.
export const importFillKeysByKind: Record<ImportDocumentKind, ImportFillKey[]> = {
  IMPORT_PERMIT: ["permitNumber", "permitDate", "arrivalDate", "supplierName", "goodsValue", "dutyAmount", "importTaxNational", "importTaxLocal"],
  TAX_PAYMENT: ["permitNumber", "dutyAmount", "importTaxNational", "importTaxLocal"],
  BROKER_INVOICE: ["permitNumber", "brokerFee", "brokerVendorId"],
  SUPPLIER_INVOICE: ["supplierName"], PACKING_LIST: ["supplierName"], WAYBILL: ["supplierName"], OTHER: [],
};

export function normalizePermitNumber(value: string) {
  return value.normalize("NFKC").toUpperCase().replace(/[\s-]/g, "");
}

function importDate(source: string, label: string) {
  const date = /(?:令和(元|\d{1,2})年\s*(\d{1,2})月\s*(\d{1,2})日|R(\d{1,2})[./-](\d{1,2})[./-](\d{1,2})|(\d{4})[./年-]\s*(\d{1,2})[./月-]\s*(\d{1,2})日?)/i;
  const match = source.match(new RegExp(`(?:${label})[^0-9]{0,12}?(${date.source})(?![0-9])`, "i"));
  if (!match) return undefined;
  const parts = match[1].match(date)!;
  const year = parts[1] ? 2018 + (parts[1] === "元" ? 1 : Number(parts[1])) : parts[4] ? 2018 + Number(parts[4]) : Number(parts[7]);
  const month = Number(parts[2] || parts[5] || parts[8]), day = Number(parts[3] || parts[6] || parts[9]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return year >= 1000 && parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
    ? parsed.toISOString().slice(0, 10) : undefined;
}

export function extractImportShipmentFields(text = "", fileName = ""): ImportShipmentFields {
  // Filenames help classification; only labelled document content supplies shipment fields.
  void fileName;
  const source = text.normalize("NFKC").replace(/[\u3000\t]/g, " ").replace(/\r\n?/g, "\n");
  const fields: ImportShipmentFields = {};
  const moneyLabels = {
    goodsValue: "課税価格|課税標準額|CIF価格",
    // A rate or a combined total ("関税等", "関税・消費税") is not the duty itself.
    dutyAmount: "関税額?(?!額?\\s*(?:率|等|・|、|及び|および))",
    importTaxNational: "(?<!地方)(?:内国消費税額?|輸入消費税額?|消費税額?)(?!額?\\s*(?:率|等|・|、|及び|および))",
    importTaxLocal: "地方消費税額?(?!額?\\s*(?:率|等|・|、|及び|および))",
    brokerFee: "通関料|通関手数料|取扱(?:手数)?料|通関業務料",
  } as const;
  for (const key of Object.keys(moneyLabels) as Array<keyof typeof moneyLabels>) {
    const pattern = new RegExp(`(?:${moneyLabels[key]})[^0-9]{0,12}?([0-9][0-9,]*(?:\\.[0-9]+)?)`, "gi");
    const seen = new Set<string>(), values: number[] = [];
    for (const match of source.matchAll(pattern)) {
      const value = Number(match[1].replace(/,/g, ""));
      if (!Number.isFinite(value)) continue;
      if (key === "brokerFee") {
        const start = source.lastIndexOf("\n", match.index - 1) + 1;
        const end = source.indexOf("\n", match.index + match[0].length);
        const line = `${source.slice(start, end < 0 ? undefined : end).trim()}:${match.index - start}`;
        if (seen.has(line)) continue;
        seen.add(line);
      }
      values.push(value);
    }
    if (values.length) fields[key] = key === "brokerFee" ? round(values.reduce((sum, value) => sum + value, 0)) : Math.max(...values);
  }
  const permit = source.match(/(?:輸入)?(?:申告|許可)番号[^0-9A-Z]{0,8}([0-9A-Z][0-9A-Z-]{5,19})(?![0-9A-Z-])/i)?.[1];
  if (permit) fields.permitNumber = permit.toUpperCase();
  const permitDate = importDate(source, "(?:輸入)?許可(?:年月)?日|許可日付");
  const arrivalDate = importDate(source, "(?:入港|到着|搬入)(?:年月)?日");
  if (permitDate) fields.permitDate = permitDate;
  if (arrivalDate) fields.arrivalDate = arrivalDate;
  const supplier = source.match(/(?:(?:仕出人|輸出者)(?:名称|名)?|Shipper(?:'s)?(?:\s*name)?|Exporter|Seller)[ ]*:?[ ]*([^\n]*)(?:\n([\s\S]*))?/i);
  if (supplier) {
    const cut = (value: string) => value.split(/輸入者|Importer|Consignee|住所|Address|コード|Code/i)[0].trim();
    const name = cut(supplier[1]) || cut(supplier[2]?.split("\n").find((line) => line.trim()) ?? "");
    if (name) fields.supplierName = name.slice(0, 80);
  }
  return fields;
}

export function fillImportShipment(row: ImportShipment, fields: ImportShipmentFields & { brokerVendorId?: string }, allowed?: ImportFillKey[]): ImportFillKey[] {
  const filled: ImportFillKey[] = [];
  for (const key of Object.keys(importFillLabels) as ImportFillKey[]) {
    if (allowed && !allowed.includes(key)) continue;
    const value = fields[key];
    if ((row[key] === undefined || row[key] === "") && value !== undefined && value !== "") {
      Object.assign(row, { [key]: value });
      filled.push(key);
    }
  }
  return filled;
}
