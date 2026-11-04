import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { admin, manager, timestamp } from "./document-fixture";
import { importShipmentsFixture } from "./import-shipments-fixture";
import { appNavigation, navigationGroups } from "../src/lib/app-navigation";
import { detectImportDocument, extractImportShipmentFields, fillImportShipment, importShipmentAmounts, importShipmentMonth, normalizePermitNumber, suggestsCustomsCategory } from "../src/lib/import-shipments";
import { applyImportShipmentFormFields, applyImportShipmentMutation, findImportShipmentByPermitNumber, importMonthlySummary, importShipmentOptions, importShipmentViews, unassignedImportDocuments } from "../src/lib/import-shipment-views";
import { classifyMailDocument } from "../src/lib/ocr";
import type { AppData } from "../src/lib/types";

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

test("the first shipment write persists an audit with a reversible patch and leaves source rows alone", async () => {
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
});
