"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CheckCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ListSelection } from "@/hooks/use-list-selection";

// The whole card selects. This tick only shows the state and keeps it readable for screen readers.
export function RowSelectionCheckbox({ selection, id, label }: { selection: ListSelection; id: string; label: string }) {
  return <label className="flex size-11 shrink-0 cursor-pointer items-center justify-center" onClick={(event) => event.stopPropagation()}>
    <input type="checkbox" tabIndex={-1} aria-label={label} checked={selection.selected.has(id)} disabled={selection.disabled}
      className="selection-tick" onChange={() => undefined}
      onMouseDown={(event) => { if (event.shiftKey) event.preventDefault(); }}
      onClick={(event) => { event.stopPropagation(); if (!selection.disabled) selection.choose(id, { shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, checked: event.currentTarget.checked }); }} />
  </label>;
}

export function SelectAllButton({ selection }: { selection: ListSelection }) {
  return <Button type="button" variant="outline" size="sm" className="min-h-11 shrink-0 lg:min-h-9" aria-pressed={selection.allSelected} disabled={selection.disabled} onClick={() => selection.selectAll(!selection.allSelected)}><CheckCheck className="size-4" />{selection.allSelected ? "選択を解除" : "表示中をすべて選択"}</Button>;
}

export function SelectionToolbar({ selection, children }: { selection: ListSelection; children?: ReactNode }) {
  return <div className={`list-selection-toolbar flex min-h-12 min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-2 py-1 text-sm ${selection.selected.size ? "border-primary/30 bg-selected" : "bg-muted/30"}`} aria-label="一覧の選択操作">
    <SelectAllButton selection={selection} />
    <span role="status" className="text-muted-foreground">{selection.selected.size}件選択{selection.hiddenCount ? `（表示外 ${selection.hiddenCount}件）` : ""}</span>
    {selection.selected.size ? <Button type="button" variant="ghost" className="size-11" size="icon" title="選択解除" aria-label="選択解除" disabled={selection.disabled} onClick={selection.clear}><X className="size-4" /></Button> : null}
    {children ? <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">{children}</div> : null}
  </div>;
}

// Floats over the page, so pressing the first card does not push the list down under the pointer.
export function SelectionActionBar({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
  useEffect(() => {
    document.body.classList.add("has-selection-bar");
    return () => document.body.classList.remove("has-selection-bar");
  }, []);
  return createPortal(<div role="region" aria-label={label} className={`selection-action-bar ${className}`}>{children}</div>, document.body);
}
