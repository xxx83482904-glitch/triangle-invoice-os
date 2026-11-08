"use client";

import { useState } from "react";
import { Camera, Check, CreditCard, ImagePlus, List, Loader2, Plus, Trash2, Wallet } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ExpensePaidWith } from "@/lib/types";
import { CardMatchBox, CardReceiptList } from "./card-screens";
import { amountOf, missing, type CardReceiptView, type CardUseView, type Draft, type FieldKey, type MyClaim, type Option } from "./model";
import { Amount, AttentionRow, AutoBadge, CaptureTile, Card, DetailRow, DoneMark, Eyebrow, HomeHeader, Notice, PrimaryButton, ReceiptThumb, Row, Screen, SecondaryButton, Segmented, Status, StatusSteps, TextButton, TopBar, dateTimeLabel, dayLabel, statusText, statusTone } from "./ui";

const label = (options: Option[], value: string) => options.find((row) => row.value === value)?.label || "";

export function HomeScreen({ name, waiting, submitted, returned, drafts, install, onCamera, onLibrary, onList, onReturned, onDrafts }: {
  name: string; waiting: { amount: number; count: number }; submitted: { amount: number; count: number }; returned: number; drafts: number; install: React.ReactNode;
  onCamera: () => void; onLibrary: () => void; onList: () => void; onReturned: () => void; onDrafts: () => void;
}) {
  return <Screen>
    <div className="flex flex-1 flex-col gap-4 px-6 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-[calc(env(safe-area-inset-top)+1.5rem)]">
      <HomeHeader name={name} onList={onList} />
      <button type="button" onClick={onList} aria-label="自分の精算状況" className="cap-surface cap-press w-full px-6 pb-5 pt-5 text-left">
        <Eyebrow>振込待ち・承認済み</Eyebrow>
        <Amount value={waiting.amount} className="mt-1 block text-[44px] leading-none" />
        <span className="cap-hairline mt-5 flex border-t pt-3.5 text-[13px] tracking-[0.06em] text-muted-foreground">
          <span className="flex-1">申請中 <span className="text-foreground">{submitted.count}件</span></span><Amount value={submitted.amount} className="text-[15px] text-foreground" /></span>
      </button>
      {returned ? <AttentionRow tone="ng" title={`差し戻された申請 ${returned}件`} detail="直して再提出してください" onClick={onReturned} /> : null}
      {drafts ? <AttentionRow tone="wait" title={`まだ送っていない領収書 ${drafts}枚`} detail="続きを確認する" onClick={onDrafts} /> : null}
      <div className="min-h-4 flex-1" />
      <CaptureTile title="領収書を撮る" caption="続けて何枚でも。金額・日付・お店は自動で読み取ります" icon={<Camera className="size-6" strokeWidth={1.5} />} onClick={onCamera} className="h-[236px]" />
      <SecondaryButton onClick={onLibrary}><ImagePlus className="size-[18px]" strokeWidth={1.6} />写真・PDFから選ぶ</SecondaryButton>
      {install}
    </div>
  </Screen>;
}

export function ReadingScreen({ draft, onManual, onClose }: { draft: Draft; onManual: () => void; onClose: () => void }) {
  const amount = amountOf(draft.fields);
  return <div className="flex min-h-dvh flex-col bg-[#0f1013] text-foreground">
    <div className="flex justify-start px-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]"><button type="button" onClick={onClose} className="flex h-14 items-center px-3 text-[15px] tracking-[0.1em] text-white/70">やめる</button></div>
    <div className="relative flex flex-1 items-center justify-center overflow-hidden px-12 py-6">
      <div className="relative max-h-[52dvh] overflow-hidden rounded-[6px] shadow-[0_30px_60px_-20px_rgba(0,0,0,0.8)]">
        {draft.preview && !draft.pdf
          // eslint-disable-next-line @next/next/no-img-element -- local preview of the photo just taken
          ? <img src={draft.preview} alt="撮影した領収書" className="max-h-[52dvh] w-auto object-contain" />
          : <div className="flex h-72 w-52 items-center justify-center bg-white text-sm tracking-[0.2em] text-neutral-500">PDF</div>}
        <span className="receipt-scan pointer-events-none absolute inset-x-0 h-px bg-white shadow-[0_0_24px_8px_rgba(255,255,255,0.35)]" />
      </div>
    </div>
    <div className="space-y-5 rounded-t-[28px] bg-background px-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-7" role="status">
      <div><Eyebrow>READING</Eyebrow><p className="mt-1 flex items-center gap-3 text-[20px] font-medium tracking-[0.08em]"><Loader2 className="size-5 animate-spin text-muted-foreground" strokeWidth={1.6} />読み取っています</p>
        <p className="mt-1 text-[13.5px] tracking-[0.06em] text-muted-foreground">金額・日付・お店を探しています</p></div>
      {amount ? <p className="flex items-center gap-2.5 text-[15px]"><Check className="size-4" strokeWidth={2} />金額<Amount value={amount} className="ml-auto text-[20px]" /></p> : null}
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
  const title = mode === "edit" ? (claim?.status === "RETURNED" ? "差し戻された申請" : "申請を直す") : isCard ? "会社カードの領収書" : "内容の確認";
  const attach = isCard && (draft.targetUse || card?.matches.length === 1);
  const submitLabel = isCard ? (attach ? "明細に付ける" : "登録する") : "申請する";
  const footer = mode === "batch"
    ? <div className="grid grid-cols-[4.5rem_1fr] gap-2.5"><SecondaryButton label="この領収書を外す" tone="danger" onClick={onRemove} disabled={sending} className="h-16"><Trash2 className="size-5" strokeWidth={1.6} /></SecondaryButton>
      <PrimaryButton onClick={onBack}>OK</PrimaryButton></div>
    : mode === "edit"
      ? <div className="space-y-1"><PrimaryButton onClick={onSubmit} disabled={sending}>{sending ? <><Loader2 className="size-5 animate-spin" />送信しています</> : claim?.status === "RETURNED" ? "直して再提出" : "変更を保存"}</PrimaryButton>
        <TextButton onClick={onWithdraw} disabled={sending}>この申請を取り下げる</TextButton></div>
      : <div className="grid grid-cols-[6.5rem_1fr] gap-2.5"><SecondaryButton onClick={onRetake} disabled={sending} className="h-16">撮り直す</SecondaryButton>
        <PrimaryButton onClick={onSubmit} disabled={sending || reading && !draft.manual}>{sending ? <><Loader2 className="size-5 animate-spin" />送信中</> : reading && !draft.manual ? "読み取り中" : submitLabel}</PrimaryButton></div>;
  return <Screen footer={footer}>
    <TopBar title={title} onBack={onBack} close={mode !== "batch"} />
    <div className="space-y-4 px-6 pb-8 pt-1">
      {card && mode !== "edit" ? <Segmented label="支払いの種類" value={draft.kind} disabled={sending || !onSwitchKind || Boolean(draft.targetUse)}
        onChange={(value) => { if (value !== draft.kind) onSwitchKind?.(); }}
        options={[{ value: "card", label: <><CreditCard className="size-4" strokeWidth={1.6} />会社カード</> }, { value: "expense", label: <><Wallet className="size-4" strokeWidth={1.6} />立替</> }]} /> : null}
      {claim?.status === "RETURNED" && claim.reviewNote ? <Notice tone="ng" title={`経理からのコメント${claim.reviewerName ? `・${claim.reviewerName}` : ""}`}>{claim.reviewNote}</Notice> : null}
      {draft.warnings.map((warning) => <Notice key={warning} tone="wait">{warning}</Notice>)}
      <div className="flex items-stretch gap-4">
        <a href={draft.preview || undefined} target="_blank" rel="noreferrer" aria-label="領収書を拡大" className="shrink-0"><ReceiptThumb src={draft.preview} pdf={draft.pdf} className="h-[124px] w-[94px]" /></a>
        <label className="flex min-w-0 flex-1 flex-col justify-end gap-1.5">
          <span className="flex items-center gap-2"><Eyebrow>金額</Eyebrow><AutoBadge source={fields.amount ? auto.amount : undefined} /></span>
          <span className="cap-hairline flex items-baseline border-b pb-1.5">
            <span className="cap-figure text-[30px] text-muted-foreground/70">¥</span>
            <input inputMode="numeric" aria-label="金額（円）" value={fields.amount ? Number(fields.amount.replaceAll(",", "") || 0).toLocaleString("ja-JP") : ""} placeholder="0" disabled={sending}
              onChange={(event) => onChange("amount", event.target.value.replace(/[^\d]/g, ""))}
              className="cap-figure min-w-0 flex-1 bg-transparent pl-1 text-[42px] leading-none outline-none placeholder:text-muted-foreground/40" />
          </span>
          {reading ? <span role="status" className="flex items-center gap-1.5 text-[12px] tracking-[0.08em] text-muted-foreground"><Loader2 className="size-3 animate-spin" />読み取り中・終わると空欄に入ります</span> : null}
        </label>
      </div>
      <Card>
        <Row label="日付" value={dayLabel(fields.spentOn)} placeholder="選んでください" warn source={auto.spentOn} onClick={() => onSheet("spentOn")} />
        <Row label="お店" value={fields.payee} placeholder="入力してください" warn source={auto.payee} onClick={() => onSheet("payee")} />
        <Row label="用途" value={fields.purpose} placeholder="入力してください" warn source={auto.purpose} onClick={() => onSheet("purpose")} />
        <Row label="案件" value={label(projects, fields.projectId) || (fields.projectId ? "（利用できない案件）" : "")} placeholder="共通経費（案件なし）" onClick={() => onSheet("projectId")} last />
      </Card>
      {isCard ? <CardMatchBox target={draft.targetUse} matches={card?.matches || []} />
        : <div className="space-y-2"><Eyebrow>支払い方法</Eyebrow>
          <Segmented<ExpensePaidWith> label="支払い方法" value={fields.paidWith} disabled={sending} onChange={(value) => onChange("paidWith", value)}
            options={[{ value: "CASH", label: "現金" }, { value: "PERSONAL_CARD", label: "個人カード等" }]} /></div>}
      <button type="button" aria-expanded={draft.more} onClick={onToggleMore} className="flex min-h-12 items-center gap-2 text-[14px] tracking-[0.08em] text-muted-foreground">
        <Plus className={`size-4 transition-transform ${draft.more ? "rotate-45" : ""}`} strokeWidth={1.6} />その他　科目・登録番号・メモ</button>
      {draft.more ? <div className="space-y-4">
        <Card><Row label="科目" value={label(categories, fields.categoryId)} placeholder="わからない（経理が設定）" source={auto.categoryId} onClick={() => onSheet("categoryId")} last /></Card>
        <label className="block space-y-1.5"><span className="flex items-center gap-2"><Eyebrow>インボイス登録番号</Eyebrow><AutoBadge source={fields.registrationNumber ? auto.registrationNumber : undefined} /></span>
          <Input className="cap-surface h-14 rounded-[16px] border-0 px-4 text-[16px] tracking-[0.06em]" value={fields.registrationNumber} placeholder="T1234567890123" maxLength={20} autoCapitalize="characters" disabled={sending} onChange={(event) => onChange("registrationNumber", event.target.value.toUpperCase())} /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1.5"><span className="flex items-center gap-2"><Eyebrow>消費税 10%</Eyebrow><AutoBadge source={fields.tax10 ? auto.tax10 : undefined} /></span>
            <Input className="cap-surface h-14 rounded-[16px] border-0 px-4 text-[16px]" inputMode="numeric" value={fields.tax10} disabled={sending} onChange={(event) => onChange("tax10", event.target.value.replace(/\D/g, ""))} /></label>
          <label className="block space-y-1.5"><span className="flex items-center gap-2"><Eyebrow>消費税 8%</Eyebrow><AutoBadge source={fields.tax8 ? auto.tax8 : undefined} /></span>
            <Input className="cap-surface h-14 rounded-[16px] border-0 px-4 text-[16px]" inputMode="numeric" value={fields.tax8} disabled={sending} onChange={(event) => onChange("tax8", event.target.value.replace(/\D/g, ""))} /></label>
        </div>
        <label className="block space-y-1.5"><Eyebrow>メモ</Eyebrow>
          <Textarea className="cap-surface min-h-24 rounded-[16px] border-0 px-4 py-3 text-[16px]" value={fields.memo} placeholder="同席者・補足など" maxLength={1000} disabled={sending} onChange={(event) => onChange("memo", event.target.value)} /></label>
      </div> : null}
      {mode === "edit" ? <SecondaryButton onClick={onRetake} disabled={sending}><Camera className="size-[18px]" strokeWidth={1.6} />領収書を撮り直す</SecondaryButton> : null}
      {draft.error ? <div role="alert"><Notice tone="ng">{draft.error}</Notice></div>
        : gaps.length && !reading ? <Status tone="wait">未入力　{gaps.join("・")}</Status> : null}
    </div>
  </Screen>;
}

export function BatchScreen({ drafts, today, sending, cardLabel, project, onBack, onOpen, onProject, onCamera, onSubmit }: {
  drafts: Draft[]; today: string; sending: boolean; cardLabel?: string; project: string; onBack: () => void; onOpen: (key: string) => void; onProject: () => void; onCamera: () => void; onSubmit: () => void;
}) {
  const ready = drafts.filter((row) => row.state === "ready" && !missing(row.fields, today).length);
  const waiting = drafts.length - ready.length, total = drafts.reduce((sum, row) => sum + amountOf(row.fields), 0);
  const stillReading = drafts.some((row) => row.state === "reading" || row.state === "preparing");
  return <Screen footer={<div className="space-y-2.5">
    <p className="flex items-baseline justify-between text-[13px] tracking-[0.06em] text-muted-foreground"><span>{waiting ? `${waiting}枚が${stillReading ? "読み取り中・" : ""}入力待ち` : `${drafts.length}枚すべて入力済み`}</span><span>合計 <Amount value={total} className="text-[18px] text-foreground" /></span></p>
    <PrimaryButton onClick={onSubmit} disabled={!ready.length || sending}>{sending ? <><Loader2 className="size-5 animate-spin" />登録しています</> : ready.length ? `${ready.length}件をまとめて登録` : "入力が必要です"}</PrimaryButton></div>}>
    <TopBar title={`${drafts.length}枚の確認`} onBack={onBack} />
    <div className="space-y-4 px-6 pb-8 pt-1">
      <div className="space-y-2"><Eyebrow>まとめて設定</Eyebrow><Card><Row label="案件" value={project} placeholder="共通経費（案件なし）" onClick={onProject} last /></Card></div>
      <div className="space-y-2"><Eyebrow>1枚ずつ確認・修正</Eyebrow>
        <Card>{drafts.map((draft, index) => {
          const gaps = missing(draft.fields, today), reading = draft.state === "reading" || draft.state === "preparing", amount = amountOf(draft.fields);
          return <button key={draft.key} type="button" onClick={() => onOpen(draft.key)} className={`flex min-h-[96px] w-full items-center gap-4 px-4 py-3.5 text-left active:bg-muted/60 ${index ? "cap-hairline border-t" : ""}`}>
            <ReceiptThumb src={draft.preview} pdf={draft.pdf} className="h-[68px] w-[52px]" />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="truncate text-[16px]">{draft.fields.payee || (reading ? "読み取り中" : "お店が未入力")}</span>
              <span className="truncate text-[12.5px] tracking-[0.04em] text-muted-foreground">{[cardLabel ? (draft.kind === "card" ? "会社カード" : "立替") : "", dayLabel(draft.fields.spentOn), draft.fields.purpose].filter(Boolean).join("・") || "—"}</span>
              {reading ? <Status tone="idle">読み取り中</Status>
                : draft.state === "sending" ? <Status tone="idle">送信中</Status>
                  : draft.error ? <Status tone="ng">{draft.error}</Status>
                    : gaps.length ? <Status tone="wait">{gaps.join("・")}が未入力</Status>
                      : <Status tone="ok">{draft.kind === "card" ? "登録できます" : "申請できます"}</Status>}
            </span>
            {amount ? <Amount value={amount} className="text-[19px]" /> : <span className="text-muted-foreground">—</span>}
          </button>;
        })}</Card></div>
      <SecondaryButton onClick={onCamera}><Camera className="size-[18px]" strokeWidth={1.6} />続けて撮る</SecondaryButton>
    </div>
  </Screen>;
}

export function DoneScreen({ count, total, label: detail, note, onCamera, onList, onHome }: { count: number; total: number; label: string; note?: string; onCamera: () => void; onList: () => void; onHome: () => void }) {
  return <Screen>
    <div className="flex flex-1 flex-col gap-3 px-6 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-[calc(env(safe-area-inset-top)+2rem)]">
      <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center" role="status">
        <DoneMark><Check className="size-10" strokeWidth={1.6} /></DoneMark>
        <div><Eyebrow>{count > 1 ? `${count} RECEIPTS` : "SUBMITTED"}</Eyebrow><p className="mt-1 text-[24px] font-medium tracking-[0.08em]">{count > 1 ? `${count}件を登録しました` : "申請しました"}</p></div>
        <div><Amount value={total} className="block text-[40px] leading-none" /><p className="mt-2 text-[14px] tracking-[0.06em] text-muted-foreground">{detail}</p></div>
        <p className="max-w-[20rem] text-[13.5px] leading-relaxed tracking-[0.04em] text-muted-foreground">{note || "経理が確認したあと、口座に振り込まれます。"}</p>
      </div>
      <PrimaryButton onClick={onCamera} className="h-[68px]"><Camera className="size-5" strokeWidth={1.6} />続けて撮る</PrimaryButton>
      <SecondaryButton onClick={onList}><List className="size-[18px]" strokeWidth={1.6} />申請状況を見る</SecondaryButton>
      <TextButton onClick={onHome}>ホームへ</TextButton>
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
  return <Screen>
    <TopBar title="申請状況" onBack={onBack} />
    <div className="space-y-2.5 px-6 pb-4 pt-1">
      {card ? <Segmented label="種類" value={kind} onChange={setKind}
        options={[{ value: "expense", label: <><Wallet className="size-4" strokeWidth={1.6} />立替 {claims.length}</> }, { value: "card", label: <><CreditCard className="size-4" strokeWidth={1.6} />会社カード {card.receipts.length}</> }]} /> : null}
      {kind === "expense" ? <Segmented label="表示" value={tab} onChange={setTab}
        options={[{ value: "active", label: `進行中 ${active.length}` }, { value: "paid", label: "振込済み" }, { value: "all", label: "すべて" }]} /> : null}
    </div>
    {kind === "card" && card ? <CardReceiptList receipts={card.receipts} fresh={fresh} onOpen={card.onOpen} />
      : <ul className="space-y-3 px-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
        {rows.map((row) => <li key={row.id}><button type="button" onClick={() => onOpen(row.id)}
          className={`cap-surface cap-press flex w-full flex-col gap-3 px-5 py-4 text-left ${fresh.has(row.id) ? "shadow-[inset_0_0_0_1.5px_var(--foreground),var(--cap-shadow)]" : ""}`}>
          <span className="flex w-full items-start gap-3">
            <span className="flex min-w-0 flex-1 flex-col gap-0.5"><span className="flex items-center gap-2 text-[16px]"><span className="truncate">{row.payee}</span>
              {fresh.has(row.id) ? <span className="shrink-0 rounded-full bg-foreground px-2 py-0.5 text-[10.5px] tracking-[0.12em] text-background">たった今</span> : null}</span>
              <span className="truncate text-[12.5px] tracking-[0.04em] text-muted-foreground">{dayLabel(row.spentOn)}・{row.purpose}</span></span>
            <Amount value={row.amount} className="text-[19px]" />
          </span>
          <Status tone={statusTone[row.status]}>{row.status === "PAID" && row.paidAt ? `${dayLabel(row.paidAt)}に振込済み` : statusText[row.status]}</Status>
          {row.status === "RETURNED" ? <span className="text-[13.5px] leading-relaxed text-muted-foreground">{row.reviewNote}</span> : <StatusSteps status={row.status} />}
        </button></li>)}
        {!rows.length ? <li className="py-14 text-center text-[14px] tracking-[0.08em] text-muted-foreground">{tab === "paid" ? "振込済みの申請はまだありません" : "申請はまだありません"}</li> : null}
      </ul>}
  </Screen>;
}

function Step({ state, title, sub, last = false }: { state: "done" | "now" | "todo" | "returned"; title: string; sub: string; last?: boolean }) {
  const tone = state === "done" ? "ok" : state === "returned" ? "ng" : state === "now" ? "info" : "idle";
  return <div className="flex gap-4">
    <div className="flex w-3.5 flex-col items-center pt-1.5">
      <span className={`cap-tone-${tone} size-3.5 shrink-0 rounded-full ${state === "todo" ? "shadow-[inset_0_0_0_1.5px_var(--border)]" : state === "now" ? "cap-tone-ring" : "cap-tone-dot"}`} />
      {last ? null : <span className={`my-1 w-px flex-1 ${state === "done" ? "bg-foreground/40" : "bg-border"}`} />}
    </div>
    <div className={last ? "" : "pb-6"}><p className={`text-[16px] tracking-[0.04em] ${state === "todo" ? "text-muted-foreground" : ""}`}>{title}</p>
      <p className={`mt-0.5 text-[12.5px] tracking-[0.06em] ${state === "now" ? `cap-tone-${tone} cap-tone-text` : "text-muted-foreground"}`}>{sub}</p></div>
  </div>;
}

export function DetailScreen({ claim, onBack, onEdit, onWithdraw }: { claim: MyClaim; onBack: () => void; onEdit: () => void; onWithdraw: () => void }) {
  const s = claim.status;
  const footer = s === "SUBMITTED" ? <div className="grid grid-cols-2 gap-2.5"><SecondaryButton tone="danger" onClick={onWithdraw}>取り下げる</SecondaryButton><SecondaryButton onClick={onEdit}>内容を直す</SecondaryButton></div>
    : s === "RETURNED" ? <PrimaryButton onClick={onEdit}>直して再提出</PrimaryButton> : undefined;
  return <Screen footer={footer}>
    <TopBar title="申請の詳細" onBack={onBack} />
    <div className="space-y-4 px-6 pb-8 pt-1">
      <div className="flex items-end gap-4">
        <a href={claim.fileUrl || undefined} target="_blank" rel="noreferrer" aria-label="領収書を開く"><ReceiptThumb src={claim.fileUrl} pdf={claim.mimeType === "application/pdf"} className="h-[96px] w-[74px]" /></a>
        <div className="min-w-0 pb-0.5"><Amount value={claim.amount} className="block text-[38px] leading-none" /><p className="mt-2 truncate text-[16px]">{claim.payee}</p>
          <p className="truncate text-[12.5px] tracking-[0.04em] text-muted-foreground">{dayLabel(claim.spentOn)}・{claim.purpose}</p></div>
      </div>
      {s === "RETURNED" ? <Notice tone="ng" title={`経理からのコメント${claim.reviewerName ? `・${claim.reviewerName}` : ""}`}>{claim.reviewNote}</Notice> : null}
      <Card className="px-5 py-5"><Eyebrow className="mb-4">PROGRESS ・ 進み具合</Eyebrow>
        <Step state="done" title="申請しました" sub={dateTimeLabel(claim.submittedAt)} />
        {s === "RETURNED" ? <Step state="returned" title="差し戻されました" sub={`${dateTimeLabel(claim.reviewedAt)}・直して再提出してください`} />
          : s === "SUBMITTED" ? <Step state="now" title="経理が確認しています" sub="いま、ここです" />
            : <Step state="done" title="承認されました" sub={dateTimeLabel(claim.reviewedAt)} />}
        {s === "PAID" ? <Step state="done" title="口座に振り込みました" sub={dayLabel(claim.paidAt)} last />
          : s === "APPROVED" ? <Step state="now" title="振込を待っています" sub="いま、ここです" last />
            : <Step state="todo" title="口座に振込" sub="承認されると振込日が入ります" last />}
      </Card>
      <Card>
        <DetailRow label="案件">{claim.projectName || "共通経費（案件なし）"}</DetailRow>
        <DetailRow label="支払い方法">{claim.paidWith === "PERSONAL_CARD" ? "個人カード・電子マネー" : claim.paidWith === "OTHER" ? "その他" : "現金"}</DetailRow>
        <DetailRow label="科目" last>{claim.categoryName || "経理が設定"}</DetailRow>
      </Card>
    </div>
  </Screen>;
}
