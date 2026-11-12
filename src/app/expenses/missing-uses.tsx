"use client";

import { useMemo, useState } from "react";
import { BellOff, ChevronDown, Paperclip, RotateCcw, Search } from "lucide-react";
import { Money } from "@/components/app/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { CardUseView, MyCardView } from "@/lib/card-receipts";
import { formatDate } from "@/lib/format";
import { selectClass } from "./expense-form";

const OPEN_MONTHS = 2;
const monthName = (month: string) => `${month.slice(0, 4)}年${Number(month.slice(5))}月`;
const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase("ja-JP");

// Uses without a receipt, grouped by month (the latest two open), searchable and filterable by card. A payee that never
// needs a receipt (a subscription, say) is taken off the list with one press and can be put back below.
export function MissingUses({ card, pending, onAttach, onExempt, onUnexempt }: {
  card: MyCardView; pending: boolean; onAttach: (use: CardUseView) => void;
  onExempt: (use: CardUseView) => void; onUnexempt: (row: MyCardView["exemptions"][number]) => void;
}) {
  const [query, setQuery] = useState(""), [account, setAccount] = useState(""), [opened, setOpened] = useState<Set<string>>(() => new Set());
  const many = card.accounts.length > 1;
  const groups = useMemo(() => {
    const terms = normalize(query).trim().split(/\s+/).filter(Boolean), map = new Map<string, CardUseView[]>();
    for (const use of card.missing) {
      if (account && use.accountId !== account) continue;
      if (!terms.every((term) => normalize(`${use.content} ${use.amount}`).includes(term))) continue;
      const month = use.date.slice(0, 7);
      map.set(month, [...(map.get(month) || []), use]);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [card.missing, query, account]);
  const shown = groups.reduce((sum, [, rows]) => sum + rows.length, 0);
  if (!card.missing.length && !card.exemptions.length) return null;
  return <Card variant="section" className="min-w-0"><CardContent className="space-y-3">
    <h2 className="text-sm font-medium">領収書がないカード利用 {card.missing.length}件</h2>
    <p className="text-xs text-muted-foreground">「領収書を付ける」から登録すると、その利用に直接付きます。サブスクなど毎回領収書が要らない支払先は「この支払先は不要」で一覧から外せます（あとで戻せます）。</p>
    {card.missing.length ? <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input aria-label="利用を検索" placeholder="支払先・金額で検索" value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" /></div>
      {many ? <select aria-label="カードで絞り込む" className={`${selectClass} w-64`} value={account} onChange={(event) => setAccount(event.target.value)}>
        <option value="">すべてのカード</option>{card.accounts.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}</select> : null}
      {query || account ? <span className="text-xs text-muted-foreground">{shown}件</span> : null}
    </div> : null}
    {groups.map(([month, rows], index) => {
      const open = index < OPEN_MONTHS || opened.has(month) || Boolean(query);
      return <section key={month} aria-label={`${monthName(month)}の領収書がない利用`} className="rounded-lg border">
        <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm" aria-expanded={open}
          onClick={() => setOpened((set) => { const next = new Set(set); if (next.has(month)) next.delete(month); else next.add(month); return next; })} disabled={index < OPEN_MONTHS || Boolean(query)}>
          <span className="font-medium">{monthName(month)}</span><span className="text-muted-foreground">{rows.length}件</span>
          <span className="ml-auto text-muted-foreground"><Money value={rows.reduce((sum, row) => sum + row.amount, 0)} /></span>
          {index >= OPEN_MONTHS && !query ? <ChevronDown className={`size-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} /> : null}
        </button>
        {open ? <ul className="divide-y border-t" aria-label="領収書がないカード利用">{rows.map((use) => <li key={use.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
          <span className="w-24 shrink-0 text-muted-foreground">{formatDate(use.date)}</span>
          <span className="min-w-0 flex-1 break-words">{use.content}{many && use.card ? <span className="block text-xs text-muted-foreground">{use.card}</span> : null}</span>
          <Money value={use.amount} />
          <span className="flex gap-1">
            <Button type="button" variant="ghost" size="sm" disabled={pending} title="この支払先の利用を、今後も含めて一覧から外します" onClick={() => onExempt(use)}><BellOff className="size-4" />この支払先は不要</Button>
            <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => onAttach(use)}><Paperclip className="size-4" />領収書を付ける</Button>
          </span>
        </li>)}</ul> : null}
      </section>;
    })}
    {card.missing.length && !groups.length ? <p className="py-6 text-center text-sm text-muted-foreground">条件に合う利用はありません</p> : null}
    {card.exemptions.length ? <details className="rounded-lg border px-3 py-2 text-sm">
      <summary className="cursor-pointer text-muted-foreground">領収書不要にした支払先 {card.exemptions.length}件</summary>
      <ul className="mt-2 divide-y" aria-label="領収書不要にした支払先">{card.exemptions.map((row) => <li key={`${row.accountId}:${row.key}`} className="flex flex-wrap items-center gap-2 py-2">
        <span className="min-w-0 flex-1 break-words">{row.label}{many ? <span className="block text-xs text-muted-foreground">{row.card}</span> : null}</span>
        <span className="text-xs text-muted-foreground">利用 {row.count}件</span>
        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => onUnexempt(row)}><RotateCcw className="size-4" />一覧に戻す</Button>
      </li>)}</ul>
    </details> : null}
  </CardContent></Card>;
}
