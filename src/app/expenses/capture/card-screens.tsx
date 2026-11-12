"use client";

import { useState } from "react";
import { Camera, Check, CreditCard, Hourglass, Loader2, Wallet } from "lucide-react";
import type { ExpenseStats } from "@/lib/expense-home-stats";
import type { CardReceiptView, CardUseView, MyCardView } from "./model";
import { Amount, AttentionRow, CaptureTile, Card, DetailRow, DoneMark, HomeHeader, SummaryPanel, Eyebrow, PrimaryButton, ReceiptThumb, Screen, SecondaryButton, Status, TextButton, TopBar, dayLabel, type Tone } from "./ui";

// Company card screens: the person pays with their own company card, so a receipt is attached to a use on that
// card's statement instead of being reimbursed.

export function CardHomeScreen({ name, card, stats, returned, drafts, install, onCard, onExpense, onLibrary, onList, onReturned, onDrafts, onMissing }: {
  name: string; card: MyCardView; stats: ExpenseStats; returned: number; drafts: number; install: React.ReactNode;
  onCard: () => void; onExpense: () => void; onLibrary: () => void; onList: () => void; onReturned: () => void; onDrafts: () => void; onMissing: () => void;
}) {
  return <Screen>
    <div className="flex flex-1 flex-col gap-3.5 px-6 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-[calc(env(safe-area-inset-top)+1.5rem)]">
      <HomeHeader name={name} onList={onList} />
      <SummaryPanel stats={stats} onList={onList} />
      {card.missing.length ? <AttentionRow tone="wait" title={`領収書がないカード利用 ${card.missing.length}件`} detail="タップして撮影" onClick={onMissing} /> : null}
      {returned ? <AttentionRow tone="ng" title={`差し戻された立替 ${returned}件`} detail="直して再提出してください" onClick={onReturned} /> : null}
      {drafts ? <AttentionRow tone="wait" title={`まだ送っていない領収書 ${drafts}枚`} detail="続きを確認する" onClick={onDrafts} /> : null}
      <div className="min-h-3 flex-1" />
      <Eyebrow className="px-1">どちらで払いましたか</Eyebrow>
      <CaptureTile title="会社カードで払った" caption={`${card.account.label}・撮って明細に付ける`} icon={<CreditCard className="size-6" strokeWidth={1.5} />} onClick={onCard} className="h-[140px]" />
      <CaptureTile variant="paper" title="自分で立て替えた" caption="撮って申請・あとで口座に振込" icon={<Wallet className="size-6" strokeWidth={1.5} />} onClick={onExpense} className="h-[116px]" />
      <TextButton onClick={onLibrary}>写真・PDFから選ぶ</TextButton>
      {install}
    </div>
  </Screen>;
}

// Shown on the confirm screen of a company card receipt: which use it will be attached to.
export function CardMatchBox({ target, matches }: { target?: CardUseView; matches: CardUseView[] }) {
  const use = target || (matches.length === 1 ? matches[0] : undefined);
  const tone: Tone = use ? "ok" : matches.length > 1 ? "wait" : "idle";
  return <div className={`cap-surface cap-tone-${tone} flex items-center gap-4 px-5 py-4`}>
    <span className="cap-tone-fill cap-tone-text flex size-10 shrink-0 items-center justify-center rounded-full">
      {use ? <Check className="size-5" strokeWidth={1.8} /> : matches.length > 1 ? <span className="text-[13px] tracking-[0.04em]">{matches.length}件</span> : <Hourglass className="size-4" strokeWidth={1.6} />}</span>
    <span className="min-w-0 flex-1">
      <span className="block text-[12px] tracking-[0.12em] text-muted-foreground">{use ? (target ? "この利用に付けます" : "見つかったカード利用") : matches.length > 1 ? "同じ金額の利用があります" : "カード明細の反映待ち"}</span>
      <span className="mt-0.5 block break-words text-[15px]">{use ? <>{dayLabel(use.date)}　{use.content}</> : matches.length > 1 ? "登録したあと、どの利用か選びます" : "明細が届いたら自動で付けます"}</span>
    </span>
    {use ? <Amount value={use.amount} className="text-[17px]" /> : null}
  </div>;
}

export function CardPickScreen({ receipt, cardLabel, pending, onBack, onPick, onLater }: {
  receipt: { payee: string; amount: number; spentOn: string; candidates: CardUseView[] }; cardLabel: string; pending: boolean;
  onBack: () => void; onPick: (id: string) => void; onLater: () => void;
}) {
  const [chosen, setChosen] = useState(receipt.candidates.find((row) => row.date === receipt.spentOn)?.id || receipt.candidates[0]?.id || "");
  return <Screen footer={<div className="space-y-1"><PrimaryButton onClick={() => chosen && onPick(chosen)} disabled={!chosen || pending}>{pending ? <><Loader2 className="size-5 animate-spin" />付けています</> : "この利用に付ける"}</PrimaryButton>
    <TextButton onClick={onLater} disabled={pending}>どれでもない・まだ明細に出ていない</TextButton></div>}>
    <TopBar title="どの利用の領収書ですか" onBack={onBack} />
    <div className="space-y-4 px-6 pb-8 pt-1">
      <div className="cap-surface flex items-center justify-between gap-3 px-5 py-4">
        <span className="min-w-0"><Eyebrow>撮った領収書</Eyebrow><span className="mt-0.5 block truncate text-[16px]">{receipt.payee}・{dayLabel(receipt.spentOn)}</span></span>
        <Amount value={receipt.amount} className="text-[22px]" />
      </div>
      <Eyebrow className="px-1">{cardLabel}・同じ金額の利用 {receipt.candidates.length}件</Eyebrow>
      <div role="radiogroup" aria-label="カードの利用" className="cap-surface overflow-hidden">{receipt.candidates.map((row, index) => {
        const selected = chosen === row.id, gap = Math.round((Date.parse(row.date) - Date.parse(receipt.spentOn)) / 86_400_000);
        return <button key={row.id} type="button" role="radio" aria-checked={selected} onClick={() => setChosen(row.id)}
          className={`flex min-h-[76px] w-full items-center gap-4 px-5 py-3 text-left active:bg-muted/60 ${index ? "cap-hairline border-t" : ""}`}>
          <span className={`flex size-6 shrink-0 items-center justify-center rounded-full ${selected ? "bg-foreground" : "shadow-[inset_0_0_0_1.5px_var(--input)]"}`}>{selected ? <Check className="size-3.5 text-background" strokeWidth={2.4} /> : null}</span>
          <span className="min-w-0 flex-1"><span className="block break-words text-[16px]">{row.content}</span><span className="block text-[12.5px] tracking-[0.06em] text-muted-foreground">{dayLabel(row.date)}・{gap === 0 ? "日付が一致" : `${Math.abs(gap)}日${gap > 0 ? "後" : "前"}`}</span></span>
          <Amount value={row.amount} className="text-[18px]" />
        </button>;
      })}</div>
    </div>
  </Screen>;
}

export function CardDoneScreen({ status, payee, amount, purpose, use, cardLabel, missing, onCamera, onMissing, onList, onHome }: {
  status: CardReceiptView["status"]; payee: string; amount: number; purpose: string; use?: CardUseView; cardLabel: string; missing: number;
  onCamera: () => void; onMissing: () => void; onList: () => void; onHome: () => void;
}) {
  const linked = status === "LINKED";
  return <Screen>
    <div className="flex flex-1 flex-col gap-3 px-6 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-[calc(env(safe-area-inset-top)+2rem)]">
      <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center" role="status">
        <DoneMark tone={linked ? "ok" : "idle"}>{linked ? <Check className="size-10" strokeWidth={1.6} /> : <Hourglass className="size-9" strokeWidth={1.4} />}</DoneMark>
        <div><Eyebrow>{linked ? "ATTACHED" : "SAVED"}</Eyebrow><p className="mt-1 text-[24px] font-medium tracking-[0.08em]">{linked ? "カード明細に付けました" : "領収書を登録しました"}</p></div>
        <div className="cap-surface w-full space-y-2 px-5 py-4 text-left">
          <p className="flex items-center gap-2 text-[12px] tracking-[0.12em] text-muted-foreground"><CreditCard className="size-3.5" strokeWidth={1.6} />{cardLabel}</p>
          <p className="flex items-baseline justify-between gap-3"><span className="min-w-0 break-words text-[16px]">{use ? `${dayLabel(use.date)}　${use.content}` : payee}</span><Amount value={amount} className="text-[22px]" /></p>
          <p className="text-[13px] tracking-[0.04em] text-muted-foreground">{purpose}</p>
        </div>
        <p className="max-w-[20rem] text-[13.5px] leading-relaxed tracking-[0.04em] text-muted-foreground">{linked ? "会社カードの支払いなので振込はありません。経理の明細画面にも領収書として表示されます。"
          : status === "CHOOSE" ? "同じ金額の利用が複数あります。申請状況の「会社カード」から、どの利用か選んでください。" : "カード明細に利用が出たら、自動でその利用に付けます。"}</p>
      </div>
      <PrimaryButton onClick={onCamera} className="h-[68px]"><Camera className="size-5" strokeWidth={1.6} />続けて撮る</PrimaryButton>
      {missing ? <SecondaryButton onClick={onMissing}>領収書がない利用　あと{missing}件</SecondaryButton> : <SecondaryButton onClick={onList}>申請状況を見る</SecondaryButton>}
      <TextButton onClick={onHome}>ホームへ</TextButton>
    </div>
  </Screen>;
}

export function MissingScreen({ card, onBack, onShoot }: { card: MyCardView; onBack: () => void; onShoot: (use: CardUseView) => void }) {
  return <Screen>
    <TopBar title="領収書がないカード利用" onBack={onBack} />
    <div className="space-y-4 px-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-1">
      <Eyebrow className="px-1">{card.account.label}・{card.missing.length}件</Eyebrow>
      {card.missing.length ? <div className="cap-surface overflow-hidden">{card.missing.map((row, index) => <div key={row.id} className={`flex min-h-[76px] items-center gap-3 py-2.5 pl-5 pr-3 ${index ? "cap-hairline border-t" : ""}`}>
        <span className="min-w-0 flex-1"><span className="block break-words text-[16px]">{row.content}</span><span className="block text-[12.5px] tracking-[0.06em] text-muted-foreground">{dayLabel(row.date)}{card.accounts.length > 1 && row.card ? `・${row.card}` : ""}</span></span>
        <Amount value={row.amount} className="text-[18px]" />
        <button type="button" aria-label={`${row.content}の領収書を撮る`} onClick={() => onShoot(row)} className="cap-press flex size-14 shrink-0 items-center justify-center rounded-full bg-foreground text-background"><Camera className="size-5" strokeWidth={1.6} /></button>
      </div>)}</div> : <p className="py-14 text-center text-[14px] tracking-[0.08em] text-muted-foreground">領収書がない利用はありません</p>}
      <p className="px-1 text-[13px] leading-relaxed tracking-[0.04em] text-muted-foreground">カメラのボタンで撮ると、その利用に直接付きます。領収書がもらえなかった利用は、経理に伝えてください。</p>
    </div>
  </Screen>;
}

export const cardStatusText: Record<CardReceiptView["status"], string> = { LINKED: "カード明細に付けました", CHOOSE: "どの利用か選んでください", WAITING: "明細の反映待ち・届いたら自動で付けます" };
export const cardStatusTone: Record<CardReceiptView["status"], Tone> = { LINKED: "ok", CHOOSE: "wait", WAITING: "idle" };

export function CardReceiptList({ receipts, fresh, onOpen }: { receipts: CardReceiptView[]; fresh: Set<string>; onOpen: (id: string) => void }) {
  const rank = (row: CardReceiptView) => fresh.has(row.id) ? 0 : row.status === "CHOOSE" ? 1 : 2;
  const rows = receipts.slice().sort((a, b) => rank(a) - rank(b) || b.createdAt.localeCompare(a.createdAt));
  return <ul className="space-y-3 px-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
    {rows.map((row) => <li key={row.id}><button type="button" onClick={() => onOpen(row.id)}
      className={`cap-surface cap-press flex w-full flex-col gap-3 px-5 py-4 text-left ${fresh.has(row.id) ? "shadow-[inset_0_0_0_1.5px_var(--foreground),var(--cap-shadow)]" : ""}`}>
      <span className="flex w-full items-start gap-3">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5"><span className="flex items-center gap-2 text-[16px]"><span className="truncate">{row.payee}</span>
          {fresh.has(row.id) ? <span className="shrink-0 rounded-full bg-foreground px-2 py-0.5 text-[10.5px] tracking-[0.12em] text-background">たった今</span> : null}</span>
          <span className="truncate text-[12.5px] tracking-[0.04em] text-muted-foreground">{dayLabel(row.spentOn)}・{row.purpose}</span></span>
        <Amount value={row.amount} className="text-[19px]" />
      </span>
      <Status tone={cardStatusTone[row.status]}>{cardStatusText[row.status]}</Status>
    </button></li>)}
    {!rows.length ? <li className="py-14 text-center text-[14px] tracking-[0.08em] text-muted-foreground">会社カードの領収書はまだありません</li> : null}
  </ul>;
}

export function CardDetailScreen({ receipt, cardLabel, onBack, onChoose, onRemove }: { receipt: CardReceiptView; cardLabel: string; onBack: () => void; onChoose: () => void; onRemove: () => void }) {
  const footer = receipt.status === "CHOOSE" ? <div className="space-y-1"><PrimaryButton onClick={onChoose}>どの利用か選ぶ</PrimaryButton><TextButton onClick={onRemove}>この領収書を削除</TextButton></div>
    : <SecondaryButton tone="danger" onClick={onRemove}>この領収書を削除</SecondaryButton>;
  return <Screen footer={footer}>
    <TopBar title="会社カードの領収書" onBack={onBack} />
    <div className="space-y-4 px-6 pb-8 pt-1">
      <div className="flex items-end gap-4">
        <a href={receipt.fileUrl || undefined} target="_blank" rel="noreferrer" aria-label="領収書を開く"><ReceiptThumb src={receipt.fileUrl} pdf={receipt.mimeType === "application/pdf"} className="h-[96px] w-[74px]" /></a>
        <div className="min-w-0 pb-0.5"><Amount value={receipt.amount} className="block text-[38px] leading-none" /><p className="mt-2 truncate text-[16px]">{receipt.payee}</p>
          <p className="truncate text-[12.5px] tracking-[0.04em] text-muted-foreground">{dayLabel(receipt.spentOn)}・{receipt.purpose}</p></div>
      </div>
      <div className="px-1"><Status tone={cardStatusTone[receipt.status]}>{cardStatusText[receipt.status]}</Status></div>
      <Card>
        <DetailRow label="カード">{cardLabel}</DetailRow>
        <DetailRow label="カード利用">{receipt.use ? `${dayLabel(receipt.use.date)}　${receipt.use.content}` : "まだ付いていません"}</DetailRow>
        <DetailRow label="案件" last>{receipt.projectName || "共通経費（案件なし）"}</DetailRow>
      </Card>
    </div>
  </Screen>;
}
