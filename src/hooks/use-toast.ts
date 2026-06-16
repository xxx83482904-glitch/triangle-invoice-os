"use client";

import * as React from "react";
import type { ToastProps } from "@/components/ui/toast";

type ToastEntry = ToastProps & {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
};

type ToastInput = Omit<ToastEntry, "id">;

const listeners: Array<(toasts: ToastEntry[]) => void> = [];
let memoryToasts: ToastEntry[] = [];

function dispatch(toasts: ToastEntry[]) {
  memoryToasts = toasts;
  listeners.forEach((fn) => fn(toasts));
}

export function toast(input: ToastInput) {
  const id = Math.random().toString(36).slice(2);
  const entry: ToastEntry = { ...input, id };
  dispatch([...memoryToasts, entry]);
  setTimeout(() => {
    dispatch(memoryToasts.filter((t) => t.id !== id));
  }, 4000);
  return id;
}

export function useToast() {
  const [toasts, setToasts] = React.useState<ToastEntry[]>(memoryToasts);

  React.useEffect(() => {
    listeners.push(setToasts);
    return () => {
      const index = listeners.indexOf(setToasts);
      if (index > -1) listeners.splice(index, 1);
    };
  }, []);

  return { toasts };
}
