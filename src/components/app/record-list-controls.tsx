"use client";

import { Folder, LoaderCircle, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";

export const recordSelectClass = "h-11 w-full min-w-0 max-w-full rounded-md border bg-background px-2 text-sm";
export const recordMonthLabel = (month: string) => !month || month === "all" ? "すべての月" : month === "undated" ? "日付未設定" : `${month.slice(0, 4)}年${Number(month.slice(5, 7))}月`;

export function RecordMonthNavigation({ label, months, value, disabled, onChange }: {
  label: string; months: string[]; value: string; disabled?: boolean; onChange: (month: string) => void;
}) {
  return <aside className="hidden border-r pr-3 xl:block">
    <h2 className="mb-2 text-sm font-medium">{label}</h2>
    <nav aria-label={label} className="max-h-[65vh] space-y-1 overflow-y-auto">
      {["", ...months].map((month) => <button key={month} disabled={disabled} className={`flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm ${value === month ? "bg-primary/10 font-medium text-primary" : "hover:bg-muted"}`} aria-current={value === month ? "page" : undefined} onClick={() => onChange(month)}><Folder className="size-4 shrink-0" /><span>{recordMonthLabel(month)}</span></button>)}
    </nav>
  </aside>;
}

export function RecordSaveBar({ label, disabled, saving, onSave, onReset }: {
  label: string; disabled: boolean; saving?: boolean; onSave: () => void; onReset?: () => void;
}) {
  return <div role="status" className="sticky bottom-20 z-20 flex flex-wrap items-center justify-between gap-2 border bg-background px-3 py-2 shadow-sm lg:bottom-2">
    <span className="mr-auto text-sm">{label}</span>
    {onReset ? <Button className="min-h-11" variant="outline" disabled={disabled} onClick={onReset}><RotateCcw className="size-4" />元に戻す</Button> : null}
    <Button className="min-h-11" disabled={disabled} onClick={onSave}>{saving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}すべて保存</Button>
  </div>;
}
