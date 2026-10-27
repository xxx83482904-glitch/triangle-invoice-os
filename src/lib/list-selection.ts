export type SelectionState = { selected: Set<string>; anchor: string | null };
export type SelectionGesture = { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; checked?: boolean };

export function selectListItem(state: SelectionState, ids: readonly string[], id: string, gesture: SelectionGesture = {}): SelectionState {
  const to = ids.indexOf(id);
  if (to < 0) return state;
  const from = state.anchor === null ? -1 : ids.indexOf(state.anchor);
  const range = Boolean(gesture.shiftKey && from >= 0);
  const targets = range ? ids.slice(Math.min(from, to), Math.max(from, to) + 1) : [id];
  const checked = gesture.checked ?? (range ? true : !state.selected.has(id));
  const selected = new Set(state.selected);
  for (const target of targets) { if (checked) selected.add(target); else selected.delete(target); }
  return { selected, anchor: range ? state.anchor : id };
}

export function selectListScope(selected: ReadonlySet<string>, ids: readonly string[], checked: boolean) {
  const next = new Set(selected);
  for (const id of ids) { if (checked) next.add(id); else next.delete(id); }
  return next;
}

export function isSelectionGesture(event: SelectionGesture) {
  return !event.altKey && Boolean(event.shiftKey || event.ctrlKey || event.metaKey);
}

// Form controls and real links retain their normal behavior. Preview buttons opt in.
export function isSelectionControl(target: EventTarget | null, root: EventTarget | null) {
  if (!(target instanceof Element)) return true;
  const control = target.closest('input, select, textarea, button, a, label, [role="button"], [role="checkbox"], [role="combobox"], [role="menuitem"], [contenteditable]:not([contenteditable="false"])');
  return Boolean(control && control !== root && !control.hasAttribute("data-selection-open"));
}
