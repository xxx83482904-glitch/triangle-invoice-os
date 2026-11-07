"use client";
import { useState, type FormEvent } from "react";
import { OptionTabs } from "@/components/app/option-tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import type { CompanyScope } from "@/lib/company";
import { detailAmountFields as amountFields, type DetailAmountKey as AmountKey, type DetailOption as Option } from "@/lib/import-detail-draft";
import type { ImportShipmentView } from "@/lib/import-shipment-views";
import { importShipmentStatusLabels, importShipmentStatuses } from "@/lib/import-shipments";
import { operationFailureToast } from "@/lib/operation-feedback";
import type { ImportShipmentStatus } from "@/lib/types";
import { detailSelectClass as selectClass } from "./[id]/detail-fields";
import { useShipmentSave } from "./use-shipment-save";

function shipmentFields(form: FormData) {
  const text = (key: string) => String(form.get(key) ?? "").trim();
  const amounts: Partial<Record<AmountKey, number>> = {};
  for (const [key, label] of amountFields) {
    const raw = text(key).replace(/,/g, "");
    if (!raw) continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`${label}は数字で入力してください`);
    amounts[key] = value;
  }
  return {
    title: text("title"), projectId: text("projectId"), supplierName: text("supplierName"), brokerVendorId: text("brokerVendorId"), permitNumber: text("permitNumber"),
    blNumber: text("blNumber"), invoiceNumber: text("invoiceNumber"),
    permitDate: text("permitDate"), arrivalDate: text("arrivalDate"), folderMonth: text("folderMonth"), status: text("status") as ImportShipmentStatus, memo: text("memo"), ...amounts,
  };
}

export function ShipmentForm({ company, row, projects, vendors, onSaved }: { company: CompanyScope; row?: ImportShipmentView; projects: Option[]; vendors: Option[]; onSaved?: (id: string) => void }) {
  const { pending, run } = useShipmentSave(company);
  const [status, setStatus] = useState<ImportShipmentStatus>(row?.status ?? "OPEN");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    let fields: ReturnType<typeof shipmentFields>;
    try { fields = shipmentFields(new FormData(event.currentTarget)); } catch (error) { toast(operationFailureToast(error)); return; }
    if (row) run({ action: "update", id: row.id, version: row.updatedAt, ...fields }, "保存しました。");
    else run({ action: "create", ...fields }, "輸入便を作成しました。", (result) => onSaved?.(result.id));
  };
  const field = "text-xs font-medium text-muted-foreground";
  return <form onSubmit={submit} className="workspace-detail-group space-y-4">
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-sm font-medium">便の情報</h3>
      <Button type="submit" size="sm" disabled={pending}>{pending ? "保存中…" : row ? "保存" : "作成"}</Button>
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1 sm:col-span-2"><span className={field}>便名</span><Input name="title" required maxLength={200} defaultValue={row?.title ?? ""} placeholder="例: 照明器具 第1便" /></label>
      <label className="space-y-1"><span className={field}>案件</span>
        <select name="projectId" defaultValue={row?.projectId ?? ""} className={`${selectClass} w-full`}><option value="">未設定</option>{projects.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
      </label>
      <label className="space-y-1"><span className={field}>通関業者（支払先）</span>
        <select name="brokerVendorId" defaultValue={row?.brokerVendorId ?? ""} className={`${selectClass} w-full`}><option value="">未設定</option>{vendors.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
      </label>
      <label className="space-y-1"><span className={field}>海外の仕入先</span><Input name="supplierName" maxLength={200} defaultValue={row?.supplierName ?? ""} /></label>
      <label className="space-y-1"><span className={field}>輸入許可番号</span><Input name="permitNumber" maxLength={100} defaultValue={row?.permitNumber ?? ""} className="font-mono" /></label>
      <label className="space-y-1"><span className={field}>B/L・AWB番号</span><Input name="blNumber" maxLength={100} defaultValue={row?.blNumber ?? ""} className="font-mono" /></label>
      <label className="space-y-1"><span className={field}>インボイス番号</span><Input name="invoiceNumber" maxLength={100} defaultValue={row?.invoiceNumber ?? ""} className="font-mono" /></label>
      <label className="space-y-1"><span className={field}>輸入許可日</span><Input name="permitDate" type="date" defaultValue={row?.permitDate ?? ""} /></label>
      <label className="space-y-1"><span className={field}>到着日</span><Input name="arrivalDate" type="date" defaultValue={row?.arrivalDate ?? ""} /></label>
      <label className="space-y-1"><span className={field}>表示する月（空欄なら許可日の月）</span><Input name="folderMonth" type="month" defaultValue={row?.folderMonth ?? ""} /></label>
      <div className="space-y-1"><span className={field}>経理の確認</span>
        <OptionTabs label="経理の確認" name="status" value={status} options={importShipmentStatuses.map((value) => [value, importShipmentStatusLabels[value]] as const)} onChange={setStatus} />
      </div>
    </div>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {amountFields.map(([key, label]) => (
        <label key={key} className="space-y-1"><span className={field}>{label}</span><Input name={key} type="number" inputMode="numeric" min="0" step="1" defaultValue={row?.recorded[key] ?? ""} className="tabular-nums" /></label>
      ))}
    </div>
    <label className="block space-y-1"><span className={field}>メモ</span><Textarea name="memo" maxLength={2000} defaultValue={row?.memo ?? ""} className="min-h-20" /></label>
  </form>;
}

