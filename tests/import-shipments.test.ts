import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { admin, manager, timestamp } from "./document-fixture";
import { importGroupingFixture, importShipmentsFixture } from "./import-shipments-fixture";
import { appNavigation, navigationGroups } from "../src/lib/app-navigation";
import { detectImportDocument, extractImportShipmentFields, fillImportShipment, importFillLabels, importShipmentAmounts, importShipmentMonth, normalizePermitNumber, suggestsCustomsCategory, type ImportReferences } from "../src/lib/import-shipments";
import { applyImportShipmentFormFields, applyImportShipmentMutation, findImportShipmentByPermitNumber, findImportShipmentByReferences, groupImportDocuments, importMonthlySummary, importShipmentOptions, importShipmentViews, unassignedImportDocuments, type ImportBoardDocument } from "../src/lib/import-shipment-views";
import { classifyMailDocument } from "../src/lib/ocr";
import type { AppData, ImportShipment } from "../src/lib/types";

test("import keywords suggest the document kind without catching ordinary invoices or tax slips", () => {
  assert.equal(detectImportDocument("輸入許可通知書 輸入申告番号 123 関税額 1,000円")?.kind, "IMPORT_PERMIT");
  assert.equal(detectImportDocument("PACKING LIST 12 cartons")?.kind, "PACKING_LIST");
  assert.equal(detectImportDocument("HOUSE AIR WAYBILL 123-4567")?.kind, "WAYBILL");
  assert.equal(detectImportDocument("", "B/L copy.pdf")?.kind, "WAYBILL");
  assert.equal(detectImportDocument("御請求書 通関料 3,000円 関税 立替 15,000円 輸入許可番号 123")?.kind, "BROKER_INVOICE");
  assert.equal(detectImportDocument("COMMERCIAL INVOICE Incoterms FOB")?.kind, "SUPPLIER_INVOICE");
  assert.equal(detectImportDocument("関税・輸入消費税の納付書 税関")?.kind, "TAX_PAYMENT");
  assert.equal(detectImportDocument("請求書 消費税 10% 振込先 合成銀行"), undefined);
  assert.equal(detectImportDocument("法人税 納付書 合成税務署"), undefined);
  assert.equal(suggestsCustomsCategory("輸入許可通知書 関税額"), true);
  assert.equal(suggestsCustomsCategory("請求書 通関料 関税 立替"), false);
});

test("mail sorter files import paperwork under 輸入・通関 and keeps broker invoices as invoices", () => {
  const extracted = (text: string) => ({ text, engine: "test", warnings: [], confidence: 90 });
  assert.equal(classifyMailDocument(extracted("輸入許可通知書 輸入許可番号 合成-0001 関税額 15,000円 消費税額 40,000円 合計 55,000円 2026年10月5日")).category, "CUSTOMS");
  assert.equal(classifyMailDocument(extracted("PACKING LIST 12 cartons gross weight 120kg")).category, "CUSTOMS");
  assert.equal(classifyMailDocument(extracted("合成通関サービス 御請求書 通関料 3,000円 関税立替 15,000円 請求金額 18,000円 支払期限 2026年11月10日")).category, "INVOICE");
});

test("amounts and months follow the recorded figures", () => {
  const amounts = importShipmentAmounts({ goodsValue: 100000, dutyAmount: 1000.5, importTaxNational: 8000, importTaxLocal: 2256.4, brokerFee: 3000 });
  assert.equal(amounts.importTax, 10256.4); assert.equal(amounts.costTotal, 14256.9); assert.equal(amounts.landedCost, 114256.9); assert.equal(amounts.otherCost, 0);
  assert.equal(importShipmentMonth({ folderMonth: "2026-09", permitDate: "2026-10-05", createdAt: "2026-11-01T00:00:00.000Z" }), "2026-09");
  assert.equal(importShipmentMonth({ permitDate: "2026-10-05", createdAt: "2026-11-01T00:00:00.000Z" }), "2026-10");
  assert.equal(importShipmentMonth({ arrivalDate: "2026-10-30", createdAt: "2026-11-01T00:00:00.000Z" }), "2026-10");
  assert.equal(importShipmentMonth({ createdAt: "2026-11-01T00:00:00.000Z" }), "2026-11");
});

test("shipment views gather linked documents once, count missing paperwork and sort by month", () => {
  const data = importShipmentsFixture();
  const views = importShipmentViews(data, "JAPAN");
  assert.deepEqual(views.map((row) => row.id), ["ship-2", "ship-1", "ship-old"]);
  const first = views.find((row) => row.id === "ship-1")!;
  assert.equal(first.month, "2026-10"); assert.equal(first.projectName, "Japan project"); assert.equal(first.brokerName, "合成通関サービス");
  assert.deepEqual(first.documents.map((document) => document.key).sort(), ["mail:awb-1", "mail:packing-1", "mail:permit-1", "received:broker-1", "received:supplier-1"]);
  assert.deepEqual(first.recorded, { goodsValue: 500000, dutyAmount: 15000, importTaxNational: 40000, importTaxLocal: 11000, brokerFee: 22000, otherCost: undefined });
  assert.deepEqual(first.missing, []); assert.equal(first.importTax, 51000); assert.equal(first.costTotal, 88000); assert.equal(first.landedCost, 588000); assert.equal(first.unpaidCount, 2);
  assert.equal(first.documents.find((document) => document.key === "mail:packing-1")?.kind, "PACKING_LIST");
  const second = views.find((row) => row.id === "ship-2")!;
  assert.deepEqual(second.missing, ["SUPPLIER_INVOICE", "PACKING_LIST", "WAYBILL", "IMPORT_PERMIT"]);
  assert.equal(second.documents[0].kind, "BROKER_INVOICE");
  assert.deepEqual(importMonthlySummary(views).map((row) => [row.month, row.count, row.dutyAmount, row.importTax]), [["2026-10", 2, 20000, 62500], ["2026-09", 1, 1000, 0]]);
  assert.deepEqual(importShipmentOptions(data, "JAPAN").map((option) => option.value), ["ship-2", "ship-1", "ship-old"]);
  assert.equal(importShipmentViews(data, "CHINA").length, 0);
});

test("the unassigned list shows import-looking documents once and ignores other companies and plain receipts", () => {
  const documents = unassignedImportDocuments(importShipmentsFixture(), "JAPAN");
  assert.deepEqual(documents.map((document) => document.key).sort(), ["mail:packing-x", "mail:permit-3", "received:broker-3"]);
  const broker = documents.find((document) => document.key === "received:broker-3")!;
  assert.equal(broker.suggestedKind, "BROKER_INVOICE"); assert.equal(broker.paid, false); assert.equal(broker.amount, 45000);
  assert.equal(documents.find((document) => document.key === "mail:packing-x")?.suggestedKind, "PACKING_LIST");
  // A kind recorded on the document outranks keyword detection, so a plain invoice taken in as その他 is offered as that.
  const data = importShipmentsFixture(); data.receivedInvoices.find((invoice) => invoice.id === "gas-1")!.importDocumentKind = "OTHER";
  const plain = unassignedImportDocuments(data, "JAPAN").find((document) => document.key === "received:gas-1")!;
  assert.equal(plain.kind, "OTHER"); assert.equal(plain.suggestedKind, "OTHER");
});

test("mutations need manage:imports, check versions and leave invoice and mail content unchanged", () => {
  const data = importShipmentsFixture();
  assert.throws(() => applyImportShipmentMutation(data, manager, "JAPAN", { action: "create", title: "x" }), /権限/);
  const strip = (rows: AppData["receivedInvoices"]) => rows.map(({ importShipmentId: _s, importDocumentKind: _k, updatedAt: _u, ...rest }) => { void _s; void _k; void _u; return rest; });
  const before = structuredClone(strip(data.receivedInvoices));
  const created = applyImportShipmentMutation(data, admin, "JAPAN", { action: "create", title: "合成新便", projectId: "japan", brokerVendorId: "broker", permitDate: "2026-11-01", dutyAmount: 1200, folderMonth: "" });
  const row = data.importShipments!.find((item) => item.id === created.id)!;
  assert.equal(row.status, "OPEN"); assert.equal(row.folderMonth, undefined); assert.equal(row.dutyAmount, 1200); assert.equal(row.createdById, "admin");
  assert.throws(() => applyImportShipmentMutation(data, admin, "JAPAN", { action: "create", title: "x", projectId: "china" }), /案件/);
  assert.throws(() => applyImportShipmentMutation(data, admin, "JAPAN", { action: "create", title: "x", brokerVendorId: "missing" }), /通関業者/);
  assert.throws(() => applyImportShipmentMutation(data, admin, "JAPAN", { action: "create", title: "x", dutyAmount: -1 }), /0以上/);
  assert.throws(() => applyImportShipmentMutation(data, admin, "JAPAN", { action: "update", id: row.id, version: "stale", title: "y" }), /更新されています/);
  const updated = applyImportShipmentMutation(data, admin, "JAPAN", { action: "update", id: row.id, version: row.updatedAt, title: "合成新便 改", status: "CLEARED", memo: "  " });
  assert.equal(row.title, "合成新便 改"); assert.equal(row.dutyAmount, undefined); assert.equal(row.status, "CLEARED"); assert.equal(row.memo, undefined); assert.equal(row.updatedAt, updated.updatedAt);

  const assigned = applyImportShipmentMutation(data, admin, "JAPAN", { action: "assign", shipmentId: row.id, source: "mail", documentId: "permit-3" });
  assert.equal(assigned.action, "assign");
  const permit = data.mailDocuments.find((mail) => mail.id === "permit-3")!;
  assert.equal(permit.importShipmentId, row.id); assert.equal(permit.importDocumentKind, "IMPORT_PERMIT"); assert.equal(assigned.kind, "IMPORT_PERMIT");
  assert.equal(row.permitNumber, "SYN-0003"); assert.equal(row.dutyAmount, 3000);
  applyImportShipmentMutation(data, admin, "JAPAN", { action: "assign", shipmentId: row.id, source: "received", documentId: "broker-3", kind: "BROKER_INVOICE" });
  const view = importShipmentViews(data, "JAPAN").find((item) => item.id === row.id)!;
  assert.equal(view.documents.length, 2); assert.deepEqual(view.missing, ["SUPPLIER_INVOICE", "PACKING_LIST", "WAYBILL"]);
  assert.throws(() => applyImportShipmentMutation(data, admin, "JAPAN", { action: "assign", shipmentId: "ship-deleted", source: "mail", documentId: "permit-3" }), /輸入便/);
  assert.throws(() => applyImportShipmentMutation(data, admin, "JAPAN", { action: "assign", shipmentId: row.id, source: "mail", documentId: "china-permit" }), /郵便物/);
  applyImportShipmentMutation(data, admin, "JAPAN", { action: "assign", shipmentId: null, source: "mail", documentId: "permit-3" });
  assert.equal(permit.importShipmentId, undefined); assert.equal(permit.importDocumentKind, "IMPORT_PERMIT");

  applyImportShipmentMutation(data, admin, "JAPAN", { action: "delete", id: row.id, version: row.updatedAt });
  assert.ok(row.deletedAt); assert.equal(data.receivedInvoices.find((invoice) => invoice.id === "broker-3")!.importShipmentId, undefined);
  assert.ok(unassignedImportDocuments(data, "JAPAN").some((document) => document.key === "received:broker-3"));
  assert.equal(importShipmentViews(data, "JAPAN").some((item) => item.id === row.id), false);
  assert.deepEqual(strip(data.receivedInvoices), before);
});

test("import fields read labelled amounts on one line and keep national and local tax separate", () => {
  assert.deepEqual(extractImportShipmentFields("関税額 15,000円 消費税額 ¥40,000 地方消費税額 11,000円 課税価格 500,000"), {
    dutyAmount: 15000, importTaxNational: 40000, importTaxLocal: 11000, goodsValue: 500000,
  });
  assert.deepEqual(extractImportShipmentFields("地方消費税額 11,000円"), { importTaxLocal: 11000 });
  assert.deepEqual(extractImportShipmentFields(), {});
});

test("import fields read amounts on the following line and normalize full width text", () => {
  assert.deepEqual(extractImportShipmentFields("課税標準額\n合計 (円)\n500,000\n関税\n15,000円\n内国消費税額\n40,000\n地方消費税\n11,000"), {
    goodsValue: 500000, dutyAmount: 15000, importTaxNational: 40000, importTaxLocal: 11000,
  });
  assert.deepEqual(extractImportShipmentFields("ＣＩＦ価格：ＪＰＹ５００，０００．５０\n関税額：￥１５，０００\n輸入消費税額：４０，０００円\n地方消費税額：１１，０００円"), {
    goodsValue: 500000.5, dutyAmount: 15000, importTaxNational: 40000, importTaxLocal: 11000,
  });
});

test("import dates accept Japanese eras, Gregorian separators, and arrival labels", () => {
  for (const date of ["令和8年10月5日", "2026/10/05", "2026-10-05", "2026.10.5", "2026年10月5日", "R8.10.5"]) {
    assert.deepEqual(extractImportShipmentFields(`輸入許可年月日：${date}\n入港日 2026/10/01`), { permitDate: "2026-10-05", arrivalDate: "2026-10-01" }, date);
  }
  assert.equal(extractImportShipmentFields("許可日付 R6.10.5").permitDate, "2024-10-05");
  assert.equal(extractImportShipmentFields("許可日 令和1年5月1日").permitDate, "2019-05-01");
  assert.equal(extractImportShipmentFields("到着年月日 2026.10.2").arrivalDate, "2026-10-02");
  assert.equal(extractImportShipmentFields("搬入日 2026年10月3日").arrivalDate, "2026-10-03");
  assert.deepEqual(extractImportShipmentFields("許可日 2026/02/30\n入港日 2026/13/01"), {});
});

test("import amounts choose the maximum, retain exemption zeros and exclude tax rate labels", () => {
  assert.deepEqual(extractImportShipmentFields("課税価格 120,000\n課税価格 180,000\n課税価格 合計 300,000\n関税額 0円"), { goodsValue: 300000, dutyAmount: 0 });
  assert.deepEqual(extractImportShipmentFields("関税率 10%\n消費税率 7.8%\n輸入消費税率 10%\n地方消費税率 2.2%"), {});
  assert.equal(detectImportDocument("請求書 消費税 10% 合計 110,000円 振込先"), undefined);
});

test("broker charges sum distinct lines and count a repeated line only once", () => {
  assert.equal(extractImportShipmentFields("通関料 3,000円\n取扱料 2,000円\n通関料 3,000円").brokerFee, 5000);
  assert.equal(extractImportShipmentFields("通関手数料\n3,000円\n取扱手数料\n2,000円\n通関手数料\n3,000円").brokerFee, 5000);
  assert.equal(extractImportShipmentFields("通関業務料 1,000円 取扱料 JPY2,000.50").brokerFee, 3000.5);
});

test("supplier names use the label line or next nonempty line and stop at recipient or address labels", () => {
  assert.equal(extractImportShipmentFields("仕出人: 合成海外家具廠").supplierName, "合成海外家具廠");
  assert.equal(extractImportShipmentFields("輸出者：\n\n合成海外家具廠\n住所: 合成住所").supplierName, "合成海外家具廠");
  for (const label of ["Shipper", "Exporter", "Seller"]) assert.equal(extractImportShipmentFields(`${label}: Synthetic Company Address: Synthetic Street`).supplierName, "Synthetic Company");
  assert.equal(extractImportShipmentFields("仕出人 合成海外家具廠 輸入者 合成輸入社").supplierName, "合成海外家具廠");
  assert.equal(extractImportShipmentFields("仕出人:\n住所: 合成住所").supplierName, undefined);
  assert.equal(extractImportShipmentFields(`仕出人: ${"合".repeat(90)}`).supplierName?.length, 80);
});

test("permit numbers use ASCII after NFKC and normalize case, spaces and hyphens for matching", () => {
  assert.equal(extractImportShipmentFields("申告番号：\nｓｙｎ－０００１").permitNumber, "SYN-0001");
  assert.equal(extractImportShipmentFields("輸入許可番号: syn-0002").permitNumber, "SYN-0002");
  assert.equal(normalizePermitNumber(" ｓｙｎ－０００１ "), "SYN0001");
  assert.equal(normalizePermitNumber("syn - 0001"), "SYN0001");
  assert.deepEqual(extractImportShipmentFields("許可番号 12345"), {});
});

test("fillImportShipment writes only empty fields and reports exactly the changed keys", () => {
  const row = importShipmentsFixture().importShipments![0];
  row.permitNumber = ""; row.dutyAmount = 0; delete row.arrivalDate;
  const filled = fillImportShipment(row, { permitNumber: "SYN-0009", arrivalDate: "2026-10-01", dutyAmount: 15000, supplierName: "上書きしない", brokerVendorId: "other", goodsValue: 1 });
  assert.deepEqual(filled, ["permitNumber", "arrivalDate"]);
  assert.equal(row.dutyAmount, 0); assert.equal(row.supplierName, "合成海外家具廠"); assert.equal(row.goodsValue, 500000); assert.equal(row.brokerVendorId, "broker");
  assert.deepEqual(fillImportShipment(row, { permitNumber: "", brokerFee: undefined }), []);
  row.brokerVendorId = "";
  assert.deepEqual(fillImportShipment(row, { brokerVendorId: "synthetic-broker" }), ["brokerVendorId"]);
});

test("assign fills empty shipment fields by default, can opt out, and changes the shipment version only on fill", () => {
  const data = importShipmentsFixture(), row = data.importShipments!.find((item) => item.id === "ship-2")!;
  const before = row.updatedAt;
  const input = { action: "assign" as const, shipmentId: row.id, source: "mail" as const, documentId: "permit-3" };
  const skipped = applyImportShipmentMutation(data, admin, "JAPAN", { ...input, fill: false });
  assert.deepEqual(skipped.filled, []); assert.equal(row.permitNumber, undefined); assert.equal(row.updatedAt, before);
  const assigned = applyImportShipmentMutation(data, admin, "JAPAN", input);
  assert.deepEqual(assigned.filled, ["permitNumber"]); assert.equal(row.permitNumber, "SYN-0003"); assert.equal(row.dutyAmount, 5000); assert.notEqual(row.updatedAt, before);
  const filledVersion = row.updatedAt;
  assert.deepEqual(applyImportShipmentMutation(data, admin, "JAPAN", input).filled, []); assert.equal(row.updatedAt, filledVersion);
  assert.deepEqual(applyImportShipmentMutation(data, admin, "JAPAN", { ...input, shipmentId: null }).filled, []); assert.equal(row.updatedAt, filledVersion);
});

test("assign uses invoice vendors for broker and supplier candidates and never fills OTHER documents", () => {
  const data = importShipmentsFixture(), row = data.importShipments!.find((item) => item.id === "ship-old")!;
  const broker = applyImportShipmentMutation(data, admin, "JAPAN", { action: "assign", shipmentId: row.id, source: "received", documentId: "broker-3", kind: "BROKER_INVOICE" });
  assert.equal(row.brokerVendorId, "broker"); assert.deepEqual(broker.filled, ["brokerVendorId"]);
  const supplier = applyImportShipmentMutation(data, admin, "JAPAN", { action: "assign", shipmentId: row.id, source: "received", documentId: "supplier-1", kind: "SUPPLIER_INVOICE" });
  assert.equal(row.supplierName, "合成海外家具廠"); assert.deepEqual(supplier.filled, ["supplierName"]);
  const other = applyImportShipmentMutation(data, admin, "JAPAN", { action: "assign", shipmentId: row.id, source: "mail", documentId: "permit-3", kind: "OTHER" });
  assert.equal(row.permitNumber, undefined); assert.deepEqual(other.filled, []);
  const plain = data.receivedInvoices.find((invoice) => invoice.id === "gas-1")!;
  plain.ocrText = "請求書 消費税 10% 合計 110,000円 振込先";
  assert.deepEqual(applyImportShipmentMutation(data, admin, "JAPAN", { action: "assign", shipmentId: row.id, source: "received", documentId: plain.id }).filled, []);
});

test("each kind of paper fills only the fields it is trusted for, and combined tax totals are not amounts", () => {
  const data = importShipmentsFixture(), row = data.importShipments!.find((item) => item.id === "ship-old")!;
  const broker = data.receivedInvoices.find((invoice) => invoice.id === "broker-3")!;
  broker.ocrText = "合成通関サービス 請求書 申告番号 SYN-0077 通関料 3,000円 消費税 10% 300円 関税 立替 15,000円 輸入消費税 立替 40,000円";
  const result = applyImportShipmentMutation(data, admin, "JAPAN", { action: "assign", shipmentId: row.id, source: "received", documentId: "broker-3", kind: "BROKER_INVOICE" });
  assert.deepEqual(result.filled, ["permitNumber", "brokerFee", "brokerVendorId"]);
  assert.equal(row.permitNumber, "SYN-0077"); assert.equal(row.brokerFee, 3000); assert.equal(row.importTaxNational, undefined); assert.equal(row.dutyAmount, 1000);
  assert.deepEqual(fillImportShipment({ ...row, permitNumber: undefined, brokerFee: undefined }, { permitNumber: "X", goodsValue: 5 }, ["goodsValue"]), ["goodsValue"]);
  assert.deepEqual(extractImportShipmentFields("関税・消費税等 55,000円\n関税額等 55,000円\n関税額 15,000円"), { dutyAmount: 15000 });
  assert.deepEqual(extractImportShipmentFields("消費税等 4,000円 地方消費税及び 1,000円"), {});
  assert.equal(extractImportShipmentFields("仕出人名 合成海外家具廠\n仕出人コード 12345").supplierName, "合成海外家具廠");
  assert.equal(extractImportShipmentFields("Shipper's name: Synthetic Furniture Co., Ltd.").supplierName, "Synthetic Furniture Co., Ltd.");
});

test("the OCR placeholder payee never becomes a shipment's broker", () => {
  const data = importShipmentsFixture(), row = data.importShipments!.find((item) => item.id === "ship-old")!;
  data.vendors.push({ id: "ocr-review-vendor-japan", companyName: "日本 OCR未確認支払先", company: "JAPAN", createdAt: timestamp, updatedAt: timestamp });
  data.receivedInvoices.find((invoice) => invoice.id === "broker-3")!.vendorId = "ocr-review-vendor-japan";
  const result = applyImportShipmentMutation(data, admin, "JAPAN", { action: "assign", shipmentId: row.id, source: "received", documentId: "broker-3", kind: "BROKER_INVOICE" });
  assert.equal(row.brokerVendorId, undefined); assert.deepEqual(result.filled, []);
});

test("permit matching ignores punctuation, case and width but excludes deleted shipments and other companies", () => {
  const data = importShipmentsFixture();
  data.importShipments![0].permitNumber = "ＳＹＮ－０００１";
  assert.equal(findImportShipmentByPermitNumber(data, "JAPAN", "syn 0001")?.id, "ship-1");
  assert.equal(findImportShipmentByPermitNumber(data, "CHINA", "SYN-0001"), undefined);
  data.importShipments!.find((row) => row.id === "ship-deleted")!.permitNumber = "SYN-9999";
  assert.equal(findImportShipmentByPermitNumber(data, "JAPAN", "syn9999"), undefined);
  assert.equal(findImportShipmentByPermitNumber(data, "JAPAN", ""), undefined);
  assert.equal(findImportShipmentByPermitNumber(data, "JAPAN", " - "), undefined);
});

test("mail and received invoice forms set or clear the shipment link only when the field is present", () => {
  const data = importShipmentsFixture(); const invoice = data.receivedInvoices.find((row) => row.id === "gas-1")!;
  applyImportShipmentFormFields(data, new FormData(), invoice); assert.equal(invoice.importShipmentId, undefined);
  const form = new FormData(); form.set("importShipmentId", "ship-2"); form.set("importDocumentKind", "OTHER");
  applyImportShipmentFormFields(data, form, invoice); assert.equal(invoice.importShipmentId, "ship-2"); assert.equal(invoice.importDocumentKind, "OTHER");
  form.set("importShipmentId", "ship-deleted"); assert.throws(() => applyImportShipmentFormFields(data, form, invoice), /輸入便/);
  form.set("importShipmentId", ""); form.set("importDocumentKind", ""); applyImportShipmentFormFields(data, form, invoice);
  assert.equal(invoice.importShipmentId, undefined); assert.equal(invoice.importDocumentKind, undefined);
});

test("the import board sits beside received invoices for accounting roles only", () => {
  assert.ok(appNavigation.flatMap((group) => group.items).some((item) => item.href === "/imports"));
  for (const role of ["ADMIN", "ACCOUNTING", "CHIEF_DESIGNER"] as const) assert.ok(navigationGroups(role).flatMap((group) => group.items).some((item) => item.href === "/imports"), role);
  for (const role of ["MAIL_EDITOR", "BILLING_EDITOR", "PROJECT_MANAGER", "DESIGNER"] as const) assert.equal(navigationGroups(role).flatMap((group) => group.items).some((item) => item.href === "/imports"), false, role);
});

function boardDocument(id: string, references: ImportReferences = {}, extra: Partial<ImportBoardDocument> = {}): ImportBoardDocument {
  return { key: `mail:${id}`, id, source: "mail", title: `${id}-saved.pdf`, displayName: `${id}.pdf`, party: "合成荷主", date: "2026-10-01",
    kind: "OTHER", href: "/mail-sorter?company=JAPAN", updatedAt: timestamp, references, ...extra };
}

function matchingShipment(id: string, extra: Partial<ImportShipment> = {}): ImportShipment {
  return { id, company: "JAPAN", title: `合成便 ${id}`, status: "OPEN", createdById: "admin", createdAt: timestamp, updatedAt: timestamp, folderMonth: "2026-10", ...extra };
}

test("strong references join transitive B/L, invoice and declaration chains without mutating input", () => {
  const documents = [
    boardDocument("waybill", { blNumber: "ＳＹＮ－ＢＬ０００１" }, { kind: "WAYBILL" }),
    boardDocument("broker", { blNumber: "syn/bl.0001", declarationNumber: "SYN-D0001" }, { kind: "BROKER_INVOICE" }),
    boardDocument("permit", { declarationNumber: "syn d0001", invoiceNumber: "SYN-INV001" }, { kind: "IMPORT_PERMIT" }),
    boardDocument("supplier", { invoiceNumber: "syn/inv001" }, { kind: "SUPPLIER_INVOICE" }),
    boardDocument("packing", { invoiceNumber: "SYN.INV001" }, { kind: "PACKING_LIST" }),
  ];
  const before = structuredClone(documents), groups = groupImportDocuments(documents, []);
  assert.equal(groups.length, 1); assert.equal(groups[0].hasPermit, true); assert.equal(groups[0].weak, false);
  assert.deepEqual(groups[0].documents.map((document) => document.id), ["supplier", "packing", "waybill", "permit", "broker"]);
  assert.equal(groups[0].key, "mail:supplier"); assert.equal(groups[0].blNumber, "ＳＹＮ－ＢＬ０００１");
  assert.deepEqual(documents, before);
  assert.equal(groupImportDocuments([...documents].reverse(), [])[0].key, groups[0].key);
  assert.equal(groupImportDocuments([boardDocument("bl", { blNumber: "SYN-0001" }), boardDocument("inv", { invoiceNumber: "SYN-0001" })], []).length, 2);
});

test("shipper-only documents join a unique group within 45 days but stay alone with two candidates or a 46-day gap", () => {
  const first = boardDocument("first", { blNumber: "SYN-BL001", shipperName: "合成家具株式会社" });
  const weak = boardDocument("weak", { shipperName: "合成家具" }, { date: "2026-11-15" });
  const joined = groupImportDocuments([weak, first], []);
  assert.equal(joined.length, 1); assert.equal(joined[0].documents.length, 2); assert.equal(joined[0].weak, true);
  const second = boardDocument("second", { blNumber: "SYN-BL002", shipperName: "合成家具" });
  const ambiguous = groupImportDocuments([first, weak, second], []);
  assert.equal(ambiguous.length, 3); assert.equal(ambiguous.find((group) => group.key === weak.key)?.weak, true);
  assert.equal(groupImportDocuments([first, { ...weak, date: "2026-11-16" }], []).length, 2);
  assert.equal(groupImportDocuments([first, second], []).length, 2);
  assert.equal(groupImportDocuments([boardDocument("same", { shipperName: "合成家具" }), weak], []).length, 1);
});

test("corporate name affixes normalize and short or absent names never act as weak keys", () => {
  for (const suffix of ["Co., Ltd.", "LIMITED", "LTD", "INC.", "CORPORATION", "CORP", "COMPANY", "GMBH", "PTE LTD", "LLC", "S.A."]) {
    const groups = groupImportDocuments([boardDocument("strong", { blNumber: "SYN-BL001", shipperName: `SYNTHETIC FURNITURE ${suffix}` }), boardDocument("weak", { shipperName: "synthetic furniture" })], []);
    assert.equal(groups.length, 1, suffix);
  }
  for (const affix of ["株式会社", "有限会社", "合同会社"]) {
    assert.equal(groupImportDocuments([boardDocument("first", { shipperName: `${affix}合成家具` }), boardDocument("second", { shipperName: `合成家具${affix}` })], []).length, 1);
  }
  assert.equal(groupImportDocuments([boardDocument("a", { shipperName: "AB Inc." }), boardDocument("b", { shipperName: "AB" })], []).length, 2);
  assert.equal(groupImportDocuments([boardDocument("a"), boardDocument("b")], []).length, 2);
});

test("groups match existing shipments by declaration, B/L and invoice references in that order", () => {
  const shipments = [matchingShipment("invoice", { invoiceNumber: "SYN-INV001" }), matchingShipment("bl", { blNumber: "SYN-BL001" }), matchingShipment("permit", { permitNumber: "SYN-D0001" })];
  const references = { declarationNumber: "ｓｙｎ／ｄ０００１", blNumber: "syn bl001", invoiceNumber: "syn.inv001" };
  assert.deepEqual(groupImportDocuments([boardDocument("doc", references)], shipments)[0].shipment, { id: "permit", title: "合成便 permit" });
  assert.equal(groupImportDocuments([boardDocument("doc", { ...references, declarationNumber: "missing" })], shipments)[0].shipment?.id, "bl");
  assert.equal(groupImportDocuments([boardDocument("doc", { invoiceNumber: references.invoiceNumber })], shipments)[0].shipment?.id, "invoice");
  assert.equal(groupImportDocuments([boardDocument("doc", references)], shipments.map((row) => ({ ...row, deletedAt: timestamp })))[0].shipment, undefined);
});

test("shipper and shipment month suggest only one live shipment within 45 days", () => {
  const document = boardDocument("weak", { shipperName: "合成家具株式会社" }, { date: "2026-11-15" });
  const shipment = matchingShipment("first", { supplierName: "合成家具" });
  assert.equal(groupImportDocuments([document], [shipment])[0].shipment?.id, shipment.id);
  const strongDocument = boardDocument("strong", { blNumber: "SYN-BL001", shipperName: "合成家具" });
  assert.equal(groupImportDocuments([strongDocument], [shipment])[0].weak, true);
  assert.equal(groupImportDocuments([strongDocument], [{ ...shipment, blNumber: "SYN-BL001" }])[0].weak, false);
  assert.equal(groupImportDocuments([{ ...document, date: "2026-11-16" }], [shipment])[0].shipment, undefined);
  assert.equal(groupImportDocuments([document], [shipment, { ...shipment, id: "second" }])[0].shipment, undefined);
  assert.equal(groupImportDocuments([document], [shipment, { ...shipment, id: "deleted", deletedAt: timestamp }])[0].shipment?.id, shipment.id);
  assert.equal(groupImportDocuments([boardDocument("empty")], [matchingShipment("empty")])[0].shipment, undefined);
});

test("group titles use B/L, invoice or latest date and groups and documents keep their specified order", () => {
  const documents = [
    boardDocument("waybill", { blNumber: "SYN-BL001", shipperName: "合成家具" }, { kind: "WAYBILL", date: "2026-09-01" }),
    boardDocument("packing-late", { blNumber: "SYN-BL001" }, { kind: "PACKING_LIST", date: "2026-10-03" }),
    boardDocument("packing-early", { blNumber: "SYN-BL001" }, { kind: "PACKING_LIST", date: "2026-10-02" }),
    boardDocument("invoice", { invoiceNumber: "SYN-INV001" }, { date: "2026-11-01" }),
    boardDocument("empty", {}, { date: "2026-12-01" }),
  ];
  const groups = groupImportDocuments(documents, []);
  assert.deepEqual(groups.map((group) => group.suggestedTitle), ["輸入便 2026-12-01", "輸入便 INV SYN-INV001", "合成家具 B/L SYN-BL001"]);
  assert.deepEqual(groups[2].documents.map((document) => document.id), ["packing-early", "packing-late", "waybill"]);
  assert.equal(groups[2].latestDate, "2026-10-03"); assert.equal(groups.every((group) => !group.hasPermit), true);
  assert.equal(groupImportDocuments([boardDocument("long", { shipperName: "合".repeat(210) })], [])[0].suggestedTitle.length, 200);
  assert.deepEqual(groupImportDocuments([], []), []);
});

test("document views expose original display names and references with titles as fallback", () => {
  const data = importGroupingFixture(), unassigned = unassignedImportDocuments(data, "JAPAN");
  const bl = unassigned.find((document) => document.id === "bl-9")!;
  assert.equal(bl.displayName, "合成B-L原本.pdf"); assert.equal(bl.title, "合成B/L 保存書類"); assert.equal(bl.references.blNumber, "SYN1BL260001");
  assert.equal(unassigned.find((document) => document.id === "supplier-9")?.displayName, "合成仕入原本.pdf");
  assert.equal(unassigned.find((document) => document.id === "packing-x")?.displayName, "梱包明細");
  const mail = data.mailDocuments.find((row) => row.id === "bl-9")!; mail.importShipmentId = "ship-2";
  const invoice = data.receivedInvoices.find((row) => row.id === "supplier-9")!; invoice.importShipmentId = "ship-2";
  const view = importShipmentViews(data, "JAPAN").find((row) => row.id === "ship-2")!;
  assert.equal(view.documents.find((document) => document.id === mail.id)?.displayName, "合成B-L原本.pdf");
  assert.equal(view.checklist.find((entry) => entry.kind === "SUPPLIER_INVOICE")?.documents[0].references.invoiceNumber, "SYN-INV-0091");
  const groups = groupImportDocuments(unassigned, []);
  assert.equal(groups.find((group) => group.blNumber === "SYN1BL260001")?.documents.length, 2);
  assert.equal(groups.find((group) => group.invoiceNumber === "SYN-INV-0091")?.documents.length, 2);
});

test("reference lookup respects priority, normalization, company and deletion and never compares empty keys", () => {
  const data = importShipmentsFixture();
  data.importShipments = [matchingShipment("invoice", { invoiceNumber: "ＳＹＮ－ＩＮＶ００１" }), matchingShipment("bl", { blNumber: "SYN/BL.001" }), matchingShipment("declaration", { permitNumber: "SYN-D001" })];
  const refs = { declarationNumber: "syn d001", blNumber: "ｓｙｎ－ｂｌ００１", invoiceNumber: "syn/inv001" };
  assert.equal(findImportShipmentByReferences(data, "JAPAN", refs)?.id, "declaration");
  assert.equal(findImportShipmentByReferences(data, "JAPAN", { ...refs, declarationNumber: "missing" })?.id, "bl");
  assert.equal(findImportShipmentByReferences(data, "JAPAN", { ...refs, declarationNumber: "", blNumber: "" })?.id, "invoice");
  assert.equal(findImportShipmentByReferences(data, "CHINA", refs), undefined);
  assert.equal(findImportShipmentByReferences(data, "JAPAN", { declarationNumber: " - ", blNumber: "/.", invoiceNumber: " " }), undefined);
  for (const row of data.importShipments) row.deletedAt = timestamp;
  assert.equal(findImportShipmentByReferences(data, "JAPAN", refs), undefined);
});

test("shipment forms validate, trim, update and clear B/L and invoice numbers", () => {
  const data = importShipmentsFixture();
  const result = applyImportShipmentMutation(data, admin, "JAPAN", { action: "create", title: "合成参照便", blNumber: " SYN-BL001 ", invoiceNumber: " SYN-INV001 " });
  const row = data.importShipments!.find((row) => row.id === result.id)!;
  assert.equal(row.blNumber, "SYN-BL001"); assert.equal(row.invoiceNumber, "SYN-INV001");
  assert.throws(() => applyImportShipmentMutation(data, admin, "JAPAN", { action: "create", title: "合成便", blNumber: "x".repeat(101) }));
  assert.throws(() => applyImportShipmentMutation(data, admin, "JAPAN", { action: "create", title: "合成便", invoiceNumber: "x".repeat(101) }));
  applyImportShipmentMutation(data, admin, "JAPAN", { action: "update", id: row.id, version: row.updatedAt, title: row.title, blNumber: " ", invoiceNumber: "SYN-INV002" });
  assert.equal(row.blNumber, undefined); assert.equal(row.invoiceNumber, "SYN-INV002");
});

test("group creates a shipment in trust order and returns the ordered union of filled fields", () => {
  const data = importShipmentsFixture();
  const permit = data.mailDocuments.find((row) => row.id === "permit-3")!;
  permit.importDocumentKind = "OTHER";
  permit.ocrText = "輸入許可通知書\n申告番号 SYN-D0003\nShipper: 合成許可荷主\n関税額 3,000円\nB/L No. SYN1BL260001";
  const tax = data.mailDocuments.find((row) => row.id === "packing-x")!;
  tax.importDocumentKind = "TAX_PAYMENT"; tax.ocrText = "関税・輸入消費税の納付書\n申告番号 SYN-D9999\n関税額 9,000円\n輸入消費税額 4,000円";
  const broker = data.receivedInvoices.find((row) => row.id === "broker-3")!;
  broker.ocrText = "請求書 通関料 2,000円\n関税額 99,000円\n消費税額 99,000円\n申告番号 SYN-D9998";
  const supplier = data.receivedInvoices.find((row) => row.id === "supplier-1")!;
  supplier.ocrText = "COMMERCIAL INVOICE\nInvoice No. SYN-INV003\nSeller: 合成仕入荷主\nFOB";
  const originals = [permit, tax, broker, supplier].map((row) => ({ ocrText: row.ocrText, originalFileName: row.originalFileName }));
  const result = applyImportShipmentMutation(data, admin, "JAPAN", { action: "group", shipmentId: null, title: " 合成まとめ便 ", projectId: "japan", documents: [
    { source: "received", documentId: supplier.id }, { source: "received", documentId: broker.id },
    { source: "mail", documentId: tax.id }, { source: "mail", documentId: permit.id, kind: "IMPORT_PERMIT" },
  ] });
  assert.equal(result.action, "group"); assert.equal(result.created, true); assert.equal(result.count, 4);
  assert.deepEqual(result.filled, ["permitNumber", "supplierName", "dutyAmount", "importTaxNational", "brokerFee", "brokerVendorId", "blNumber", "invoiceNumber"]);
  assert.deepEqual(result.filled, Object.keys(importFillLabels).filter((key) => result.filled?.includes(key as keyof typeof importFillLabels)));
  const row = data.importShipments!.find((row) => row.id === result.id)!;
  assert.equal(row.title, "合成まとめ便"); assert.equal(row.projectId, "japan"); assert.equal(row.status, "OPEN"); assert.equal(row.createdById, admin.id);
  assert.equal(row.permitNumber, "SYN-D0003"); assert.equal(row.supplierName, "合成許可荷主"); assert.equal(row.dutyAmount, 3000); assert.equal(row.importTaxNational, 4000);
  assert.equal(row.brokerFee, 2000); assert.equal(row.brokerVendorId, "broker"); assert.equal(row.blNumber, "SYN1BL260001"); assert.equal(row.invoiceNumber, "SYN-INV003");
  assert.equal(row.updatedAt, result.updatedAt);
  for (const document of [permit, tax, broker, supplier]) assert.equal(document.importShipmentId, row.id);
  assert.deepEqual([permit, tax, broker, supplier].map((row) => ({ ocrText: row.ocrText, originalFileName: row.originalFileName })), originals);
});

test("group adds to an existing shipment, respects explicit kinds and preserves populated fields", () => {
  const data = importGroupingFixture(), before = data.importShipments!.length;
  const row = data.importShipments!.find((row) => row.id === "ship-2")!;
  const result = applyImportShipmentMutation(data, admin, "JAPAN", { action: "group", shipmentId: row.id, documents: [
    { source: "mail", documentId: "bl-9" }, { source: "received", documentId: "broker-9" }, { source: "mail", documentId: "permit-3", kind: "OTHER" },
  ] });
  assert.equal(result.action, "group"); assert.equal(result.created, false); assert.equal(result.id, row.id); assert.equal(result.count, 3);
  assert.equal(data.importShipments!.length, before); assert.equal(row.dutyAmount, 5000); assert.equal(row.permitNumber, undefined);
  assert.equal(row.blNumber, "SYN1BL260001"); assert.equal(row.brokerFee, 3000);
  assert.equal(data.mailDocuments.find((document) => document.id === "permit-3")?.importDocumentKind, "OTHER");
});

test("group validates size, title, project and permissions before changing any documents", () => {
  const data = importShipmentsFixture(), before = structuredClone(data);
  const document = { source: "mail" as const, documentId: "permit-3" };
  assert.throws(() => applyImportShipmentMutation(data, admin, "JAPAN", { action: "group", shipmentId: null, title: "合成便", documents: [] }), /書類を選んでください/);
  assert.throws(() => applyImportShipmentMutation(data, admin, "JAPAN", { action: "group", shipmentId: null, title: "合成便", documents: Array(51).fill(document) }), /一度に付けられるのは50件までです/);
  for (const title of [undefined, "", "  "]) assert.throws(() => applyImportShipmentMutation(data, admin, "JAPAN", { action: "group", shipmentId: null, title, documents: [document] }), /便名を入力してください/);
  assert.throws(() => applyImportShipmentMutation(data, admin, "JAPAN", { action: "group", shipmentId: null, title: "合".repeat(201), documents: [document] }), /便名は200文字以内にしてください/);
  assert.throws(() => applyImportShipmentMutation(data, admin, "JAPAN", { action: "group", shipmentId: null, title: "合成便", projectId: "missing", documents: [document] }), /案件/);
  assert.throws(() => applyImportShipmentMutation(data, manager, "JAPAN", { action: "group", shipmentId: "ship-1", documents: [document] }), /権限/);
  assert.throws(() => applyImportShipmentMutation(data, admin, "CHINA", { action: "group", shipmentId: null, title: "合成便", documents: [document] }), /日本版/);
  assert.deepEqual(data, before);
});

test("group rejects missing, deleted and foreign shipments or documents without partially linking a batch", () => {
  const data = importShipmentsFixture();
  data.importShipments!.push(matchingShipment("foreign", { company: "CHINA" }));
  data.mailDocuments.push({ ...data.mailDocuments[0], id: "deleted-mail", deletedAt: timestamp });
  data.receivedInvoices.push({ ...data.receivedInvoices[0], id: "foreign-invoice", projectId: "china" }, { ...data.receivedInvoices[0], id: "deleted-invoice", deletedAt: timestamp });
  const before = structuredClone(data), first = { source: "mail" as const, documentId: "permit-3" };
  for (const shipmentId of ["missing", "ship-deleted", "foreign"]) {
    assert.throws(() => applyImportShipmentMutation(data, admin, "JAPAN", { action: "group", shipmentId, documents: [first] }), /輸入便が見つかりません/);
  }
  for (const shipmentId of [null, "ship-2"]) {
    for (const documentId of ["missing", "deleted-mail", "china-permit"]) {
      assert.throws(() => applyImportShipmentMutation(data, admin, "JAPAN", { action: "group", shipmentId, title: "合成便", documents: [first, { source: "mail", documentId }] }), /郵便物が見つかりません/);
    }
    for (const documentId of ["missing", "deleted-invoice", "foreign-invoice"]) {
      assert.throws(() => applyImportShipmentMutation(data, admin, "JAPAN", { action: "group", shipmentId, title: "合成便", documents: [first, { source: "received", documentId }] }), /受領請求書が見つかりません/);
    }
  }
  assert.deepEqual(data, before);
});

test("group accepts exactly 50 documents", () => {
  const data = importShipmentsFixture();
  const documents = Array.from({ length: 50 }, (_, index) => ({ ...data.mailDocuments[0], id: `synthetic-${index}`, importShipmentId: undefined, importDocumentKind: "OTHER" as const }));
  data.mailDocuments.push(...documents);
  const result = applyImportShipmentMutation(data, admin, "JAPAN", { action: "group", shipmentId: "ship-2", documents: documents.map((document) => ({ source: "mail", documentId: document.id })) });
  assert.equal(result.action, "group"); assert.equal(result.count, 50); assert.deepEqual(result.filled, []);
  assert.equal(documents.every((document) => document.importShipmentId === "ship-2"), true);
});

test("reread overwrites incorrect fields from the first trusted paper, reports differences and preserves manual-only fields", () => {
  const data = importShipmentsFixture(), row = data.importShipments![0];
  Object.assign(row, { dutyAmount: 999, importTaxNational: 888, otherCost: 777, memo: "合成の手入力", folderMonth: "2026-09", blNumber: "SYN-OLD001" });
  data.mailDocuments.find((document) => document.id === "permit-1")!.ocrText = "輸入許可通知書\n申告番号 SYN-D001\n許可日 2026/10/05\n関税額 0円\n輸入消費税額 4,000円\nB/L No. SYN1BL260001";
  data.mailDocuments.push({ ...data.mailDocuments[0], id: "tax-reread", importDocumentKind: "TAX_PAYMENT", ocrText: "関税・輸入消費税の納付書\n関税額 9,000円\n輸入消費税額 9,000円\n地方消費税額 2,000円" });
  data.receivedInvoices.find((document) => document.id === "broker-1")!.ocrText = "請求書 通関料 3,000円\n関税額 99,000円\n輸入消費税額 99,000円\n課税価格 1,000円";
  const before = structuredClone(row), beforeDocuments = structuredClone([data.mailDocuments, data.receivedInvoices]);
  const result = applyImportShipmentMutation(data, admin, "JAPAN", { action: "reread", id: row.id, version: row.updatedAt });
  assert.equal(result.action, "reread");
  assert.deepEqual(result.changed, [
    { key: "permitNumber", before: "合成-0001", after: "SYN-D001" }, { key: "dutyAmount", before: 999, after: 0 },
    { key: "importTaxNational", before: 888, after: 4000 }, { key: "importTaxLocal", before: 11000, after: 2000 },
    { key: "brokerFee", before: 22000, after: 3000 }, { key: "blNumber", before: "SYN-OLD001", after: "SYN1BL260001" },
  ]);
  for (const key of ["otherCost", "memo", "title", "projectId", "status", "folderMonth", "goodsValue", "brokerVendorId"] as const) assert.equal(row[key], before[key], key);
  assert.notEqual(row.updatedAt, before.updatedAt); assert.equal(result.updatedAt, row.updatedAt);
  assert.deepEqual([data.mailDocuments, data.receivedInvoices], beforeDocuments);
  const unchanged = applyImportShipmentMutation(data, admin, "JAPAN", { action: "reread", id: row.id, version: row.updatedAt });
  assert.equal(unchanged.action, "reread"); assert.deepEqual(unchanged.changed, []); assert.equal(unchanged.updatedAt, result.updatedAt);
  assert.throws(() => applyImportShipmentMutation(data, admin, "JAPAN", { action: "reread", id: row.id, version: before.updatedAt }), /更新されています/);
});

test("reread trusts broker invoices only for allowed fields and fills their vendor only when blank", () => {
  for (const vendorId of [undefined, "", "overseas"]) {
    const data = importShipmentsFixture(), row = data.importShipments!.find((row) => row.id === "ship-old")!;
    Object.assign(row, { brokerVendorId: vendorId, supplierName: "合成保持荷主", importTaxNational: 4000, otherCost: 555 });
    const broker = data.receivedInvoices.find((invoice) => invoice.id === "broker-3")!;
    broker.importShipmentId = row.id;
    broker.ocrText = "請求書 通関料 3,000円\n関税額 99,000円\n消費税額 99,000円\nShipper: 合成別荷主\n課税価格 99,000円";
    const result = applyImportShipmentMutation(data, admin, "JAPAN", { action: "reread", id: row.id, version: row.updatedAt });
    assert.equal(result.action, "reread"); assert.deepEqual(result.changed?.map((entry) => entry.key), vendorId ? ["brokerFee"] : ["brokerFee", "brokerVendorId"]);
    assert.equal(row.brokerFee, 3000); assert.equal(row.brokerVendorId, vendorId || "broker");
    assert.equal(row.supplierName, "合成保持荷主"); assert.equal(row.dutyAmount, 1000); assert.equal(row.importTaxNational, 4000); assert.equal(row.otherCost, 555); assert.equal(row.goodsValue, undefined);
  }
});

test("reread uses the same live and scoped document set as the board and ignores duplicate mail wrappers", () => {
  const data = importShipmentsFixture(), row = data.importShipments!.find((row) => row.id === "ship-old")!;
  const mail = data.mailDocuments[0];
  data.mailDocuments.push(
    { ...mail, id: "deleted-reread", importShipmentId: row.id, deletedAt: timestamp, ocrText: "輸入許可通知書 関税額 5,000円" },
    { ...mail, id: "foreign-reread", importShipmentId: row.id, company: "CHINA", ocrText: "輸入許可通知書 関税額 6,000円" },
    { ...mail, id: "wrapped-reread", importShipmentId: row.id, relatedReceivedInvoiceId: "broker-3", ocrText: "輸入許可通知書 関税額 7,000円" },
  );
  data.receivedInvoices.push({ ...data.receivedInvoices[0], id: "foreign-reread-invoice", importShipmentId: row.id, projectId: "china", ocrText: "請求書 通関料 8,000円" });
  const result = applyImportShipmentMutation(data, admin, "JAPAN", { action: "reread", id: row.id, version: row.updatedAt });
  assert.equal(result.action, "reread"); assert.deepEqual(result.changed, []); assert.equal(row.updatedAt, timestamp); assert.equal(row.dutyAmount, 1000);
  assert.throws(() => applyImportShipmentMutation(data, manager, "JAPAN", { action: "reread", id: row.id, version: row.updatedAt }), /権限/);
  for (const id of ["missing", "ship-deleted"]) assert.throws(() => applyImportShipmentMutation(data, admin, "JAPAN", { action: "reread", id, version: timestamp }), /輸入便が見つかりません/);
});

test("shipment creation, grouping and rereading persist reversible audit patches", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "triangle-imports-store-test-"));
  process.env.DATA_DIR = dir; process.env.UPLOAD_DIR = path.join(dir, "uploads"); process.env.DATABASE_URL = "";
  for (const key of Object.keys(process.env)) if (key.startsWith("RELEASE_")) delete process.env[key];
  const data = importShipmentsFixture(); delete data.importShipments; data.mailDocuments = data.mailDocuments.filter((row) => row.company !== "CHINA");
  for (const row of [...data.mailDocuments, ...data.receivedInvoices]) delete row.importShipmentId;
  data.users = [{ id: "admin", role: "ADMIN", name: "合成管理者", email: "admin@example.invalid", passwordHash: "unused", createdAt: timestamp, updatedAt: timestamp }];
  await writeFile(path.join(dir, "app-data.json"), JSON.stringify(data));
  const { mutateData, readData, restoreUndoState } = await import("../src/lib/store");
  const before = await readData(); assert.equal(before.importShipments, undefined);
  const result = await mutateData("admin", "CREATE_IMPORT_SHIPMENT", "ImportShipment", "new", (current) => applyImportShipmentMutation(current, admin, "JAPAN", { action: "create", title: "合成便" }));
  const after = JSON.parse(await readFile(path.join(dir, "app-data.json"), "utf8")) as AppData;
  assert.equal(after.importShipments!.length, 1); assert.equal(after.importShipments![0].id, result.id);
  const patch = after.auditLogs[0].beforeStateJson as { changes: Array<{ collection: string; before: unknown }> };
  assert.equal(patch.changes.length, 1); assert.equal(patch.changes[0].collection, "importShipments"); assert.equal(patch.changes[0].before, null);
  const restored = structuredClone(after); restoreUndoState(restored, after.auditLogs[0].beforeStateJson); assert.deepEqual(restored.importShipments, []);
  assert.deepEqual(after.receivedInvoices, before.receivedInvoices); assert.deepEqual(after.mailDocuments, before.mailDocuments);

  const grouped = await mutateData("admin", "GROUP_IMPORT_DOCUMENTS", "ImportShipment", "new", (current) => applyImportShipmentMutation(current, admin, "JAPAN", {
    action: "group", shipmentId: null, title: "合成監査便", documents: [{ source: "mail", documentId: "permit-3" }, { source: "received", documentId: "broker-3" }],
  }));
  const afterGroup = await readData(), groupAudit = afterGroup.auditLogs.find((log) => log.action === "GROUP_IMPORT_DOCUMENTS")!;
  const groupRestored = structuredClone(afterGroup); restoreUndoState(groupRestored, groupAudit.beforeStateJson);
  assert.deepEqual(groupRestored.importShipments, after.importShipments);
  assert.deepEqual(groupRestored.mailDocuments, after.mailDocuments); assert.deepEqual(groupRestored.receivedInvoices, after.receivedInvoices);
  const groupRow = afterGroup.importShipments!.find((row) => row.id === grouped.id)!;
  await mutateData("admin", "UPDATE_IMPORT_SHIPMENT", "ImportShipment", groupRow.id, (current) => applyImportShipmentMutation(current, admin, "JAPAN", {
    action: "update", id: groupRow.id, version: groupRow.updatedAt, title: groupRow.title, dutyAmount: 17,
  }));
  const beforeReread = await readData(), edited = beforeReread.importShipments!.find((row) => row.id === grouped.id)!;
  const reread = await mutateData("admin", "REREAD_IMPORT_SHIPMENT", "ImportShipment", edited.id, (current) => applyImportShipmentMutation(current, admin, "JAPAN", {
    action: "reread", id: edited.id, version: edited.updatedAt,
  }));
  assert.equal(reread.action, "reread"); assert.ok(reread.changed?.some((entry) => entry.key === "dutyAmount" && entry.before === 17 && entry.after === 3000));
  const afterReread = await readData(), rereadAudit = afterReread.auditLogs.find((log) => log.action === "REREAD_IMPORT_SHIPMENT")!;
  const rereadRestored = structuredClone(afterReread); restoreUndoState(rereadRestored, rereadAudit.beforeStateJson);
  assert.deepEqual(rereadRestored.importShipments, beforeReread.importShipments);
  assert.deepEqual(afterReread.mailDocuments, beforeReread.mailDocuments); assert.deepEqual(afterReread.receivedInvoices, beforeReread.receivedInvoices);
});
