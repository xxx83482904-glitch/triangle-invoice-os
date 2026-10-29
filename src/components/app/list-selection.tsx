"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ListSelection } from "@/hooks/use-list-selection";
import type { SelectionGesture } from "@/lib/list-selection";

export function SelectionCheckbox({ label, checked, mixed = false, disabled, onSelect }: {
  label: string; checked: boolean; mixed?: boolean; disabled?: boolean;
  onSelect: (gesture: SelectionGesture) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = mixed; }, [mixed]);
  return <label className="flex size-11 shrink-0 cursor-pointer items-center justify-center" onClick={(event) => event.stopPropagation()}>
    <input ref={ref} type="checkbox" aria-label={label} aria-checked={mixed ? "mixed" : checked} checked={checked} disabled={disabled}
      className="size-5 accent-primary" onChange={() => undefined}
      onMouseDown={(event) => { if (event.shiftKey) event.preventDefault(); }}
      onClick={(event) => { event.stopPropagation(); if (!disabled) onSelect({ shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, checked: event.currentTarget.checked }); }}
      onKeyDown={(event) => { if (event.key === " ") { event.preventDefault(); event.stopPropagation(); if (!disabled && !event.repeat) onSelect({ shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, checked: !checked }); } }} />
  </label>;
}

export function RowSelectionCheckbox({ selection, id, label }: { selection: ListSelection; id: string; label: string }) {
  return <SelectionCheckbox label={label} checked={selection.selected.has(id)} disabled={selection.disabled} onSelect={(gesture) => selection.choose(id, gesture)} />;
}

export function SelectAllCheckbox({ selection, label = "表示中をすべて選択" }: { selection: ListSelection; label?: string }) {
  return <SelectionCheckbox label={label} checked={selection.allSelected} mixed={selection.someSelected} disabled={selection.disabled} onSelect={(gesture) => selection.selectAll(Boolean(gesture.checked))} />;
}

export function SelectionToolbar({ selection, children }: { selection: ListSelection; children?: ReactNode }) {
  return <div className={`flex min-w-0 flex-wrap items-center gap-2 border-y py-1 text-sm ${selection.selected.size ? "bg-primary/5" : ""}`} aria-label="一覧の選択操作">
    <div className="flex items-center"><SelectAllCheckbox selection={selection} /><span>表示中を選択</span></div>
    <span role="status" className="text-muted-foreground">{selection.selected.size}件選択{selection.hiddenCount ? `（表示外 ${selection.hiddenCount}件）` : ""}</span>
    {selection.selected.size ? <Button type="button" variant="ghost" className="size-11" size="icon" title="選択解除" aria-label="選択解除" disabled={selection.disabled} onClick={selection.clear}><X className="size-4" /></Button> : null}
    {children}
  </div>;
}
