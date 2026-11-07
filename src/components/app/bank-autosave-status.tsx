"use client";

import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import type { BankAutosaveEntry } from "@/lib/bank-autosave";

export function BankAutosaveStatus({ entry, onRetry, onDetails }: { entry: BankAutosaveEntry; onRetry: () => void; onDetails: () => void }) {
  if (entry.status === "queued" || entry.status === "saving") return <span role="status" className="bank-autosave-state"><LoaderCircle className="size-3 animate-spin" />保存中</span>;
  if (entry.status === "saved") return <span role="status" className="bank-autosave-state"><Check className="size-3" />保存済み</span>;
  return <div className="bank-autosave-error" role="status">
    <button type="button" className="min-w-0 text-left" title={entry.error} onClick={onDetails}>
      <span className="flex items-center gap-1"><CircleAlert className="size-3 shrink-0" />{entry.status === "conflict" ? "競合" : "保存できませんでした"}</span>
      <span className="block truncate text-muted-foreground">{entry.error}</span>
    </button>
    {entry.status === "failed" ? <button type="button" className="bank-autosave-retry" onClick={onRetry}>再試行</button> : null}
  </div>;
}
