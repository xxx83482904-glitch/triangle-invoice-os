"use client";

import { useActionState, useState } from "react";
import { Check, ChevronDown, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { assignCompanyCardAction } from "./actions";

// A person can hold several company cards (credit cards, PayPay, a bank account's debit card); each card belongs to one
// person. Their card receipts are matched against the uses of every card they hold.
export function CompanyCardForm({ userId, accountIds, cards }: { userId: string; accountIds: string[]; cards: Array<{ id: string; label: string; holder: string }> }) {
  const [state, action, pending] = useActionState(assignCompanyCardAction, { error: "" });
  const [chosen, setChosen] = useState(accountIds);
  const summary = chosen.length ? cards.filter((card) => chosen.includes(card.id)).map((card) => card.label).join("・") : "会社カードなし";
  return <form action={action} className="flex min-w-0 flex-wrap items-start gap-2">
    <input type="hidden" name="userId" value={userId} />
    {chosen.map((id) => <input key={id} type="hidden" name="accountIds" value={id} />)}
    <details className="group relative min-w-0 max-w-80">
      <summary aria-label="会社カード" className="flex h-11 cursor-pointer list-none items-center gap-2 rounded-md border border-input bg-background px-2 text-sm lg:h-9 [&::-webkit-details-marker]:hidden">
        <CreditCard className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{summary}</span>
        {chosen.length > 1 ? <span className="shrink-0 text-xs text-muted-foreground">{chosen.length}枚</span> : null}
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <fieldset className="absolute left-0 z-20 mt-1 w-80 max-w-[calc(100vw-2rem)] space-y-1 rounded-md border bg-popover p-2 shadow-md" disabled={pending}>
        <legend className="sr-only">会社カード（複数選べます）</legend>
        {cards.map((card) => {
          const taken = Boolean(card.holder) && !accountIds.includes(card.id);
          return <label key={card.id} className={`flex min-h-11 items-center gap-2 rounded px-2 text-sm lg:min-h-9 ${taken ? "text-muted-foreground" : "hover:bg-muted/50"}`}>
            <input type="checkbox" checked={chosen.includes(card.id)} disabled={taken}
              onChange={(event) => setChosen((rows) => event.target.checked ? [...rows, card.id] : rows.filter((id) => id !== card.id))} />
            <span className="min-w-0 flex-1 break-words">{card.label}{taken ? `（${card.holder}さん）` : ""}</span>
          </label>;
        })}
      </fieldset>
    </details>
    <Button type="submit" variant="outline" disabled={pending} className="h-11 lg:h-9">保存</Button>
    {state.success ? <span role="status" className="flex items-center gap-1 self-center text-xs text-muted-foreground"><Check className="size-3.5" />保存しました</span> : null}
    {state.error ? <p role="alert" className="w-full break-words text-sm text-destructive">{state.error}</p> : null}
  </form>;
}
