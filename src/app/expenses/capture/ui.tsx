"use client";

import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { ExpenseClaimStatus } from "@/lib/types";

// Shared building blocks for the phone screens: large targets (56px+), 17px body text, one main action at the bottom.

export const yen = (value: number) => `¥${Math.round(value).toLocaleString("ja-JP")}`;
const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
export function dayLabel(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  const [y, m, d] = date.split("-").map(Number);
  return `${m}月${d}日（${weekdays[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}）`;
}
export function dateTimeLabel(value?: string) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${get("month")}月${get("day")}日 ${get("hour")}:${get("minute")}`;
}

export function Screen({ children, footer, className = "" }: { children: ReactNode; footer?: ReactNode; className?: string }) {
  return <div className={`flex min-h-dvh flex-col bg-background text-foreground ${className}`}>
    <div className="flex flex-1 flex-col">{children}</div>
    {footer ? <div className="sticky bottom-0 z-20 border-t bg-card/95 px-5 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3.5 backdrop-blur">{footer}</div> : null}
  </div>;
}

export function TopBar({ title, onBack, close = false, right }: { title: string; onBack?: () => void; close?: boolean; right?: ReactNode }) {
  return <header className="sticky top-0 z-10 flex items-center gap-1 bg-background/95 px-3 pb-2 pt-[calc(env(safe-area-inset-top)+0.75rem)] backdrop-blur">
    {onBack ? <button type="button" aria-label={close ? "やめる" : "戻る"} onClick={onBack} className="flex size-14 items-center justify-center rounded-2xl active:bg-muted">
      {close ? <X className="size-7" strokeWidth={2.2} /> : <ChevronLeft className="size-7" strokeWidth={2.2} />}</button> : <span className="w-2" />}
    <h1 className="min-w-0 flex-1 truncate text-xl font-bold">{title}</h1>
    {right}
  </header>;
}

type ButtonProps = { children: ReactNode; onClick?: () => void; disabled?: boolean; className?: string; label?: string; type?: "button" | "submit" };
export function PrimaryButton({ children, onClick, disabled, className = "", label, type = "button" }: ButtonProps) {
  return <button type={type} aria-label={label} disabled={disabled} onClick={onClick}
    className={`flex h-[68px] w-full items-center justify-center gap-3 rounded-[20px] bg-foreground px-4 text-xl font-bold text-background transition-opacity active:opacity-80 disabled:opacity-40 ${className}`}>{children}</button>;
}
export function SecondaryButton({ children, onClick, disabled, className = "", label, tone = "default" }: ButtonProps & { tone?: "default" | "danger" }) {
  return <button type="button" aria-label={label} disabled={disabled} onClick={onClick}
    className={`flex h-16 w-full items-center justify-center gap-2.5 rounded-[20px] border border-input bg-card px-4 text-lg font-medium active:bg-muted disabled:opacity-40 ${tone === "danger" ? "text-rose-700 dark:text-rose-300" : ""} ${className}`}>{children}</button>;
}

export function AutoBadge({ source }: { source?: "ai" | "ocr" | "history" }) {
  if (!source) return null;
  return <span className="shrink-0 rounded-md bg-sky-100 px-1.5 py-0.5 text-xs font-bold text-sky-800 dark:bg-sky-950 dark:text-sky-200">{source === "history" ? "前回" : "自動"}</span>;
}

export function Row({ label, value, placeholder, onClick, source, warn = false, last = false }: {
  label: string; value?: string; placeholder: string; onClick: () => void; source?: "ai" | "ocr" | "history"; warn?: boolean; last?: boolean;
}) {
  return <button type="button" onClick={onClick} className={`flex min-h-16 w-full items-center gap-3 px-4 py-2 text-left active:bg-muted ${last ? "" : "border-b border-border/70"}`}>
    <span className="w-16 shrink-0 text-[15px] text-muted-foreground">{label}</span>
    <span className={`min-w-0 flex-1 break-words text-[17px] font-medium ${value ? "" : warn ? "text-amber-800 dark:text-amber-300" : "text-muted-foreground"}`}>{value || placeholder}</span>
    <AutoBadge source={value ? source : undefined} />
    <ChevronRight className="size-5 shrink-0 text-muted-foreground/70" strokeWidth={2.4} />
  </button>;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`overflow-hidden rounded-[20px] border bg-card ${className}`}>{children}</div>;
}

export function ReceiptThumb({ src, pdf, className = "", label }: { src?: string; pdf?: boolean; className?: string; label?: string }) {
  return <span aria-label={label} role={label ? "img" : undefined} className={`flex shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-card text-xs text-muted-foreground ${className}`}>
    {src && !pdf
      // Local previews and the person's own authenticated receipts; nothing for the optimizer to do.
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={src} alt="" className="size-full object-cover" />
      : pdf ? "PDF" : "領収書"}
  </span>;
}

export const statusText: Record<ExpenseClaimStatus, string> = {
  SUBMITTED: "経理の確認待ち", RETURNED: "差し戻し：直してください", APPROVED: "承認済み・振込待ち", PAID: "振込済み", WITHDRAWN: "取り下げ",
};
export const statusTone: Record<ExpenseClaimStatus, string> = {
  SUBMITTED: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  RETURNED: "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200",
  APPROVED: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  PAID: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  WITHDRAWN: "bg-muted text-muted-foreground",
};

export function StatusSteps({ status }: { status: ExpenseClaimStatus }) {
  const done = status === "PAID" ? 3 : status === "APPROVED" ? 2 : 1;
  const color = status === "PAID" ? "bg-emerald-600" : "bg-sky-600";
  return <span className="block space-y-1.5" aria-label={`進み具合 ${done}/3`}>
    <span className="grid grid-cols-3 gap-1.5">{[1, 2, 3].map((step) => <span key={step} className={`h-1.5 rounded-full ${step <= done ? color : "bg-muted"}`} />)}</span>
    <span className="grid grid-cols-3 gap-1.5 text-[13px] text-muted-foreground"><span>申請</span><span>承認</span><span>振込</span></span>
  </span>;
}

export function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  return <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true" aria-label={title}>
    <button type="button" aria-label="閉じる" className="absolute inset-0 bg-black/45" onClick={onClose} />
    <div className="relative flex max-h-[88dvh] flex-col rounded-t-[28px] bg-card shadow-2xl">
      <div className="mx-auto mt-2.5 h-1.5 w-11 rounded-full bg-border" />
      <div className="flex items-center justify-between gap-2 px-5 pt-1">
        <h2 className="text-[22px] font-bold">{title}</h2>
        <button type="button" aria-label="閉じる" onClick={onClose} className="flex size-14 items-center justify-center rounded-2xl active:bg-muted"><X className="size-7" strokeWidth={2.2} /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
      {footer ? <div className="border-t px-5 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3">{footer}</div> : <div className="pb-[env(safe-area-inset-bottom)]" />}
    </div>
  </div>;
}
