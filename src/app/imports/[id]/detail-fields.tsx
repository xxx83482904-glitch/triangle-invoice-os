"use client";

import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import { shortImportDate } from "@/lib/import-detail-draft";
import type { ImportFieldSource } from "@/lib/types";

export const detailSelectClass = "h-9 w-full min-w-0 max-w-full rounded-lg border border-input bg-[var(--field)] px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60";
export const amberText = "text-[var(--tone-amber-fg)]";

export function DetailDate({ value, today }: { value?: string; today: string }) {
  return value ? <time dateTime={value} title={formatDate(value)} aria-label={formatDate(value)} className="whitespace-nowrap">{shortImportDate(value, today)}</time> : <span>未入力</span>;
}

export function DetailField({ label, children, caption }: { label: string; children: ReactNode; caption?: ReactNode }) {
  return <div className="grid min-w-0 gap-1.5 lg:grid-cols-[132px_minmax(0,1fr)] lg:items-start lg:gap-3">
    <div className="text-xs text-muted-foreground lg:pt-2">{label}</div>
    <div className="min-w-0 space-y-1">{children}{caption ? <div className="text-xs text-muted-foreground">{caption}</div> : null}</div>
  </div>;
}

export function FieldSource({ value, source, changed }: { value: string; source?: ImportFieldSource; changed?: boolean }) {
  if (!value) return <span className="text-[11px] text-muted-foreground">未入力</span>;
  const current = changed ? "MANUAL" : source;
  if (!current) return null;
  return <Badge variant="outline" className={`border-transparent text-[10px] font-normal ${current === "DOCUMENT" ? "bg-[var(--tone-blue-bg)] text-[var(--tone-blue-fg)]" : "bg-[var(--tile)]"}`}>
    {current === "DOCUMENT" ? "書類から" : "手入力"}
  </Badge>;
}

export function DetailSection({ title, badge, summary, children }: { title: string; badge: string; summary: ReactNode; children: ReactNode }) {
  return <details className="group/section min-w-0 rounded-xl border border-[var(--rule)] bg-[var(--field)]">
    <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-2 rounded-xl px-3 py-2 focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
      <ChevronDown aria-hidden className="size-3.5 shrink-0 -rotate-90 transition-transform group-open/section:rotate-0" />
      <span className="font-medium">{title}</span><Badge variant="outline" className="border-transparent bg-[var(--tile)] text-[10px] font-normal">{badge}</Badge>
      <span className="ml-auto text-xs text-muted-foreground group-open/section:hidden">{summary}</span>
    </summary>
    <div className="space-y-4 p-3 pt-1">{children}</div>
  </details>;
}
