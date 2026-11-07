import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { admin, manager, timestamp } from "./document-fixture";
import { importShipmentsFixture } from "./import-shipments-fixture";
import type { ImportIntakeInput } from "../src/lib/import-intake";
import type { AppData } from "../src/lib/types";

let root: string;
let intakeImportDocument: typeof import("../src/lib/import-intake").intakeImportDocument;
let intakeMailDocument: typeof import("../src/lib/mail-intake").intakeMailDocument;
let readData: typeof import("../src/lib/store").readData;
const keys = ["DATA_DIR", "UPLOAD_DIR", "DATABASE_URL", "VERCEL", "FILE_STORAGE_DRIVER", "OPENAI_API_KEY", ...Object.keys(process.env).filter((key) => key.startsWith("RELEASE_"))];
const previous = new Map(keys.map((key) => [key, process.env[key]]));

before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "triangle-import-intake-test-"));
  for (const key of keys) delete process.env[key];
  process.env.DATA_DIR = root; process.env.UPLOAD_DIR = path.join(root, "uploads"); process.env.DATABASE_URL = "";
  ({ intakeImportDocument } = await import("../src/lib/import-intake"));
  ({ intakeMailDocument } = await import("../src/lib/mail-intake"));
  ({ readData } = await import("../src/lib/store"));
});

beforeEach(async () => {
  const data = importShipmentsFixture();
  data.importShipments = []; data.mailDocuments = []; data.receivedInvoices = [];
  data.vendors = []; data.projects = []; data.clients = []; data.attachments = [];
  data.users = [{ ...admin, name: "合成管理者", email: "synthetic@example.invalid", passwordHash: "unused", createdAt: timestamp, updatedAt: timestamp }];
  await writeFile(path.join(root, "app-data.json"), JSON.stringify(data));
});

after(async () => {
  for (const key of keys) { const value = previous.get(key); if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  if (root && path.dirname(path.resolve(root)) === path.resolve(os.tmpdir()) && path.basename(root).startsWith("triangle-import-intake-test-")) {
    await rm(path.resolve(root), { recursive: true, force: true });
  }
});

const permitText = "輸入許可通知書\n輸入申告番号 SYN-0001\n許可日 令和8年10月5日\n入港日 2026/10/01\n仕出人: 合成海外家具廠\n課税価格 500,000円\n関税額 15,000円\n消費税額 40,000円\n地方消費税額 11,000円";
function input(text: string, extra: Partial<ImportIntakeInput> = {}): ImportIntakeInput {
  return { user: admin, company: "JAPAN", fileName: "合成書類.pdf", mimeType: "application/pdf", buffer: Buffer.from(`synthetic file: ${text}`),
    extracted: { text, engine: "synthetic", confidence: 95, warnings: [] }, ...extra };
}

async function assertSavedFile(data: AppData, mailId: string, expected: Buffer) {
  const mail = data.mailDocuments.find((row) => row.id === mailId)!;
  const name = decodeURIComponent(new URL(mail.fileUrl, "http://localhost").pathname.split("/").at(-1)!);
  assert.deepEqual(await readFile(path.join(root, "uploads", name)), expected);
}

test("permit intake saves a CUSTOMS original and creates and fills a shipment in one import mutation", async () => {
  const request = input(permitText), result = await intakeImportDocument(request);
  assert.equal(result.displayName, request.fileName);
  assert.equal(result.error, undefined); assert.equal(result.kind, "IMPORT_PERMIT"); assert.equal(result.savedAs, "other-document"); assert.equal(result.shipmentCreated, true);
  assert.deepEqual(result.filled, ["許可番号", "許可日", "到着日", "仕入先", "課税価格", "関税", "輸入消費税", "地方消費税"]);
  const data = await readData(), row = data.importShipments![0], mail = data.mailDocuments[0];
  assert.equal(data.mailDocuments.length, 1); assert.equal(mail.category, "CUSTOMS"); assert.equal(mail.importDocumentKind, "IMPORT_PERMIT"); assert.equal(mail.importShipmentId, row.id);
  assert.equal(mail.senderName, "合成海外家具廠"); assert.match(mail.originalFileName, /_合成海外家具廠_/);
  assert.equal(data.importShipments!.length, 1); assert.equal(row.id, result.shipmentId); assert.equal(row.title, "合成海外家具廠 2026-10-05"); assert.equal(result.shipmentTitle, row.title); assert.equal(row.status, "OPEN");
  assert.equal(row.permitNumber, "SYN-0001"); assert.equal(row.permitDate, "2026-10-05"); assert.equal(row.arrivalDate, "2026-10-01");
  assert.equal(row.goodsValue, 500000); assert.equal(row.dutyAmount, 15000); assert.equal(row.importTaxNational, 40000); assert.equal(row.importTaxLocal, 11000);
  assert.deepEqual(row.fieldSources, { permitNumber: "DOCUMENT", permitDate: "DOCUMENT", arrivalDate: "DOCUMENT", supplierName: "DOCUMENT",
    goodsValue: "DOCUMENT", dutyAmount: "DOCUMENT", importTaxNational: "DOCUMENT", importTaxLocal: "DOCUMENT" });
  assert.equal(data.auditLogs.filter((log) => log.action === "SORT_MAIL_DOCUMENT").length, 1);
  const imports = data.auditLogs.filter((log) => log.action === "INTAKE_IMPORT_DOCUMENT");
  assert.equal(imports.length, 1);
  const patch = imports[0].beforeStateJson as { changes: Array<{ collection: string }> };
  assert.deepEqual(patch.changes.map((change) => change.collection).sort(), ["importShipments", "mailDocuments"]);
  await assertSavedFile(data, result.mailDocumentId!, request.buffer);
});

test("a tax payment with the same normalized declaration number joins the existing shipment", async () => {
  const first = await intakeImportDocument(input(permitText));
  const result = await intakeImportDocument(input("関税・輸入消費税の納付書\n申告番号 ｓｙｎ０００１\n関税額 99,000円", { fileName: "合成納付書.pdf" }));
  assert.equal(result.error, undefined); assert.equal(result.kind, "TAX_PAYMENT"); assert.equal(result.shipmentId, first.shipmentId); assert.equal(result.shipmentCreated, undefined); assert.deepEqual(result.filled, []);
  const data = await readData();
  assert.equal(data.importShipments!.length, 1); assert.equal(data.importShipments![0].dutyAmount, 15000);
  assert.equal(data.mailDocuments.find((row) => row.id === result.mailDocumentId)?.importShipmentId, first.shipmentId);
});

test("a B/L joins a shipment by B/L alone and retains the uploaded display name", async () => {
  const data = await readData();
  data.importShipments = [{ id: "synthetic-bl-shipment", company: "JAPAN", title: "合成B/L便", status: "OPEN", blNumber: "ＳＹＮ１ＢＬ－２６０００１", createdById: admin.id, createdAt: timestamp, updatedAt: timestamp }];
  await writeFile(path.join(root, "app-data.json"), JSON.stringify(data));
  const result = await intakeImportDocument(input("HOUSE BILL OF LADING\nB/L No. SYN1BL260001\nShipper: 合成海外家具廠", { fileName: "合成B-L原本.pdf" }));
  assert.equal(result.error, undefined); assert.equal(result.kind, "WAYBILL"); assert.equal(result.shipmentId, "synthetic-bl-shipment"); assert.equal(result.shipmentCreated, undefined);
  assert.equal(result.displayName, "合成B-L原本.pdf"); assert.notEqual(result.fileName, result.displayName);
  const after = await readData();
  assert.equal(after.importShipments!.length, 1); assert.equal(after.importShipments![0].permitNumber, undefined);
  assert.equal(after.mailDocuments.find((mail) => mail.id === result.mailDocumentId)?.importShipmentId, result.shipmentId);
});

test("a packing list joins by invoice number without creating another shipment", async () => {
  const data = await readData();
  data.importShipments = [{ id: "synthetic-invoice-shipment", company: "JAPAN", title: "合成インボイス便", status: "OPEN", invoiceNumber: "SYN/INV.0091", createdById: admin.id, createdAt: timestamp, updatedAt: timestamp }];
  await writeFile(path.join(root, "app-data.json"), JSON.stringify(data));
  const result = await intakeImportDocument(input("PACKING LIST\nInvoice No. SYN-INV-0091\nShipper: 合成海外家具廠"));
  assert.equal(result.error, undefined); assert.equal(result.kind, "PACKING_LIST"); assert.equal(result.shipmentId, "synthetic-invoice-shipment");
  assert.equal(result.shipmentCreated, undefined); assert.equal(result.displayName, "合成書類.pdf"); assert.equal((await readData()).importShipments!.length, 1);
});

test("broker invoices become received invoices and fill the selected shipment's vendor and fee", async () => {
  const first = await intakeImportDocument(input(permitText));
  const request = input("発行者: 合成通関株式会社\n請求書 通関料 3,000円 関税 立替 15,000円 請求金額 18,000円 支払期限 2026-11-10", { shipmentId: first.shipmentId });
  const result = await intakeImportDocument(request), data = await readData();
  assert.equal(result.error, undefined); assert.equal(result.savedAs, "received-invoice"); assert.equal(result.kind, "BROKER_INVOICE"); assert.equal(result.shipmentCreated, undefined);
  assert.equal(data.receivedInvoices.length, 1);
  const invoice = data.receivedInvoices[0], shipment = data.importShipments![0];
  assert.equal(invoice.id, result.receivedInvoiceId); assert.equal(invoice.importShipmentId, first.shipmentId); assert.equal(invoice.importDocumentKind, "BROKER_INVOICE");
  assert.equal(shipment.brokerFee, 3000); assert.equal(shipment.brokerVendorId, invoice.vendorId);
  assert.ok(data.vendors.some((vendor) => vendor.id === invoice.vendorId && vendor.contactName === "OCR自動登録"));
  assert.deepEqual(result.filled, ["通関手数料", "通関業者"]);
  assert.equal(data.mailDocuments.find((mail) => mail.id === result.mailDocumentId)?.relatedReceivedInvoiceId, invoice.id);
  await assertSavedFile(data, result.mailDocumentId!, request.buffer);
});

test("packing lists without a target are saved but do not create a shipment", async () => {
  const result = await intakeImportDocument(input("PACKING LIST\n合成海外家具廠\n12 cartons")), data = await readData();
  assert.equal(result.error, undefined); assert.equal(result.kind, "PACKING_LIST"); assert.equal(result.shipmentId, undefined); assert.equal(result.shipmentCreated, undefined); assert.deepEqual(result.filled, []);
  assert.equal(data.importShipments!.length, 0); assert.equal(data.mailDocuments.length, 1); assert.equal(data.mailDocuments[0].importShipmentId, undefined); assert.equal(data.mailDocuments[0].importDocumentKind, "PACKING_LIST");
});

test("a missing target returns a link error while preserving the uploaded original", async () => {
  const request = input(permitText, { shipmentId: "synthetic-missing" }), result = await intakeImportDocument(request), data = await readData();
  assert.equal(result.displayName, request.fileName);
  assert.equal(result.error, "輸入便が見つかりません"); assert.equal(result.savedAs, "other-document"); assert.equal(result.shipmentId, undefined); assert.deepEqual(result.filled, []);
  assert.equal(data.mailDocuments.length, 1); assert.equal(data.mailDocuments[0].importShipmentId, undefined); assert.equal(data.importShipments!.length, 0);
  await assertSavedFile(data, result.mailDocumentId!, request.buffer);
});

test("ordinary mail invoice intake preserves invoice records, duplicates and folder moves without import metadata", async () => {
  const request = input("合成文具株式会社\n請求書\n請求日 2026年10月1日\n請求金額 12,000円\n支払期限 2026年11月10日\n振込先 合成銀行", { targetMonth: "2026-10" });
  const first = await intakeMailDocument(request), before = await readData();
  assert.equal(first.savedAs, "received-invoice"); assert.equal(first.duplicate, false); assert.equal(before.receivedInvoices.length, 1);
  // The issuer line names the sender even when no vendor matched; the placeholder "支払先確認待ち" must not become "確認待ち".
  assert.match(before.mailDocuments[0].originalFileName, /_合成文具株式会社_/); assert.notEqual(before.mailDocuments[0].senderName, "確認待ち");
  for (const row of [...before.mailDocuments, ...before.receivedInvoices]) {
    assert.equal(Object.hasOwn(row, "importShipmentId"), false); assert.equal(Object.hasOwn(row, "importDocumentKind"), false); assert.equal(row.folderMonth, "2026-10");
  }
  const second = await intakeMailDocument({ ...request, targetMonth: "2026-11" }), after = await readData();
  assert.equal(second.receivedInvoiceId, first.receivedInvoiceId); assert.equal(second.duplicate, true); assert.ok(second.duplicateReason); assert.equal(after.receivedInvoices.length, 1); assert.equal(after.mailDocuments.length, 2);
  assert.equal(after.receivedInvoices[0].folderMonth, "2026-11"); assert.equal(after.receivedInvoices[0].memo, before.receivedInvoices[0].memo);
  assert.match(after.mailDocuments[0].memo!, /判定: 重複候補として保存しました/);
  assert.equal(after.auditLogs.every((log) => log.action === "SORT_MAIL_DOCUMENT"), true);
  await assertSavedFile(after, first.mailDocumentId!, request.buffer);
});

test("mail intake writes import metadata only when supplied, on both mail and invoice", async () => {
  const result = await intakeMailDocument({ ...input("合成通関株式会社\n請求書 通関料 3,000円 関税 立替 15,000円 請求金額 18,000円 支払期限 2026-11-10"), importShipmentId: "synthetic-shipment", importDocumentKind: "BROKER_INVOICE" });
  const data = await readData();
  assert.equal(result.savedAs, "received-invoice");
  for (const row of [...data.mailDocuments, ...data.receivedInvoices]) { assert.equal(row.importShipmentId, "synthetic-shipment"); assert.equal(row.importDocumentKind, "BROKER_INVOICE"); }
});

test("ordinary invoices stay unassigned without importing their consumption tax", async () => {
  const result = await intakeImportDocument(input("合成文具株式会社\n請求書 消費税 10% 合計 110,000円 振込先 合成銀行"));
  assert.equal(result.error, undefined); assert.equal(result.kind, "OTHER"); assert.equal(result.shipmentId, undefined); assert.deepEqual(result.filled, []);
  assert.equal((await readData()).importShipments!.length, 0);
});

test("import intake checks permissions, company scope and explicit kind before saving", async () => {
  await assert.rejects(intakeImportDocument(input(permitText, { user: manager })), /権限/);
  await assert.rejects(intakeImportDocument(input(permitText, { company: "CHINA" })), /日本版/);
  await assert.rejects(intakeImportDocument(input(permitText, { kind: "INVALID" as ImportIntakeInput["kind"] })));
  const data = await readData(); assert.equal(data.mailDocuments.length, 0); assert.equal(data.importShipments!.length, 0);
});

test("unreadable permit details use a fallback title and explicit OTHER skips auto creation", async () => {
  const result = await intakeImportDocument(input("輸入許可通知書"));
  assert.equal(result.shipmentCreated, true); assert.match(result.shipmentTitle!, /^輸入便 \d{4}-\d{2}-\d{2}$/); assert.deepEqual(result.filled, []);
  const other = await intakeImportDocument(input(permitText, { kind: "OTHER" }));
  assert.equal(other.kind, "OTHER"); assert.equal(other.shipmentId, undefined); assert.deepEqual(other.filled, []); assert.equal((await readData()).importShipments!.length, 1);
});
