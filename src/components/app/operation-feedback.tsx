"use client";

import type { ReactNode } from "react";
import { LoaderCircle } from "lucide-react";

export function OperationPending({ pending, children, label = "保存中…" }: { pending: boolean; children: ReactNode; label?: string }) {
  return pending ? <><LoaderCircle className="size-4 shrink-0 animate-spin" aria-hidden="true" />{label}</> : children;
}

export function OperationError({ message, className = "" }: { message?: string; className?: string }) {
  return message ? <p role="alert" className={`whitespace-pre-wrap break-words text-sm text-destructive ${className}`}>{message}</p> : null;
}
