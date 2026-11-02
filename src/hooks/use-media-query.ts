"use client";

import { useCallback, useSyncExternalStore } from "react";

// The server renders the wide layout: it is the one that is visible straight away on a computer.
export function useMediaQuery(query: string) {
  const subscribe = useCallback((notify: () => void) => {
    const media = window.matchMedia(query);
    media.addEventListener("change", notify);
    return () => media.removeEventListener("change", notify);
  }, [query]);
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => true);
}
