import { formatMoney } from "./format";
import type { DetailOption } from "./import-detail-draft";
import type { ImportRereadChange } from "./import-shipment-views";
import { importFillLabels } from "./import-shipments";
import type { ImportFillKey } from "./types";

const amountKeys = new Set<ImportFillKey>(["goodsValue", "dutyAmount", "importTaxNational", "importTaxLocal", "brokerFee"]);
export const rereadSourceLabels = { MANUAL: "手入力", DOCUMENT: "書類から", UNKNOWN: "由来不明", EMPTY: "未入力" } as const;
export const importConflictMessage = "ほかの人が先にこの便を更新しました。最新を読み込んで、入力内容と見比べてください。";

export function defaultRereadKeys(changes: ImportRereadChange[]) {
  return changes.filter((change) => change.source !== "MANUAL").map((change) => change.key);
}

export function formatRereadValue(key: ImportFillKey, value: string | number | undefined, vendors: DetailOption[]) {
  if (value === undefined || value === "") return "未入力";
  if (amountKeys.has(key)) return formatMoney(Number(value));
  if (key === "permitDate" || key === "arrivalDate") return String(value).replaceAll("-", "/");
  if (key === "brokerVendorId") return vendors.find((vendor) => vendor.value === value)?.label ?? "登録済みの通関業者（現在選択不可）";
  return String(value);
}

export function rereadSuccessMessage(changed: { key: ImportFillKey }[]) {
  return changed.length ? `${changed.map(({ key }) => importFillLabels[key]).join("・")}を書き直しました。元の値は画面右上の取り消しで戻せます。`
    : "書類から読み直せる項目はありませんでした。";
}
