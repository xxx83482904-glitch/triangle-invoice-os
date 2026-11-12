"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, CreditCard, ExternalLink, Files, Paperclip, Plus, Trash2, X } from "lucide-react";
import { cardPressProps } from "@/components/app/list-selection";
import { Money } from "@/components/app/money";
import { MonthTabs } from "@/components/app/month-tabs";
import { RecordDetail } from "@/components/app/record-detail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import type { CardReceiptView, CardUseView, MyCardView } from "@/lib/card-receipts";
import type { CompanyScope } from "@/lib/company";
import { formatDate } from "@/lib/format";
import { countByMonth } from "@/lib/month-tabs";
import { operationFailureToast } from "@/lib/operation-feedback";
import { cardReceiptAction } from "./actions";
import { BatchForm } from "./batch-form";
import { ExpenseForm, type Option } from "./expense-form";

const statusText: Record<CardReceiptView["status"], string> = { LINKED: "明細に付けました", CHOOSE: "利用を選んでください", WAITING: "明細の反映待ち" };
const statusClass: Record<CardReceiptView["status"], string> = {
  LINKED: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
  CHOOSE: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  WAITING: "border-border bg-muted/20 text-muted-foreground",
};
type Mode = { kind: "new"; target?: CardUseView } | { kind: "receipt"; id: string } | null;

// The company card side of the expense page on PC: the same things the phone app does with the person's own card
// (credit card or PayPay) — register a receipt, attach it to a use, pick among same-amount uses, see uses without a
// receipt, and delete a receipt.
export function CardPanel({ card, company, today, projects, categories, wide }: {
  card: MyCardView; company: CompanyScope; today: string; projects: Option[]; categories: Option[]; wide: boolean;
}) {
  const router = useRouter(), [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<Mode>(null), [month, setMonth] = useState(""), [batch, setBatch] = useState(false);
  const months = card.receipts.map((row) => row.spentOn.slice(0, 7)), counts = countByMonth(months);
  const rows = useMemo(() => card.receipts.filter((row) => !month || row.spentOn.startsWith(month))
    .sort((a, b) => Number(b.status === "CHOOSE") - Number(a.status === "CHOOSE") || b.createdAt.localeCompare(a.createdAt)), [card.receipts, month]);
  const active = mode?.kind === "receipt" ? card.receipts.find((row) => row.id === mode.id) : undefined, index = rows.findIndex((row) => row.id === active?.id);
  const context = { label: card.account.label, uses: card.uses };
  const open = (id: string) => setMode({ kind: "receipt", id });
  const close = () => { if (!pending) setMode(null); };
  const attach = (target: CardUseView) => { setBatch(false); setMode({ kind: "new", target }); };
  const step = (offset: number) => !pending && index >= 0 && rows[index + offset] ? () => open(rows[index + offset].id) : undefined;

  const save = (formData: FormData) => startTransition(async () => {
    try {
      const response = await fetch("/api/uploads/card-receipts", { method: "POST", body: formData });
      const body = await response.json() as { id?: string; status?: CardReceiptView["status"]; error?: string };
      if (!response.ok || !body.id) throw new Error(body.error || "登録できませんでした");
      toast({ title: body.status === "LINKED" ? "カードの利用に付けました。" : body.status === "CHOOSE" ? "登録しました。どの利用か選んでください。" : "登録しました。明細が届いたら自動で付けます。", variant: "success" });
      setMode({ kind: "receipt", id: body.id }); router.refresh();
    } catch (error) { toast(operationFailureToast(error)); }
  });
  const act = (input: Parameters<typeof cardReceiptAction>[1], title: string, after?: () => void) => startTransition(async () => {
    const result = await cardReceiptAction(company, input);
    if (!result.success) { toast(operationFailureToast(new Error(result.error))); return; }
    toast({ title, variant: "success" }); after?.(); router.refresh();
  });

  return <div className="min-w-0 space-y-4">
    <div className="flex flex-wrap justify-end gap-2">
      <Button type="button" variant="outline" disabled={pending} onClick={() => { setMode(null); setBatch(true); }}><Files className="size-4" />まとめて登録</Button>
      <Button type="button" disabled={pending} onClick={() => { setBatch(false); setMode({ kind: "new" }); }}><Plus className="size-4" />カードの領収書を登録</Button>
    </div>
    <section aria-label="会社カードの概要" className="grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:grid-cols-3 sm:gap-3">
      <div className="min-w-0 rounded-lg border bg-muted/20 px-3 py-2"><div className="flex items-center gap-1"><CreditCard className="size-3.5" />会社カード</div><div className="mt-1 truncate text-sm font-medium text-foreground">{card.account.label}</div></div>
      <div className="min-w-0 rounded-lg border bg-muted/20 px-3 py-2"><div>今月の利用</div><div className="mt-1 break-all text-sm font-medium text-foreground"><Money value={card.monthTotal} /></div></div>
      <div className="min-w-0 rounded-lg border bg-muted/20 px-3 py-2"><div>領収書がない利用</div><div className="mt-1 text-sm font-medium text-foreground">{card.missing.length}件</div></div>
    </section>
    {card.missing.length ? <Card variant="section" className="min-w-0"><CardContent className="space-y-2">
      <h2 className="text-sm font-medium">領収書がないカード利用 {card.missing.length}件</h2>
      <p className="text-xs text-muted-foreground">「領収書を付ける」から登録すると、その利用に直接付きます。領収書がもらえなかった利用は経理に伝えてください。</p>
      <ul className="divide-y rounded-lg border" aria-label="領収書がないカード利用">{card.missing.map((use) => <li key={use.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
        <span className="w-24 shrink-0 text-muted-foreground">{formatDate(use.date)}</span><span className="min-w-0 flex-1 break-words">{use.content}</span><Money value={use.amount} />
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => attach(use)}><Paperclip className="size-4" />領収書を付ける</Button>
      </li>)}</ul>
    </CardContent></Card> : null}
    {batch ? <BatchForm kind="card" card={context} company={company} today={today} projects={projects} categories={categories}
      onClose={() => setBatch(false)} onFinished={() => { setBatch(false); router.refresh(); }} /> : null}
    <Card variant="section" className="min-w-0"><CardContent className="space-y-3">
      <MonthTabs label="支払月" value={month} months={months} counts={counts} today={today} onChange={setMonth} />
      <div className="grid lg:min-h-[520px] lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_440px]">
        <div className="min-w-0 lg:pr-3">
          <p className="mb-2 text-xs text-muted-foreground">{rows.length}件</p>
          {rows.length ? <table className="record-cards record-cards-stack workspace-record-table w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr><th>支払先</th><th>支払日</th><th>カード利用</th><th className="text-right">金額</th><th>状態</th></tr></thead>
            <tbody>{rows.map((row) => <tr key={`${row.id}:${row.updatedAt}`} {...cardPressProps(() => { if (!pending) open(row.id); })} data-active={row.id === active?.id ? "" : undefined}>
              <td className="record-card-title"><button type="button" data-selection-open className="record-card-open" title="開く" disabled={pending} onClick={() => open(row.id)}>{row.payee}</button><div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{row.purpose}</div></td>
              <td data-card-sub>{formatDate(row.spentOn)}</td>
              <td data-card-hide className="text-muted-foreground">{row.use ? `${formatDate(row.use.date)} ${row.use.content}` : "—"}</td>
              <td data-card-end className="text-right"><Money value={row.amount} /></td>
              <td><Badge variant="outline" className={`font-normal ${statusClass[row.status]}`}>{statusText[row.status]}</Badge></td>
            </tr>)}</tbody>
          </table> : <p className="py-12 text-center text-sm text-muted-foreground">会社カードの領収書はまだありません</p>}
        </div>
        <RecordDetail wide={wide} open={Boolean(mode)} title={mode?.kind === "new" ? "カードの領収書を登録" : active?.payee || "会社カードの領収書"} label="会社カードの領収書の詳細"
          resetKey={mode?.kind === "new" ? `new:${mode.target?.id || ""}` : active?.id || ""} onClose={close} onPrevious={mode?.kind === "receipt" ? step(-1) : undefined} onNext={mode?.kind === "receipt" ? step(1) : undefined}>
          <div className="space-y-4 p-3">
            {wide && mode ? <div className="flex items-center gap-2 border-b pb-3"><h2 className="min-w-0 flex-1 truncate text-sm font-medium">{mode.kind === "new" ? "カードの領収書を登録" : active?.payee}</h2>
              {mode.kind === "receipt" ? <><Button type="button" variant="outline" size="icon" aria-label="前の領収書" disabled={!step(-1)} onClick={step(-1)}><ChevronLeft className="size-4" /></Button><Button type="button" variant="outline" size="icon" aria-label="次の領収書" disabled={!step(1)} onClick={step(1)}><ChevronRight className="size-4" /></Button></> : null}
              <Button type="button" variant="ghost" size="icon" aria-label="詳細を閉じる" disabled={pending} onClick={close}><X className="size-4" /></Button></div> : null}
            {mode?.kind === "new" ? <ExpenseForm key={`card:${mode.target?.id || "new"}`} kind="card" card={context} target={mode.target} company={company} today={today} projects={projects} categories={categories} pending={pending} save={save} />
              : active ? <ReceiptDetail key={`${active.id}:${active.updatedAt}`} receipt={active} cardLabel={card.account.label} wide={wide} pending={pending}
                onPick={(use) => act({ action: "pick", id: active.id, version: active.updatedAt, transactionId: use.id }, "カードの利用に付けました。")}
                onRemove={() => { if (window.confirm("この領収書を削除しますか？カード明細に付いていた場合は、明細からも外れます。")) act({ action: "remove", id: active.id, version: active.updatedAt }, "領収書を削除しました。", () => setMode(null)); }} />
                : <p className="py-12 text-center text-sm text-muted-foreground">{mode?.kind === "receipt" ? "領収書を読み込んでいます。" : "領収書を開くと詳細を確認できます。"}</p>}
          </div>
        </RecordDetail>
      </div>
    </CardContent></Card>
  </div>;
}

function ReceiptDetail({ receipt, cardLabel, wide, pending, onPick, onRemove }: {
  receipt: CardReceiptView; cardLabel: string; wide: boolean; pending: boolean; onPick: (use: CardUseView) => void; onRemove: () => void;
}) {
  const [chosen, setChosen] = useState(receipt.candidates.find((row) => row.date === receipt.spentOn)?.id || receipt.candidates[0]?.id || "");
  const pdf = receipt.mimeType === "application/pdf";
  return <div className="space-y-5">
    {receipt.fileUrl ? <section aria-label="領収書" className="space-y-2">
      {!pdf ?
        // Authenticated receipts are served directly, without the image optimizer.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={receipt.fileUrl} alt={`${receipt.payee}の領収書`} className="max-h-80 w-full rounded-lg border object-contain" />
        : wide ? <iframe src={receipt.fileUrl} title={`${receipt.payee}の領収書`} className="h-80 w-full rounded-lg border" /> : null}
      <a href={receipt.fileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 text-sm underline underline-offset-4"><ExternalLink className="size-4" />原本を開く</a>
    </section> : null}
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
      <dt className="text-muted-foreground">状態</dt><dd><Badge variant="outline" className={`font-normal ${statusClass[receipt.status]}`}>{statusText[receipt.status]}</Badge></dd>
      {([["支払日", formatDate(receipt.spentOn)], ["金額", <Money key="amount" value={receipt.amount} />], ["支払先", receipt.payee], ["用途", receipt.purpose],
        ["案件", receipt.projectName || "共通経費（案件なし）"], ["カード", cardLabel],
        ["カード利用", receipt.use ? `${formatDate(receipt.use.date)} ${receipt.use.content}${receipt.linkedBy === "AUTO" ? "（自動）" : ""}` : "まだ付いていません"]] as const).map(([label, value]) =>
        <div key={label} className="contents"><dt className="text-muted-foreground">{label}</dt><dd className="min-w-0 whitespace-pre-wrap break-words">{value}</dd></div>)}
    </dl>
    {receipt.status === "WAITING" ? <p className="text-xs text-muted-foreground">カード明細に同じ金額の利用が出たら、自動でその利用に付けます。</p> : null}
    {receipt.status === "CHOOSE" ? <section aria-label="カードの利用を選ぶ" className="space-y-3 border-t pt-4">
      <h3 className="text-sm font-medium">どの利用の領収書ですか（同じ金額 {receipt.candidates.length}件）</h3>
      <div role="radiogroup" aria-label="カードの利用" className="divide-y rounded-lg border">{receipt.candidates.map((use) => {
        const gap = Math.round((Date.parse(use.date) - Date.parse(receipt.spentOn)) / 86_400_000), selected = chosen === use.id;
        return <button key={use.id} type="button" role="radio" aria-checked={selected} disabled={pending} onClick={() => setChosen(use.id)} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted/40">
          <span className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${selected ? "border-foreground bg-foreground text-background" : ""}`}>{selected ? <Check className="size-3" /> : null}</span>
          <span className="min-w-0 flex-1"><span className="block break-words">{use.content}</span><span className="block text-xs text-muted-foreground">{formatDate(use.date)}・{gap === 0 ? "日付が一致" : `${Math.abs(gap)}日${gap > 0 ? "後" : "前"}`}</span></span>
          <Money value={use.amount} />
        </button>;
      })}</div>
      <Button type="button" disabled={!chosen || pending} onClick={() => { const use = receipt.candidates.find((row) => row.id === chosen); if (use) onPick(use); }}>この利用に付ける</Button>
    </section> : null}
    <div className="border-t pt-4"><Button type="button" variant="outline" disabled={pending} onClick={onRemove}><Trash2 className="size-4" />この領収書を削除</Button></div>
  </div>;
}
