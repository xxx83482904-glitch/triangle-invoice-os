"use client";

import { useState, type Dispatch, type SetStateAction, type MouseEvent, type KeyboardEvent } from "react";
import { isSelectionControl, isSelectionGesture, selectListItem, selectListScope, type SelectionGesture, type SelectionState } from "@/lib/list-selection";

export function useListSelection(ids: string[], { availableIds = ids, disabled = false }: { availableIds?: string[]; disabled?: boolean } = {}) {
  const [state, setState] = useState<SelectionState>({ selected: new Set(), anchor: null });
  const available = new Set(availableIds);
  const selected = new Set([...state.selected].filter((id) => available.has(id)));
  const count = ids.filter((id) => selected.has(id)).length;
  const setSelected: Dispatch<SetStateAction<Set<string>>> = (value) => setState((current) => ({ selected: typeof value === "function" ? value(new Set([...current.selected].filter((id) => available.has(id)))) : value, anchor: null }));
  const choose = (id: string, gesture: SelectionGesture = {}) => {
    if (disabled) return;
    setState((current) => selectListItem({ ...current, selected: new Set([...current.selected].filter((value) => available.has(value))) }, ids, id, gesture));
  };
  const rowProps = (id: string) => ({
    "data-selection-id": id,
    "data-selected": selected.has(id) ? "true" : "false",
    tabIndex: 0,
    onMouseDownCapture: (event: MouseEvent<HTMLElement>) => {
      if (event.button === 0 && isSelectionGesture(event) && !isSelectionControl(event.target, event.currentTarget)) event.preventDefault();
    },
    onClickCapture: (event: MouseEvent<HTMLElement>) => {
      if (event.button !== 0 || !isSelectionGesture(event) || isSelectionControl(event.target, event.currentTarget)) return;
      event.preventDefault(); event.stopPropagation(); choose(id, event);
    },
    onKeyDownCapture: (event: KeyboardEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget || (event.key !== " " && !(event.key === "Enter" && isSelectionGesture(event)))) return;
      event.preventDefault(); event.stopPropagation(); if (!event.repeat) choose(id, event);
    },
  });
  return { selected, setSelected, choose, rowProps, disabled,
    allSelected: ids.length > 0 && count === ids.length,
    someSelected: count > 0 && count < ids.length,
    hiddenCount: selected.size - count,
    clear: () => setSelected(new Set()),
    selectAll: (checked: boolean) => { if (!disabled) setSelected((current) => selectListScope(current, ids, checked)); },
  };
}

export type ListSelection = ReturnType<typeof useListSelection>;
