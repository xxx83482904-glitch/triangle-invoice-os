"use client";

import { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { Option } from "./model";
import { PrimaryButton, SecondaryButton, Sheet, dayLabel } from "./ui";

function shift(today: string, days: number) {
  const [y, m, d] = today.split("-").map(Number), date = new Date(Date.UTC(y, m - 1, d - days));
  return date.toISOString().slice(0, 10);
}

export function DateSheet({ value, today, onPick, onClose }: { value: string; today: string; onPick: (value: string) => void; onClose: () => void }) {
  const [custom, setCustom] = useState(value || today);
  const quick = [["今日", shift(today, 0)], ["昨日", shift(today, 1)], ["おととい", shift(today, 2)]] as const;
  return <Sheet title="日付を選ぶ" onClose={onClose} footer={<PrimaryButton onClick={() => { if (custom && custom <= today) onPick(custom); }} disabled={!custom || custom > today}>この日付にする</PrimaryButton>}>
    <div className="space-y-4 pt-2">
      <div className="grid grid-cols-3 gap-2.5">{quick.map(([text, date]) => <button key={text} type="button" onClick={() => onPick(date)}
        className={`flex h-[72px] flex-col items-center justify-center rounded-2xl text-lg ${value === date ? "border-2 border-foreground bg-foreground font-bold text-background" : "border border-input bg-card font-medium"}`}>
        {text}<span className="text-xs opacity-70">{dayLabel(date)}</span></button>)}</div>
      <label className="block space-y-1.5"><span className="text-[15px] text-muted-foreground">別の日</span>
        <Input type="date" max={today} value={custom} onChange={(event) => setCustom(event.target.value)} className="h-14 rounded-2xl text-[17px]" /></label>
    </div>
  </Sheet>;
}

export function TextSheet({ title, value, placeholder, suggestions, maxLength, onDone, onClose }: {
  title: string; value: string; placeholder: string; suggestions: string[]; maxLength: number; onDone: (value: string) => void; onClose: () => void;
}) {
  const [text, setText] = useState(value);
  return <Sheet title={title} onClose={onClose} footer={<PrimaryButton onClick={() => onDone(text.trim())} disabled={!text.trim()}>決定</PrimaryButton>}>
    <form className="space-y-4 pt-2" onSubmit={(event) => { event.preventDefault(); if (text.trim()) onDone(text.trim()); }}>
      <Input autoFocus enterKeyHint="done" value={text} maxLength={maxLength} placeholder={placeholder} onChange={(event) => setText(event.target.value)} className="h-16 rounded-2xl text-lg" aria-label={title} />
      {suggestions.length ? <div className="space-y-2"><p className="text-[15px] text-muted-foreground">最近の入力</p>
        <div className="flex flex-wrap gap-2">{suggestions.map((row) => <button key={row} type="button" onClick={() => onDone(row)} className="min-h-12 rounded-full border border-input bg-card px-4 text-base active:bg-muted">{row}</button>)}</div></div> : null}
    </form>
  </Sheet>;
}

export function PickerSheet({ title, value, empty, recent, options, onPick, onClose }: {
  title: string; value: string; empty: string; recent: Option[]; options: Option[]; onPick: (value: string) => void; onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const terms = query.normalize("NFKC").toLocaleLowerCase("ja-JP").trim();
  const match = (row: Option) => !terms || row.label.normalize("NFKC").toLocaleLowerCase("ja-JP").includes(terms);
  const rest = useMemo(() => options.filter((row) => !recent.some((item) => item.value === row.value)), [options, recent]);
  const item = (row: Option, last = false) => <button key={row.value || "none"} type="button" aria-pressed={value === row.value} onClick={() => onPick(row.value)}
    className={`flex min-h-16 w-full items-center gap-3.5 px-1 text-left text-[17px] active:bg-muted ${last ? "" : "border-b border-border/70"} ${value === row.value ? "font-bold" : "font-medium"}`}>
    {value === row.value ? <span className="flex size-[26px] shrink-0 items-center justify-center rounded-full bg-foreground"><Check className="size-4 text-background" strokeWidth={3} /></span>
      : <span className="size-[26px] shrink-0 rounded-full border-2 border-input" />}
    <span className="min-w-0 flex-1 break-words">{row.label}</span></button>;
  const recentRows = recent.filter(match), restRows = rest.filter(match);
  return <Sheet title={title} onClose={onClose}>
    <div className="space-y-1 pt-1">
      {options.length > 8 ? <label className="mb-2 flex h-14 items-center gap-2.5 rounded-2xl bg-muted px-4"><Search className="size-5 text-muted-foreground" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="名前で探す" aria-label={`${title}：名前で探す`} className="min-w-0 flex-1 bg-transparent text-[17px] outline-none" /></label> : null}
      {!terms ? item({ value: "", label: empty }) : null}
      {recentRows.length ? <><p className="px-1 pt-4 text-sm text-muted-foreground">最近使ったもの</p>{recentRows.map((row) => item(row))}</> : null}
      {restRows.length ? <><p className="px-1 pt-4 text-sm text-muted-foreground">すべて</p>{restRows.map((row, index) => item(row, index === restRows.length - 1))}</> : null}
      {terms && !recentRows.length && !restRows.length ? <p className="py-8 text-center text-[17px] text-muted-foreground">見つかりません</p> : null}
    </div>
  </Sheet>;
}

export function WithdrawSheet({ payee, amount, pending, onConfirm, onClose }: { payee: string; amount: string; pending: boolean; onConfirm: () => void; onClose: () => void }) {
  return <Sheet title="申請を取り下げますか？" onClose={onClose} footer={<div className="space-y-2.5">
    <button type="button" disabled={pending} onClick={onConfirm} className="flex h-[68px] w-full items-center justify-center rounded-[20px] bg-rose-700 text-xl font-bold text-white active:opacity-85 disabled:opacity-50">{pending ? "取り下げています…" : "取り下げる"}</button>
    <SecondaryButton onClick={onClose} disabled={pending}>やめる</SecondaryButton></div>}>
    <p className="pt-2 text-[17px] leading-relaxed">{payee}（{amount}）の申請を取り下げます。経理には届かなくなります。</p>
  </Sheet>;
}
