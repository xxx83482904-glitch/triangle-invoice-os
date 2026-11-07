import type { CompanyScope } from "./company";
import { shortImportDate } from "./import-detail-draft";
import type { ImportShipmentView } from "./import-shipment-views";
import { defaultImportStages } from "./import-shipments";

export function importShipmentHref(company: CompanyScope, id: string) {
  return `/imports/${encodeURIComponent(id)}?company=${encodeURIComponent(company)}`;
}

export function legacyImportShipmentHref(company: CompanyScope, shipment?: string | string[]) {
  const id = Array.isArray(shipment) ? shipment[0] : shipment;
  return id?.trim() ? importShipmentHref(company, id) : undefined;
}

export function matchesImportSearch(row: ImportShipmentView, query: string) {
  const needle = query.trim().toLocaleLowerCase("ja-JP");
  return !needle || [row.title, row.supplierName, row.brokerName, row.projectName, row.permitNumber,
    row.blNumber, row.invoiceNumber, row.memo, ...row.orders.flatMap((order) => [order.clientName, order.orderNumber])]
    .some((value) => value?.toLocaleLowerCase("ja-JP").includes(needle));
}

export function importListSummary(row: ImportShipmentView, today: string) {
  const { timeline, requestedDates, orders } = row;
  const current = timeline.stages.find((stage) => stage.key === timeline.current);
  const completedAt = timeline.allDone ? timeline.stages.find((stage) => stage.key === "DELIVERY")?.completedAt : undefined;
  const dates = [...new Set([...requestedDates.dates, ...requestedDates.itemOverrides.map((item) => item.date)])].sort();
  return {
    client: orders[0]?.clientName || "未設定",
    clientFromProject: orders[0]?.clientSource === "PROJECT",
    order: !orders.length ? "注文未登録" : orders.length === 1 && orders[0].orderNumber ? orders[0].orderNumber : `注文 ${orders.length}件`,
    segments: defaultImportStages.map(({ key }) => timeline.stages.find((stage) => stage.key === key)?.state ?? "UPCOMING"),
    stage: timeline.allDone ? "納品済み" : current?.label ?? "工程未入力",
    actual: completedAt ? `実績 ${shortImportDate(completedAt, today)}` : undefined,
    next: timeline.next ? `${shortImportDate(timeline.next.date, today)} ${timeline.next.label}の完了予定` : "—",
    remaining: timeline.next ? timeline.next.overdue ? `${Math.abs(timeline.next.daysLeft)}日超過` : `あと${timeline.next.daysLeft}日` : undefined,
    overdue: timeline.next?.overdue ?? false,
    requested: dates.length ? dates.map((date) => shortImportDate(date, today)).join("・") : "—",
    documents: `${row.checklist.filter((entry) => entry.documents.length).length}/5種類`,
  };
}
