import assert from "node:assert/strict";
import test from "node:test";
import { detectImportDocument, extractImportShipmentFields, readImportReferences } from "../src/lib/import-shipments";
import { classifyMailDocument } from "../src/lib/ocr";

// Synthetic text in the shape OCR gives for a NACCS import permit: labels in one column, figures in another, spaces inside
// amounts, traditional glyphs, and date lines near tax labels. Every number and name is made up.
const naccsPermit = [
  "輸入許可通知書_20261005_12345678901.pdf", "<SEA/IMP>", "輸入許可通知書", "2026/10/05 11:31", "1 / 1",
  "申告年月日", "2026/10/04", "申告番号", "123 4567 8901", "申告予定年月日 2026/10/04 本申告 []", "代表稅番", "あて先税関",
  "B/L番号(1) SYNB1TKY260001A", "蔵置税関 OHI", "入港年月日 2026/10/01", "輸入者", "合成輸入デザイン株式会社", "仕出人", "SYNTHETIC FURNITURE CO., LTD.",
  "仕入書番号 SYN-INV-0091", "D 関税", "F 消費税", "A 地方消費税", "稅額合計", "¥0", "¥96,200", "¥27, 100", "0 納稅額合計", "¥123,300", "¥123,300",
  "税表番号 9403.60", "申告価格(CIF)", "¥1,234,567", "関税率 G FREE", "-内国消費税等(1)", "¥1,234,567", "税率 7.8%", "¥96,296",
  "-内国消費税等(2) 地方消費稅", "¥96,200", "¥27, 133", "関税法第67条の規定により、あなたが申告した貨物の輸入を許可します。",
  "輸入許可日 2026/10/05", "2027/01/04 A 地方消費税", "利用者整理番号16973",
].join("\n");

test("a NACCS permit read column by column yields the declaration number, dates, references and the three taxes", () => {
  assert.deepEqual(extractImportShipmentFields(naccsPermit, "輸入許可通知書_20261005_12345678901.pdf"), {
    permitNumber: "12345678901", blNumber: "SYNB1TKY260001A", invoiceNumber: "SYN-INV-0091", supplierName: "SYNTHETIC FURNITURE CO., LTD.",
    permitDate: "2026-10-05", arrivalDate: "2026-10-01", goodsValue: 1234567, importTaxNational: 96200, importTaxLocal: 27100, dutyAmount: 0,
  });
  assert.equal(detectImportDocument(naccsPermit)?.kind, "IMPORT_PERMIT");
  assert.equal(classifyMailDocument({ text: naccsPermit, engine: "test", warnings: [], confidence: 90 }).category, "CUSTOMS");
});

test("duty comes out of the tax total and several CIF lines add up", () => {
  const text = [
    "輸入許可通知書", "申告番号", "234 5678 9012", "D 関税", "F 消費税", "A 地方消費税", "税額合計", "¥37,000", "¥99,100", "¥27, 900", "¥164,000",
    "申告価格(CIF)", "¥1,270,000", "関税率 3.0%", "申告価格(CIF)", "¥20, 000", "輸入許可日", "2026/10/06",
  ].join("\n");
  assert.deepEqual(extractImportShipmentFields(text), { permitNumber: "23456789012", permitDate: "2026-10-06", goodsValue: 1290000, importTaxNational: 99100, importTaxLocal: 27900, dutyAmount: 37000 });
});

test("amounts survive OCR spacing and never come from rates, dates or code numbers", () => {
  assert.deepEqual(extractImportShipmentFields("課税価格 ¥2,422, 066\n関税額 ¥88, 800\n税率 7.8%\n2027/01/04\n利用者整理番号 16973\n税表番号 4901.99"), { goodsValue: 2422066, dutyAmount: 88800 });
  assert.deepEqual(extractImportShipmentFields("関税 10%\n消費税 7.8%\n2026/10/05 11:31"), {});
});

test("a payment slip with the taxes in one column reads the same way", () => {
  const text = "関税・輸入消費税の納付書 税関\n申告番号 345 6789 0123\n関税\n消費税\n地方消費税\n合計\n¥37,000\n¥99,100\n¥27,900\n¥164,000";
  assert.equal(detectImportDocument(text)?.kind, "TAX_PAYMENT");
  assert.deepEqual(extractImportShipmentFields(text), { permitNumber: "34567890123", importTaxNational: 99100, importTaxLocal: 27900, dutyAmount: 37000 });
});

test("a broker's invoice that mentions the declaration fee is an invoice, with its fees and the B/L number", () => {
  const text = [
    "請求書１_2626001234A.pdf", "請求書", "INVOICE", "請求番号: 2626001234A", "合成輸入デザイン株式会社 御中", "B/L No.", "SYNB1TKY260001A", "輸入者",
    "*立替*", "地方消費税", "消費税", "*課税*", "輸入申告料", "¥10,000", "通関料 ¥3,000", "取扱料 ¥1, 500", "立替金合計", "¥123,300", "合計", "¥145,300",
  ].join("\n");
  assert.equal(detectImportDocument(text)?.kind, "BROKER_INVOICE");
  assert.equal(classifyMailDocument({ text, engine: "test", warnings: [], confidence: 90 }).category, "INVOICE");
  const fields = extractImportShipmentFields(text);
  assert.equal(fields.brokerFee, 14500); assert.equal(fields.blNumber, "SYNB1TKY260001A");
  assert.deepEqual(readImportReferences(text), { blNumber: "SYNB1TKY260001A" });
  assert.equal(detectImportDocument("料金表 輸入申告料 10,000円"), undefined);
  assert.equal(detectImportDocument("輸入申告番号 12345678901 の控え"), undefined);
});

test("references are read from the labels papers actually carry, and the first OCR line names the file", () => {
  assert.deepEqual(readImportReferences("HOUSE BILL OF LADING\nExporter\nSYNTHETIC FURNITURE CO., LTD.\nLEVEL 9, SYNTHETIC ROAD\nConsignee\nB/L No.\nVESSEL / VOYAGE\nSYNB1TKY260001A\nTOTAL CARTONS: 334"),
    { blNumber: "SYNB1TKY260001A", shipperName: "SYNTHETIC FURNITURE CO., LTD." });
  assert.deepEqual(readImportReferences("PACKING LIST\nInvoice No. SYN-INV-0091\nShipper: Synthetic Furniture Co., Ltd.\nDate: 2026/09/20"), { invoiceNumber: "SYN-INV-0091", shipperName: "Synthetic Furniture Co., Ltd." });
  // A label whose value is elsewhere must not borrow the next reference's value.
  assert.deepEqual(readImportReferences("Ocean B/L No.\nVoy No.: 2610N\nI/V No.\nSYN-INV-0091\nContainer No: SYNU1234567"), { invoiceNumber: "SYN-INV-0091" });
  assert.deepEqual(readImportReferences("B/L No.\nSYNB1TKY260001A\nI/V No.\nSYN-INV-0091"), { blNumber: "SYNB1TKY260001A", invoiceNumber: "SYN-INV-0091" });
});
