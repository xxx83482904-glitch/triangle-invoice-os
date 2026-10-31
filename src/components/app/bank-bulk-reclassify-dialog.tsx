"use client";

import { useEffect, useState, useTransition } from "react";
import { Layers, LoaderCircle } from "lucide-react";
import { applyBulkReclassifyAction, previewBulkReclassifyAction } from "@/app/banking/bulk-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { bankSelectClass } from "@/components/app/banking-settings";
import { bankCategorySection } from "@/lib/bank-category-catalog";
import type { BulkReclassifyPreview } from "@/lib/bank-bulk-reclassify";
import type { AccountingCategory, BankTransaction } from "@/lib/banking-types";
import type { CompanyScope } from "@/lib/company";
import { toast } from "@/hooks/use-toast";

const money = (value: number) => new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 }).format(value);

// 取引先単位の一括変更: every row with this description gets one category after a preview. Reviewed rows stay reviewed.
export function BankBulkReclassifyDialog({ company, row, accountName, categories, disabled, onApplied }: {
  company: CompanyScope; row: Pick<BankTransaction, "content" | "side" | "bankAccountId" | "officeCode">; accountName?: string; categories: AccountingCategory[]; disabled?: boolean; onApplied: () => void;
}) {
  const [open, setOpen] = useState(false), [pending, startTransition] = useTransition();
  const [sameSide, setSameSide] = useState(true), [sameAccount, setSameAccount] = useState(false), [includeReviewed, setIncludeReviewed] = useState(true);
  const [categoryId, setCategoryId] = useState(""), [subCategoryId, setSubCategoryId] = useState(""), [reason, setReason] = useState("");
  const [preview, setPreview] = useState<BulkReclassifyPreview | null>(null), [error, setError] = useState("");
  const parents = categories.filter((item) => !item.parentId && item.available && !item.deletedAt && item.company === company && (!item.officeCode || item.officeCode === row.officeCode)).sort((a, b) => a.name.localeCompare(b.name, "ja"));
  const children = categories.filter((item) => item.parentId === categoryId && item.available && !item.deletedAt);
  const sections = [...new Set(parents.map((item) => bankCategorySection(item.group).label))];
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    startTransition(async () => {
      const result = await previewBulkReclassifyAction(company, { content: row.content, side: sameSide ? row.side : undefined, bankAccountId: sameAccount ? row.bankAccountId : undefined, includeReviewed });
      if (cancelled) return;
      if (!result.success) { setError(result.error); setPreview(null); return; }
      setError(""); setPreview(result.preview);
    });
    return () => { cancelled = true; };
  }, [open, sameSide, sameAccount, includeReviewed, company, row.content, row.side, row.bankAccountId]);
  function apply() {
    if (!preview || !categoryId || !reason.trim()) return;
    startTransition(async () => {
      const result = await applyBulkReclassifyAction(company, { content: row.content, side: sameSide ? row.side : undefined, bankAccountId: sameAccount ? row.bankAccountId : undefined, includeReviewed, categoryId, subCategoryId: subCategoryId || undefined, reason: reason.trim(), expectedCount: preview.matched });
      if (!result.success) { setError(result.error); return; }
      toast({ title: `${result.changed}件の科目を変更しました（確認済み ${result.reviewed}件を含む）`, variant: "success" });
      setOpen(false); setPreview(null); setReason(""); onApplied();
    });
  }
  return <>
    <Button variant="ghost" size="icon" className="size-7 min-h-7" title="同じ摘要の明細をまとめて同じ科目に変更" aria-label={`${row.content}と同じ摘要の明細をまとめて変更`} disabled={disabled} onClick={() => setOpen(true)}><Layers className="size-3.5" /></Button>
    <Dialog open={open} onOpenChange={(value) => { if (!pending) { setOpen(value); if (!value) setError(""); } }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" showCloseButton={!pending} onInteractOutside={(event) => event.preventDefault()}>
        <DialogHeader><DialogTitle>同じ摘要の明細をまとめて変更</DialogTitle><DialogDescription className="break-words">「{row.content || "摘要なし"}」の明細に同じ勘定科目を付けます。確認済みの行も含めて変更でき、確認状態はそのまま残ります。振替・対象外・科目分割・保留の行は対象外です。</DialogDescription></DialogHeader>
        <div className="grid gap-2 text-sm sm:grid-cols-3">
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" className="size-4 accent-primary" checked={sameSide} disabled={pending} onChange={(e) => setSameSide(e.target.checked)} />同じ方向（{row.side === "INCOME" ? "入金" : "出金"}）だけ</label>
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" className="size-4 accent-primary" checked={sameAccount} disabled={pending} onChange={(e) => setSameAccount(e.target.checked)} />同じ口座だけ{accountName ? `（${accountName}）` : ""}</label>
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" className="size-4 accent-primary" checked={includeReviewed} disabled={pending} onChange={(e) => setIncludeReviewed(e.target.checked)} />確認済みも含める</label>
        </div>
        {preview ? <div className="space-y-2 rounded-md border bg-muted/40 p-3 text-sm">
          <p>対象 <strong>{preview.matched}</strong>件（確認済み {preview.reviewed} / 未確認 {preview.unreviewed}）{preview.skipped.length ? ` / 対象外 ${preview.skipped.length}件` : ""}</p>
          <p className="text-xs text-muted-foreground">現在の科目: {preview.categories.map((item) => `${item.name} ${item.count}件`).join(" / ") || "なし"}</p>
          {preview.rows.length ? <ul className="max-h-40 divide-y overflow-auto border-y text-xs">{preview.rows.slice(0, 50).map((item) => <li key={item.id} className="flex flex-wrap justify-between gap-2 py-1"><span>{item.transactionDate} / {item.side === "INCOME" ? "+" : "-"}{money(item.amount)}</span><span className="text-muted-foreground">{item.categoryName} / {item.label}{item.reviewed ? " / 確認済み" : ""}</span></li>)}{preview.rows.length > 50 ? <li className="py-1 text-muted-foreground">ほか {preview.matched - 50}件</li> : null}</ul> : null}
          {preview.skipped.length ? <details className="text-xs"><summary className="cursor-pointer">対象外の明細 {preview.skipped.length}件</summary><ul className="mt-1 space-y-0.5">{preview.skipped.slice(0, 20).map((item) => <li key={item.id}>{item.transactionDate} / {money(item.amount)} / {item.reason}</li>)}</ul></details> : null}
        </div> : pending ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />対象を確認中...</p> : null}
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid min-w-0 gap-1 text-xs">変更後の勘定科目<select className={bankSelectClass} value={categoryId} disabled={pending} onChange={(e) => { setCategoryId(e.target.value); setSubCategoryId(""); }}><option value="">選択してください</option>{sections.map((section) => <optgroup key={section} label={section}>{parents.filter((item) => bankCategorySection(item.group).label === section).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>)}</select></label>
          <label className="grid min-w-0 gap-1 text-xs">補助科目<select className={bankSelectClass} value={subCategoryId} disabled={pending || !children.length} onChange={(e) => setSubCategoryId(e.target.value)}><option value="">なし</option>{children.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        </div>
        <label className="grid gap-1 text-xs">変更の理由（履歴に残ります）<Input className="h-11" value={reason} maxLength={500} disabled={pending} placeholder="例: 取引先の科目を外注費へ統一" onChange={(e) => setReason(e.target.value)} /></label>
        {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
        <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" className="min-h-11" disabled={pending} onClick={() => setOpen(false)}>キャンセル</Button><Button className="min-h-11" disabled={pending || !preview?.matched || !categoryId || !reason.trim()} onClick={apply}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <Layers className="size-4" />}{preview?.matched || 0}件を変更</Button></div>
      </DialogContent>
    </Dialog>
  </>;
}
