"use client";

import { useMemo, useState } from "react";
import { Check, CreditCard, Search, Wallet } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { Option } from "./model";
import { CaptureTile, Eyebrow, PrimaryButton, SecondaryButton, Sheet, dayLabel } from "./ui";

function shift(today: string, days: number) {
  const [y, m, d] = today.split("-").map(Number), date = new Date(Date.UTC(y, m - 1, d - days));
  return date.toISOString().slice(0, 10);
}

const fieldClass = "cap-surface h-14 rounded-[16px] border-0 px-4 text-[16px] tracking-[0.04em]";

export function DateSheet({ value, today, onPick, onClose }: { value: string; today: string; onPick: (value: string) => void; onClose: () => void }) {
  const [custom, setCustom] = useState(value || today);
  const quick = [["今日", shift(today, 0)], ["昨日", shift(today, 1)], ["おととい", shift(today, 2)]] as const;
  return <Sheet title="日付" onClose={onClose} footer={<PrimaryButton onClick={() => { if (custom && custom <= today) onPick(custom); }} disabled={!custom || custom > today}>この日付にする</PrimaryButton>}>
    <div className="space-y-5 pt-2">
      <div className="grid grid-cols-3 gap-2.5">{quick.map(([text, date]) => <button key={text} type="button" onClick={() => onPick(date)} aria-pressed={value === date}
        className={`cap-press flex h-[76px] flex-col items-center justify-center gap-1 rounded-[18px] ${value === date ? "bg-foreground text-background" : "cap-surface"}`}>
        <span className="text-[16px] tracking-[0.08em]">{text}</span><span className="text-[11.5px] tracking-[0.04em] opacity-60">{dayLabel(date)}</span></button>)}</div>
      <label className="block space-y-2"><Eyebrow>別の日</Eyebrow>
        <Input type="date" max={today} value={custom} onChange={(event) => setCustom(event.target.value)} className={fieldClass} /></label>
    </div>
  </Sheet>;
}

export function TextSheet({ title, value, placeholder, suggestions, maxLength, onDone, onClose }: {
  title: string; value: string; placeholder: string; suggestions: string[]; maxLength: number; onDone: (value: string) => void; onClose: () => void;
}) {
  const [text, setText] = useState(value);
  return <Sheet title={title} onClose={onClose} footer={<PrimaryButton onClick={() => onDone(text.trim())} disabled={!text.trim()}>決定</PrimaryButton>}>
    <form className="space-y-5 pt-2" onSubmit={(event) => { event.preventDefault(); if (text.trim()) onDone(text.trim()); }}>
      <Input autoFocus enterKeyHint="done" value={text} maxLength={maxLength} placeholder={placeholder} onChange={(event) => setText(event.target.value)} className={`${fieldClass} h-16 text-[17px]`} aria-label={title} />
      {suggestions.length ? <div className="space-y-2.5"><Eyebrow>最近の入力</Eyebrow>
        <div className="flex flex-wrap gap-2">{suggestions.map((row) => <button key={row} type="button" onClick={() => onDone(row)} className="cap-surface cap-press min-h-11 rounded-full px-4 text-[14px] tracking-[0.04em]">{row}</button>)}</div></div> : null}
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
  const item = (row: Option, first = false) => <button key={row.value || "none"} type="button" aria-pressed={value === row.value} onClick={() => onPick(row.value)}
    className={`flex min-h-[58px] w-full items-center gap-4 px-5 text-left text-[16px] active:bg-muted/60 ${first ? "" : "cap-hairline border-t"}`}>
    <span className={`flex size-5 shrink-0 items-center justify-center rounded-full ${value === row.value ? "bg-foreground" : "shadow-[inset_0_0_0_1.5px_var(--input)]"}`}>{value === row.value ? <Check className="size-3 text-background" strokeWidth={2.6} /> : null}</span>
    <span className="min-w-0 flex-1 break-words">{row.label}</span></button>;
  const recentRows = recent.filter(match), restRows = rest.filter(match);
  const group = (heading: string, rows: Option[]) => rows.length ? <div className="space-y-2 pt-4"><Eyebrow className="px-1">{heading}</Eyebrow>
    <div className="cap-surface overflow-hidden">{rows.map((row, index) => item(row, index === 0))}</div></div> : null;
  return <Sheet title={title} onClose={onClose}>
    <div className="pt-1">
      {options.length > 8 ? <label className="mb-1 flex h-12 items-center gap-2.5 rounded-[14px] bg-muted px-4"><Search className="size-4 text-muted-foreground" strokeWidth={1.6} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="名前で探す" aria-label={`${title}：名前で探す`} className="min-w-0 flex-1 bg-transparent text-[16px] outline-none" /></label> : null}
      {!terms ? <div className="cap-surface mt-3 overflow-hidden">{item({ value: "", label: empty }, true)}</div> : null}
      {group("最近使ったもの", recentRows)}
      {group("すべて", restRows)}
      {terms && !recentRows.length && !restRows.length ? <p className="py-10 text-center text-[14px] tracking-[0.08em] text-muted-foreground">見つかりません</p> : null}
    </div>
  </Sheet>;
}

export function DangerSheet({ title, body, action, pendingLabel, pending, onConfirm, onClose }: { title: string; body: string; action: string; pendingLabel: string; pending: boolean; onConfirm: () => void; onClose: () => void }) {
  return <Sheet title={title} onClose={onClose} footer={<div className="space-y-2.5">
    <button type="button" disabled={pending} onClick={onConfirm} className="cap-press cap-tone-ng flex h-16 w-full items-center justify-center rounded-[18px] bg-[var(--tone)] text-[16px] font-medium tracking-[0.12em] text-white disabled:opacity-40">{pending ? pendingLabel : action}</button>
    <SecondaryButton onClick={onClose} disabled={pending}>やめる</SecondaryButton></div>}>
    <p className="pt-2 text-[15px] leading-relaxed tracking-[0.04em]">{body}</p>
  </Sheet>;
}

export function WithdrawSheet({ payee, amount, pending, onConfirm, onClose }: { payee: string; amount: string; pending: boolean; onConfirm: () => void; onClose: () => void }) {
  return <DangerSheet title="申請を取り下げますか" body={`${payee}（${amount}）の申請を取り下げます。経理には届かなくなります。`} action="取り下げる" pendingLabel="取り下げています"
    pending={pending} onConfirm={onConfirm} onClose={onClose} />;
}

export function PayKindSheet({ cardLabel, onPick, onClose }: { cardLabel: string; onPick: (kind: "expense" | "card") => void; onClose: () => void }) {
  return <Sheet title="どちらで払いましたか" onClose={onClose}>
    <div className="space-y-3 pb-3 pt-2">
      <CaptureTile title="会社カードで払った" caption={cardLabel} icon={<CreditCard className="size-6" strokeWidth={1.5} />} onClick={() => onPick("card")} className="h-[132px]" />
      <CaptureTile variant="paper" title="自分で立て替えた" caption="あとで口座に振込" icon={<Wallet className="size-6" strokeWidth={1.5} />} onClick={() => onPick("expense")} className="h-[132px]" />
    </div>
  </Sheet>;
}
