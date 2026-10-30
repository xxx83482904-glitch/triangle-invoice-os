"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, LoaderCircle, Plus, Save, Trash2 } from "lucide-react";
import { loadBankBookkeepingAction, saveBankBookkeepingAction } from "@/app/banking/bookkeeping-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { bankSplitValidation, type BankBookkeepingDetail, type BankBookkeepingInput, type BankHoldReason, type BankSplit, type BookkeepingTransaction } from "@/lib/bank-bookkeeping";
import type { AccountingCategory, BankTransaction } from "@/lib/banking-types";
import type { CompanyScope } from "@/lib/company";

type Props = {
  company: CompanyScope;
  transaction: BankTransaction;
  categories: AccountingCategory[];
  disabled?: boolean;
  onSaved?: (transaction: BookkeepingTransaction) => void;
};
const money = (amount: number) => new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" }).format(amount);
const selectClass = "min-h-11 w-full min-w-0 rounded-md border bg-background px-2 text-sm disabled:opacity-50";
const holdLabels: Record<BankHoldReason, string> = {
  MISSING_DOCUMENT: "資料不足", CATEGORY_UNCLEAR: "科目の確認", AMOUNT_MISMATCH: "金額の確認", DUPLICATE_REVIEW: "重複の確認", OTHER: "その他",
};

export function BankBookkeepingDialog({ company, transaction, categories, disabled, onSaved }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<BankBookkeepingDetail | null>(null);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, startTransition] = useTransition();
  function load() {
    setError(""); setDetail(null); setDirty(false);
    startTransition(async () => {
      try {
        const result = await loadBankBookkeepingAction(company, transaction.id);
        if (!result.success) throw new Error(result.error);
        setDetail(result.detail);
      } catch (cause) { setError(cause instanceof Error ? cause.message : "詳細を取得できません。再読み込みしてください"); }
    });
  }
  function changeOpen(next: boolean) {
    if (loading || saving) return;
    if (!next && dirty && !window.confirm("保存していない詳細を破棄しますか？")) return;
    setOpen(next);
    if (next) load();
  }
  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild><Button type="button" size="icon" variant="ghost" className="size-11 shrink-0" disabled={disabled} title="記帳詳細" aria-label={`${transaction.content || "明細"}の記帳詳細`}><ClipboardList className="size-4" /></Button></DialogTrigger>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl" showCloseButton={!loading && !saving} onInteractOutside={(event) => event.preventDefault()} onEscapeKeyDown={(event) => { if (loading || saving || dirty) event.preventDefault(); }}>
      <DialogHeader><DialogTitle>記帳詳細</DialogTitle><DialogDescription className="break-words pr-6">{transaction.transactionDate} / {transaction.content || "摘要なし"}</DialogDescription></DialogHeader>
      {loading ? <p role="status" className="flex items-center gap-2 py-6"><LoaderCircle className="size-4 animate-spin" />読み込み中...</p> : null}
      {error ? <div className="space-y-2"><p role="alert" className="break-words text-destructive">{error}</p><Button type="button" variant="outline" onClick={load} disabled={loading}>再読み込み</Button></div> : null}
      {detail ? <BookkeepingEditor key={`${detail.transaction.id}:${detail.transaction.updatedAt}`} company={company} detail={detail} categories={categories} onDirty={() => setDirty(true)} onBusy={setSaving} onSaved={(row) => { setDirty(false); setOpen(false); router.refresh(); onSaved?.(row); }} /> : null}
    </DialogContent>
  </Dialog>;
}

function CategorySelection({ categories, categoryId, subCategoryId, disabled, onChange, label }: {
  categories: AccountingCategory[]; categoryId?: string; subCategoryId?: string; disabled: boolean;
  onChange: (categoryId?: string, subCategoryId?: string) => void; label: string;
}) {
  const parents = categories.filter((category) => !category.parentId);
  const children = categories.filter((category) => category.parentId === categoryId);
  return <div className="grid min-w-0 gap-2 sm:grid-cols-2">
    <label className="min-w-0 space-y-1"><span className="text-xs text-muted-foreground">勘定科目</span><select aria-label={`${label}の勘定科目`} className={selectClass} value={categoryId || ""} disabled={disabled} onChange={(event) => onChange(event.target.value || undefined)}>
      <option value="">未分類</option>{categoryId && !parents.some((category) => category.id === categoryId) ? <option value={categoryId}>無効な科目 ({categoryId})</option> : null}{parents.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
    </select></label>
    <label className="min-w-0 space-y-1"><span className="text-xs text-muted-foreground">補助科目</span><select aria-label={`${label}の補助科目`} className={selectClass} value={subCategoryId || ""} disabled={disabled || !categoryId} onChange={(event) => onChange(categoryId, event.target.value || undefined)}>
      <option value="">なし</option>{subCategoryId && !children.some((category) => category.id === subCategoryId) ? <option value={subCategoryId}>無効な補助科目 ({subCategoryId})</option> : null}{children.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
    </select></label>
  </div>;
}

function BookkeepingEditor({ company, detail, categories, onDirty, onBusy, onSaved }: {
  company: CompanyScope; detail: BankBookkeepingDetail; categories: AccountingCategory[];
  onDirty: () => void; onBusy: (busy: boolean) => void; onSaved: (row: BookkeepingTransaction) => void;
}) {
  const row = detail.transaction;
  const prefix = useId();
  const [draft, setDraft] = useState<BankBookkeepingInput>(() => ({
    id: row.id, updatedAt: row.updatedAt, categoryId: row.categoryId, subCategoryId: row.subCategoryId,
    splits: row.bookkeeping?.splits || [], hold: row.bookkeeping?.hold || null,
    invoiceRequirement: row.bookkeeping?.invoiceRequirement || "UNDECIDED", memo: row.memo, reviewed: row.reviewed,
  }));
  const [splitMode, setSplitMode] = useState(Boolean(draft.splits.length));
  const [error, setError] = useState("");
  const [busy, startTransition] = useTransition();
  const locked = Boolean(detail.lockedReason);
  const available = categories.filter((category) => category.company === company && category.available && !category.deletedAt && (!category.officeCode || category.officeCode === row.officeCode));
  const validation = bankSplitValidation(row, draft.splits, available);
  const holdInvalid = Boolean(draft.hold && !draft.hold.question.trim());
  const reviewInvalid = draft.reviewed && (Boolean(draft.hold) || row.treatment === "NORMAL" && !draft.categoryId && !draft.splits.length);
  function change(patch: Partial<BankBookkeepingInput>) { setDraft((current) => ({ ...current, ...patch })); setError(""); onDirty(); }
  function changeSplit(id: string, patch: Partial<BankSplit>) { change({ splits: draft.splits.map((split) => split.id === id ? { ...split, ...patch } : split), reviewed: false }); }
  function newSplit(amount = 0): BankSplit { return { id: crypto.randomUUID(), categoryId: "", amount, memo: "" }; }
  function toggleSplit(enabled: boolean) {
    setSplitMode(enabled);
    change(enabled ? { splits: [{ ...newSplit(row.amount), categoryId: draft.categoryId || "", subCategoryId: draft.subCategoryId }, newSplit()], categoryId: undefined, subCategoryId: undefined, reviewed: false }
      : { splits: [], categoryId: draft.splits[0]?.categoryId || undefined, subCategoryId: draft.splits[0]?.subCategoryId, reviewed: false });
  }
  function save() {
    setError(""); onBusy(true);
    startTransition(async () => {
      try {
        const result = await saveBankBookkeepingAction(company, draft);
        if (!result.success) throw new Error(result.error);
        onSaved(result.transaction);
      } catch (cause) { setError(cause instanceof Error ? cause.message : "保存結果を確認できません。再度保存する前に詳細を開き直してください"); }
      finally { onBusy(false); }
    });
  }
  return <form className="min-w-0 space-y-4" onSubmit={(event) => { event.preventDefault(); if (!locked && !busy && !validation.issue && !holdInvalid && !reviewInvalid) save(); }}>
    <div className="flex flex-wrap justify-between gap-2 border-b pb-3"><span>{row.side === "INCOME" ? "入金" : "出金"}</span><strong className="break-all tabular-nums">{money(row.amount)}</strong></div>
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs"><dt className="text-muted-foreground">元明細ID</dt><dd className="break-all">{row.sourceId}</dd><dt className="text-muted-foreground">事業者</dt><dd className="break-all">{row.officeCode}</dd></dl>
    {detail.lockedReason ? <p role="alert" className="border-l-2 border-amber-500 p-3">{detail.lockedReason}</p> : null}
    <fieldset disabled={locked || busy} className="min-w-0 space-y-4 disabled:opacity-60">
      <section className="min-w-0 space-y-3 border-t pt-3">
        <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-5 accent-primary" checked={splitMode} disabled={row.treatment !== "NORMAL"} onChange={(event) => toggleSplit(event.target.checked)} /><span className="font-medium">複数科目に分割</span></label>
        {!splitMode ? <CategorySelection categories={available} categoryId={draft.categoryId} subCategoryId={draft.subCategoryId} disabled={locked || busy} label="明細" onChange={(categoryId, subCategoryId) => change({ categoryId, subCategoryId, reviewed: false })} /> : <>
          <ol className="divide-y border-y">{draft.splits.map((split, index) => <li key={split.id} className="min-w-0 space-y-2 py-3">
            <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-medium">分割 {index + 1}</h3><Button type="button" size="icon" variant="ghost" className="size-11" aria-label={`分割${index + 1}を削除`} title="分割行を削除" disabled={draft.splits.length <= 2} onClick={() => change({ splits: draft.splits.filter((item) => item.id !== split.id), reviewed: false })}><Trash2 className="size-4" /></Button></div>
            <CategorySelection categories={available} categoryId={split.categoryId} subCategoryId={split.subCategoryId} disabled={locked || busy} label={`分割${index + 1}`} onChange={(categoryId, subCategoryId) => changeSplit(split.id, { categoryId: categoryId || "", subCategoryId })} />
            <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"><label className="min-w-0 space-y-1"><span className="text-xs text-muted-foreground">金額 (円)</span><Input type="number" inputMode="numeric" min={1} max={row.amount} step={1} className="min-h-11" aria-label={`分割${index + 1}の金額`} value={split.amount || ""} onChange={(event) => changeSplit(split.id, { amount: Number(event.target.value) })} /></label><label className="min-w-0 space-y-1"><span className="text-xs text-muted-foreground">メモ</span><Input className="min-h-11" maxLength={2000} aria-label={`分割${index + 1}のメモ`} value={split.memo} onChange={(event) => changeSplit(split.id, { memo: event.target.value })} /></label></div>
          </li>)}</ol>
          <div className="flex flex-wrap items-center justify-between gap-2"><Button type="button" variant="outline" className="min-h-11" disabled={draft.splits.length >= 50} onClick={() => change({ splits: [...draft.splits, newSplit(Math.max(0, validation.remaining))], reviewed: false })}><Plus className="size-4" />分割行を追加</Button><p className="text-sm tabular-nums" role="status">合計 {money(validation.total)} / 差額 {money(validation.remaining)}</p></div>
          {validation.issue ? <p role="alert" className="text-sm text-destructive">{validation.issue}</p> : <p className="text-sm text-emerald-700" role="status">分割合計と明細金額が一致</p>}
        </>}
      </section>
      <section className="min-w-0 space-y-3 border-t pt-3">
        <label className="block space-y-1"><span className="font-medium">請求書</span><select className={selectClass} aria-label="請求書の要否" value={draft.invoiceRequirement} onChange={(event) => change({ invoiceRequirement: event.target.value as BankBookkeepingInput["invoiceRequirement"], reviewed: false })}><option value="UNDECIDED">未判断</option><option value="REQUIRED">必要</option><option value="NOT_REQUIRED" disabled={detail.invoiceLinked}>不要</option></select></label>
        {detail.invoiceLinked ? <p className="text-xs text-muted-foreground">請求書照合済み</p> : null}
        <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-5 accent-primary" checked={Boolean(draft.hold)} onChange={(event) => change({ hold: event.target.checked ? { reason: "MISSING_DOCUMENT", question: "" } : null, reviewed: false })} /><span className="font-medium">保留</span></label>
        {draft.hold ? <div className="min-w-0 space-y-2 border-l-2 border-amber-500 pl-3"><label className="block space-y-1"><span className="text-xs text-muted-foreground">保留理由</span><select className={selectClass} aria-label="保留理由" value={draft.hold.reason} onChange={(event) => change({ hold: { ...draft.hold!, reason: event.target.value as BankHoldReason }, reviewed: false })}>{Object.entries(holdLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="block space-y-1" htmlFor={`${prefix}-question`}><span className="text-xs text-muted-foreground">確認事項 (必須)</span><textarea id={`${prefix}-question`} className="min-h-24 w-full min-w-0 rounded-md border bg-background p-2" maxLength={2000} required value={draft.hold.question} onChange={(event) => change({ hold: { ...draft.hold!, question: event.target.value }, reviewed: false })} /></label>{holdInvalid ? <p role="status" className="text-xs text-amber-700">確認事項が未入力です</p> : null}</div> : null}
        <label className="block space-y-1" htmlFor={`${prefix}-memo`}><span className="font-medium">メモ</span><textarea id={`${prefix}-memo`} className="min-h-20 w-full min-w-0 rounded-md border bg-background p-2" maxLength={2000} value={draft.memo} onChange={(event) => change({ memo: event.target.value })} /></label>
        <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-5 accent-primary" checked={draft.reviewed} disabled={Boolean(draft.hold) || Boolean(validation.issue)} onChange={(event) => change({ reviewed: event.target.checked })} /><span>確認済み</span></label>
        {reviewInvalid ? <p role="alert" className="text-sm text-destructive">確認済みにする前に保留と科目を確認してください</p> : null}
      </section>
    </fieldset>
    <section className="min-w-0 space-y-2 border-t pt-3" aria-label="重複候補と根拠">
      <h3 className="text-sm font-semibold">重複候補 <span className="tabular-nums">{detail.duplicates.length}件</span></h3>
      {detail.duplicates.length ? <><p className="text-xs text-amber-700">未確定・元明細を保持</p><ul className="max-h-64 divide-y overflow-y-auto">{detail.duplicates.map((candidate) => <li key={candidate.id} className="min-w-0 space-y-1 py-3 text-xs">
        <p className="break-words font-medium">{candidate.accountName} / {candidate.transactionDate} / {money(candidate.amount)}</p><p className="break-words">{candidate.content}</p>
        <p className="break-words text-amber-700">{candidate.evidence.map((evidence) => evidence === "SOURCE_ID" ? "元明細IDが一致" : "日付・金額・入出金・摘要が一致").join(" / ")}{candidate.sourceMissing ? " / 元明細なし" : ""}</p>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1"><dt>この元明細ID</dt><dd className="break-all">{candidate.comparedSourceId || "未設定"}</dd><dt>候補の元明細ID</dt><dd className="break-all">{candidate.sourceId || "未設定"}</dd><dt>候補の記録ID</dt><dd className="break-all">{candidate.id}</dd><dt>事業者</dt><dd className="break-all">{candidate.officeCode}</dd></dl>
      </li>)}</ul></> : <p className="text-xs text-muted-foreground">一致する重複候補はありません</p>}
    </section>
    {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
    <div className="flex justify-end border-t pt-3"><Button type="submit" className="min-h-11" disabled={locked || busy || Boolean(validation.issue) || holdInvalid || reviewInvalid}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}{busy ? "保存中..." : "詳細を保存"}</Button></div>
  </form>;
}
