"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";

export type ThemePreference = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

type ThemeContextValue = {
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
  theme: ThemePreference;
};

const storageKey = "triangle-invoice-os-theme";
const ThemeContext = createContext<ThemeContextValue | null>(null);
const themeListeners = new Set<() => void>();

function preferredSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readStoredTheme(): ThemePreference {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(storageKey);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

function applyResolvedTheme(resolved: ResolvedTheme) {
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.style.colorScheme = resolved;
}

function subscribeTheme(listener: () => void) {
  themeListeners.add(listener);
  const handleStorage = (event: StorageEvent) => {
    if (event.key === storageKey) listener();
  };
  window.addEventListener("storage", handleStorage);
  return () => {
    themeListeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
  };
}

function emitThemeChange() {
  themeListeners.forEach((listener) => listener());
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore<ThemePreference>(subscribeTheme, readStoredTheme, () => "system");
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => preferredSystemTheme());
  const resolvedTheme: ResolvedTheme = theme === "system" ? systemTheme : theme;

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => setSystemTheme(preferredSystemTheme());
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    applyResolvedTheme(resolvedTheme);
  }, [resolvedTheme]);

  const setTheme = useCallback((nextTheme: ThemePreference) => {
    window.localStorage.setItem(storageKey, nextTheme);
    emitThemeChange();
  }, []);

  const value = useMemo(() => ({ resolvedTheme, setTheme, theme }), [resolvedTheme, setTheme, theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}

export const themeInitScript = `
(() => {
  try {
    const stored = window.localStorage.getItem("${storageKey}");
    const theme = stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
    const resolved = theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : theme === "dark" ? "dark" : "light";
    document.documentElement.classList.toggle("dark", resolved === "dark");
    document.documentElement.style.colorScheme = resolved;
  } catch (_) {}
})();
`;
