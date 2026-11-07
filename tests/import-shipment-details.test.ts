import assert from "node:assert/strict";
import test from "node:test";
import { admin, manager, timestamp } from "./document-fixture";
import { importShipmentsFixture } from "./import-shipments-fixture";
import { canViewImportFile } from "../src/lib/import-shipment-files";
import { documentRows } from "../src/lib/documents";
import { defaultImportStages, fillImportShipment, importFillLabels, importOrderItemKinds, importRequestedDates, importStageTimeline, importToday } from "../src/lib/import-shipments";
import { applyImportShipmentMutation, importRereadChanges, importShipmentViews, unassignedImportDocuments, type ImportShipmentMutation } from "../src/lib/import-shipment-views";
import type { AppData, ImportOrder, ImportShipment, ImportStage } from "../src/lib/types";

const today = "2026-11-06";
type Create = Extract<ImportShipmentMutation, { action: "create" }>;
const shipment = (data: AppData, id = "ship-1") => data.importShipments!.find((row) => row.id === id)!;
const mutate = (data: AppData, input: ImportShipmentMutation) => applyImportShipmentMutation(data, admin, "JAPAN", input);
function update(data: AppData, row: ImportShipment, extra: Partial<Omit<Create, "action">> = {}) {
  return mutate(data, {
    action: "update", id: row.id, version: row.updatedAt, title: row.title, projectId: row.projectId, supplierName: row.supplierName,
    brokerVendorId: row.brokerVendorId, permitNumber: row.permitNumber, permitDate: row.permitDate, arrivalDate: row.arrivalDate,
    blNumber: row.blNumber, invoiceNumber: row.invoiceNumber, folderMonth: row.folderMonth, goodsValue: row.goodsValue,
    dutyAmount: row.dutyAmount, importTaxNational: row.importTaxNational, importTaxLocal: row.importTaxLocal, brokerFee: row.brokerFee,
    otherCost: row.otherCost, status: row.status, memo: row.memo, ...extra,
  });
}
const sampleOrders: NonNullable<Create["orders"]> = [
  { id: "untrusted-order", clientId: "client", orderNumber: " サンプル-001 ", orderedAt: "2026-10-01", requestedDeliveryDate: "2026-11-20", memo: "  ", items: [
    { id: "untrusted-item", name: " サンプル袋 ", quantity: 0, unit: " 枚 ", kind: "BAG", note: "", requestedDeliveryDate: "2026-11-20" },
    { name: "サンプル印刷物", quantity: 100, unit: "部", kind: "PRINTED", requestedDeliveryDate: "2026-11-18" },
  ] },
  { orderNumber: "サンプル-002", requestedDeliveryDate: "2026-11-25", items: [{ name: "サンプル箱", kind: "BOX" }] },
];

test("orders with several items round-trip through views, preserve IDs on saves, and distinguish absent from empty", () => {
  const data = importShipmentsFixture();
  const result = mutate(data, { action: "create", title: "サンプル混載便", projectId: "japan", orders: sampleOrders });
  const row = shipment(data, result.id), saved = structuredClone(row.orders!);
  assert.equal(saved.length, 2); assert.deepEqual(saved.map((order) => order.items.length), [2, 1]);
  assert.notEqual(saved[0].id, "untrusted-order"); assert.notEqual(saved[0].items[0].id, "untrusted-item");
  assert.equal(saved[0].orderNumber, "サンプル-001"); assert.equal(saved[0].items[0].name, "サンプル袋");
  assert.equal(saved[0].items[0].quantity, 0); assert.equal(saved[0].items[0].unit, "枚");
  assert.equal("memo" in saved[0], false); assert.equal("note" in saved[0].items[0], false);
  assert.equal("requestedDeliveryDate" in saved[0].items[0], false);
  const view = importShipmentViews(data, "JAPAN", today).find((view) => view.id === row.id)!;
  assert.deepEqual(view.projectClient, { id: "client", name: "Test customer" });
  assert.deepEqual(view.orders.map((order) => [order.clientName, order.clientSource]), [["Test customer", "ORDER"], ["Test customer", "PROJECT"]]);
  assert.equal(row.orders![1].clientId, undefined);
  assert.deepEqual(view.requestedDates, { dates: ["2026-11-20", "2026-11-25"], differs: true,
    itemOverrides: [{ orderId: saved[0].id, itemId: saved[0].items[1].id, date: "2026-11-18" }] });
  update(data, row, { orders: saved });
  assert.deepEqual(row.orders, saved);
  update(data, row, { title: "サンプル便の名称変更" });
  assert.deepEqual(row.orders, saved);
  update(data, row, { orders: [] });
  assert.equal("orders" in row, false);
  assert.deepEqual(importShipmentViews(data, "JAPAN", today).find((view) => view.id === row.id)!.orders, []);
});

test("order and item IDs are retained only in their own shipment/order and duplicate IDs are replaced", () => {
  const data = importShipmentsFixture(), row = shipment(data);
  update(data, row, { orders: sampleOrders });
  const [first, second] = structuredClone(row.orders!);
  update(data, row, { orders: [first, { ...second, items: [first.items[0], first.items[0]] }, first] });
  assert.equal(row.orders![0].id, first.id);
  assert.equal(row.orders![0].items[0].id, first.items[0].id);
  assert.notEqual(row.orders![2].id, first.id);
  assert.notEqual(row.orders![2].items[0].id, first.items[0].id);
  assert.notEqual(row.orders![1].items[0].id, first.items[0].id);
  assert.equal(new Set(row.orders!.map((order) => order.id)).size, 3);
  const items = row.orders![0].items;
  update(data, row, { orders: [{ ...first, items: [items[0], items[0]] }] });
  assert.equal(row.orders![0].items[0].id, first.items[0].id);
  assert.notEqual(row.orders![0].items[1].id, first.items[0].id);
  const other = shipment(data, "ship-old");
  update(data, other, { orders: row.orders });
  assert.notEqual(other.orders![0].id, row.orders![0].id);
  assert.notEqual(other.orders![0].items[0].id, row.orders![0].items[0].id);
});

test("client fallback requires an absent order client and a live company-scoped project and client", () => {
  const data = importShipmentsFixture(), row = shipment(data);
  update(data, row, { orders: sampleOrders });
  const view = () => importShipmentViews(data, "JAPAN", today).find((view) => view.id === row.id)!;
  row.orders![0].clientId = "missing";
  assert.equal(view().orders[0].clientSource, "NONE"); assert.equal(view().orders[0].clientName, "");
  assert.equal(view().orders[1].clientSource, "PROJECT");
  data.clients[0].deletedAt = timestamp;
  assert.equal(view().projectClient, undefined); assert.equal(view().orders[1].clientSource, "NONE");
  delete data.clients[0].deletedAt; data.clients[0].company = "CHINA";
  assert.equal(view().projectClient, undefined);
  data.clients[0].company = "JAPAN"; data.projects[0].deletedAt = timestamp;
  assert.equal(view().projectClient, undefined);
  delete data.projects[0].deletedAt; data.projects[0].company = "CHINA";
  assert.equal(view().projectClient, undefined);
});

test("stages save their dates and custom keys, omit blank text, preserve absent values and remove empty arrays", () => {
  const data = importShipmentsFixture(), row = shipment(data);
  const stages = [{ key: "PRODUCTION", label: " 製作 ", startedAt: "2026-11-01", plannedAt: "2026-11-10", completedAt: "", memo: " " },
    { key: "INSPECTION", label: "検品", completedAt: "2026-11-02" }];
  update(data, row, { stages });
  assert.deepEqual(row.stages, [{ key: "PRODUCTION", label: "製作", startedAt: "2026-11-01", plannedAt: "2026-11-10" },
    { key: "INSPECTION", label: "検品", completedAt: "2026-11-02" }]);
  const saved = structuredClone(row.stages);
  update(data, row); assert.deepEqual(row.stages, saved);
  update(data, row, { stages: [] }); assert.equal("stages" in row, false);
  const created = mutate(data, { action: "create", title: "サンプル便", orders: [], stages });
  assert.equal(shipment(data, created.id).stages?.length, 2); assert.equal(shipment(data, created.id).orders, undefined);
});

const invalidDetails: Array<{ name: string; fields: Partial<Create>; error: RegExp }> = [
  { name: "empty item name", fields: { orders: [{ items: [{ name: "  " }] }] }, error: /品名を入力してください/ },
  { name: "bad order date", fields: { orders: [{ orderedAt: "2026-02-30", items: [] }] }, error: /日付/ },
  { name: "bad requested date", fields: { orders: [{ requestedDeliveryDate: "2026/11/06", items: [] }] }, error: /日付/ },
  { name: "bad item date", fields: { orders: [{ items: [{ name: "袋", requestedDeliveryDate: "2026-13-01" }] }] }, error: /日付/ },
  { name: "bad stage date", fields: { stages: [{ key: "PRODUCTION", label: "製作", plannedAt: "2026-02-29" }] }, error: /日付/ },
  { name: "completion before start", fields: { stages: [{ key: "PRODUCTION", label: "製作", startedAt: "2026-11-06", completedAt: "2026-11-05" }] }, error: /完了日が開始日より前です/ },
  { name: "unknown client", fields: { orders: [{ clientId: "missing", items: [] }] }, error: /クライアントが見つかりません/ },
  { name: "other-company client", fields: { orders: [{ clientId: "foreign", items: [] }] }, error: /クライアントが見つかりません/ },
  { name: "deleted client", fields: { orders: [{ clientId: "deleted", items: [] }] }, error: /クライアントが見つかりません/ },
  { name: "too many items", fields: { orders: [{ items: Array.from({ length: 101 }, () => ({ name: "袋" })) }] }, error: /100/ },
  { name: "too many orders", fields: { orders: Array.from({ length: 21 }, () => ({ items: [] })) }, error: /20/ },
  { name: "too many stages", fields: { stages: Array.from({ length: 13 }, (_, index) => ({ key: `STAGE_${index}`, label: "工程" })) }, error: /12/ },
  { name: "duplicate stage keys", fields: { stages: [{ key: "X", label: "工程1" }, { key: "X", label: "工程2" }] }, error: /重複/ },
  { name: "invalid stage key", fields: { stages: [{ key: "lowercase", label: "工程" }] }, error: /工程キー/ },
  { name: "empty stage label", fields: { stages: [{ key: "X", label: " " }] }, error: /工程名/ },
  { name: "negative quantity", fields: { orders: [{ items: [{ name: "袋", quantity: -1 }] }] }, error: /0/ },
  { name: "large quantity", fields: { orders: [{ items: [{ name: "袋", quantity: 1e9 + 1 }] }] }, error: /1000000000/ },
  { name: "infinite quantity", fields: { orders: [{ items: [{ name: "袋", quantity: Infinity }] }] }, error: /number/ },
  { name: "long item name", fields: { orders: [{ items: [{ name: "袋".repeat(201) }] }] }, error: /200/ },
  { name: "long order number", fields: { orders: [{ orderNumber: "x".repeat(101), items: [] }] }, error: /100/ },
  { name: "long order memo", fields: { orders: [{ memo: "x".repeat(1001), items: [] }] }, error: /1000/ },
  { name: "long unit", fields: { orders: [{ items: [{ name: "袋", unit: "x".repeat(21) }] }] }, error: /20/ },
  { name: "long item note", fields: { orders: [{ items: [{ name: "袋", note: "x".repeat(201) }] }] }, error: /200/ },
  { name: "long stage label", fields: { stages: [{ key: "X", label: "x".repeat(41) }] }, error: /40/ },
  { name: "long stage memo", fields: { stages: [{ key: "X", label: "工程", memo: "x".repeat(501) }] }, error: /500/ },
];
for (const { name, fields, error } of invalidDetails) test(`detail validation rejects ${name} before changing stored data`, () => {
  const data = importShipmentsFixture(), row = shipment(data);
  data.clients.push({ ...data.clients[0], id: "foreign", company: "CHINA" }, { ...data.clients[0], id: "deleted", deletedAt: timestamp });
  const before = structuredClone(data);
  assert.throws(() => update(data, row, fields), error); assert.deepEqual(data, before);
  assert.throws(() => mutate(data, { action: "create", title: "サンプル便", ...fields }), error); assert.deepEqual(data, before);
});

test("detail saves reject roles without manage:imports, foreign scope/rows, deleted rows and stale versions", () => {
  const data = importShipmentsFixture(), row = shipment(data), before = structuredClone(data);
  const input = { action: "update" as const, id: row.id, version: row.updatedAt, title: row.title, orders: sampleOrders };
  for (const role of ["CHIEF_DESIGNER", "PROJECT_MANAGER", "MAIL_EDITOR", "DESIGNER", "GUEST"] as const) {
    assert.throws(() => applyImportShipmentMutation(data, { id: "reader", role }, "JAPAN", input), /権限/);
  }
  assert.throws(() => applyImportShipmentMutation(data, admin, "CHINA", input), /日本/);
  assert.throws(() => mutate(data, { ...input, version: "stale" }), /更新されています/);
  for (const id of ["missing", "ship-deleted"]) assert.throws(() => mutate(data, { ...input, id }), /輸入便が見つかりません/);
  assert.deepEqual(data, before);
  row.company = "CHINA";
  assert.throws(() => mutate(data, input), /輸入便が見つかりません/);
});

test("timeline has no current stage without dates and a start date alone never completes a stage", () => {
  const empty = importStageTimeline(undefined, today);
  assert.equal(empty.entered, false); assert.equal(empty.current, undefined); assert.equal(empty.next, undefined); assert.equal(empty.allDone, false);
  assert.deepEqual(empty.stages.map((stage) => [stage.key, stage.label, stage.state]), defaultImportStages.map((stage) => [stage.key, stage.label, "UPCOMING"]));
  const timeline = importStageTimeline([{ key: "ORDER_RECEIVED", label: "発注受付", startedAt: "2026-10-01" }], today);
  assert.equal(timeline.entered, true); assert.equal(timeline.current, "ORDER_RECEIVED"); assert.equal(timeline.stages[0].state, "CURRENT"); assert.equal(timeline.allDone, false);
  assert.equal(importStageTimeline([{ key: "PRODUCTION", label: "製作", memo: "確認中" }], today).entered, false);
});

test("current is the first incomplete stage; next skips incomplete stages without a plan and completed plans", () => {
  const timeline = importStageTimeline([
    { key: "ORDER_RECEIVED", label: "発注受付", plannedAt: "2026-10-01", completedAt: "2026-10-01" },
    { key: "SHIPMENT", label: "出荷", plannedAt: "2026-11-10" },
    { key: "CUSTOMS", label: "通関", plannedAt: "2026-11-07" },
  ], today);
  assert.equal(timeline.current, "PRODUCTION");
  assert.deepEqual(timeline.stages.map((stage) => stage.state), ["DONE", "CURRENT", "UPCOMING", "UPCOMING", "UPCOMING"]);
  assert.deepEqual(timeline.next, { key: "SHIPMENT", label: "出荷", date: "2026-11-10", daysLeft: 4, overdue: false });
  assert.equal(importStageTimeline([{ key: "DELIVERY", label: "納品", completedAt: "2026-11-01" }], today).current, "ORDER_RECEIVED");
});

test("timeline computes overdue and due-today calendar days, keeps custom stages in stored order and does not mutate", () => {
  const stages: ImportStage[] = [
    { key: "CUSTOM_B", label: "検品", plannedAt: "2026-11-12" },
    { key: "PRODUCTION", label: "サンプル製作", startedAt: "2026-10-30", plannedAt: "2026-11-04" },
    { key: "CUSTOM_A", label: "梱包" },
  ];
  const before = structuredClone(stages), timeline = importStageTimeline(stages, today);
  assert.equal(timeline.stages[1].label, "サンプル製作");
  assert.deepEqual(timeline.stages.slice(-2).map((stage) => stage.key), ["CUSTOM_B", "CUSTOM_A"]);
  assert.deepEqual(timeline.next, { key: "PRODUCTION", label: "サンプル製作", date: "2026-11-04", daysLeft: -2, overdue: true });
  assert.equal(importStageTimeline(stages, "2026-11-04").next?.overdue, false);
  assert.equal(importStageTimeline(stages, "2026-11-04").next?.daysLeft, 0);
  assert.deepEqual(stages, before);
  const complete = defaultImportStages.map((stage) => ({ ...stage, completedAt: today }));
  assert.equal(importStageTimeline(complete, today).allDone, true); assert.equal(importStageTimeline(complete, today).current, undefined);
  assert.equal(importStageTimeline(complete, today).next, undefined);
  const custom = importStageTimeline([...complete, { key: "CUSTOM", label: "検品", plannedAt: "2026-11-07" }], today);
  assert.equal(custom.current, "CUSTOM"); assert.equal(custom.allDone, false); assert.equal(custom.next?.key, "CUSTOM");
});

test("JST today crosses the date boundary at 15:00 UTC regardless of the machine time zone", () => {
  assert.equal(importToday(new Date("2026-11-05T14:59:59Z")), "2026-11-05");
  assert.equal(importToday(new Date("2026-11-05T15:00:00Z")), "2026-11-06");
});

test("requested dates list distinct sorted order dates and differing item dates, without inferring unspecified dates", () => {
  const orders: ImportOrder[] = [
    { id: "a", requestedDeliveryDate: "2026-11-20", items: [{ id: "a1", name: "袋", requestedDeliveryDate: "2026-11-18" }] },
    { id: "b", requestedDeliveryDate: "2026-11-10", items: [{ id: "b1", name: "箱", requestedDeliveryDate: "2026-11-10" }] },
    { id: "c", requestedDeliveryDate: "2026-11-10", items: [{ id: "c1", name: "布" }] },
  ];
  assert.deepEqual(importRequestedDates(orders), { dates: ["2026-11-10", "2026-11-20"], differs: true, itemOverrides: [{ orderId: "a", itemId: "a1", date: "2026-11-18" }] });
  assert.deepEqual(importRequestedDates(undefined), { dates: [], differs: false, itemOverrides: [] });
  assert.equal(importRequestedDates(orders.slice(1)).differs, false);
  assert.equal(importRequestedDates(orders.slice(0, 1)).differs, true);
  delete orders[0].requestedDeliveryDate;
  assert.deepEqual(importRequestedDates(orders.slice(0, 1)), { dates: [], differs: false, itemOverrides: [{ orderId: "a", itemId: "a1", date: "2026-11-18" }] });
});

test("manual creation/editing marks changed fill values, keeps unchanged sources, and clearing removes entries", () => {
  const data = importShipmentsFixture();
  const result = mutate(data, { action: "create", title: "サンプル便", goodsValue: 0, supplierName: "", brokerVendorId: "broker" });
  const row = shipment(data, result.id);
  assert.deepEqual(row.fieldSources, { goodsValue: "MANUAL", brokerVendorId: "MANUAL" });
  fillImportShipment(row, { permitNumber: "SYN-0011", dutyAmount: 0 });
  update(data, row, { goodsValue: 5, dutyAmount: 20 });
  assert.equal(row.fieldSources?.permitNumber, "DOCUMENT"); assert.equal(row.fieldSources?.dutyAmount, "MANUAL");
  update(data, row, { permitNumber: "", dutyAmount: undefined, brokerVendorId: "" });
  assert.deepEqual(row.fieldSources, { goodsValue: "MANUAL" });
  update(data, row, { goodsValue: undefined }); assert.equal(row.fieldSources, undefined);
  const legacy = shipment(data);
  update(data, legacy); assert.equal(legacy.fieldSources, undefined);
});

test("attach and group fills mark only written keys DOCUMENT and leave recorded zeros and detached values alone", () => {
  const data = importShipmentsFixture(), row = shipment(data, "ship-old");
  row.dutyAmount = 0; row.fieldSources = { dutyAmount: "MANUAL" };
  const assigned = mutate(data, { action: "assign", shipmentId: row.id, source: "mail", documentId: "permit-3" });
  assert.deepEqual(assigned.filled, ["permitNumber"]); assert.deepEqual(row.fieldSources, { dutyAmount: "MANUAL", permitNumber: "DOCUMENT" });
  mutate(data, { action: "assign", shipmentId: null, source: "mail", documentId: "permit-3" });
  assert.equal(row.permitNumber, "SYN-0003"); assert.equal(row.fieldSources?.permitNumber, "DOCUMENT");
  const grouped = mutate(data, { action: "group", shipmentId: null, title: "サンプル書類便", documents: [
    { source: "mail", documentId: "permit-3" }, { source: "received", documentId: "broker-3" },
  ] });
  const group = shipment(data, grouped.id);
  assert.ok(grouped.filled!.length > 0);
  assert.deepEqual(group.fieldSources, Object.fromEntries(grouped.filled!.map((key) => [key, "DOCUMENT"])));
});

function rereadFixture() {
  const data = importShipmentsFixture(), row = shipment(data);
  row.dutyAmount = 0; row.goodsValue = 1; row.importTaxNational = 1;
  row.fieldSources = { dutyAmount: "MANUAL", goodsValue: "DOCUMENT" };
  const permit = data.mailDocuments.find((mail) => mail.id === "permit-1")!;
  permit.ocrText = "サンプル許可通知書.pdf\n輸入許可通知書\n許可日 2026-10-06\n入港日 2026-10-03\n課税価格 600,000円\n関税額 16,000円\n消費税額 41,000円\n地方消費税額 12,000円";
  return { data, row };
}

test("read-only re-read preview reports manual, document, unknown and empty sources plus document evidence", () => {
  const { data, row } = rereadFixture(), before = structuredClone(data), changes = importRereadChanges(data, "JAPAN", row);
  const change = (key: string) => changes.find((change) => change.key === key)!;
  assert.equal(change("dutyAmount").source, "MANUAL"); assert.equal(change("dutyAmount").before, 0); assert.equal(change("dutyAmount").after, 16000);
  assert.equal(change("goodsValue").source, "DOCUMENT"); assert.equal(change("importTaxNational").source, "UNKNOWN");
  assert.equal(change("arrivalDate").source, "EMPTY"); assert.equal(change("arrivalDate").before, undefined);
  for (const change of changes) {
    assert.equal(change.label, importFillLabels[change.key]);
    assert.deepEqual(change.document, { kind: "IMPORT_PERMIT", displayName: "サンプル許可通知書.pdf" });
  }
  assert.deepEqual(data, before);
});

test("selective re-read writes only selected keys and provenance; omitted keys retain the old write-all behaviour", () => {
  const { data, row } = rereadFixture(), before = structuredClone(row);
  const preview = importRereadChanges(data, "JAPAN", row);
  const selected = mutate(data, { action: "reread", id: row.id, version: row.updatedAt, keys: ["dutyAmount", "arrivalDate"] });
  assert.equal(selected.action, "reread");
  assert.deepEqual(selected.changed, preview.filter((change) => ["dutyAmount", "arrivalDate"].includes(change.key)).map(({ key, before, after }) => ({ key, before, after })));
  assert.equal(row.dutyAmount, 16000); assert.equal(row.arrivalDate, "2026-10-03");
  assert.equal(row.fieldSources?.dutyAmount, "DOCUMENT"); assert.equal(row.fieldSources?.arrivalDate, "DOCUMENT");
  assert.equal(row.goodsValue, before.goodsValue); assert.equal(row.importTaxNational, before.importTaxNational);
  const version = row.updatedAt;
  const empty = mutate(data, { action: "reread", id: row.id, version, keys: [] });
  assert.equal(empty.action, "reread"); assert.deepEqual(empty.changed, []); assert.equal(row.updatedAt, version);
  assert.throws(() => mutate(data, { action: "reread", id: row.id, version: before.updatedAt, keys: ["goodsValue"] }), /更新されています/);
  const rest = importRereadChanges(data, "JAPAN", row);
  const reread = mutate(data, { action: "reread", id: row.id, version });
  assert.equal(reread.action, "reread");
  assert.deepEqual(reread.changed, rest.map(({ key, before, after }) => ({ key, before, after })));
  for (const change of rest) { assert.equal(row[change.key], change.after); assert.equal(row.fieldSources?.[change.key], "DOCUMENT"); }
  assert.deepEqual(importRereadChanges(data, "JAPAN", row), []);
});

test("re-read keys reject non-fill keys, more than 20 entries, and actors without manage:imports", () => {
  const { data, row } = rereadFixture(), before = structuredClone(data);
  const input = { action: "reread" as const, id: row.id, version: row.updatedAt };
  assert.throws(() => mutate(data, { ...input, keys: ["title"] } as unknown as ImportShipmentMutation), /Invalid/);
  assert.throws(() => mutate(data, { ...input, keys: Array.from({ length: 21 }, () => "dutyAmount" as const) }), /20/);
  assert.throws(() => applyImportShipmentMutation(data, manager, "JAPAN", { ...input, keys: ["dutyAmount"] }), /権限/);
  assert.throws(() => applyImportShipmentMutation(data, admin, "CHINA", input), /日本/);
  assert.deepEqual(data, before);
});

test("legacy shipments render without inferred orders/stages and every board document carries preview metadata", () => {
  const data = importShipmentsFixture(), before = structuredClone(data), views = importShipmentViews(data, "JAPAN", today);
  const first = views.find((view) => view.id === "ship-1")!;
  assert.deepEqual(first.orders, []); assert.deepEqual(first.fieldSources, {});
  assert.equal(first.timeline.entered, false); assert.equal(first.timeline.current, undefined);
  assert.deepEqual(first.requestedDates, { dates: [], differs: false, itemOverrides: [] });
  assert.equal(first.missing.length, 0); assert.equal(first.timeline.allDone, false);
  for (const document of [...views.flatMap((view) => view.documents), ...unassignedImportDocuments(data, "JAPAN")]) {
    assert.ok(document.fileUrl?.endsWith(".pdf")); assert.equal(document.mimeType, "application/pdf"); assert.ok(document.fileName);
  }
  assert.deepEqual(data, before);
  assert.deepEqual(importOrderItemKinds.map((kind) => kind.label), ["袋", "印刷物", "箱", "布製品", "照明", "家具", "その他"]);
});

test("import viewers may open attached mail and invoice originals even outside document-library project visibility", () => {
  const data = importShipmentsFixture(), chief = { id: "unassigned-chief", role: "CHIEF_DESIGNER" as const }, before = structuredClone(data);
  assert.equal(documentRows(data, chief, "JAPAN").some((row) => ["/api/files/permit-1.pdf", "/api/files/broker-1.pdf"].includes(row.fileUrl ?? "")), false);
  for (const name of ["permit-1.pdf", "broker-1.pdf", "packing-1.pdf", "supplier-1.pdf"]) assert.equal(canViewImportFile(data, chief, name), true, name);
  assert.equal(canViewImportFile(data, chief, "permit-3.pdf"), false); assert.equal(canViewImportFile(data, chief, "broker-3.pdf"), false);
  assert.equal(canViewImportFile(data, chief, "receipt-1.pdf"), false);
  for (const role of ["PROJECT_MANAGER", "DESIGNER", "MAIL_EDITOR", "BILLING_EDITOR", "GUEST"] as const) assert.equal(canViewImportFile(data, { role }, "permit-1.pdf"), false, role);
  assert.deepEqual(data, before);
});

test("import file access is limited to live same-company document, shipment and invoice project rows", () => {
  const chief = { role: "CHIEF_DESIGNER" as const };
  for (const source of ["mail", "received"] as const) {
    for (const variant of ["document-deleted", "document-foreign", "shipment-deleted", "shipment-foreign", "shipment-missing", "project-deleted", "project-missing"]) {
      const data = importShipmentsFixture();
      const document = source === "mail" ? data.mailDocuments[0] : data.receivedInvoices[0];
      if (variant === "document-deleted") document.deletedAt = timestamp;
      if (variant === "document-foreign") {
        if (source === "mail") data.mailDocuments[0].company = "CHINA"; else data.projects[0].company = "CHINA";
      }
      if (variant === "shipment-deleted") shipment(data).deletedAt = timestamp;
      if (variant === "shipment-foreign") shipment(data).company = "CHINA";
      if (variant === "shipment-missing") document.importShipmentId = "missing";
      if (variant.startsWith("project")) {
        if (source === "mail") continue;
        if (variant === "project-deleted") data.projects[0].deletedAt = timestamp; else data.receivedInvoices[0].projectId = "missing";
      }
      assert.equal(canViewImportFile(data, chief, source === "mail" ? "permit-1.pdf" : "broker-1.pdf"), false, `${source} ${variant}`);
    }
  }
  const data = importShipmentsFixture();
  for (const name of ["", ".", "..", "../permit-1.pdf", "unrelated.pdf"]) assert.equal(canViewImportFile(data, chief, name), false);
  for (const prefix of ["/api/files/", "/uploads/received-invoices/"]) {
    const name = "サンプル 許可書.pdf";
    data.mailDocuments[0].fileUrl = prefix + encodeURIComponent(name);
    assert.equal(canViewImportFile(data, chief, name), true);
  }
});
