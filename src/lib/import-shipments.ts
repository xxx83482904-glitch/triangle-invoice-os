import type { ImportDocumentKind, ImportFillKey, ImportOrder, ImportOrderItemKind, ImportShipment, ImportShipmentStatus, ImportStage } from "@/lib/types";
export type { ImportFillKey } from "@/lib/types";
export { todayInJapan as importToday } from "@/lib/dates";

// Client-safe part of the import board: labels, keyword detection and arithmetic. Store access lives in import-shipment-views.ts.
export const importDocumentKinds = ["PURCHASE_ORDER", "SUPPLIER_INVOICE", "PACKING_LIST", "WAYBILL", "IMPORT_PERMIT", "BROKER_INVOICE", "TAX_PAYMENT", "OTHER"] as const satisfies readonly ImportDocumentKind[];
export const importDocumentKindLabels: Record<ImportDocumentKind, string> = {
  PURCHASE_ORDER: "発注書",
  SUPPLIER_INVOICE: "仕入先インボイス", PACKING_LIST: "パッキングリスト", WAYBILL: "AWB・B/L", IMPORT_PERMIT: "輸入許可通知書",
  BROKER_INVOICE: "通関業者の請求書", TAX_PAYMENT: "関税・消費税の納付", OTHER: "その他",
};
// The paper trail one shipment should hold before it is closed; the permit is also the evidence for the import consumption tax.
export const importChecklistKinds: ImportDocumentKind[] = ["SUPPLIER_INVOICE", "PACKING_LIST", "WAYBILL", "IMPORT_PERMIT", "BROKER_INVOICE"];
// Import paperwork that is not an invoice to pay, so the mail sorter files it under 輸入・通関 instead of 請求書.
export const customsDocumentKinds: ImportDocumentKind[] = ["PURCHASE_ORDER", "IMPORT_PERMIT", "PACKING_LIST", "WAYBILL", "TAX_PAYMENT"];
export const importShipmentStatuses = ["OPEN", "CLEARED", "CLOSED"] as const satisfies readonly ImportShipmentStatus[];
export const importShipmentStatusLabels: Record<ImportShipmentStatus, string> = { OPEN: "書類待ち", CLEARED: "通関済み", CLOSED: "完了" };

export const defaultImportStages = [
  { key: "ORDER_RECEIVED", label: "発注受付" }, { key: "PRODUCTION", label: "製作" }, { key: "SHIPMENT", label: "出荷" },
  { key: "CUSTOMS", label: "通関" }, { key: "DELIVERY", label: "納品" },
] as const satisfies readonly ImportStage[];
export const importOrderItemKinds = [
  { value: "BAG", label: "袋" }, { value: "PRINTED", label: "印刷物" }, { value: "BOX", label: "箱" }, { value: "TEXTILE", label: "布製品" },
  { value: "LIGHTING", label: "照明" }, { value: "FURNITURE", label: "家具" }, { value: "OTHER", label: "その他" },
] as const satisfies readonly { value: ImportOrderItemKind; label: string }[];

export function importStageTimeline(stages: ImportStage[] | undefined, today: string) {
  const stored = new Map((stages ?? []).map((stage) => [stage.key, stage]));
  const defaults = new Set<string>(defaultImportStages.map((stage) => stage.key));
  const merged: ImportStage[] = [
    ...defaultImportStages.map((stage) => ({ ...stage, ...stored.get(stage.key) })),
    ...(stages ?? []).filter((stage) => !defaults.has(stage.key)),
  ];
  const entered = merged.some((stage) => Boolean(stage.startedAt || stage.plannedAt || stage.completedAt));
  const current = entered ? merged.find((stage) => !stage.completedAt)?.key : undefined;
  const scheduled = merged.find((stage) => !stage.completedAt && stage.plannedAt);
  // ISO calendar dates are compared at UTC midnight; today itself is supplied in JST.
  const daysLeft = scheduled ? Math.round((Date.parse(`${scheduled.plannedAt}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000) : 0;
  return {
    stages: merged.map((stage): ImportStage & { state: "DONE" | "CURRENT" | "UPCOMING" } => ({
      ...stage, state: stage.completedAt ? "DONE" : stage.key === current ? "CURRENT" : "UPCOMING",
    })),
    entered, current, allDone: merged.every((stage) => Boolean(stage.completedAt)),
    next: scheduled ? { key: scheduled.key, label: scheduled.label, date: scheduled.plannedAt!, daysLeft, overdue: daysLeft < 0 } : undefined,
  };
}

export function importRequestedDates(orders: ImportOrder[] | undefined) {
  const dates = [...new Set((orders ?? []).flatMap((order) => order.requestedDeliveryDate ? [order.requestedDeliveryDate] : []))].sort();
  const itemOverrides = (orders ?? []).flatMap((order) => order.items.flatMap((item) =>
    item.requestedDeliveryDate && item.requestedDeliveryDate !== order.requestedDeliveryDate
      ? [{ orderId: order.id, itemId: item.id, date: item.requestedDeliveryDate }] : []));
  return { dates, differs: new Set([...dates, ...itemOverrides.map((item) => item.date)]).size > 1, itemOverrides };
}

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
const brokerWords = /通関(料|手数料|業務|費用|代行)|輸入申告料|立替|customs (clearance|brokerage)|clearance fee/i;
const brokerContext = /輸入申告|輸入者|B\/L|AWB|税関|通関/i;
const importWords = /関税|輸入消費税|通関|税関/;
const kindPatterns: Array<[ImportDocumentKind, RegExp]> = [
  ["PURCHASE_ORDER", /(?:^|\n)\s*(?:発注書|注文書|purchase[ \t]+order)(?=$|[\s.:：_-])/i],
  ["IMPORT_PERMIT", /輸入許可通知書|輸入許可書|import permit/i],
  ["PACKING_LIST", /packing list|パッキングリスト|梱包明細/i],
  ["WAYBILL", /air waybill|\bAWB\b|bill of lading|\bB\/L\b|船荷証券|sea waybill/i],
  ["TAX_PAYMENT", /(関税|輸入消費税|税関).{0,20}納付|納付.{0,20}(関税|輸入消費税|税関)/],
  ["SUPPLIER_INVOICE", /commercial invoice|proforma invoice|incoterms|\bFOB\b|\bCIF\b|\bEXW\b|HS ?code|country of origin/i],
  ["BROKER_INVOICE", importWords],
];

export function detectImportDocument(text = "", fileName = ""): { kind: ImportDocumentKind; evidence: string } | undefined {
  const source = `${fileName}\n${text}`.normalize("NFKC");
  // A broker's invoice quotes the permit number, so the invoice signal wins over the permit words.
  if (invoiceWords.test(source) && brokerWords.test(source) && (importWords.test(source) || brokerContext.test(source))) return { kind: "BROKER_INVOICE", evidence: source.match(brokerWords)![0] };
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

export type ImportShipmentFields = Partial<Pick<ImportShipment, Exclude<ImportFillKey, "brokerVendorId">>>;
export const importFillLabels: Record<ImportFillKey, string> = {
  permitNumber: "許可番号", permitDate: "許可日", arrivalDate: "到着日", supplierName: "仕入先", goodsValue: "課税価格",
  dutyAmount: "関税", importTaxNational: "輸入消費税", importTaxLocal: "地方消費税", brokerFee: "通関手数料", brokerVendorId: "通関業者",
  blNumber: "B/L・AWB番号", invoiceNumber: "インボイス番号",
};
// What each paper is trusted to state: duty and tax come from the permit or the payment slip, never from a broker's own invoice lines.
export const importFillKeysByKind: Record<ImportDocumentKind, ImportFillKey[]> = {
  PURCHASE_ORDER: [],
  IMPORT_PERMIT: ["permitNumber", "permitDate", "arrivalDate", "supplierName", "goodsValue", "dutyAmount", "importTaxNational", "importTaxLocal", "blNumber", "invoiceNumber"],
  TAX_PAYMENT: ["permitNumber", "dutyAmount", "importTaxNational", "importTaxLocal"],
  BROKER_INVOICE: ["permitNumber", "blNumber", "brokerFee", "brokerVendorId"],
  SUPPLIER_INVOICE: ["supplierName", "invoiceNumber"], PACKING_LIST: ["supplierName", "invoiceNumber"], WAYBILL: ["supplierName", "blNumber"], OTHER: [],
};

// Reference numbers compare without case, width, spaces or punctuation, so "ｓｙｎ－０００１" and "SYN 0001" are one number.
export function normalizeReference(value: string) {
  return value.normalize("NFKC").toUpperCase().replace(/[\s\-/._]/g, "");
}
export const normalizePermitNumber = normalizeReference;

// Google Vision reads some kanji as their traditional forms; NFKC leaves those alone.
const glyphVariants: Record<string, string> = { "稅": "税", "內": "内", "戾": "戻", "產": "産", "藏": "蔵", "滯": "滞", "檢": "検", "點": "点", "關": "関" };
export function normalizeOcrLines(text = ""): string[] {
  return text.normalize("NFKC").replace(/[稅內戾產藏滯檢點關]/g, (glyph) => glyphVariants[glyph] ?? glyph).replace(/[\u3000\t]/g, " ")
    .split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

// Uploaded files are renamed on save, but the OCR text starts with the name the person gave the file.
export function documentDisplayName(ocrText = "", fallback = "") {
  const first = normalizeOcrLines(ocrText)[0] ?? "";
  return /\.(pdf|jpe?g|png)$/i.test(first) && first.length <= 120 ? first.replace(/^.*[\\/]/, "") : fallback;
}

export type ImportReferences = { declarationNumber?: string; blNumber?: string; invoiceNumber?: string; containerNumber?: string; shipperName?: string };

const shipperLabel = /(?:(?:仕出人|輸出者)(?:名称|名)?|Shipper(?:'s)?(?:\s*name)?|Exporter|Seller)[ ]*:?[ ]*/i;
const shipperStop = /輸入者|Importer|Consignee|住所|Address|コード|Code/i;
function readShipperName(lines: string[]) {
  const index = lines.findIndex((line) => shipperLabel.test(line));
  if (index < 0) return undefined;
  const cut = (value: string) => value.split(shipperStop)[0].trim();
  const same = cut(lines[index].replace(shipperLabel, ""));
  const name = same || cut(lines.slice(index + 1, index + 4).find((line) => /[A-Za-z一-龯ぁ-んァ-ヶ]{2,}/.test(line) && !shipperStop.test(line.slice(0, 4))) ?? "");
  return name ? name.slice(0, 80) : undefined;
}

// Tabular papers come out of OCR column by column, so a label's value may sit a few lines below it.
function valueNear(lines: string[], label: RegExp, reach: number, pick: (window: string) => string | undefined, stop?: RegExp) {
  for (let index = 0; index < lines.length; index += 1) {
    if (!label.test(lines[index])) continue;
    const below: string[] = [];
    for (const next of lines.slice(index + 1, index + 1 + reach)) {
      if (stop?.test(next)) break;
      below.push(next);
    }
    const value = pick([lines[index].replace(label, " "), ...below].join("\n"));
    if (value) return value;
  }
  return undefined;
}
const declarationLabel = /(?:輸入)?(?:申告|許可)番号/;
const blLabel = /B\/L\s*番号|B\/L\s*No\.?|\bBL\s*No\.?|AWB\s*No\.?|(?:HOUSE|MASTER)?\s*AIR\s*WAYBILL\s*(?:NO|NUMBER)|\bHAWB\b|\bMAWB\b|船荷証券番号/i;
const invoiceLabel = /仕入書番号|インボイス(?:番号|No)|INVOICE\s*(?:NO|NUMBER|#)|I\/V\s*No\.?|\bINV\.?\s*No\.?/i;
const datelike = /^\d{4}[/.-]\d{1,2}[/.-]\d{1,2}$/;
const otherReference = /(?:Container|Seal|Ref\.?|Job|Voy(?:age)?|Booking|Order|P\/?O)\s*(?:No|Number|#)/i;
const codeToken = (window: string, pattern: RegExp) => window.match(pattern)?.map((token) => token.trim()).find((token) => /\d/.test(token) && !datelike.test(token) && !/^(?:NO|BL|AWB|HAWB|MAWB)$/i.test(token));
// Transport numbers have shapes of their own: an ocean B/L is a carrier code and digits, an air waybill is 3 digits, a dash and 8 digits,
// a container is three letters, a category letter and 7 digits. On a bill of lading the number often sits lines away from its label.
const blContext = /B\/L|BILL OF LADING|WAYBILL|\bAWB\b|HAWB|MAWB|船荷証券/i;
const oceanBlToken = /^[A-Z]{3,4}\d[A-Z0-9]{7,15}$/;
const airWaybillToken = /^\d{3}-\d{8}$/;
const containerToken = /\b[A-Z]{3}[UJZ]\d{7}\b/;
function transportNumber(lines: string[]) {
  if (!lines.some((line) => blContext.test(line))) return undefined;
  const counts = new Map<string, number>();
  const words = [lines[0]?.replace(/\.[a-z0-9]+$/i, "") ?? "", ...lines.flatMap((line) => line.toUpperCase().split(/[\s:：,、()\[\]]+/))];
  for (const word of words) {
    if (!(oceanBlToken.test(word) || airWaybillToken.test(word)) || containerToken.test(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

export function readImportReferences(text = "", fileName = ""): ImportReferences {
  const lines = normalizeOcrLines(fileName + "\n" + text);
  const declarationNumber = valueNear(lines, declarationLabel, 12, (window) => {
    const naccs = window.match(/\d{3}[\s-]?\d{4}[\s-]?\d{4}(?!\d)/)?.[0];
    if (naccs) return naccs.replace(/\D/g, "");
    return window.split("\n").slice(0, 3).join("\n").match(/(?<![0-9A-Z])[0-9A-Z][0-9A-Z-]{5,19}(?![0-9A-Z-])/i)?.[0].toUpperCase();
  });
  const blNumber = valueNear(lines, blLabel, 6, (window) => codeToken(window.toUpperCase(), /\b(?:[A-Z]{2,6}[A-Z0-9-]{4,18}|\d{3}-\d{8})\b/g), new RegExp(invoiceLabel.source + "|" + otherReference.source, "i"))
    ?? transportNumber(lines);
  const invoiceNumber = valueNear(lines, invoiceLabel, 8, (window) => codeToken(window.toUpperCase(), /\b[A-Z0-9][A-Z0-9/-]{3,24}\b/g), new RegExp(blLabel.source + "|" + otherReference.source, "i"));
  const containerNumber = lines.join("\n").toUpperCase().match(containerToken)?.[0];
  const shipperName = readShipperName(lines);
  return { ...(declarationNumber ? { declarationNumber } : {}), ...(blNumber ? { blNumber } : {}), ...(invoiceNumber ? { invoiceNumber } : {}),
    ...(containerNumber ? { containerNumber } : {}), ...(shipperName ? { shipperName } : {}) };
}

const dateToken = /(?:令和(元|\d{1,2})年\s*(\d{1,2})月\s*(\d{1,2})日|R(\d{1,2})[./-](\d{1,2})[./-](\d{1,2})|(\d{4})[./年-]\s*(\d{1,2})[./月-]\s*(\d{1,2})日?)(?![0-9])/gi;
function isoDate(parts: RegExpMatchArray) {
  const year = parts[1] ? 2018 + (parts[1] === "元" ? 1 : Number(parts[1])) : parts[4] ? 2018 + Number(parts[4]) : Number(parts[7]);
  const month = Number(parts[2] || parts[5] || parts[8]), day = Number(parts[3] || parts[6] || parts[9]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return year >= 1000 && parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day ? parsed.toISOString().slice(0, 10) : undefined;
}

// Money on these papers carries a yen sign, a 円 suffix, thousands commas or a JPY prefix; bare numbers are codes, dates and rates.
const moneyToken = /[¥￥]\s?\d{1,3}(?:[,\s]{1,2}\d{3})*(?:\.\d+)?|[¥￥]\s?\d+(?:\.\d+)?|JPY\s?\d{1,3}(?:[,\s]{1,2}\d{3})*(?:\.\d+)?|\d{1,3}(?:,\s?\d{3})+(?:\.\d+)?(?:\s?円)?|\d+(?:\.\d+)?\s?円/gi;
function amountsIn(window: string): number[] {
  const values: number[] = [];
  for (const match of window.matchAll(moneyToken)) {
    const after = window.slice(match.index + match[0].length, match.index + match[0].length + 2);
    if (/^\s?%/.test(after) || /^[/-]\d/.test(after)) continue;
    const value = Number(match[0].replace(/[¥￥JPYjpy円,\s]/g, ""));
    if (Number.isFinite(value)) values.push(round(value));
  }
  return values;
}

// The text after a label: the rest of its line, then the lines below it up to the reach, stopping at the next label of the same family.
function windowsAfter(lines: string[], label: RegExp, reach: number, stop?: RegExp) {
  const windows: Array<{ index: number; offset: number; window: string }> = [];
  const every = new RegExp(label.source, label.flags.includes("g") ? label.flags : label.flags + "g");
  lines.forEach((line, index) => {
    for (const match of line.matchAll(every)) {
      const parts = [line.slice(match.index + match[0].length)];
      for (const next of lines.slice(index + 1, index + 1 + reach)) {
        if (stop?.test(next)) break;
        parts.push(next);
      }
      windows.push({ index, offset: match.index, window: parts.join("\n") });
    }
  });
  return windows;
}
const firstAmountNear = (lines: string[], label: RegExp, reach: number, stop?: RegExp) =>
  windowsAfter(lines, label, reach, stop).map(({ index, offset, window }) => ({ index, offset, window, value: amountsIn(window)[0] })).filter((entry) => entry.value !== undefined) as Array<{ index: number; offset: number; window: string; value: number }>;

function dateNear(lines: string[], label: RegExp, reach: number) {
  for (const { window } of windowsAfter(lines, label, reach, dateLabels)) {
    for (const match of window.matchAll(dateToken)) {
      const value = isoDate(match);
      if (value) return value;
    }
  }
  return undefined;
}
const dateLabels = /(?:申告|許可|入港|搬入|到着|作成|発行|請求|支払)(?:予定)?(?:年月)?日/;

// Rates and combined totals ("関税等", "関税・消費税") are not the amounts themselves.
const notAmount = "(?!額?\\s*(?:率|等|・|、|及び|および))";
const dutyLabel = new RegExp("関税額?" + notAmount);
const nationalLabel = new RegExp("(?<!地方)(?:内国消費税額?|輸入消費税額?|消費税額?)" + notAmount);
const localLabel = new RegExp("地方消費税額?" + notAmount);
const cifLabel = /申告価格\s*\(?\s*CIF\s*\)?/i;
const goodsLabel = /課税価格|課税標準額|CIF価格/i;
const feeLabel = /通関料|通関手数料|通関業務(?:手数)?料|取扱(?:手数)?料|輸入申告料/;

// NACCS permits and payment slips print the three taxes in one column and their figures in another, so labels and values do not
// sit together. The local consumption tax is the national one times 22/78, truncated to hundreds, which identifies the pair
// without labels; the duty is whatever remains of the tax total.
function readTaxesByArithmetic(lines: string[]) {
  if (!lines.some((line) => nationalLabel.test(line)) || !lines.some((line) => localLabel.test(line))) return undefined;
  const amounts = [...new Set(amountsIn(lines.join("\n")))];
  let best: { national: number; local: number } | undefined;
  for (const national of amounts) {
    if (national <= 0 || national % 100 !== 0) continue;
    const target = (national * 22) / 78;
    const local = amounts.filter((value) => value % 100 === 0 && target - value >= 0 && target - value < 400).sort((a, b) => b - a)[0];
    if (local === undefined || (local === 0 && target >= 100)) continue;
    if (!best || national > best.national) best = { national, local };
  }
  if (!best) return undefined;
  const base = best.national + best.local;
  const total = amounts.filter((value) => value >= base && (value === base || amounts.includes(round(value - base)))).sort((a, b) => a - b)[0];
  return { importTaxNational: best.national, importTaxLocal: best.local, ...(total === undefined ? {} : { dutyAmount: round(total - base) }) };
}

function readGoodsValue(lines: string[]) {
  const cif = firstAmountNear(lines, cifLabel, 6);
  if (cif.length) return round(cif.reduce((sum, entry) => sum + entry.value, 0));
  const entries = firstAmountNear(lines, goodsLabel, 3);
  if (!entries.length) return undefined;
  const total = entries.find((entry) => /合計/.test(entry.window.split("\n")[0]) || /合計/.test(lines[entry.index]));
  return total ? total.value : Math.max(...entries.map((entry) => entry.value));
}

function readBrokerFee(lines: string[]) {
  const seen = new Set<string>();
  let sum = 0, found = false;
  for (const entry of firstAmountNear(lines, feeLabel, 2)) {
    const key = lines[entry.index] + "|" + entry.offset + "|" + entry.value;
    if (seen.has(key)) continue;
    seen.add(key); sum += entry.value; found = true;
  }
  return found ? round(sum) : undefined;
}

export function extractImportShipmentFields(text = "", fileName = "", kind?: ImportDocumentKind): ImportShipmentFields {
  void kind;
  const lines = normalizeOcrLines(text);
  const references = readImportReferences(text, fileName);
  const fields: ImportShipmentFields = {};
  if (references.declarationNumber) fields.permitNumber = references.declarationNumber;
  if (references.blNumber) fields.blNumber = references.blNumber;
  if (references.invoiceNumber) fields.invoiceNumber = references.invoiceNumber;
  if (references.shipperName) fields.supplierName = references.shipperName;
  const permitDate = dateNear(lines, /(?:輸入)?許可(?:年月)?日|許可日付/, 3);
  const arrivalDate = dateNear(lines, /(?:入港|到着|搬入)(?:年月)?日/, 3);
  if (permitDate) fields.permitDate = permitDate;
  if (arrivalDate) fields.arrivalDate = arrivalDate;
  const goodsValue = readGoodsValue(lines);
  if (goodsValue !== undefined) fields.goodsValue = goodsValue;
  Object.assign(fields, readTaxesByArithmetic(lines));
  // Papers that print each tax beside its label still read the simple way.
  const labelled: Array<["dutyAmount" | "importTaxNational" | "importTaxLocal", RegExp]> = [["dutyAmount", dutyLabel], ["importTaxNational", nationalLabel], ["importTaxLocal", localLabel]];
  for (const [key, label] of labelled) {
    if (fields[key] !== undefined) continue;
    const entries = firstAmountNear(lines, label, 2);
    const beside = entries.filter((entry) => amountsIn(entry.window.split("\n")[0]).length);
    const chosen = beside.length ? beside : entries;
    if (chosen.length) fields[key] = Math.max(...chosen.map((entry) => entry.value));
  }
  const brokerFee = readBrokerFee(lines);
  if (brokerFee !== undefined) fields.brokerFee = brokerFee;
  return fields;
}

export function fillImportShipment(row: ImportShipment, fields: ImportShipmentFields & { brokerVendorId?: string }, allowed?: ImportFillKey[]): ImportFillKey[] {
  const filled: ImportFillKey[] = [];
  for (const key of Object.keys(importFillLabels) as ImportFillKey[]) {
    if (allowed && !allowed.includes(key)) continue;
    const value = fields[key];
    if ((row[key] === undefined || row[key] === "") && value !== undefined && value !== "") {
      Object.assign(row, { [key]: value });
      (row.fieldSources ??= {})[key] = "DOCUMENT";
      filled.push(key);
    }
  }
  return filled;
}
