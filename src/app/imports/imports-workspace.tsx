"use client";

import { useRouter } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { ImportDropzone } from "./import-dropzone";
import { ShipmentCandidates } from "./shipment-candidates";
import { ShipmentForm } from "./shipment-form";
import { ShipmentListTable } from "./shipment-list-table";
import { FilterPanel } from "@/components/app/filter-panel";
import { Money } from "@/components/app/money";
import { MonthTabs } from "@/components/app/month-tabs";
import { OptionTabs } from "@/components/app/option-tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { CompanyScope } from "@/lib/company";
import type { DetailOption } from "@/lib/import-detail-draft";
import { importShipmentHref, matchesImportSearch } from "@/lib/import-list";
import type { ImportDocumentGroup, ImportShipmentView } from "@/lib/import-shipment-views";
import { countByMonth } from "@/lib/month-tabs";
import type { ImportShipmentStatus } from "@/lib/types";

type StatusFilter = "all" | ImportShipmentStatus | "missing";
const statusFilterOptions = [["all", "すべて"], ["OPEN", "書類待ち"], ["CLEARED", "通関済み"], ["CLOSED", "完了"], ["missing", "書類不足"]] as const;

export function ImportsWorkspace({ canEdit, company, rows, groups, projects, vendors, today }: {
  canEdit: boolean; company: CompanyScope; rows: ImportShipmentView[]; groups: ImportDocumentGroup[]; projects: DetailOption[]; vendors: DetailOption[]; today: string;
}) {
  const router = useRouter(), createRef = useRef<HTMLButtonElement>(null);
  const [month, setMonth] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const months = useMemo(() => rows.map((row) => row.month), [rows]);
  const monthCounts = useMemo(() => countByMonth(months), [months]);
  const filtered = useMemo(() => rows.filter((row) => (!month || row.month === month)
    && (status === "all" || (status === "missing" ? row.missing.length > 0 : row.status === status))
    && matchesImportSearch(row, query)), [rows, month, status, query]);
  const open = (id: string) => router.push(importShipmentHref(company, id));
  const totals = useMemo(() => filtered.reduce((sum, row) => ({ duty: sum.duty + row.dutyAmount, tax: sum.tax + row.importTax, cost: sum.cost + row.costTotal, missing: sum.missing + (row.missing.length ? 1 : 0) }), { duty: 0, tax: 0, cost: 0, missing: 0 }), [filtered]);
  const filtering = status !== "all" || Boolean(query);

  return <div className="min-w-0 space-y-4">
    {canEdit || groups.length ? <div className={`grid min-w-0 items-start gap-4 ${canEdit && groups.length ? "xl:grid-cols-2" : ""}`}>
      {canEdit ? <ImportDropzone company={company} layout="list" onCreated={open} /> : null}
      {groups.length ? <ShipmentCandidates company={company} canEdit={canEdit} groups={groups} shipments={rows} onCreated={open} /> : null}
    </div> : null}
    <Card variant="section" className="min-w-0">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="font-medium">輸入便一覧</CardTitle>
          {canEdit ? <Button ref={createRef} type="button" size="sm" className="gap-1" onClick={() => setCreating(true)}><Plus aria-hidden className="size-4" />新しい便</Button> : null}
        </div>
        <section aria-label="輸入の集計" className="grid grid-cols-3 gap-2 text-xs text-muted-foreground sm:gap-3 lg:max-w-2xl">
          <div className="min-w-0 rounded-lg border bg-muted/20 px-3 py-2"><div>関税</div><div className="break-all text-sm font-medium text-foreground"><Money value={totals.duty} /></div><div className="mt-1 hidden sm:block">表示中{filtered.length}便</div></div>
          <div className="min-w-0 rounded-lg border bg-muted/20 px-3 py-2"><div>輸入消費税</div><div className="break-all text-sm font-medium text-foreground"><Money value={totals.tax} /></div><div className="mt-1 hidden sm:block">国税と地方消費税の合計</div></div>
          <div className="min-w-0 rounded-lg border bg-muted/20 px-3 py-2"><div>諸費用合計</div><div className="break-all text-sm font-medium text-foreground"><Money value={totals.cost} /></div><div className="mt-1 hidden sm:block">{totals.missing ? `書類不足 ${totals.missing}便` : "書類は揃っています"}</div></div>
        </section>
      </CardHeader>
      <CardContent className="min-w-0">
        <div className="mb-3"><MonthTabs label="輸入月" value={month} months={months} counts={monthCounts} undatedLabel="日付なし" onChange={setMonth} /></div>
        <FilterPanel primary={<>
          <label className="filter-panel-search relative min-w-0 flex-1 basis-56">
            <span className="sr-only">輸入便を検索</span><Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} placeholder="便名・仕入先・クライアント・注文番号・参照番号・案件を検索" className="h-11 pl-9 lg:h-9" onChange={(event) => setQuery(event.target.value)} />
          </label>
          <OptionTabs label="経理の確認で絞り込み" value={status} options={statusFilterOptions} onChange={setStatus} />
        </>} activeCount={status !== "all" ? 1 : 0} onReset={filtering ? () => { setStatus("all"); setQuery(""); } : undefined}>
          <p className="text-xs text-muted-foreground">書類不足は、仕入先インボイス・パッキングリスト・AWB/B/L・輸入許可通知書・通関業者の請求書のどれかが付いていない便です。</p>
        </FilterPanel>
        <div className="mt-3 min-w-0 overflow-x-auto">
          {filtered.length ? <ShipmentListTable rows={filtered} today={today} onOpen={open} /> : <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 px-4 text-center">
            <div><div className="font-medium">{rows.length ? "条件に合う輸入便がありません" : "輸入便はまだありません"}</div>
              <p className="mt-1 text-sm text-muted-foreground">{rows.length ? "月や絞り込みを戻すと一覧に表示されます。" : "最初の便を作ると、関税・輸入消費税と書類をまとめられます。"}</p></div>
            {rows.length ? <Button type="button" variant="outline" onClick={() => { setMonth(""); setStatus("all"); setQuery(""); }}>条件をリセット</Button>
              : canEdit ? <Button type="button" className="gap-1" onClick={() => setCreating(true)}><Plus aria-hidden className="size-4" />最初の便を作る</Button> : null}
          </div>}
        </div>
      </CardContent>
    </Card>
    {canEdit ? <Dialog open={creating} onOpenChange={setCreating}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl" onCloseAutoFocus={(event) => { event.preventDefault(); createRef.current?.focus(); }}>
        <DialogHeader><DialogTitle>新しい便</DialogTitle><DialogDescription>便の情報を登録します。注文と工程は作成後に追加できます。</DialogDescription></DialogHeader>
        <ShipmentForm company={company} projects={projects} vendors={vendors} onSaved={(id) => { setCreating(false); open(id); }} />
      </DialogContent>
    </Dialog> : null}
  </div>;
}
