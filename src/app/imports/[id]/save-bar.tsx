"use client";

import { useEffect, useRef, type RefObject } from "react";
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { importConflictMessage } from "@/lib/import-reread";

export function SaveBar({ dirtyCount, pending, error, onReset, onReload, rootRef }: {
  dirtyCount: number; pending: boolean; error: string; onReset: () => void; onReload: () => void; rootRef: RefObject<HTMLDivElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(() => rootRef.current?.style.setProperty("--import-savebar-height", `${element.getBoundingClientRect().height}px`));
    observer.observe(element);
    return () => observer.disconnect();
  }, [rootRef]);
  const conflict = error.includes("輸入便が更新されています");
  return <div ref={ref} className="record-savebar fixed inset-x-3 bottom-[calc(64px+env(safe-area-inset-bottom))] z-20 flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-3 lg:sticky lg:inset-x-auto lg:bottom-2 lg:mt-1">
    <div aria-live="polite" className={`min-w-0 flex-1 text-xs ${error ? "basis-full text-destructive" : dirtyCount ? "text-[var(--tone-amber-fg)]" : "text-muted-foreground"}`}>
      <p className="flex items-center gap-1.5">{pending ? <Loader2 aria-hidden className="size-3.5 shrink-0 animate-spin" /> : error || dirtyCount ? <AlertCircle aria-hidden className="size-3.5 shrink-0" /> : <CheckCircle2 aria-hidden className="size-3.5 shrink-0 text-[var(--tone-emerald-fg)]" />}
        {pending ? "保存中…" : error ? "保存できませんでした" : dirtyCount ? `未保存の変更 ${dirtyCount}件` : "保存済み"}</p>
      {error ? <p className="mt-1 break-words">{error}</p> : null}
      {conflict ? <p className="mt-1 text-muted-foreground">{importConflictMessage}</p> : null}
    </div>
    <div className="ml-auto flex max-w-full flex-wrap items-center gap-1">
      {conflict ? <Button type="button" variant="outline" size="sm" disabled={pending} onClick={onReload}><RefreshCw />最新を読み込む</Button> : null}
      {dirtyCount ? <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onReset}><RotateCcw className="hidden sm:block" />変更を戻す</Button> : null}
      <Button type="submit" form="shipment-detail-form" size="sm" disabled={pending || !dirtyCount}><Save className="hidden sm:block" />保存</Button>
    </div>
  </div>;
}
