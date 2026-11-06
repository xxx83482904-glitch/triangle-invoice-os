"use client";

import { useState } from "react";
import { AlertCircle, CalendarDays, Check, Circle, ClipboardCheck, Factory, PackageCheck, Pencil, Stamp, Truck, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { ImportShipmentView } from "@/lib/import-shipment-views";
import type { ImportStage } from "@/lib/types";
import { amberText, DetailDate } from "./detail-fields";

type Timeline = ImportShipmentView["timeline"];
type Requested = ImportShipmentView["requestedDates"];
const stageIcons = { ORDER_RECEIVED: ClipboardCheck, PRODUCTION: Factory, SHIPMENT: Truck, CUSTOMS: Stamp, DELIVERY: PackageCheck };
const stateWords = { DONE: "完了", CURRENT: "現在", UPCOMING: "予定" };

function StageCircle({ stage }: { stage: Timeline["stages"][number] }) {
  const Icon = stage.state === "DONE" ? Check : stageIcons[stage.key as keyof typeof stageIcons] ?? Circle;
  return <span aria-label={stateWords[stage.state]} className={`relative z-10 flex size-9 shrink-0 items-center justify-center rounded-full border ${stage.state === "DONE"
    ? "border-transparent bg-[var(--tone-emerald-bg)] text-[var(--tone-emerald-fg)]" : stage.state === "CURRENT"
      ? "border-primary bg-primary text-primary-foreground ring-4 ring-[var(--tile)]" : "border-input bg-card text-muted-foreground"}`}><Icon aria-hidden className="size-4" /></span>;
}

function StageDates({ stage, today }: { stage: Timeline["stages"][number]; today: string }) {
  return <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground lg:flex-col">
    <span>{stage.state === "DONE" ? "実績 " : stage.state === "CURRENT" ? "開始 " : "予定 "}
      <DetailDate today={today} value={stage.state === "DONE" ? stage.completedAt : stage.state === "CURRENT" ? stage.startedAt : stage.plannedAt} /></span>
    {stage.state === "CURRENT" && stage.plannedAt ? <span>完了予定 <DetailDate value={stage.plannedAt} today={today} /></span> : null}
  </div>;
}

export function RequestedDates({ requested, today, orderCount, compact = false }: { requested: Requested; today: string; orderCount: number; compact?: boolean }) {
  const dates = [...new Set([...requested.dates, ...requested.itemOverrides.map((item) => item.date)])].sort();
  return <div className="min-w-0 space-y-1">
    <div className="flex items-center gap-1 text-xs text-muted-foreground">{!compact ? <CalendarDays aria-hidden className="size-3.5" /> : null}希望納期</div>
    <div className={`flex flex-wrap items-center gap-x-1 font-medium ${compact ? "text-xs" : "text-base"}`}>
      {dates.length ? dates.map((date, index) => <span key={date}>{index ? "・" : ""}<DetailDate value={date} today={today} /></span>) : "未入力"}
    </div>
    {dates.length ? <p className={`text-[11px] ${requested.differs ? amberText : "text-muted-foreground"}`}>
      {requested.differs ? requested.dates.length > 1 ? `注文ごとに異なる（${orderCount}件）` : "品目ごとに異なる" : "クライアントの指定"}
      {requested.itemOverrides.length ? <span className="block">品目の指定 {requested.itemOverrides.length}件を含む</span> : null}
    </p> : null}
  </div>;
}

export function NextSchedule({ timeline, today, compact = false }: { timeline: Timeline; today: string; compact?: boolean }) {
  const next = timeline.next;
  return <div className={compact ? "min-w-0 space-y-1" : "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-[var(--tone-blue-bg)] px-3 py-3 text-xs text-[var(--tone-blue-fg)]"}>
    <span className="flex items-center gap-1 text-xs">{!compact ? <CalendarDays aria-hidden className="size-3.5" /> : null}次の予定</span>
    {next ? <><span className="text-xs font-medium"><DetailDate value={next.date} today={today} /> {next.label}</span>
      <span className={`flex items-center gap-1 text-[11px] ${next.overdue ? amberText : ""}`}>
        {next.overdue ? <AlertCircle aria-hidden className="size-3" /> : null}{next.overdue ? `${Math.abs(next.daysLeft)}日超過` : `あと${next.daysLeft}日`}
      </span></> : <span className="text-xs">次の予定は未入力です</span>}
  </div>;
}

export function MobileSchedule({ timeline, requested, orderCount, today }: { timeline: Timeline; requested: Requested; orderCount: number; today: string }) {
  const current = timeline.stages.find((stage) => stage.key === timeline.current);
  return <Card variant="section" className="grid grid-cols-3 gap-0 divide-x divide-[var(--rule)] p-3 lg:hidden">
    <div className="min-w-0 space-y-1 pr-2"><p className="text-xs text-muted-foreground">現在</p><p className="text-xs font-medium">{current?.label ?? (timeline.allDone ? "全工程完了" : "未入力")}</p>
      {current ? <p className="text-[11px] text-muted-foreground">開始 <DetailDate value={current.startedAt} today={today} /></p> : null}</div>
    <div className="px-2"><NextSchedule timeline={timeline} today={today} compact /></div>
    <div className="pl-2"><RequestedDates requested={requested} today={today} orderCount={orderCount} compact /></div>
  </Card>;
}

export function StagePanel({ timeline, baseline, requested, orderCount, today, canEdit, pending, onChange, className }: {
  timeline: Timeline; baseline: ImportStage[]; requested: Requested; orderCount: number; today: string; canEdit: boolean;
  pending: boolean; onChange: (stages: ImportStage[]) => void; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const editButton = canEdit ? <Button type="button" variant="outline" size="sm" disabled={pending} aria-expanded={open} aria-controls="stage-editor" onClick={() => setOpen(!open)}>
    {open ? <X /> : <Pencil />}{open ? "編集を閉じる" : "工程を編集"}</Button> : null;
  const changeStage = (key: string, field: string, value: string) => onChange(timeline.stages.map(({ key: stageKey, label, startedAt, plannedAt, completedAt, memo }) => ({
    key: stageKey, label, startedAt, plannedAt, completedAt, memo, ...(stageKey === key ? { [field]: value } : {}),
  })));
  return <Card variant="section" className={`min-w-0 gap-4 p-4 ${className ?? ""}`}>
    <div className="flex items-center justify-between gap-2 lg:hidden"><h2 className="text-sm font-medium">工程</h2>{editButton}</div>
    <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start">
      <ol aria-label="便の工程" className="flex min-w-0 flex-1 flex-col lg:flex-row">
        {timeline.stages.map((stage, index) => <li key={stage.key} className="relative flex min-w-0 items-center gap-3 py-2 lg:flex-1 lg:flex-col lg:gap-2 lg:px-1 lg:text-center">
          {index < timeline.stages.length - 1 ? <span aria-hidden className={`absolute left-[17px] top-10 h-full w-px lg:left-[calc(50%+24px)] lg:top-[25px] lg:h-px lg:w-[calc(100%-48px)] ${stage.state === "DONE" ? "bg-[var(--tone-emerald-bar)]" : "bg-input"}`} /> : null}
          <StageCircle stage={stage} />
          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-1 lg:flex-col lg:justify-start lg:gap-2">
            <div className="flex items-center gap-1 text-xs font-medium">{stage.label}{stage.state === "CURRENT" ? <Badge className="px-1 py-0 text-[10px] font-normal">現在</Badge> : null}</div>
            <StageDates stage={stage} today={today} />
          </div>
        </li>)}
      </ol>
      <div className="hidden max-w-[30%] items-center gap-4 border-l border-[var(--rule)] pl-4 lg:flex">
        <RequestedDates requested={requested} today={today} orderCount={orderCount} /><div className="shrink-0">{editButton}</div>
      </div>
    </div>
    {!timeline.entered ? <p className="text-xs text-muted-foreground">工程はまだ入力されていません</p> : null}
    {open && canEdit ? <fieldset id="stage-editor" disabled={pending} className="min-w-0 space-y-3 rounded-xl border border-[var(--rule)] bg-[var(--field)] p-3">
      <legend className="sr-only">工程を編集</legend>
      {timeline.stages.map((stage) => <div key={stage.key} className="grid min-w-0 gap-3 border-b border-[var(--rule)] pb-3 last:border-0 lg:grid-cols-[minmax(100px,0.8fr)_repeat(3,minmax(0,1fr))_minmax(0,2fr)]">
        <div className="flex items-center gap-2 text-xs lg:pt-6"><span className="font-medium">{stage.label}</span><span className="text-muted-foreground">{stateWords[stage.state]}</span></div>
        {([["startedAt", "開始日"], ["plannedAt", "完了予定日"], ["completedAt", "完了日（実績）"], ["memo", "メモ"]] as const).map(([key, label]) => {
          const changed = (stage[key] ?? "") !== (baseline.find((old) => old.key === stage.key)?.[key] ?? "");
          return <label key={key} className="min-w-0 space-y-1 text-xs"><span className="flex justify-between gap-1 text-muted-foreground">{label}{changed ? <span className={amberText}>変更</span> : null}</span>
            <Input aria-label={`${stage.label} ${label}`} type={key === "memo" ? "text" : "date"} value={stage[key] ?? ""} maxLength={key === "memo" ? 500 : undefined}
              className={`min-w-0 w-full ${changed ? "border-[var(--tone-amber-bar)]" : ""}`} onChange={(event) => changeStage(stage.key, key, event.target.value)} />
          </label>;
        })}
      </div>)}
      <p className="text-xs text-muted-foreground">完了日を入れた工程が「完了」になります。開始日だけでは完了になりません。</p>
      <p className="text-xs text-muted-foreground">希望納期は注文情報で変更します</p>
    </fieldset> : null}
  </Card>;
}
