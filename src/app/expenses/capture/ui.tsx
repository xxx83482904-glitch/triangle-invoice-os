"use client";

import { useState, type ReactNode } from "react";
import { ArrowUpRight, ChevronLeft, ChevronRight, List, X } from "lucide-react";
import type { ExpenseClaimStatus } from "@/lib/types";

// Shared building blocks for the phone screens. Quiet by design: paper ground, ink type, hairlines and soft depth.
// Targets stay large (56px+), the main action sits at the bottom, one job per screen.

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

// A money figure: light numerals with a muted yen sign.
export function Amount({ value, className = "" }: { value: number; className?: string }) {
  return <span className={`cap-figure whitespace-nowrap ${className}`}><span className="cap-yen">¥</span>{Math.round(value).toLocaleString("ja-JP")}</span>;
}

export function Screen({ children, footer, className = "" }: { children: ReactNode; footer?: ReactNode; className?: string }) {
  return <div className={`flex min-h-dvh flex-col bg-background text-foreground ${className}`}>
    <div className="flex flex-1 flex-col">{children}</div>
    {footer ? <div className="cap-hairline sticky bottom-0 z-20 border-t bg-background/90 px-6 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3.5 backdrop-blur-md">{footer}</div> : null}
  </div>;
}

export function TopBar({ title, onBack, close = false, right }: { title: string; onBack?: () => void; close?: boolean; right?: ReactNode }) {
  return <header className="sticky top-0 z-10 flex items-center gap-1 bg-background/90 px-3 pb-2 pt-[calc(env(safe-area-inset-top)+0.75rem)] backdrop-blur-md">
    {onBack ? <button type="button" aria-label={close ? "やめる" : "戻る"} onClick={onBack} className="flex size-14 items-center justify-center rounded-full active:bg-muted">
      {close ? <X className="size-6" strokeWidth={1.6} /> : <ChevronLeft className="size-6" strokeWidth={1.6} />}</button> : <span className="w-3" />}
    <h1 className="min-w-0 flex-1 truncate text-[17px] font-medium tracking-[0.08em]">{title}</h1>
    {right}
  </header>;
}

export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`cap-eyebrow ${className}`}>{children}</p>;
}

type ButtonProps = { children: ReactNode; onClick?: () => void; disabled?: boolean; className?: string; label?: string; type?: "button" | "submit" };
export function PrimaryButton({ children, onClick, disabled, className = "", label, type = "button" }: ButtonProps) {
  return <button type={type} aria-label={label} disabled={disabled} onClick={onClick}
    className={`cap-press flex h-16 w-full items-center justify-center gap-2.5 rounded-[18px] bg-foreground px-4 text-[16px] font-medium tracking-[0.12em] text-background disabled:opacity-35 ${className}`}>{children}</button>;
}
export function SecondaryButton({ children, onClick, disabled, className = "", label, tone = "default" }: ButtonProps & { tone?: "default" | "danger" }) {
  return <button type="button" aria-label={label} disabled={disabled} onClick={onClick}
    className={`cap-press cap-surface flex h-14 w-full items-center justify-center gap-2 rounded-[18px] px-4 text-[15px] tracking-[0.08em] disabled:opacity-35 ${tone === "danger" ? "cap-tone-ng cap-tone-text" : ""} ${className}`}>{children}</button>;
}
export function TextButton({ children, onClick, disabled, className = "" }: ButtonProps) {
  return <button type="button" disabled={disabled} onClick={onClick}
    className={`flex min-h-12 w-full items-center justify-center text-[14px] tracking-[0.08em] text-muted-foreground underline-offset-4 active:underline disabled:opacity-35 ${className}`}>{children}</button>;
}

export function AutoBadge({ source }: { source?: "ai" | "ocr" | "history" }) {
  if (!source) return null;
  return <span className="cap-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] tracking-[0.1em]">{source === "history" ? "前回" : "自動"}</span>;
}

export function Row({ label, value, placeholder, onClick, source, warn = false, last = false }: {
  label: string; value?: string; placeholder: string; onClick: () => void; source?: "ai" | "ocr" | "history"; warn?: boolean; last?: boolean;
}) {
  return <button type="button" onClick={onClick} className={`flex min-h-[60px] w-full items-center gap-3 px-5 py-2 text-left active:bg-muted/60 ${last ? "" : "cap-hairline border-b"}`}>
    <span className="w-[4.25rem] shrink-0 text-[13px] tracking-[0.1em] text-muted-foreground">{label}</span>
    <span className={`min-w-0 flex-1 break-words text-[16px] ${value ? "" : warn ? "cap-tone-wait cap-tone-text" : "text-muted-foreground"}`}>{value || placeholder}</span>
    <AutoBadge source={value ? source : undefined} />
    <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" strokeWidth={1.6} />
  </button>;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`cap-surface overflow-hidden ${className}`}>{children}</div>;
}

export function ReceiptThumb({ src, pdf, className = "", label }: { src?: string; pdf?: boolean; className?: string; label?: string }) {
  return <span aria-label={label} role={label ? "img" : undefined} className={`flex shrink-0 items-center justify-center overflow-hidden rounded-[12px] bg-muted text-[11px] tracking-[0.1em] text-muted-foreground shadow-[inset_0_0_0_1px_var(--cap-hairline)] ${className}`}>
    {src && !pdf
      // Local previews and the person's own authenticated receipts; nothing for the optimizer to do.
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={src} alt="" className="size-full object-cover" />
      : pdf ? "PDF" : "領収書"}
  </span>;
}

export type Tone = "wait" | "ok" | "ng" | "info" | "idle";
// A status reads as a small colored dot and a word, never a filled banner.
export function Status({ tone, children, className = "" }: { tone: Tone; children: ReactNode; className?: string }) {
  return <span className={`cap-tone-${tone} inline-flex items-center gap-2 text-[13.5px] tracking-[0.06em] ${className}`}>
    <span className="cap-tone-dot size-1.5 shrink-0 rounded-full" /><span className="cap-tone-text">{children}</span></span>;
}

// A quiet notice: a surface with a tone dot, for warnings and comments that need reading.
export function Notice({ tone, title, children }: { tone: Tone; title?: string; children: ReactNode }) {
  return <div className={`cap-tone-${tone} cap-tone-fill rounded-[18px] px-4 py-3.5`}>
    {title ? <p className="cap-tone-text mb-1 flex items-center gap-2 text-[12px] tracking-[0.12em]"><span className="cap-tone-dot size-1.5 rounded-full" />{title}</p> : null}
    <div className="text-[15px] leading-relaxed">{children}</div>
  </div>;
}

export const statusText: Record<ExpenseClaimStatus, string> = {
  SUBMITTED: "経理の確認待ち", RETURNED: "差し戻し・直してください", APPROVED: "承認済み・振込待ち", PAID: "振込済み", WITHDRAWN: "取り下げ",
};
export const statusTone: Record<ExpenseClaimStatus, Tone> = { SUBMITTED: "wait", RETURNED: "ng", APPROVED: "info", PAID: "ok", WITHDRAWN: "idle" };

export function StatusSteps({ status }: { status: ExpenseClaimStatus }) {
  const done = status === "PAID" ? 3 : status === "APPROVED" ? 2 : 1;
  return <span className="block space-y-1.5" aria-label={`進み具合 ${done}/3`}>
    <span className="grid grid-cols-3 gap-1">{[1, 2, 3].map((step) => <span key={step} className={`h-[2px] rounded-full ${step <= done ? "bg-foreground" : "bg-border"}`} />)}</span>
    <span className="grid grid-cols-3 gap-1 text-[11px] tracking-[0.12em] text-muted-foreground">{["申請", "承認", "振込"].map((text, index) => <span key={text} className={index < done ? "text-foreground" : ""}>{text}</span>)}</span>
  </span>;
}

// Segmented control: a muted track with the chosen option lifted onto a card.
export function Segmented<T extends string>({ value, options, onChange, label, disabled }: { value: T; options: Array<{ value: T; label: ReactNode }>; onChange: (value: T) => void; label: string; disabled?: boolean }) {
  return <div role="group" aria-label={label} className="grid gap-1 rounded-[16px] bg-muted p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
    {options.map((option) => <button key={option.value} type="button" aria-pressed={value === option.value} disabled={disabled} onClick={() => onChange(option.value)}
      className={`flex h-12 items-center justify-center gap-1.5 rounded-[12px] px-2 text-[14px] tracking-[0.06em] transition-colors ${value === option.value ? "bg-card text-foreground shadow-[var(--cap-shadow)]" : "text-muted-foreground"}`}>{option.label}</button>)}
  </div>;
}

export function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  return <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true" aria-label={title}>
    <button type="button" aria-label="閉じる" className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />
    <div className="relative flex max-h-[88dvh] flex-col rounded-t-[28px] bg-background shadow-2xl">
      <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-border" />
      <div className="flex items-center justify-between gap-2 px-6 pt-2">
        <h2 className="text-[18px] font-medium tracking-[0.08em]">{title}</h2>
        <button type="button" aria-label="閉じる" onClick={onClose} className="-mr-2 flex size-14 items-center justify-center rounded-full active:bg-muted"><X className="size-6" strokeWidth={1.6} /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4">{children}</div>
      {footer ? <div className="cap-hairline border-t px-6 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3">{footer}</div> : <div className="pb-[env(safe-area-inset-bottom)]" />}
    </div>
  </div>;
}

// A tappable row on the home screen that points somewhere that needs attention.
export function AttentionRow({ tone, title, detail, onClick }: { tone: Tone; title: string; detail?: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`cap-press cap-surface cap-tone-${tone} flex min-h-[60px] w-full items-center gap-3.5 px-5 py-3 text-left`}>
    <span className="cap-tone-dot size-2 shrink-0 rounded-full" />
    <span className="min-w-0 flex-1"><span className="block text-[15px] tracking-[0.04em]">{title}</span>{detail ? <span className="block text-[12.5px] tracking-[0.06em] text-muted-foreground">{detail}</span> : null}</span>
    <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" strokeWidth={1.6} />
  </button>;
}

// The large ink tile that starts a capture: icon top-left, words bottom-left, like a printed card.
export function CaptureTile({ title, caption, icon, onClick, variant = "ink", className = "" }: {
  title: string; caption: string; icon: React.ReactNode; onClick: () => void; variant?: "ink" | "paper"; className?: string;
}) {
  const ink = variant === "ink";
  return <button type="button" onClick={onClick} className={`cap-press relative flex w-full flex-col justify-between overflow-hidden rounded-[28px] p-6 text-left ${ink ? "bg-foreground text-background" : "cap-surface"} ${className}`}>
    <span className={`flex size-14 items-center justify-center rounded-full ${ink ? "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.22)] dark:shadow-[inset_0_0_0_1px_rgba(0,0,0,0.2)]" : "shadow-[inset_0_0_0_1px_var(--cap-hairline)]"}`}>{icon}</span>
    <span className="flex items-end justify-between gap-3">
      <span className="min-w-0"><span className="block text-[23px] font-medium tracking-[0.08em]">{title}</span><span className={`mt-1 block text-[13px] tracking-[0.06em] ${ink ? "opacity-60" : "text-muted-foreground"}`}>{caption}</span></span>
      <ArrowUpRight className={`size-6 shrink-0 ${ink ? "opacity-70" : "text-muted-foreground"}`} strokeWidth={1.4} />
    </span>
  </button>;
}

export function HomeHeader({ name, onList }: { name: string; onList: () => void }) {
  return <div className="flex items-start justify-between gap-3">
    <div className="min-w-0"><Eyebrow>EXPENSES ・ 経費精算</Eyebrow><p className="mt-1 truncate text-[22px] font-medium tracking-[0.06em]">{name}さん</p></div>
    <button type="button" aria-label="申請状況の一覧" onClick={onList} className="cap-surface cap-press flex size-14 items-center justify-center rounded-full"><List className="size-5" strokeWidth={1.6} /></button>
  </div>;
}

export function DoneMark({ tone = "ok", children }: { tone?: "ok" | "idle"; children: React.ReactNode }) {
  return <span className={`cap-tone-${tone} cap-tone-fill cap-tone-text flex size-24 items-center justify-center rounded-full`}>{children}</span>;
}

export function DetailRow({ label: name, children, last = false }: { label: string; children: React.ReactNode; last?: boolean }) {
  return <div className={`flex min-h-[54px] items-center gap-3 px-5 py-2 ${last ? "" : "cap-hairline border-b"}`}><span className="w-[5.5rem] shrink-0 text-[13px] tracking-[0.1em] text-muted-foreground">{name}</span><span className="min-w-0 break-words text-[15px]">{children}</span></div>;
}


const monthName = (month: string) => `${Number(month.slice(5, 7))}月`;

// The month bars on the home summary: one series, the selected month in ink, the others recessive.
// Tapping a bar shows its month and total in the caption above the bars.
export function MonthBars({ months, current }: { months: Array<{ month: string; total: number }>; current: string }) {
  const [selected, setSelected] = useState(current);
  const max = Math.max(...months.map((row) => row.total), 1), shown = months.find((row) => row.month === selected) || months[months.length - 1];
  return <div className="space-y-1.5">
    <div className="flex items-baseline justify-between"><Eyebrow>毎月の利用金額</Eyebrow>
      <p className="text-[12px] tracking-[0.06em] text-muted-foreground" aria-live="polite">{monthName(shown.month)}　<span className="text-foreground">{yen(shown.total)}</span></p></div>
    <div className="flex h-11 items-end gap-2" role="group" aria-label="毎月の利用金額">
      {months.map((row) => <button key={row.month} type="button" onClick={() => setSelected(row.month)} aria-pressed={selected === row.month} aria-label={`${monthName(row.month)} ${yen(row.total)}`}
        className="flex h-full min-w-0 flex-1 items-end">
        <span className={`w-full rounded-t-[4px] ${row.month === selected ? "bg-foreground" : "bg-foreground/15"}`} style={{ height: `${row.total ? Math.max(6, (row.total / max) * 100) : 4}%`, opacity: row.total ? 1 : 0.5 }} />
      </button>)}
    </div>
    <div className="flex gap-2 text-center text-[10.5px] tracking-[0.04em] text-muted-foreground" aria-hidden="true">{months.map((row) => <span key={row.month} className={`flex-1 ${row.month === selected ? "text-foreground" : ""}`}>{monthName(row.month)}</span>)}</div>
  </div>;
}

type Stats = { month: string; thisMonth: { total: number; expense: number; card: number }; unapproved: { count: number; amount: number; returned: number };
  awaitingPayout: { count: number; amount: number }; monthly: Array<{ month: string; total: number }>; hasCard: boolean };

export function SummaryPanel({ stats, onList }: { stats: Stats; onList: () => void }) {
  const figure = (title: string, value: { count: number; amount: number }, note?: string) => <button type="button" onClick={onList} className="min-w-0 self-start text-left">
    <Eyebrow>{title}</Eyebrow>
    <span className="mt-1 flex items-baseline gap-2"><Amount value={value.amount} className="text-[20px]" /><span className="text-[12px] tracking-[0.06em] text-muted-foreground">{value.count}件</span></span>
    {note ? <span className="cap-tone-ng mt-0.5 block text-[11.5px] tracking-[0.04em]"><span className="cap-tone-text">{note}</span></span> : null}
  </button>;
  return <section aria-label="自分の利用と申請" className="cap-surface px-6 pb-4 pt-5">
    <Eyebrow>{monthName(stats.month)}の利用額</Eyebrow>
    <Amount value={stats.thisMonth.total} className="mt-1 block text-[40px] leading-none" />
    {stats.hasCard ? <p className="mt-2 text-[12px] tracking-[0.04em] text-muted-foreground">立替 {yen(stats.thisMonth.expense)}　・　会社カード {yen(stats.thisMonth.card)}</p> : null}
    <div className="mt-4"><MonthBars months={stats.monthly} current={stats.month} /></div>
    <div className="cap-hairline mt-4 grid grid-cols-2 gap-4 border-t pt-3.5">
      {figure("未承認", stats.unapproved, stats.unapproved.returned ? `うち差し戻し ${stats.unapproved.returned}件` : undefined)}
      {figure("承認済み・振込待ち", stats.awaitingPayout)}
    </div>
  </section>;
}
