"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { DragEventHandler } from "react";
import { Button } from "@/components/ui/button";
import { bankLedgerYearMonth } from "@/lib/bank-ledger";
import { monthTabsView } from "@/lib/month-tabs";

type MonthTabDropProps = { "data-drop"?: string; onDragOver?: DragEventHandler<HTMLElement>; onDragLeave?: DragEventHandler<HTMLElement>; onDrop?: DragEventHandler<HTMLElement> };

export function MonthTabs({ label, value, months, today, counts, showAll = true, undatedLabel = "日付未設定", disabled, isMonthDisabled, monthProps, onChange }: {
  label: string; value: string; months: string[]; today?: string; counts?: ReadonlyMap<string, number>; showAll?: boolean; undatedLabel?: string; disabled?: boolean;
  isMonthDisabled?: (month: string) => boolean; monthProps?: (month: string) => MonthTabDropProps; onChange: (month: string) => void;
}) {
  const view = monthTabsView(value, months, today);
  const { year, previousYear, nextYear } = view;
  if (!year && !view.undated.length) return null;
  const hasData = (month: string) => counts ? Boolean(counts.get(month)) : months.includes(month);
  return <nav aria-label={label} className="month-tabs">
    <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-1">
      {year ? <>
        <Button variant="outline" size="icon" className="size-9" title="前の年度" aria-label="前の年度" disabled={disabled || !previousYear} onClick={() => { if (previousYear) onChange(bankLedgerYearMonth(previousYear, months)); }}><ChevronLeft className="size-4" /></Button>
        <select aria-label="決算年度" className="month-tabs-year" value={year} disabled={disabled} onChange={(event) => onChange(bankLedgerYearMonth(Number(event.target.value), months))}>{view.years.map((item) => <option key={item} value={item}>{item - 1}.09 - {item}.08</option>)}</select>
        <Button variant="outline" size="icon" className="size-9" title="次の年度" aria-label="次の年度" disabled={disabled || !nextYear} onClick={() => { if (nextYear) onChange(bankLedgerYearMonth(nextYear, months)); }}><ChevronRight className="size-4" /></Button>
      </> : null}
      {showAll ? <button type="button" className="month-tabs-all" disabled={disabled} aria-pressed={!value} onClick={() => onChange("")}>全期間</button> : null}
      {view.undated.map((month) => <button type="button" key={month} className="month-tabs-all" disabled={disabled} aria-pressed={value === month} onClick={() => onChange(month)}>{undatedLabel}{counts?.get(month) ? <small>{counts.get(month)}</small> : null}</button>)}
    </div>
    {view.tabs.length ? <div className="month-tabs-row">
      {view.tabs.map((month) => {
        const count = counts?.get(month);
        const name = `${month.slice(0, 4)}年${Number(month.slice(5))}月`;
        return <button type="button" key={month} title={name} aria-label={count ? `${name} ${count}件` : name} aria-pressed={value === month} data-empty={hasData(month) ? undefined : ""} disabled={disabled || isMonthDisabled?.(month)} onClick={() => onChange(month)} {...monthProps?.(month)}>{Number(month.slice(5))}月{count ? <small>{count}</small> : null}</button>;
      })}
    </div> : null}
  </nav>;
}
