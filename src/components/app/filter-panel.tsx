"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";

// One row of the most used filters stays out; the rest fold away so the list starts near the top.
export function FilterPanel({ label = "絞り込み", primary, activeCount = 0, onReset, resetDisabled = false, children }: {
  label?: string; primary: ReactNode; activeCount?: number; onReset?: () => void; resetDisabled?: boolean; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return <section aria-label={label} className="workspace-filter-panel filter-panel">
    <div className="filter-panel-primary">
      {primary}
      <Button type="button" variant="outline" className="filter-panel-toggle" aria-label={`${label}${activeCount ? `（${activeCount}件）` : ""}`} title={label} aria-expanded={open} onClick={() => setOpen(!open)}>
        <SlidersHorizontal className="size-4" /><span className="filter-panel-label">絞り込み</span>{activeCount ? <span className="filter-panel-count">{activeCount}</span> : null}<ChevronDown className={`filter-panel-chevron size-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </Button>
      {onReset ? <Button type="button" variant="ghost" className="filter-panel-toggle" aria-label={`${label}を解除`} title={`${label}を解除`} disabled={resetDisabled} onClick={onReset}><X className="size-4" /><span className="filter-panel-label">解除</span></Button> : null}
    </div>
    {open ? <div className="filter-panel-more">{children}</div> : null}
  </section>;
}
