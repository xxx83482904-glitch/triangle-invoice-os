"use client";

import { useState } from "react";
import { AlertCircle, Camera, Check, ChevronRight, CreditCard, Hourglass, List, Loader2, Wallet } from "lucide-react";
import type { CardReceiptView, CardUseView, MyCardView } from "./model";
import { Card, PrimaryButton, ReceiptThumb, Screen, SecondaryButton, TopBar, dayLabel, yen } from "./ui";

// Company card screens: the person pays with their own company card, so a receipt is attached to a use on that
// card's statement instead of being reimbursed.

export function CardHomeScreen({ name, card, waiting, returned, drafts, install, onCard, onExpense, onLibrary, onList, onReturned, onDrafts, onMissing }: {
  name: string; card: MyCardView; waiting: number; returned: number; drafts: number; install: React.ReactNode;
  onCard: () => void; onExpense: () => void; onLibrary: () => void; onList: () => void; onReturned: () => void; onDrafts: () => void; onMissing: () => void;
}) {
  return <Screen>
    <div className="flex flex-1 flex-col gap-3.5 px-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-[calc(env(safe-area-inset-top)+1.25rem)]">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0"><p className="text-[15px] text-muted-foreground">経費精算</p><p className="truncate text-[22px] font-bold">{name}さん</p></div>
        <button type="button" aria-label="申請状況の一覧" onClick={onList} className="flex size-14 items-center justify-center rounded-2xl border bg-card active:bg-muted"><List className="size-7" /></button>
      </div>
      <section aria-label="自分の状況" className="grid grid-cols-2 gap-3 rounded-[22px] border bg-card p-4">
        <button type="button" onClick={onList} className="text-left"><p className="text-sm text-muted-foreground">立替の振込待ち</p><p className="text-[26px] font-bold tabular-nums">{yen(waiting)}</p></button>
        <button type="button" onClick={onList} className="text-left"><p className="text-sm text-muted-foreground">今月のカード利用</p><p className="text-[26px] font-bold tabular-nums">{yen(card.monthTotal)}</p></button>
      </section>
      {card.missing.length ? <button type="button" onClick={onMissing} className="flex min-h-16 items-center gap-3 rounded-[20px] border-2 border-amber-400 bg-amber-50 px-4 py-2 text-left text-amber-950 active:opacity-80 dark:bg-amber-950/40 dark:text-amber-100">
        <AlertCircle className="size-6 shrink-0" /><span className="flex flex-1 flex-col"><span className="text-[17px] font-bold">領収書がないカード利用 {card.missing.length}件</span><span className="text-sm">タップして撮影</span></span><ChevronRight className="size-5" strokeWidth={2.4} /></button> : null}
      {returned ? <button type="button" onClick={onReturned} className="flex min-h-14 items-center gap-3 rounded-[20px] bg-rose-100 px-4 text-left text-rose-950 active:opacity-80 dark:bg-rose-950 dark:text-rose-100">
        <AlertCircle className="size-5 shrink-0" /><span className="flex-1 text-[17px] font-bold">差し戻された立替 {returned}件</span><ChevronRight className="size-5" strokeWidth={2.4} /></button> : null}
      {drafts ? <button type="button" onClick={onDrafts} className="flex min-h-14 items-center gap-3 rounded-[20px] border-2 border-amber-400 bg-amber-50 px-4 text-left text-amber-950 active:opacity-80 dark:bg-amber-950/40 dark:text-amber-100">
        <AlertCircle className="size-5 shrink-0" /><span className="flex-1 text-[17px] font-bold">まだ送っていない領収書 {drafts}枚</span><ChevronRight className="size-5" strokeWidth={2.4} /></button> : null}
      <div className="flex-1" />
      <p className="px-1 text-[17px] font-bold">どちらで払いましたか？</p>
      <button type="button" onClick={onCard} className="flex min-h-[150px] items-center gap-4 rounded-[26px] bg-foreground px-5 text-left text-background active:opacity-90">
        <span className="flex size-[76px] shrink-0 items-center justify-center rounded-full bg-background/15"><CreditCard className="size-10" strokeWidth={1.9} /></span>
        <span className="flex min-w-0 flex-col gap-1"><span className="text-2xl font-bold">会社カードで払った</span><span className="text-[15px] opacity-75">{card.account.label}・撮って明細に付ける</span></span>
      </button>
      <button type="button" onClick={onExpense} className="flex min-h-[120px] items-center gap-4 rounded-[26px] border-2 border-foreground bg-card px-5 text-left active:bg-muted">
        <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-muted"><Wallet className="size-[34px]" strokeWidth={1.9} /></span>
        <span className="flex min-w-0 flex-col gap-1"><span className="text-[22px] font-bold">自分で立て替えた</span><span className="text-[15px] text-muted-foreground">撮って申請・あとで口座に振込</span></span>
      </button>
      <button type="button" onClick={onLibrary} className="flex min-h-[52px] items-center justify-center text-base text-muted-foreground">写真・PDFから選ぶ</button>
      {install}
    </div>
  </Screen>;
}

// Shown on the confirm screen of a company card receipt: which use it will be attached to.
export function CardMatchBox({ target, matches }: { target?: CardUseView; matches: CardUseView[] }) {
  const use = target || (matches.length === 1 ? matches[0] : undefined);
  if (use) return <div className="flex items-center gap-3 rounded-[20px] border border-emerald-300 bg-emerald-50 p-4 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-100">
    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-700"><Check className="size-5 text-white" strokeWidth={3} /></span>
    <span className="min-w-0"><span className="block text-base font-bold">{target ? "この利用に付けます" : "カードの利用が見つかりました"}</span><span className="block break-words text-sm">{dayLabel(use.date)} {use.content} {yen(use.amount)}</span></span></div>;
  if (matches.length > 1) return <div className="flex items-center gap-3 rounded-[20px] border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100">
    <AlertCircle className="size-6 shrink-0" /><span className="text-[15px]">同じ金額の利用が{matches.length}件あります。登録したあと、どれか選びます。</span></div>;
  return <div className="flex items-center gap-3 rounded-[20px] bg-muted p-4 text-[15px] text-muted-foreground">
    <Hourglass className="size-6 shrink-0" /><span>まだカード明細に出ていません。明細が届いたら自動で付けます。</span></div>;
}

export function CardPickScreen({ receipt, cardLabel, pending, onBack, onPick, onLater }: {
  receipt: { payee: string; amount: number; spentOn: string; candidates: CardUseView[] }; cardLabel: string; pending: boolean;
  onBack: () => void; onPick: (id: string) => void; onLater: () => void;
}) {
  const [chosen, setChosen] = useState(receipt.candidates.find((row) => row.date === receipt.spentOn)?.id || receipt.candidates[0]?.id || "");
  return <Screen footer={<PrimaryButton onClick={() => chosen && onPick(chosen)} disabled={!chosen || pending}>{pending ? <><Loader2 className="size-6 animate-spin" />付けています…</> : "この利用に付ける"}</PrimaryButton>}>
    <TopBar title="どの利用の領収書ですか？" onBack={onBack} />
    <div className="space-y-3 px-5 pb-6">
      <div className="flex items-center justify-between gap-3 rounded-[18px] border bg-card p-4">
        <span className="min-w-0"><span className="block text-sm text-muted-foreground">撮った領収書</span><span className="block truncate text-[17px] font-bold">{receipt.payee}・{dayLabel(receipt.spentOn)}</span></span>
        <span className="text-[22px] font-bold tabular-nums">{yen(receipt.amount)}</span>
      </div>
      <p className="px-1 pt-1 text-[15px] text-muted-foreground">あなたのカード（{cardLabel}）で、同じ金額の利用が{receipt.candidates.length}件あります</p>
      <div role="radiogroup" aria-label="カードの利用" className="space-y-3">{receipt.candidates.map((row) => {
        const selected = chosen === row.id, gap = Math.round((Date.parse(row.date) - Date.parse(receipt.spentOn)) / 86_400_000);
        return <button key={row.id} type="button" role="radio" aria-checked={selected} onClick={() => setChosen(row.id)}
          className={`flex min-h-20 w-full items-center gap-3.5 rounded-[18px] bg-card px-4 py-3 text-left ${selected ? "border-2 border-foreground" : "border"}`}>
          {selected ? <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground"><Check className="size-4 text-background" strokeWidth={3} /></span> : <span className="size-7 shrink-0 rounded-full border-2 border-input" />}
          <span className="min-w-0 flex-1"><span className="block break-words text-[17px] font-bold">{row.content}</span><span className="block text-sm text-muted-foreground">{dayLabel(row.date)}・{gap === 0 ? "日付が一致" : `${Math.abs(gap)}日${gap > 0 ? "後" : "前"}`}</span></span>
          <span className="text-[19px] font-bold tabular-nums">{yen(row.amount)}</span>
        </button>;
      })}</div>
      <button type="button" onClick={onLater} disabled={pending} className="flex min-h-16 w-full flex-col items-center justify-center gap-0.5 rounded-[18px] border-2 border-dashed border-input text-base active:bg-muted">
        <span className="font-bold">どれでもない・まだ明細に出ていない</span><span className="text-[13px] text-muted-foreground">あとで一覧から選べます</span></button>
    </div>
  </Screen>;
}

export function CardDoneScreen({ status, payee, amount, purpose, use, cardLabel, missing, onCamera, onMissing, onList, onHome }: {
  status: CardReceiptView["status"]; payee: string; amount: number; purpose: string; use?: CardUseView; cardLabel: string; missing: number;
  onCamera: () => void; onMissing: () => void; onList: () => void; onHome: () => void;
}) {
  const linked = status === "LINKED";
  return <Screen>
    <div className="flex flex-1 flex-col gap-3.5 px-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-[calc(env(safe-area-inset-top)+2rem)]">
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center" role="status">
        <span className={`flex size-32 items-center justify-center rounded-full ${linked ? "bg-emerald-100 dark:bg-emerald-950" : "bg-muted"}`}>
          {linked ? <Check className="size-[68px] text-emerald-700 dark:text-emerald-300" strokeWidth={2.6} /> : <Hourglass className="size-16 text-muted-foreground" strokeWidth={2} />}</span>
        <p className="text-[28px] font-bold">{linked ? "カード明細に付けました" : "領収書を登録しました"}</p>
        <div className="w-full space-y-2.5 rounded-[20px] border bg-card p-4 text-left">
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><CreditCard className="size-4" />{cardLabel}</p>
          <p className="flex items-baseline justify-between gap-3"><span className="min-w-0 break-words text-[17px] font-bold">{use ? `${dayLabel(use.date)} ${use.content}` : payee}</span><span className="text-[22px] font-bold tabular-nums">{yen(amount)}</span></p>
          <p className="text-sm text-muted-foreground">{purpose}</p>
        </div>
        <p className="text-[15px] leading-relaxed text-muted-foreground">{linked ? "会社カードの支払いなので、振込はありません。経理の明細画面にも領収書として表示されます。"
          : status === "CHOOSE" ? "同じ金額の利用が複数あります。申請状況の「会社カード」から、どの利用か選んでください。" : "カード明細に利用が出たら、自動でその利用に付けます。"}</p>
      </div>
      <PrimaryButton onClick={onCamera} className="h-[72px] rounded-[22px]"><Camera className="size-7" strokeWidth={2} />続けて撮る</PrimaryButton>
      {missing ? <SecondaryButton onClick={onMissing}>領収書が足りない利用 あと{missing}件</SecondaryButton> : <SecondaryButton onClick={onList}><List className="size-6" />申請状況を見る</SecondaryButton>}
      <button type="button" onClick={onHome} className="flex min-h-12 items-center justify-center text-base text-muted-foreground">ホームへ</button>
    </div>
  </Screen>;
}

export function MissingScreen({ card, onBack, onShoot }: { card: MyCardView; onBack: () => void; onShoot: (use: CardUseView) => void }) {
  return <Screen>
    <TopBar title="領収書が足りない利用" onBack={onBack} />
    <div className="space-y-3 px-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
      <p className="flex items-center gap-2 text-[15px] text-muted-foreground"><CreditCard className="size-5 shrink-0" />{card.account.label}の利用のうち、領収書がまだのもの</p>
      {card.missing.map((row) => <div key={row.id} className="flex min-h-[76px] items-center gap-3 rounded-[18px] border bg-card py-2.5 pl-4 pr-3">
        <span className="min-w-0 flex-1"><span className="block break-words text-[17px] font-bold">{row.content}</span><span className="block text-sm text-muted-foreground">{dayLabel(row.date)}</span></span>
        <span className="text-[19px] font-bold tabular-nums">{yen(row.amount)}</span>
        <button type="button" aria-label={`${row.content}の領収書を撮る`} onClick={() => onShoot(row)} className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-foreground text-background active:opacity-80"><Camera className="size-[26px]" /></button>
      </div>)}
      {!card.missing.length ? <p className="rounded-[20px] border border-dashed p-8 text-center text-[17px] text-muted-foreground">領収書が足りない利用はありません</p> : null}
      <p className="rounded-[18px] bg-muted p-4 text-[15px] leading-relaxed text-muted-foreground">カメラのボタンで撮ると、その利用に直接付きます。領収書がもらえなかった利用は、経理に伝えてください。</p>
    </div>
  </Screen>;
}

export const cardStatusText: Record<CardReceiptView["status"], string> = { LINKED: "カード明細に付けました", CHOOSE: "どの利用か選んでください", WAITING: "明細の反映待ち（届いたら自動で付けます）" };
export const cardStatusTone: Record<CardReceiptView["status"], string> = {
  LINKED: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  CHOOSE: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  WAITING: "bg-muted text-muted-foreground",
};

export function CardReceiptList({ receipts, fresh, onOpen }: { receipts: CardReceiptView[]; fresh: Set<string>; onOpen: (id: string) => void }) {
  const rank = (row: CardReceiptView) => fresh.has(row.id) ? 0 : row.status === "CHOOSE" ? 1 : 2;
  const rows = receipts.slice().sort((a, b) => rank(a) - rank(b) || b.createdAt.localeCompare(a.createdAt));
  return <ul className="space-y-3 px-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
    {rows.map((row) => <li key={row.id}><button type="button" onClick={() => onOpen(row.id)}
      className={`flex w-full flex-col gap-2.5 rounded-[20px] bg-card p-4 text-left active:bg-muted ${fresh.has(row.id) ? "border-2 border-sky-600" : row.status === "CHOOSE" ? "border-2 border-amber-400" : "border"}`}>
      <span className="flex w-full items-start gap-3">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5"><span className="flex items-center gap-2 text-[17px] font-bold"><span className="truncate">{row.payee}</span>
          {fresh.has(row.id) ? <span className="shrink-0 rounded-md bg-sky-700 px-1.5 py-0.5 text-xs font-bold text-white">たった今</span> : null}</span>
          <span className="truncate text-sm text-muted-foreground">{dayLabel(row.spentOn)}・{row.purpose}</span></span>
        <span className="text-xl font-bold tabular-nums">{yen(row.amount)}</span>
      </span>
      <span className={`rounded-[10px] px-3 py-1.5 text-[15px] font-bold ${cardStatusTone[row.status]}`}>{cardStatusText[row.status]}</span>
    </button></li>)}
    {!rows.length ? <li className="rounded-[20px] border border-dashed p-8 text-center text-[17px] text-muted-foreground">会社カードの領収書はまだありません</li> : null}
  </ul>;
}

export function CardDetailScreen({ receipt, cardLabel, onBack, onChoose, onRemove }: { receipt: CardReceiptView; cardLabel: string; onBack: () => void; onChoose: () => void; onRemove: () => void }) {
  const footer = receipt.status === "CHOOSE" ? <div className="space-y-2"><PrimaryButton onClick={onChoose}>どの利用か選ぶ</PrimaryButton>
    <button type="button" onClick={onRemove} className="flex min-h-12 w-full items-center justify-center text-base text-muted-foreground">この領収書を削除</button></div>
    : <SecondaryButton tone="danger" onClick={onRemove}>この領収書を削除</SecondaryButton>;
  return <Screen footer={footer}>
    <TopBar title="会社カードの領収書" onBack={onBack} />
    <div className="space-y-3.5 px-5 pb-6">
      <div className="flex items-center gap-3.5">
        <a href={receipt.fileUrl || undefined} target="_blank" rel="noreferrer" aria-label="領収書を開く"><ReceiptThumb src={receipt.fileUrl} pdf={receipt.mimeType === "application/pdf"} className="h-[92px] w-[72px]" /></a>
        <div className="min-w-0"><p className="text-[36px] font-bold leading-tight tabular-nums">{yen(receipt.amount)}</p><p className="truncate text-[17px] font-medium">{receipt.payee}</p>
          <p className="truncate text-sm text-muted-foreground">{dayLabel(receipt.spentOn)}・{receipt.purpose}</p></div>
      </div>
      <span className={`block rounded-[12px] px-3.5 py-2.5 text-base font-bold ${cardStatusTone[receipt.status]}`}>{cardStatusText[receipt.status]}</span>
      <Card className="text-base">
        <div className="flex min-h-[52px] items-center gap-2 border-b border-border/70 px-4"><span className="w-24 shrink-0 text-muted-foreground">カード</span>{cardLabel}</div>
        <div className="flex min-h-[52px] items-center gap-2 border-b border-border/70 px-4 py-2"><span className="w-24 shrink-0 text-muted-foreground">カード利用</span>
          <span className="min-w-0 break-words">{receipt.use ? `${dayLabel(receipt.use.date)} ${receipt.use.content}` : "まだ付いていません"}</span></div>
        <div className="flex min-h-[52px] items-center gap-2 px-4"><span className="w-24 shrink-0 text-muted-foreground">案件</span><span className="min-w-0 break-words">{receipt.projectName || "共通経費（案件なし）"}</span></div>
      </Card>
    </div>
  </Screen>;
}
