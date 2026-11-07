import assert from "node:assert/strict";
import test from "node:test";
import { admin } from "./document-fixture";
import { importShipmentsFixture } from "./import-shipments-fixture";
import { dirtyFieldCount, draftAmounts, initialShipmentDraft, reconcileShipmentDraft, shipmentDraft, shipmentUpdate, shortImportDate } from "../src/lib/import-detail-draft";
import { applyImportShipmentMutation, importShipmentViews } from "../src/lib/import-shipment-views";
import { importRequestedDates, importShipmentAmounts, importStageTimeline } from "../src/lib/import-shipments";
import { originalPdfPageCount } from "../src/lib/original-file-preview";

const today = "2026-11-06";
function fixture() {
  const data = importShipmentsFixture(), row = data.importShipments![0];
  row.orders = [{ id: "order-1", orderNumber: "SYN-01", memo: "Keep order memo", requestedDeliveryDate: "2026-11-20",
    items: [{ id: "item-1", name: "Synthetic item", quantity: 0, unit: "枚", kind: "BAG", requestedDeliveryDate: "2026-11-22" }] }];
  row.stages = [{ key: "ORDER_RECEIVED", label: "発注受付", completedAt: "2026-11-01" },
    { key: "PRODUCTION", label: "製作", startedAt: "2026-11-02", plannedAt: "2026-11-10" },
    { key: "CHECK", label: "検品", memo: "Keep custom stage" }];
  const view = () => importShipmentViews(data, "JAPAN", today).find((value) => value.id === row.id)!;
  return { data, row, view };
}

test("detail draft distinguishes missing amounts from zero and never stores project-derived clients", () => {
  const { view } = fixture(), value = view(), draft = shipmentDraft(value);
  assert.equal(value.otherCost, 0); assert.equal(draft.otherCost, "");
  assert.equal(draft.orders[0].items[0].quantity, "0");
  assert.equal(value.orders[0].clientSource, "PROJECT");
  assert.equal(draft.orders[0].clientId, undefined);
  assert.equal("clientName" in draft.orders[0], false); assert.equal("clientSource" in draft.orders[0], false);
  assert.ok(draft.stages.every((stage) => !("state" in stage)));
  assert.equal(dirtyFieldCount(draft, structuredClone(draft)), 0);
});

test("single detail save preserves scalars, order memo, owned IDs and custom stages through the strict mutation", () => {
  const { data, row, view } = fixture(), original = structuredClone(row), draft = shipmentDraft(view());
  draft.orders[0].items[0].quantity = "12.5";
  draft.stages.find((stage) => stage.key === "PRODUCTION")!.plannedAt = "2026-11-12";
  draft.otherCost = "0";
  assert.equal(dirtyFieldCount(shipmentDraft(view()), draft), 3);
  const input = shipmentUpdate(draft, row.id, row.updatedAt);
  applyImportShipmentMutation(data, admin, "JAPAN", input);
  for (const key of ["projectId", "supplierName", "brokerVendorId", "permitNumber", "permitDate", "goodsValue", "dutyAmount", "importTaxNational", "importTaxLocal", "brokerFee", "status", "memo"] as const) assert.equal(row[key], original[key], key);
  assert.equal(row.orders![0].id, "order-1"); assert.equal(row.orders![0].items[0].id, "item-1");
  assert.equal(row.orders![0].items[0].quantity, 12.5); assert.equal(row.orders![0].memo, "Keep order memo");
  assert.equal(row.orders![0].clientId, undefined); assert.equal(row.otherCost, 0);
  assert.equal(row.stages!.find((stage) => stage.key === "CHECK")!.memo, "Keep custom stage");
  assert.equal(view().timeline.next!.date, "2026-11-12");
});

test("legacy detail save leaves absent orders and unentered stages absent", () => {
  const data = importShipmentsFixture(), view = importShipmentViews(data, "JAPAN", today).find((row) => row.id === "ship-old")!;
  const draft = shipmentDraft(view); draft.title = "Changed legacy title";
  assert.deepEqual(draft.orders, []); assert.equal(draft.stages.length, 5);
  applyImportShipmentMutation(data, admin, "JAPAN", shipmentUpdate(draft, view.id, view.updatedAt));
  const saved = data.importShipments!.find((row) => row.id === view.id)!;
  assert.equal(saved.orders, undefined); assert.equal(saved.stages, undefined);
  assert.equal(importStageTimeline(saved.stages, today).entered, false);
});

test("dirty counter follows row identity, counts field edits, and counts added/deleted rows once", () => {
  const { view } = fixture(), draft = shipmentDraft(view()), next = structuredClone(draft);
  next.orders[0].items[0].note = "";
  assert.equal(dirtyFieldCount(draft, next), 0);
  next.orders[0].orderNumber = "changed"; next.orders[0].items[0].note = "New note";
  assert.equal(dirtyFieldCount(draft, next), 2);
  next.orders[0].items.push({ id: "new", name: "New item", quantity: "3" });
  assert.equal(dirtyFieldCount(draft, next), 3);
  next.orders = [];
  assert.equal(dirtyFieldCount(draft, next), 1);
});

test("draft totals and schedule immediately reflect unsaved values without changing requested dates into actuals", () => {
  const { view } = fixture(), draft = shipmentDraft(view());
  draft.goodsValue = "100"; draft.dutyAmount = "0"; draft.importTaxNational = "10"; draft.importTaxLocal = "2"; draft.brokerFee = "3"; draft.otherCost = "";
  assert.equal(importShipmentAmounts(draftAmounts(draft)).landedCost, 115);
  draft.stages.find((stage) => stage.key === "PRODUCTION")!.plannedAt = "2026-11-04";
  const timeline = importStageTimeline(draft.stages, today);
  assert.equal(timeline.next!.daysLeft, -2); assert.equal(timeline.stages[1].state, "CURRENT");
  assert.equal(timeline.stages[1].completedAt, undefined);
  const request = importRequestedDates(view().orders);
  assert.deepEqual(request.dates, ["2026-11-20"]); assert.equal(request.itemOverrides[0].date, "2026-11-22");
});

test("refreshes preserve unsaved edits and their original optimistic version, including after attachments", () => {
  const { view } = fixture(), before = view(), state = initialShipmentDraft(before);
  state.draft = { ...state.draft, title: "Local edit" };
  const remote = { ...before, title: "Remote title", updatedAt: "2026-11-06T12:00:00.000Z" };
  const refreshed = reconcileShipmentDraft(state, remote);
  assert.equal(refreshed.draft.title, "Local edit"); assert.equal(refreshed.version, before.updatedAt);
  assert.equal(refreshed.seenVersion, remote.updatedAt);
  assert.equal(reconcileShipmentDraft(refreshed, remote), refreshed);
  const reverted = reconcileShipmentDraft({ ...refreshed, draft: refreshed.baseline }, remote);
  assert.equal(reverted.draft.title, "Remote title"); assert.equal(reverted.version, remote.updatedAt);
});

test("clean refresh and successful save adopt server normalization and regenerated IDs exactly once", () => {
  const { data, row, view } = fixture(), original = view(), state = initialShipmentDraft(original);
  state.draft = { ...state.draft, orders: [...state.draft.orders, { id: "local-id", items: [] }] };
  const saved = applyImportShipmentMutation(data, admin, "JAPAN", shipmentUpdate(state.draft, row.id, row.updatedAt));
  assert.ok("updatedAt" in saved);
  const accepted = reconcileShipmentDraft({ ...state, acceptedVersion: row.updatedAt }, view());
  assert.equal(dirtyFieldCount(accepted.baseline, accepted.draft), 0);
  assert.notEqual(accepted.draft.orders[1].id, "local-id");
  assert.equal(accepted.version, row.updatedAt);
  assert.equal(reconcileShipmentDraft(accepted, view()), accepted);
  assert.equal(reconcileShipmentDraft(initialShipmentDraft(original), view()).draft.orders.length, 2);
});

test("clearing quantities and costs stays empty, invalid numeric drafts are rejected by the server", () => {
  const { data, row, view } = fixture(), draft = shipmentDraft(view());
  draft.orders[0].items[0].quantity = ""; draft.brokerFee = "";
  applyImportShipmentMutation(data, admin, "JAPAN", shipmentUpdate(draft, row.id, row.updatedAt));
  assert.equal(row.orders![0].items[0].quantity, undefined); assert.equal(row.brokerFee, undefined);
  const invalid = shipmentDraft(view()); invalid.goodsValue = "not a number";
  assert.throws(() => applyImportShipmentMutation(data, admin, "JAPAN", shipmentUpdate(invalid, row.id, row.updatedAt)));
});

test("short dates use the supplied Japan year, keeping other years explicit", () => {
  assert.equal(shortImportDate("2026-11-06", today), "11/6");
  assert.equal(shortImportDate("2025-11-06", today), "2025/11/6");
  assert.equal(shortImportDate(undefined, today), "未入力");
});

test("cheap PDF page counts ignore stream contents and fall back to unknown for uncertain page trees", () => {
  const plain = "%PDF-1.4\n1 0 obj << /Type /Pages /Count 2 >> endobj\n2 0 obj << /Type /Page >> endobj\n3 0 obj << /Type /Page >> endobj";
  assert.equal(originalPdfPageCount(plain), 2);
  assert.equal(originalPdfPageCount(`${plain}\n4 0 obj << >> stream\n/Type /Page\nendstream\nendobj`), 2);
  for (const uncertain of [plain.replace("/Count 2", "/Count 3"), `${plain}\n/Type /ObjStm`, `${plain}\n/Encrypt`, `${plain}\n/Prev 1`, "%PDF-1.4", "not a PDF"]) assert.equal(originalPdfPageCount(uncertain), undefined);
});
