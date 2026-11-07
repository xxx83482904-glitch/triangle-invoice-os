"use client";

import { ChevronRight } from "lucide-react";
import { cardPressProps } from "@/components/app/list-selection";
import { Money } from "@/components/app/money";
import { Badge } from "@/components/ui/badge";
import { importListSummary } from "@/lib/import-list";
import type { ImportShipmentView } from "@/lib/import-shipment-views";
import { importDocumentKindLabels } from "@/lib/import-shipments";

const segmentTone = { DONE: "bg-[var(--tone-emerald-bar)]", CURRENT: "bg-primary", UPCOMING: "bg-input" };

export function ShipmentListTable({ rows, today, onOpen }: { rows: ImportShipmentView[]; today: string; onOpen: (id: string) => void }) {
  return <table className="record-cards record-cards-stack workspace-record-table w-full text-sm [overflow-wrap:anywhere] lg:table-fixed">
    <colgroup><col className="w-[17%] xl:w-[20%]" /><col className="w-[17%]" /><col className="w-[16%]" /><col className="w-[16%]" /><col className="w-[11%]" /><col className="w-[12%] xl:w-[9%]" /><col className="w-36" /><col className="w-8" /></colgroup>
    <thead className="text-xs text-muted-foreground"><tr>
      {["便名・仕入先", "クライアント・注文", "工程", "次の予定", "希望納期", "書類"].map((label) => <th key={label} scope="col" className="whitespace-normal! px-3 py-2 text-left font-normal">{label}</th>)}
      <th scope="col" className="px-3 py-2 text-right font-normal">諸費用</th><th scope="col" className="p-0"><span className="sr-only">詳細</span></th>
    </tr></thead>
    <tbody>{rows.map((row) => {
      const summary = importListSummary(row, today);
      return <tr key={row.id} {...cardPressProps(() => onOpen(row.id))}>
        <td className="record-card-title min-w-0 px-3 py-3 font-medium"><div className="min-w-0 w-full">
          <button type="button" data-selection-open aria-label={`${row.title}の詳細を開く`} className="record-card-open block w-full truncate text-left focus-visible:outline-2 focus-visible:outline-ring" title={row.title}>{row.title}</button>
          <p className="mt-1 break-words text-xs font-normal text-muted-foreground">{row.supplierName || "仕入先未設定"}</p>
        </div></td>
        <td data-label="クライアント" data-card-line="" className="min-w-0 px-3 py-3"><div className="min-w-0 space-y-1">
          <p className="break-words">{summary.client}{summary.clientFromProject ? <span className="ml-1 text-[10px] text-muted-foreground">案件から</span> : null}</p>
          <p className="break-words text-xs text-muted-foreground">{summary.order}</p>
        </div></td>
        <td data-label="工程" data-card-sub="" data-card-line="" className="px-3 py-3"><div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2"><span aria-hidden className="flex w-20 max-w-full shrink-0 gap-1">{summary.segments.map((state, index) => <span key={index} className={`h-1 w-full rounded-full ${segmentTone[state]}`} />)}</span><span className="text-xs text-foreground">{summary.stage}</span></div>
          {summary.actual ? <p className="text-[11px] text-muted-foreground">{summary.actual}</p> : null}
        </div></td>
        <td data-label="次の予定" data-card-sub="" data-card-line="" className="px-3 py-3"><div className="min-w-0 space-y-1">
          <p className="text-xs text-foreground">{summary.next}</p>{summary.remaining ? <p className={`text-[11px] ${summary.overdue ? "text-[var(--tone-amber-fg)]" : "text-muted-foreground"}`}>{summary.remaining}</p> : null}
        </div></td>
        <td data-label="希望納期" data-card-sub="" data-card-line="" className="px-3 py-3 text-xs"><span className="break-words">{summary.requested}</span></td>
        <td data-label="書類" data-card-sub="" className="px-3 py-3"><div className="flex flex-wrap items-center gap-1" title={row.missing.map((kind) => importDocumentKindLabels[kind]).join("、")}>
          <span className="text-xs text-foreground">{summary.documents}</span>{row.missing.length ? <Badge variant="outline" className="border-transparent bg-[var(--tone-amber-bg)] text-[10px] font-normal text-[var(--tone-amber-fg)]">不足</Badge> : null}
        </div></td>
        <td data-label="諸費用" data-card-sub="" data-card-end="" className="whitespace-nowrap px-3 py-3 text-right"><Money value={row.costTotal} /></td>
        <td data-card-hide="" className="p-0 text-muted-foreground"><ChevronRight aria-hidden className="mx-auto size-4" /></td>
      </tr>;
    })}</tbody>
  </table>;
}
