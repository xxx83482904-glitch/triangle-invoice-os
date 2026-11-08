"use client";

import { useState } from "react";
import { AlertCircle, Camera, Check, ChevronRight, CreditCard, ImagePlus, List, Loader2, Plus, Trash2, Wallet } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ExpensePaidWith } from "@/lib/types";
import { CardMatchBox, CardReceiptList } from "./card-screens";
import { amountOf, missing, type CardReceiptView, type CardUseView, type Draft, type FieldKey, type MyClaim, type Option } from "./model";
import { AutoBadge, Card, PrimaryButton, ReceiptThumb, Row, Screen, SecondaryButton, StatusSteps, TopBar, dateTimeLabel, dayLabel, statusText, statusTone, yen } from "./ui";

const label = (options: Option[], value: string) => options.find((row) => row.value === value)?.label || "";

export function HomeScreen({ name, waiting, submitted, returned, drafts, install, onCamera, onLibrary, onList, onReturned, onDrafts }: {
  name: string; waiting: { amount: number; count: number }; submitted: { amount: number; count: number }; returned: number; drafts: number; install: React.ReactNode;
  onCamera: () => void; onLibrary: () => void; onList: () => void; onReturned: () => void; onDrafts: () => void;
}) {
  return <Screen>
    <div className="flex flex-1 flex-col gap-4 px-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-[calc(env(safe-area-inset-top)+1.25rem)]">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0"><p className="text-[15px] text-muted-foreground">経費精算</p><p className="truncate text-[22px] font-bold">{name}さん</p></div>
        <button type="button" aria-label="申請状況の一覧" onClick={onList} className="flex size-14 items-center justify-center rounded-2xl border bg-card active:bg-muted"><List className="size-7" /></button>
      </div>
      <section aria-label="自分の精算状況" className="space-y-3.5 rounded-[22px] border bg-card p-5">
        <div><p className="text-[15px] text-muted-foreground">振込待ち（承認済み）</p><p className="text-[40px] font-bold leading-tight tracking-tight tabular-nums">{yen(waiting.amount)}</p></div>
        <div className="grid grid-cols-2 gap-2.5">
          <button type="button" onClick={onList} className="flex min-h-14 flex-col justify-center rounded-2xl bg-muted px-3.5 py-2 text-left active:opacity-80">
            <span className="text-[13px] text-muted-foreground">申請中</span><span className="text-[17px] font-bold">{submitted.count}件 {yen(submitted.amount)}</span></button>
          <button type="button" onClick={onReturned} disabled={!returned} className={`flex min-h-14 items-center justify-between rounded-2xl px-3.5 py-2 text-left active:opacity-80 ${returned ? "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200" : "bg-muted text-muted-foreground"}`}>
            <span className="flex flex-col"><span className="text-[13px]">差戻し</span><span className="text-[17px] font-bold">{returned ? `${returned}件 直す` : "なし"}</span></span>
            {returned ? <ChevronRight className="size-5" strokeWidth={2.4} /> : null}</button>
        </div>
      </section>
      {drafts ? <button type="button" onClick={onDrafts} className="flex min-h-16 items-center gap-3 rounded-[20px] border-2 border-amber-400 bg-amber-50 px-4 text-left text-amber-950 active:opacity-80 dark:bg-amber-950/40 dark:text-amber-100">
        <AlertCircle className="size-6 shrink-0" /><span className="flex-1 text-[17px] font-bold">まだ申請していない領収書 {drafts}枚</span><ChevronRight className="size-5" strokeWidth={2.4} /></button> : null}
      <div className="flex-1" />
      <button type="button" onClick={onCamera} className="flex h-[248px] flex-col items-center justify-center gap-3.5 rounded-[28px] bg-foreground text-background active:opacity-90">
        <span className="flex size-24 items-center justify-center rounded-full bg-background/15"><Camera className="size-[52px]" strokeWidth={1.8} /></span>
        <span className="text-[26px] font-bold">領収書を撮る</span>
        <span className="text-[15px] opacity-75">撮るだけで金額・日付・お店を読み取ります</span>
      </button>
      <SecondaryButton onClick={onLibrary}><ImagePlus className="size-6" />写真・PDFから選ぶ</SecondaryButton>
      {install}
    </div>
  </Screen>;
}

export function ReadingScreen({ draft, onManual, onClose }: { draft: Draft; onManual: () => void; onClose: () => void }) {
  const amount = amountOf(draft.fields);
  return <div className="flex min-h-dvh flex-col bg-[#0E1222] text-foreground">
    <div className="flex justify-start px-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]"><button type="button" onClick={onClose} className="flex h-14 items-center px-3 text-lg text-white/80">やめる</button></div>
    <div className="relative flex flex-1 items-center justify-center overflow-hidden px-10 py-6">
      <div className="relative max-h-[52dvh] overflow-hidden rounded-md shadow-2xl">
        {draft.preview && !draft.pdf
          // eslint-disable-next-line @next/next/no-img-element -- local preview of the photo just taken
          ? <img src={draft.preview} alt="撮影した領収書" className="max-h-[52dvh] w-auto object-contain" />
          : <div className="flex h-72 w-52 items-center justify-center bg-white text-lg text-slate-500">PDF</div>}
        <span className="receipt-scan pointer-events-none absolute inset-x-0 h-[3px] bg-sky-400 shadow-[0_0_18px_6px_rgba(56,189,248,0.45)]" />
      </div>
    </div>
    <div className="space-y-4 rounded-t-[28px] bg-card px-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-7" role="status">
      <div className="flex items-center gap-3.5"><Loader2 className="size-9 animate-spin text-sky-700 dark:text-sky-300" /><div><p className="text-[22px] font-bold">読み取っています…</p><p className="text-[15px] text-muted-foreground">金額・日付・お店を探しています</p></div></div>
      {amount ? <p className="flex items-center gap-2.5 text-[17px]"><Check className="size-5 text-emerald-700" strokeWidth={2.8} />金額 <span className="ml-auto font-bold tabular-nums">{yen(amount)}</span></p> : null}
      <SecondaryButton onClick={onManual}>待たずに手で入力する</SecondaryButton>
    </div>
  </div>;
}

export function ConfirmScreen({ draft, mode, today, projects, categories, card, onSwitchKind, onBack, onChange, onSheet, onToggleMore, onRetake, onSubmit, onRemove, onWithdraw }: {
  draft: Draft; mode: "single" | "batch" | "edit"; today: string; projects: Option[]; categories: Option[];
  card?: { label: string; matches: CardUseView[] }; onSwitchKind?: () => void;
  onBack: () => void; onChange: (key: FieldKey, value: string) => void; onSheet: (kind: "spentOn" | "payee" | "purpose" | "projectId" | "categoryId") => void;
  onToggleMore: () => void; onRetake: () => void; onSubmit: () => void; onRemove: () => void; onWithdraw: () => void;
}) {
  const { fields, auto } = draft, gaps = missing(fields, today), sending = draft.state === "sending", reading = draft.state === "preparing" || draft.state === "reading";
  const claim = draft.claim, isCard = draft.kind === "card";
  const title = mode === "edit" ? (claim?.status === "RETURNED" ? "差し戻された申請" : "申請を直す") : isCard ? "会社カードの領収書" : "内容を確認";
  const attach = isCard && (draft.targetUse || card?.matches.length === 1);
  const submitLabel = isCard ? (attach ? "明細に付ける" : "登録する") : "申請する";
  const footer = mode === "batch"
    ? <div className="grid grid-cols-3 gap-2.5"><SecondaryButton label="この領収書を外す" tone="danger" onClick={onRemove} disabled={sending}><Trash2 className="size-6" /></SecondaryButton>
      <PrimaryButton className="col-span-2" onClick={onBack}>OK</PrimaryButton></div>
    : mode === "edit"
      ? <div className="space-y-2"><PrimaryButton onClick={onSubmit} disabled={sending}>{sending ? <><Loader2 className="size-6 animate-spin" />送信しています…</> : claim?.status === "RETURNED" ? "直して再提出" : "変更を保存"}</PrimaryButton>
        <button type="button" onClick={onWithdraw} disabled={sending} className="flex min-h-13 w-full items-center justify-center text-base text-muted-foreground">この申請を取り下げる</button></div>
      : <div className="grid grid-cols-3 gap-2.5"><SecondaryButton onClick={onRetake} disabled={sending}>撮り直す</SecondaryButton>
        <PrimaryButton className="col-span-2" onClick={onSubmit} disabled={sending || reading && !draft.manual}>{sending ? <><Loader2 className="size-6 animate-spin" />送信中…</> : reading && !draft.manual ? "読み取り中…" : submitLabel}</PrimaryButton></div>;
  const pay = (value: ExpensePaidWith, text: string) => <button type="button" aria-pressed={fields.paidWith === value} onClick={() => onChange("paidWith", value)} disabled={sending}
    className={`h-[60px] rounded-2xl text-lg ${fields.paidWith === value ? "border-2 border-foreground bg-foreground font-bold text-background" : "border border-input bg-card font-medium"}`}>{text}</button>;
  return <Screen footer={footer}>
    <TopBar title={title} onBack={onBack} close={mode !== "batch"} />
    <div className="space-y-3.5 px-5 pb-6">
      {card && mode !== "edit" ? <div className={`flex min-h-14 items-center gap-3 rounded-2xl px-4 ${isCard ? "bg-foreground text-background" : "border bg-card"}`}>
        {isCard ? <CreditCard className="size-6 shrink-0" /> : <Wallet className="size-6 shrink-0" />}
        <span className="min-w-0 flex-1 text-base font-bold">{isCard ? `${card.label}で支払い` : "自分で立て替えた（あとで振込）"}</span>
        {onSwitchKind && !draft.targetUse ? <button type="button" onClick={onSwitchKind} disabled={sending} className={`min-h-11 shrink-0 text-sm underline underline-offset-4 ${isCard ? "opacity-80" : "text-muted-foreground"}`}>{isCard ? "立替に変える" : "会社カードに変える"}</button> : null}
      </div> : null}
      {claim?.status === "RETURNED" && claim.reviewNote ? <div className="space-y-1.5 rounded-[20px] bg-rose-100 p-4 text-rose-950 dark:bg-rose-950 dark:text-rose-100">
        <p className="text-sm font-bold">経理からのコメント{claim.reviewerName ? `（${claim.reviewerName}）` : ""}</p><p className="text-lg font-medium leading-relaxed">{claim.reviewNote}</p></div> : null}
      {draft.warnings.map((warning) => <p key={warning} className="flex items-start gap-2 rounded-2xl bg-amber-50 p-3 text-[15px] text-amber-950 dark:bg-amber-950/50 dark:text-amber-100"><AlertCircle className="mt-0.5 size-5 shrink-0" />{warning}</p>)}
      {reading ? <p role="status" className="flex items-center gap-2 text-[15px] text-muted-foreground"><Loader2 className="size-4 animate-spin" />読み取りが終わると空欄に入ります</p> : null}
      <div className="flex items-center gap-4">
        <a href={draft.preview || undefined} target="_blank" rel="noreferrer" aria-label="領収書を拡大" className="shrink-0"><ReceiptThumb src={draft.preview} pdf={draft.pdf} className="h-[120px] w-[92px]" /></a>
        <label className="min-w-0 flex-1 space-y-1">
          <span className="flex items-center gap-2 text-[15px] text-muted-foreground">金額<AutoBadge source={fields.amount ? auto.amount : undefined} /></span>
          <span className="flex h-16 items-center rounded-2xl border border-input bg-card px-3.5 focus-within:ring-3 focus-within:ring-ring/50">
            <span className="text-[30px] font-bold text-muted-foreground">¥</span>
            <input inputMode="numeric" aria-label="金額（円）" value={fields.amount ? Number(fields.amount.replaceAll(",", "") || 0).toLocaleString("ja-JP") : ""} placeholder="0" disabled={sending}
              onChange={(event) => onChange("amount", event.target.value.replace(/[^\d]/g, ""))}
              className="min-w-0 flex-1 bg-transparent pl-1 text-[34px] font-bold tabular-nums outline-none placeholder:text-muted-foreground/50" />
          </span>
        </label>
      </div>
      <Card>
        <Row label="日付" value={dayLabel(fields.spentOn)} placeholder="選んでください" warn source={auto.spentOn} onClick={() => onSheet("spentOn")} />
        <Row label="お店" value={fields.payee} placeholder="入力してください" warn source={auto.payee} onClick={() => onSheet("payee")} />
        <Row label="用途" value={fields.purpose} placeholder="入力してください" warn source={auto.purpose} onClick={() => onSheet("purpose")} />
        <Row label="案件" value={label(projects, fields.projectId) || (fields.projectId ? "（利用できない案件）" : "")} placeholder="共通経費（案件なし）" onClick={() => onSheet("projectId")} last />
      </Card>
      {isCard ? <CardMatchBox target={draft.targetUse} matches={card?.matches || []} />
        : <div className="space-y-2"><p className="text-[15px] text-muted-foreground">支払い方法</p>
          <div role="group" aria-label="支払い方法" className="grid grid-cols-2 gap-2.5">{pay("CASH", "現金")}{pay("PERSONAL_CARD", "個人のカード・電子マネー")}</div></div>}
      <button type="button" aria-expanded={draft.more} onClick={onToggleMore} className="flex min-h-14 items-center gap-2 px-1 text-base text-muted-foreground">
        <Plus className={`size-5 transition-transform ${draft.more ? "rotate-45" : ""}`} strokeWidth={2.2} />その他（科目・登録番号・メモ）</button>
      {draft.more ? <div className="space-y-3.5">
        <Card><Row label="科目" value={label(categories, fields.categoryId)} placeholder="わからない（経理が設定）" source={auto.categoryId} onClick={() => onSheet("categoryId")} last /></Card>
        <label className="block space-y-1.5"><span className="flex items-center gap-2 text-[15px] text-muted-foreground">インボイス登録番号<AutoBadge source={fields.registrationNumber ? auto.registrationNumber : undefined} /></span>
          <Input className="h-14 rounded-2xl text-[17px]" value={fields.registrationNumber} placeholder="T1234567890123" maxLength={20} autoCapitalize="characters" disabled={sending} onChange={(event) => onChange("registrationNumber", event.target.value.toUpperCase())} /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1.5"><span className="flex items-center gap-2 text-[15px] text-muted-foreground">消費税 10%<AutoBadge source={fields.tax10 ? auto.tax10 : undefined} /></span>
            <Input className="h-14 rounded-2xl text-[17px]" inputMode="numeric" value={fields.tax10} disabled={sending} onChange={(event) => onChange("tax10", event.target.value.replace(/\D/g, ""))} /></label>
          <label className="block space-y-1.5"><span className="flex items-center gap-2 text-[15px] text-muted-foreground">消費税 8%<AutoBadge source={fields.tax8 ? auto.tax8 : undefined} /></span>
            <Input className="h-14 rounded-2xl text-[17px]" inputMode="numeric" value={fields.tax8} disabled={sending} onChange={(event) => onChange("tax8", event.target.value.replace(/\D/g, ""))} /></label>
        </div>
        <label className="block space-y-1.5"><span className="text-[15px] text-muted-foreground">メモ</span>
          <Textarea className="min-h-24 rounded-2xl text-[17px]" value={fields.memo} placeholder="同席者・補足など" maxLength={1000} disabled={sending} onChange={(event) => onChange("memo", event.target.value)} /></label>
      </div> : null}
      {mode === "edit" ? <SecondaryButton onClick={onRetake} disabled={sending}><Camera className="size-6" />領収書を撮り直す</SecondaryButton> : null}
      {draft.error ? <p role="alert" className="rounded-2xl bg-rose-100 p-3 text-[15px] font-medium text-rose-900 dark:bg-rose-950 dark:text-rose-100">{draft.error}</p>
        : gaps.length && !reading ? <p className="text-[15px] text-amber-800 dark:text-amber-300">未入力：{gaps.join("・")}</p> : null}
    </div>
  </Screen>;
}

export function BatchScreen({ drafts, today, sending, onBack, onOpen, onCamera, onSubmit }: {
  drafts: Draft[]; today: string; sending: boolean; onBack: () => void; onOpen: (key: string) => void; onCamera: () => void; onSubmit: () => void;
}) {
  const ready = drafts.filter((row) => row.state === "ready" && !missing(row.fields, today).length);
  const waiting = drafts.length - ready.length, total = drafts.reduce((sum, row) => sum + amountOf(row.fields), 0);
  return <Screen footer={<div className="space-y-2">
    <p className="text-center text-sm text-muted-foreground">合計 {yen(total)}{waiting ? `（うち${waiting}枚は${drafts.some((row) => row.state === "reading" || row.state === "preparing") ? "読み取り中・" : ""}入力待ち）` : ""}</p>
    <PrimaryButton onClick={onSubmit} disabled={!ready.length || sending}>{sending ? <><Loader2 className="size-6 animate-spin" />申請しています…</> : ready.length ? `${ready.length}件を申請する` : "入力が必要です"}</PrimaryButton></div>}>
    <TopBar title={`${drafts.length}枚を確認`} onBack={onBack} />
    <div className="space-y-3 px-5 pb-6">
      <p className="text-[15px] text-muted-foreground">タップすると1枚ずつ確認・修正できます</p>
      {drafts.map((draft) => {
        const gaps = missing(draft.fields, today), reading = draft.state === "reading" || draft.state === "preparing", amount = amountOf(draft.fields);
        return <button key={draft.key} type="button" onClick={() => onOpen(draft.key)} className={`flex min-h-[104px] w-full items-center gap-3.5 rounded-[20px] bg-card p-3.5 text-left active:bg-muted ${gaps.length && !reading ? "border-2 border-amber-400" : "border"}`}>
          <ReceiptThumb src={draft.preview} pdf={draft.pdf} className="h-[76px] w-[60px]" />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-[17px] font-bold">{draft.fields.payee || (reading ? "読み取り中…" : "お店を入力してください")}</span>
            <span className="truncate text-sm text-muted-foreground">{[dayLabel(draft.fields.spentOn), draft.fields.purpose].filter(Boolean).join("・") || "—"}</span>
            {reading ? <span className="flex items-center gap-1.5 text-[15px] text-muted-foreground"><Loader2 className="size-4 animate-spin" />読み取り中</span>
              : draft.state === "sending" ? <span className="flex items-center gap-1.5 text-[15px] text-muted-foreground"><Loader2 className="size-4 animate-spin" />申請中</span>
                : draft.error ? <span className="text-[15px] font-bold text-rose-800 dark:text-rose-300">{draft.error}</span>
                  : gaps.length ? <span className="flex items-center gap-1.5 text-[15px] font-bold text-amber-800 dark:text-amber-300"><AlertCircle className="size-4" />{gaps.join("・")}が未入力</span>
                    : <span className="flex items-center gap-1.5 text-[15px] font-medium text-emerald-700 dark:text-emerald-300"><Check className="size-4" strokeWidth={2.8} />申請できます</span>}
          </span>
          <span className="text-xl font-bold tabular-nums">{amount ? yen(amount) : "—"}</span>
        </button>;
      })}
      <button type="button" onClick={onCamera} className="flex min-h-16 w-full items-center justify-center gap-2.5 rounded-[20px] border-2 border-dashed border-input text-[17px] font-medium active:bg-muted"><Camera className="size-6" />もう1枚撮る</button>
    </div>
  </Screen>;
}

export function DoneScreen({ count, total, label: detail, onCamera, onList, onHome }: { count: number; total: number; label: string; onCamera: () => void; onList: () => void; onHome: () => void }) {
  return <Screen>
    <div className="flex flex-1 flex-col gap-3.5 px-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-[calc(env(safe-area-inset-top)+2rem)]">
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center" role="status">
        <span className="flex size-32 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950"><Check className="size-[68px] text-emerald-700 dark:text-emerald-300" strokeWidth={2.6} /></span>
        <p className="text-[30px] font-bold">{count > 1 ? `${count}件を申請しました` : "申請しました"}</p>
        <div><p className="text-[34px] font-bold tabular-nums">{yen(total)}</p><p className="text-[17px] text-muted-foreground">{detail}</p></div>
        <p className="text-[15px] leading-relaxed text-muted-foreground">経理が確認したあと、口座に振り込まれます。</p>
      </div>
      <PrimaryButton onClick={onCamera} className="h-[72px] rounded-[22px]"><Camera className="size-7" strokeWidth={2} />続けて撮る</PrimaryButton>
      <SecondaryButton onClick={onList}><List className="size-6" />申請状況を見る</SecondaryButton>
      <button type="button" onClick={onHome} className="flex min-h-12 items-center justify-center text-base text-muted-foreground">ホームへ</button>
    </div>
  </Screen>;
}

type Tab = "active" | "paid" | "all";
export function ListScreen({ claims, fresh, card, initialKind = "expense", onBack, onOpen }: {
  claims: MyClaim[]; fresh: Set<string>; card?: { receipts: CardReceiptView[]; onOpen: (id: string) => void }; initialKind?: "expense" | "card"; onBack: () => void; onOpen: (id: string) => void;
}) {
  const active = claims.filter((row) => row.status !== "PAID");
  const [tab, setTab] = useState<Tab>(active.length ? "active" : "all");
  const [kind, setKind] = useState<"expense" | "card">(card ? initialKind : "expense");
  const rank = (row: MyClaim) => fresh.has(row.id) ? 0 : row.status === "RETURNED" ? 1 : 2;
  const rows = (tab === "active" ? active : tab === "paid" ? claims.filter((row) => row.status === "PAID") : claims)
    .slice().sort((a, b) => rank(a) - rank(b) || b.submittedAt.localeCompare(a.submittedAt));
  const tabButton = (value: Tab, text: string) => <button type="button" aria-pressed={tab === value} onClick={() => setTab(value)}
    className={`h-12 rounded-xl text-base ${tab === value ? "bg-card font-bold shadow-sm" : "text-muted-foreground"}`}>{text}</button>;
  return <Screen>
    <TopBar title="申請状況" onBack={onBack} />
    {card ? <div className="px-5 pb-3"><div role="group" aria-label="種類" className="grid grid-cols-2 gap-1.5 rounded-2xl bg-muted p-1">
      {(["expense", "card"] as const).map((value) => <button key={value} type="button" aria-pressed={kind === value} onClick={() => setKind(value)}
        className={`flex h-[52px] items-center justify-center gap-2 rounded-xl text-base ${kind === value ? "bg-card font-bold shadow-sm" : "text-muted-foreground"}`}>
        {value === "card" ? <><CreditCard className="size-5" />会社カード {card.receipts.length}</> : <><Wallet className="size-5" />立替 {claims.length}</>}</button>)}
    </div></div> : null}
    {kind === "card" && card ? <CardReceiptList receipts={card.receipts} fresh={fresh} onOpen={card.onOpen} /> : <>
    <div className="px-5 pb-3"><div role="group" aria-label="表示" className="grid grid-cols-3 gap-1.5 rounded-2xl bg-muted p-1">
      {tabButton("active", `進行中 ${active.length}`)}{tabButton("paid", "振込済み")}{tabButton("all", "すべて")}</div></div>
    <ul className="space-y-3 px-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
      {rows.map((row) => <li key={row.id}><button type="button" onClick={() => onOpen(row.id)}
        className={`flex w-full flex-col gap-2.5 rounded-[20px] bg-card p-4 text-left active:bg-muted ${fresh.has(row.id) ? "border-2 border-sky-600" : row.status === "RETURNED" ? "border-2 border-rose-400" : "border"}`}>
        <span className="flex w-full items-start gap-3">
          <span className="flex min-w-0 flex-1 flex-col gap-0.5"><span className="flex items-center gap-2 text-[17px] font-bold"><span className="truncate">{row.payee}</span>
            {fresh.has(row.id) ? <span className="shrink-0 rounded-md bg-sky-700 px-1.5 py-0.5 text-xs font-bold text-white">たった今</span> : null}</span>
            <span className="truncate text-sm text-muted-foreground">{dayLabel(row.spentOn)}・{row.purpose}</span></span>
          <span className="text-xl font-bold tabular-nums">{yen(row.amount)}</span>
        </span>
        <span className={`rounded-[10px] px-3 py-1.5 text-[15px] font-bold ${statusTone[row.status]}`}>{row.status === "PAID" && row.paidAt ? `${dayLabel(row.paidAt)}に振込済み` : statusText[row.status]}</span>
        {row.status === "RETURNED" ? <span className="text-sm text-rose-900 dark:text-rose-200">{row.reviewNote}</span> : <StatusSteps status={row.status} />}
      </button></li>)}
      {!rows.length ? <li className="rounded-[20px] border border-dashed p-8 text-center text-[17px] text-muted-foreground">{tab === "paid" ? "振込済みの申請はまだありません" : "申請はまだありません"}</li> : null}
    </ul></>}
  </Screen>;
}

function Step({ state, title, sub, last = false }: { state: "done" | "now" | "todo" | "returned"; title: string; sub: string; last?: boolean }) {
  return <div className="flex gap-3.5">
    <div className="flex flex-col items-center">
      {state === "done" ? <span className="flex size-8 items-center justify-center rounded-full bg-emerald-700"><Check className="size-[18px] text-white" strokeWidth={3} /></span>
        : state === "returned" ? <span className="flex size-8 items-center justify-center rounded-full bg-rose-700"><AlertCircle className="size-[18px] text-white" strokeWidth={2.6} /></span>
          : state === "now" ? <span className="size-8 rounded-full border-[3px] border-sky-700 bg-sky-100 dark:bg-sky-950" /> : <span className="size-8 rounded-full border-[3px] border-muted" />}
      {last ? null : <span className={`h-10 w-[3px] ${state === "done" ? "bg-emerald-700" : "bg-muted"}`} />}
    </div>
    <div className="pt-1"><p className={`text-[17px] font-bold ${state === "now" ? "text-sky-800 dark:text-sky-200" : state === "returned" ? "text-rose-800 dark:text-rose-200" : state === "todo" ? "font-medium text-muted-foreground" : ""}`}>{title}</p>
      <p className="text-sm text-muted-foreground">{sub}</p></div>
  </div>;
}

export function DetailScreen({ claim, onBack, onEdit, onWithdraw }: { claim: MyClaim; onBack: () => void; onEdit: () => void; onWithdraw: () => void }) {
  const s = claim.status;
  const footer = s === "SUBMITTED" ? <div className="grid grid-cols-2 gap-2.5"><SecondaryButton tone="danger" onClick={onWithdraw}>取り下げる</SecondaryButton><SecondaryButton onClick={onEdit} className="font-bold">内容を直す</SecondaryButton></div>
    : s === "RETURNED" ? <PrimaryButton onClick={onEdit}>直して再提出</PrimaryButton> : undefined;
  return <Screen footer={footer}>
    <TopBar title="申請の詳細" onBack={onBack} />
    <div className="space-y-3.5 px-5 pb-6">
      <div className="flex items-center gap-3.5">
        <a href={claim.fileUrl || undefined} target="_blank" rel="noreferrer" aria-label="領収書を開く"><ReceiptThumb src={claim.fileUrl} pdf={claim.mimeType === "application/pdf"} className="h-[92px] w-[72px]" /></a>
        <div className="min-w-0"><p className="text-[36px] font-bold leading-tight tabular-nums">{yen(claim.amount)}</p><p className="truncate text-[17px] font-medium">{claim.payee}</p>
          <p className="truncate text-sm text-muted-foreground">{dayLabel(claim.spentOn)}・{claim.purpose}</p></div>
      </div>
      {s === "RETURNED" ? <div className="space-y-1.5 rounded-[20px] bg-rose-100 p-4 text-rose-950 dark:bg-rose-950 dark:text-rose-100">
        <p className="text-sm font-bold">経理からのコメント{claim.reviewerName ? `（${claim.reviewerName}）` : ""}</p><p className="text-lg font-medium leading-relaxed">{claim.reviewNote}</p></div> : null}
      <Card className="p-5"><p className="mb-3.5 text-[15px] text-muted-foreground">進み具合</p>
        <Step state="done" title="申請しました" sub={dateTimeLabel(claim.submittedAt)} />
        {s === "RETURNED" ? <Step state="returned" title="差し戻されました" sub={`${dateTimeLabel(claim.reviewedAt)}・直して再提出してください`} />
          : s === "SUBMITTED" ? <Step state="now" title="経理が確認しています" sub="いま、ここです" />
            : <Step state="done" title="承認されました" sub={dateTimeLabel(claim.reviewedAt)} />}
        {s === "PAID" ? <Step state="done" title="口座に振り込みました" sub={dayLabel(claim.paidAt)} last />
          : s === "APPROVED" ? <Step state="now" title="振込を待っています" sub="いま、ここです" last />
            : <Step state="todo" title="口座に振込" sub="承認されると振込日が入ります" last />}
      </Card>
      <Card className="text-base">
        <div className="flex min-h-[52px] items-center gap-2 border-b border-border/70 px-4"><span className="w-24 shrink-0 text-muted-foreground">案件</span><span className="min-w-0 break-words">{claim.projectName || "共通経費（案件なし）"}</span></div>
        <div className="flex min-h-[52px] items-center gap-2 border-b border-border/70 px-4"><span className="w-24 shrink-0 text-muted-foreground">支払い方法</span>{claim.paidWith === "PERSONAL_CARD" ? "カード・電子マネー" : claim.paidWith === "OTHER" ? "その他" : "現金"}</div>
        <div className="flex min-h-[52px] items-center gap-2 px-4"><span className="w-24 shrink-0 text-muted-foreground">科目</span>{claim.categoryName || "経理が設定"}</div>
      </Card>
    </div>
  </Screen>;
}
