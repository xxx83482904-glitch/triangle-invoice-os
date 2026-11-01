import { useMemo, useSyncExternalStore } from "react";
import { readSavedState, STORAGE_KEY, type SavedState } from "./model";

const CHANGE_EVENT = "akira-kitchen-change";
let memory: string | null = null;
let memoryOnly = false;

function snapshot(): string | null {
  if (memoryOnly) return memory;
  try { return window.localStorage.getItem(STORAGE_KEY); } catch { return memory; }
}

function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(CHANGE_EVENT, listener);
  };
}

export function currentSavedState(): SavedState {
  return readSavedState(snapshot());
}

export function persistState(state: SavedState): boolean {
  memory = JSON.stringify(state);
  try {
    window.localStorage.setItem(STORAGE_KEY, memory);
    memoryOnly = false;
  } catch {
    memoryOnly = true;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
  return !memoryOnly;
}

export function useSavedState(): SavedState {
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);
  return useMemo(() => readSavedState(raw), [raw]);
}
