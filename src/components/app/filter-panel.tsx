"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";

// One row of the most used filters stays out; the rest fold away so the list starts near the top.
export function FilterPanel({ label = "絞り込み", primary, activeCount = 0, onReset, children }: {
  label?: string; primary: ReactNode; activeCount?: number; onReset?: () => void; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return <section aria-label={label} className="workspace-filter-panel filter-panel">
    <div className="filter-panel-primary">
      {primary}
      <Button type="button" variant="outline" className="filter-panel-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <SlidersHorizontal className="size-4" />絞り込み{activeCount ? <span className="filter-panel-count">{activeCount}</span> : null}<ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </Button>
      {onReset ? <Button type="button" variant="ghost" className="filter-panel-toggle" onClick={onReset}><X className="size-4" />解除</Button> : null}
    </div>
    {open ? <div className="filter-panel-more">{children}</div> : null}
  </section>;
}
