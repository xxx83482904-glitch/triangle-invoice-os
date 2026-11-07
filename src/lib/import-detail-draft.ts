import type { ImportShipmentMutation, ImportShipmentView } from "./import-shipment-views";
import { defaultImportStages } from "./import-shipments";
import type { ImportOrder, ImportOrderItem, ImportShipmentStatus, ImportStage } from "./types";

export type DetailOption = { value: string; label: string; clientId?: string };
export const detailAmountFields = [
  ["goodsValue", "課税価格（CIF）"], ["dutyAmount", "関税"], ["importTaxNational", "輸入消費税（国税）"],
  ["importTaxLocal", "地方消費税"], ["brokerFee", "通関手数料など"], ["otherCost", "その他の費用"],
] as const;
export const detailTextKeys = ["title", "projectId", "supplierName", "brokerVendorId", "permitNumber", "permitDate", "arrivalDate", "blNumber", "invoiceNumber", "folderMonth", "memo"] as const;
export type DetailAmountKey = (typeof detailAmountFields)[number][0];
export type DetailItem = Omit<ImportOrderItem, "quantity"> & { quantity: string };
export type DetailOrder = Omit<ImportOrder, "items"> & { items: DetailItem[] };
export type ShipmentDraft = Record<(typeof detailTextKeys)[number] | DetailAmountKey, string> & {
  status: ImportShipmentStatus; orders: DetailOrder[]; stages: ImportStage[];
};

export function shipmentDraft(view: ImportShipmentView): ShipmentDraft {
  return {
    ...Object.fromEntries(detailTextKeys.map((key) => [key, view[key] ?? ""])) as Pick<ShipmentDraft, (typeof detailTextKeys)[number]>,
    ...Object.fromEntries(detailAmountFields.map(([key]) => [key, view.recorded[key]?.toString() ?? ""])) as Record<DetailAmountKey, string>,
    status: view.status,
    orders: view.orders.map((order) => ({
      id: order.id, clientId: order.clientId, orderNumber: order.orderNumber, orderedAt: order.orderedAt,
      requestedDeliveryDate: order.requestedDeliveryDate, memo: order.memo,
      items: order.items.map((item) => ({ ...item, quantity: item.quantity?.toString() ?? "" })),
    })),
    stages: view.timeline.stages.map((stage) => ({ key: stage.key, label: stage.label, startedAt: stage.startedAt,
      plannedAt: stage.plannedAt, completedAt: stage.completedAt, memo: stage.memo })),
  };
}

export function draftAmounts(draft: ShipmentDraft) {
  return Object.fromEntries(detailAmountFields.map(([key]) => [key, draft[key].trim() === "" ? undefined : Number(draft[key])])) as Record<DetailAmountKey, number | undefined>;
}

export function draftOrders(draft: ShipmentDraft): ImportOrder[] {
  return draft.orders.map((order) => ({ ...order, items: order.items.map((item) => ({
    ...item, quantity: item.quantity.trim() === "" ? undefined : Number(item.quantity),
  })) }));
}

export function shipmentUpdate(draft: ShipmentDraft, id: string, version: string): ImportShipmentMutation {
  const stages = draft.stages.filter((stage) => stage.startedAt || stage.plannedAt || stage.completedAt || stage.memo
    || !defaultImportStages.some((standard) => standard.key === stage.key && standard.label === stage.label));
  return { ...draft, ...draftAmounts(draft), orders: draftOrders(draft), stages, action: "update", id, version };
}

// A new/deleted row is one change; edits to an existing row count by field. IDs are stable across switches.
export function dirtyFieldCount(before: unknown, after: unknown): number {
  if (Array.isArray(before) && Array.isArray(after)) {
    const identity = (row: { id?: string; key?: string }) => row.id ?? row.key;
    const old = new Map(before.map((row) => [identity(row), row]));
    const next = new Map(after.map((row) => [identity(row), row]));
    return [...new Set([...old.keys(), ...next.keys()])].reduce((count, key) =>
      count + (!old.has(key) || !next.has(key) ? 1 : dirtyFieldCount(old.get(key), next.get(key))), 0);
  }
  if (before && after && typeof before === "object" && typeof after === "object") {
    const old = before as Record<string, unknown>, next = after as Record<string, unknown>;
    return [...new Set([...Object.keys(old), ...Object.keys(next)])].reduce((count, key) => count + dirtyFieldCount(old[key], next[key]), 0);
  }
  return (before ?? "") === (after ?? "") ? 0 : 1;
}

export function shortImportDate(value: string | undefined, today: string) {
  if (!value) return "未入力";
  const [year, month, day] = value.split("-");
  return `${year === today.slice(0, 4) ? "" : `${year}/`}${Number(month)}/${Number(day)}`;
}

export type ShipmentDraftState = { baseline: ShipmentDraft; draft: ShipmentDraft; version: string; seenVersion: string; acceptedVersion?: string };
export function initialShipmentDraft(view: ImportShipmentView): ShipmentDraftState {
  const draft = shipmentDraft(view);
  return { baseline: draft, draft, version: view.updatedAt, seenVersion: view.updatedAt };
}
export function reconcileShipmentDraft(state: ShipmentDraftState, view: ImportShipmentView): ShipmentDraftState {
  const dirty = dirtyFieldCount(state.baseline, state.draft);
  if (!dirty && state.version !== view.updatedAt) return initialShipmentDraft(view);
  if (state.seenVersion === view.updatedAt && state.acceptedVersion !== view.updatedAt) return state;
  if (!dirty || state.acceptedVersion === view.updatedAt) return initialShipmentDraft(view);
  // A refresh caused by an upload or another editor must never discard local edits or bypass the version check.
  return { ...state, seenVersion: view.updatedAt };
}
