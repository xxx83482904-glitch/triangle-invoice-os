import assert from "node:assert/strict";
import test from "node:test";
import { admin } from "./document-fixture";
import { importShipmentsFixture } from "./import-shipments-fixture";
import { yen } from "../src/lib/format";
import { importListSummary, importShipmentHref, legacyImportShipmentHref, matchesImportSearch } from "../src/lib/import-list";
import { defaultRereadKeys, formatRereadValue, rereadSuccessMessage } from "../src/lib/import-reread";
import { applyImportShipmentMutation, importRereadChanges, importShipmentViews, type ImportRereadChange } from "../src/lib/import-shipment-views";
import { defaultImportStages } from "../src/lib/import-shipments";
import { importPdfFragment } from "../src/lib/original-file-preview";

const today = "2026-11-06";
function fixture() {
  const data = importShipmentsFixture(), row = data.importShipments![0];
  const view = () => importShipmentViews(data, "JAPAN", today).find((value) => value.id === row.id)!;
  return { data, row, view };
}

test("legacy list rows never infer orders or logistics from accounting status or complete documents", () => {
  const { row, view } = fixture(); row.status = "CLOSED";
  const summary = importListSummary(view(), today);
  assert.equal(summary.client, "未設定"); assert.equal(summary.order, "注文未登録");
  assert.equal(summary.stage, "工程未入力"); assert.equal(summary.actual, undefined);
  assert.deepEqual(summary.segments, Array(5).fill("UPCOMING"));
  assert.equal(summary.next, "—"); assert.equal(summary.remaining, undefined);
  assert.equal(summary.requested, "—"); assert.equal(summary.documents, "5/5種類");
});

test("list orders show the first resolved client, project attribution, and a single number or count", () => {
  const { row, view } = fixture();
  row.orders = [{ id: "first", orderNumber: "SYN-101", items: [] }];
  const one = view(), summary = importListSummary(one, today);
  assert.equal(summary.client, one.projectClient!.name); assert.equal(summary.clientFromProject, true);
  assert.equal(summary.order, "SYN-101");
  row.orders.push({ id: "second", orderNumber: "SYN-102", items: [] });
  assert.equal(importListSummary(view(), today).order, "注文 2件");
  row.orders = [{ id: "first", clientId: "unavailable-client", items: [] }];
  assert.equal(importListSummary(view(), today).client, "未設定");
  assert.equal(importListSummary(view(), today).order, "注文 1件");
});

test("list progress marks only completed stages done and calls planned dates completion plans", () => {
  const { row, view } = fixture();
  row.stages = [{ key: "ORDER_RECEIVED", label: "発注受付", completedAt: "2026-11-01" },
    { key: "PRODUCTION", label: "製作", startedAt: "2026-11-02", plannedAt: "2026-11-10" }];
  const summary = importListSummary(view(), today);
  assert.equal(summary.stage, "製作");
  assert.deepEqual(summary.segments, ["DONE", "CURRENT", "UPCOMING", "UPCOMING", "UPCOMING"]);
  assert.equal(summary.next, "11/10 製作の完了予定"); assert.equal(summary.remaining, "あと4日");
  assert.equal(summary.actual, undefined); assert.equal(summary.overdue, false);
  row.stages[1].plannedAt = "2026-11-04";
  assert.equal(importListSummary(view(), today).remaining, "2日超過");
  assert.equal(importListSummary(view(), today).overdue, true);
  row.stages[1].plannedAt = today;
  assert.equal(importListSummary(view(), today).remaining, "あと0日");
});

test("completed list rows show actual delivery, never a requested date, and retain custom stage labels", () => {
  const { row, view } = fixture();
  row.stages = defaultImportStages.map((stage) => ({ ...stage, completedAt: "2026-10-28" }));
  row.orders = [{ id: "order", requestedDeliveryDate: "2026-11-20", items: [] }];
  let summary = importListSummary(view(), today);
  assert.equal(summary.stage, "納品済み"); assert.equal(summary.actual, "実績 10/28");
  assert.equal(summary.next, "—"); assert.deepEqual(summary.segments, Array(5).fill("DONE"));
  row.stages.push({ key: "CHECK", label: "検品", plannedAt: "2026-11-08" });
  summary = importListSummary(view(), today);
  assert.equal(summary.stage, "検品"); assert.equal(summary.actual, undefined);
  assert.equal(summary.next, "11/8 検品の完了予定"); assert.equal(summary.segments.length, 5);
});

test("requested dates include distinct order and item dates and keep other years explicit", () => {
  const { row, view } = fixture();
  row.orders = [{ id: "first", requestedDeliveryDate: "2026-11-20", items: [
    { id: "same", name: "Same", requestedDeliveryDate: "2026-11-20" },
    { id: "later", name: "Later", requestedDeliveryDate: "2026-11-28" },
  ] }, { id: "second", requestedDeliveryDate: "2026-11-28", items: [{ id: "next-year", name: "Next year", requestedDeliveryDate: "2027-01-02" }] }];
  assert.equal(importListSummary(view(), today).requested, "11/20・11/28・2027/1/2");
});

test("list document coverage counts kinds rather than files", () => {
  const { data, view } = fixture();
  data.mailDocuments = data.mailDocuments.filter((mail) => mail.id !== "packing-1");
  data.mailDocuments.push({ ...data.mailDocuments[0], id: "duplicate-permit" });
  assert.equal(view().documents.length, 5);
  assert.equal(importListSummary(view(), today).documents, "4/5種類");
  assert.deepEqual(view().missing, ["PACKING_LIST"]);
});

test("search includes every order's client and number, along with existing reference fields", () => {
  const { view } = fixture(), value = view();
  value.orders = [{ id: "a", clientName: "合成第一商事", clientSource: "ORDER", orderNumber: "First-01", items: [] },
    { id: "b", clientName: "合成第二商事", clientSource: "ORDER", orderNumber: "Second-02", items: [] }];
  for (const query of ["第一", "第二", " first-01 ", "SECOND-02", value.permitNumber!, value.supplierName!, ""]) assert.equal(matchesImportSearch(value, query), true, query);
  assert.equal(matchesImportSearch(value, "no matching order"), false);
});

test("old shipment links redirect to encoded local detail paths with the company preserved", () => {
  assert.equal(legacyImportShipmentHref("JAPAN", "ship-1"), "/imports/ship-1?company=JAPAN");
  assert.equal(legacyImportShipmentHref("CHINA", ["ship-2", "ignored"]), "/imports/ship-2?company=CHINA");
  for (const id of [undefined, "", "  ", []]) assert.equal(legacyImportShipmentHref("JAPAN", id), undefined);
  const id = "合成/a?company=CHINA&shipment=other#section";
  const url = new URL(importShipmentHref("JAPAN", id), "https://example.invalid");
  assert.equal(url.origin, "https://example.invalid"); assert.equal(url.search, "?company=JAPAN"); assert.equal(url.hash, "");
  assert.equal(decodeURIComponent(url.pathname.slice("/imports/".length)), id);
});

test("reread defaults skip only manual values, including a manual zero", () => {
  const changes: ImportRereadChange[] = [
    { key: "dutyAmount", label: "関税", before: 0, after: 10, source: "MANUAL", document: { kind: "IMPORT_PERMIT", displayName: "合成許可書" } },
    { key: "permitNumber", label: "番号", before: "old", after: "new", source: "DOCUMENT", document: { kind: "IMPORT_PERMIT", displayName: "合成許可書" } },
    { key: "permitDate", label: "日付", before: "2026-10-01", after: "2026-11-01", source: "UNKNOWN", document: { kind: "IMPORT_PERMIT", displayName: "合成許可書" } },
    { key: "blNumber", label: "B/L", before: undefined, after: "SYN-BL", source: "EMPTY", document: { kind: "WAYBILL", displayName: "合成輸送書類" } },
  ];
  assert.deepEqual(defaultRereadKeys(changes), ["permitNumber", "permitDate", "blNumber"]);
  assert.deepEqual(defaultRereadKeys(changes.slice(0, 1)), []);
});

test("reread values distinguish empty from zero and format dates and broker names", () => {
  const vendors = [{ value: "broker", label: "合成通関サービス" }];
  assert.equal(formatRereadValue("dutyAmount", undefined, vendors), "未入力");
  assert.equal(formatRereadValue("dutyAmount", 0, vendors), yen.format(0));
  assert.equal(formatRereadValue("brokerFee", 12345, vendors), yen.format(12345));
  assert.equal(formatRereadValue("permitDate", "2026-11-06", vendors), "2026/11/06");
  assert.equal(formatRereadValue("arrivalDate", "2026-12-01", vendors), "2026/12/01");
  assert.equal(formatRereadValue("brokerVendorId", "broker", vendors), "合成通関サービス");
  assert.equal(formatRereadValue("brokerVendorId", "private-unknown-id", vendors).includes("private-unknown-id"), false);
  assert.equal(formatRereadValue("invoiceNumber", "INV-001", vendors), "INV-001");
});

test("selective reread preserves unchecked manual fields and rejects a stale preview version", () => {
  const { data, row } = fixture();
  row.dutyAmount = 0; row.importTaxNational = 8; row.importTaxLocal = undefined;
  row.fieldSources = { dutyAmount: "MANUAL", importTaxNational: "DOCUMENT" };
  const changes = importRereadChanges(data, "JAPAN", row), version = row.updatedAt;
  const keys = defaultRereadKeys(changes);
  assert.equal(keys.includes("dutyAmount"), false); assert.equal(keys.includes("importTaxLocal"), true);
  const result = applyImportShipmentMutation(data, admin, "JAPAN", { action: "reread", id: row.id, version, keys });
  assert.equal(result.action, "reread");
  assert.equal(row.dutyAmount, 0); assert.equal(row.fieldSources.dutyAmount, "MANUAL");
  assert.equal(row.importTaxNational, 40000); assert.equal(row.importTaxLocal, 11000);
  assert.equal(row.fieldSources.importTaxLocal, "DOCUMENT");
  assert.throws(() => applyImportShipmentMutation(data, admin, "JAPAN", { action: "reread", id: row.id, version, keys: ["dutyAmount"] }), /輸入便が更新されています/);
  if (result.action === "reread") {
    assert.match(rereadSuccessMessage(result.changed), /を書き直しました。元の値は画面右上の取り消しで戻せます。$/);
    assert.equal(result.changed.some((change) => change.key === "dutyAmount"), false);
  }
  assert.equal(rereadSuccessMessage([]), "書類から読み直せる項目はありませんでした。");
});

test("PDF fragments suppress native controls and use FitH or an explicit percentage", () => {
  assert.equal(importPdfFragment(1, 100, true), "#toolbar=0&navpanes=0&page=1&view=FitH");
  assert.equal(importPdfFragment(2, 125, false), "#toolbar=0&navpanes=0&page=2&zoom=125");
  assert.equal(importPdfFragment(3, 75, false), "#toolbar=0&navpanes=0&page=3&zoom=75");
});
