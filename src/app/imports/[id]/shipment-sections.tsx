"use client";

import { RefreshCw } from "lucide-react";
import type { RefObject } from "react";
import { Money } from "@/components/app/money";
import { OptionTabs } from "@/components/app/option-tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/format";
import { detailAmountFields, draftAmounts, type DetailOption, type ShipmentDraft } from "@/lib/import-detail-draft";
import type { ImportShipmentView } from "@/lib/import-shipment-views";
import { importShipmentAmounts, importShipmentStatusLabels, importShipmentStatuses } from "@/lib/import-shipments";
import type { ImportFillKey } from "@/lib/types";
import { DetailField, DetailSection, detailSelectClass, FieldSource } from "./detail-fields";

type SectionProps = { draft: ShipmentDraft; baseline: ShipmentDraft; sources: ImportShipmentView["fieldSources"]; canEdit: boolean; onChange: (draft: ShipmentDraft) => void };

export function CostsSection({ draft, baseline, sources, canEdit, onChange, onReread, canReread, dirty, rereadRef }: SectionProps & { onReread: () => void; canReread: boolean; dirty: boolean; rereadRef: RefObject<HTMLButtonElement | null> }) {
  const amounts = importShipmentAmounts(draftAmounts(draft));
  return <DetailSection title="費用・税額" badge="便全体" summary={<span className="flex flex-wrap gap-x-2">関税 <Money value={amounts.dutyAmount} />・輸入消費税 <Money value={amounts.importTax} /></span>}>
    <p className="text-xs text-muted-foreground">この便全体の金額です（注文・品目ごとには分けません）</p>
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
      {detailAmountFields.map(([key, label]) => <label key={key} className="min-w-0 space-y-1 text-xs">
        <span className="flex flex-wrap items-center justify-between gap-1 text-muted-foreground">{label}<FieldSource value={draft[key]} source={key === "otherCost" ? undefined : sources[key]} changed={baseline[key] !== draft[key]} /></span>
        {canEdit ? <Input aria-label={label} type="number" inputMode="decimal" min="0" max="1000000000000" step="any" className="text-right tabular-nums" value={draft[key]} onChange={(event) => onChange({ ...draft, [key]: event.target.value })} />
          : <span className="block whitespace-nowrap py-2 text-right text-sm">{draft[key] ? <Money value={Number(draft[key])} /> : "未入力"}</span>}
      </label>)}
    </div>
    <div className="flex flex-wrap justify-between gap-3 rounded-lg bg-[var(--track)] p-3 text-xs">
      <span>諸費用合計 <Money value={amounts.costTotal} className="font-medium" /></span>
      <span>着地原価 <Money value={amounts.landedCost} className="font-medium" /></span>
    </div>
    <div className="space-y-2"><div className="flex flex-wrap items-center gap-2"><span className="text-xs text-muted-foreground">経理の確認</span>
      {canEdit ? <OptionTabs label="経理の確認" value={draft.status} options={importShipmentStatuses.map((value) => [value, importShipmentStatusLabels[value]] as const)} onChange={(status) => onChange({ ...draft, status })} />
        : <span className="text-xs">{importShipmentStatusLabels[draft.status]}</span>}</div><p className="text-xs text-muted-foreground">工程（物流）とは別に管理</p></div>
    {canEdit ? <div className="space-y-1 border-t border-[var(--rule)] pt-3"><Button ref={rereadRef} type="button" variant="outline" size="sm" disabled={!canReread || dirty} aria-describedby={dirty ? "reread-disabled-reason" : undefined} onClick={onReread}><RefreshCw />書類から読み直す</Button>
      {dirty ? <p id="reread-disabled-reason" className="text-xs text-muted-foreground">先に保存してください</p> : null}</div> : null}
  </DetailSection>;
}

const infoFields = [
  ["title", "便名", "text", 200], ["projectId", "案件", "project", undefined], ["supplierName", "仕入先", "text", 200],
  ["brokerVendorId", "通関業者（支払先）", "vendor", undefined], ["permitNumber", "輸入許可番号", "text", 100],
  ["permitDate", "輸入許可日", "date", undefined], ["arrivalDate", "到着日", "date", undefined],
  ["blNumber", "B/L・AWB番号", "text", 100], ["invoiceNumber", "インボイス番号", "text", 100],
  ["folderMonth", "表示する月", "month", undefined], ["memo", "メモ", "memo", 2000],
] as const;
const sourced = new Set<string>(["supplierName", "brokerVendorId", "permitNumber", "permitDate", "arrivalDate", "blNumber", "invoiceNumber"]);

export function ShipmentInfoSection({ draft, baseline, sources, canEdit, onChange, projects, vendors }: SectionProps & { projects: DetailOption[]; vendors: DetailOption[] }) {
  const count = [...sourced].filter((key) => draft[key as keyof ShipmentDraft]).length;
  return <DetailSection title="便の情報・番号" badge="OCR・手入力" summary={`許可番号ほか ${count}項目`}>
    {infoFields.map(([key, label, type, maxLength]) => {
      const options = type === "project" ? projects : type === "vendor" ? vendors : undefined;
      return <DetailField key={key} label={label} caption={key === "folderMonth" ? "空欄なら許可日の月" : undefined}>
        {sourced.has(key) ? <div className="flex justify-end"><FieldSource value={draft[key]} source={sources[key as ImportFillKey]} changed={draft[key] !== baseline[key]} /></div> : null}
        {!canEdit ? <p className={`whitespace-pre-wrap py-1.5 text-sm ${type === "date" ? "whitespace-nowrap" : "break-words"}`}>{options ? options.find((option) => option.value === draft[key])?.label || "未設定" : draft[key] ? type === "date" ? formatDate(draft[key]) : draft[key] : "未入力"}</p>
          : options ? <select aria-label={label} className={detailSelectClass} value={draft[key]} onChange={(event) => onChange({ ...draft, [key]: event.target.value })}>
            <option value="">未設定</option>{draft[key] && !options.some((option) => option.value === draft[key]) ? <option value={draft[key]}>登録済み（現在選択不可）</option> : null}
            {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
            : type === "memo" ? <Textarea aria-label={label} value={draft[key]} maxLength={maxLength} className="min-h-20" onChange={(event) => onChange({ ...draft, [key]: event.target.value })} />
              : <Input aria-label={label} type={type} value={draft[key]} maxLength={maxLength} onChange={(event) => onChange({ ...draft, [key]: event.target.value })} />}
      </DetailField>;
    })}
  </DetailSection>;
}
