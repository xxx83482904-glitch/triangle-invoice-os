"use client";

import { useActionState } from "react";
import { Check, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { assignCompanyCardAction } from "./actions";

// One company card per person: their card receipts in the phone expense app are matched to this card's uses.
export function CompanyCardForm({ userId, accountId, cards }: { userId: string; accountId: string; cards: Array<{ id: string; label: string; holder: string }> }) {
  const [state, action, pending] = useActionState(assignCompanyCardAction, { error: "" });
  return <form action={action} className="flex min-w-0 flex-wrap items-center gap-2">
    <input type="hidden" name="userId" value={userId} />
    <label className="flex min-w-0 items-center gap-2 text-sm"><CreditCard className="size-4 shrink-0 text-muted-foreground" /><span className="sr-only">会社カード</span>
      <select name="accountId" defaultValue={accountId} disabled={pending} aria-label="会社カード" className="h-11 min-w-0 max-w-64 rounded-md border border-input bg-background px-2 text-sm lg:h-9">
        <option value="">会社カードなし</option>
        {cards.map((card) => <option key={card.id} value={card.id} disabled={Boolean(card.holder) && card.id !== accountId}>{card.label}{card.holder && card.id !== accountId ? `（${card.holder}さん）` : ""}</option>)}
      </select></label>
    <Button type="submit" variant="outline" disabled={pending} className="h-11 lg:h-9">保存</Button>
    {state.success ? <span role="status" className="flex items-center gap-1 text-xs text-muted-foreground"><Check className="size-3.5" />保存しました</span> : null}
    {state.error ? <p role="alert" className="w-full break-words text-sm text-destructive">{state.error}</p> : null}
  </form>;
}
