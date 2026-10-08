"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Save, Trash2 } from "lucide-react";
import { deleteBankDefinitionAction, saveAccountingCategoryAction, saveBankRuleAction } from "@/app/banking/actions";
import { categoryGroups, treatmentLabels } from "@/lib/banking";
import type { AccountingCategory, BankAccount, BankRule, BankRuleInput, CategoryInput } from "@/lib/banking-types";
import type { CompanyScope } from "@/lib/company";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const bankSelectClass = "h-11 w-full min-w-0 max-w-full rounded-md border bg-background px-2 text-sm text-foreground disabled:opacity-50";

export function BankCategoryFields({ categories, categoryId = "", subCategoryId = "", onChange, disabled = false, label = "" }: {
  categories: AccountingCategory[]; categoryId?: string; subCategoryId?: string;
  onChange: (categoryId: string, subCategoryId: string) => void; disabled?: boolean; label?: string;
}) {
  const parents = categories.filter((row) => !row.parentId && ((row.available && !row.deletedAt) || row.id === categoryId));
  const children = categories.filter((row) => row.parentId === categoryId && ((row.available && !row.deletedAt) || row.id === subCategoryId));
  return <div className="grid min-w-0 gap-1">
    <select className={bankSelectClass} aria-label={`${label}勘定科目`} value={categoryId} disabled={disabled} onChange={(e) => onChange(e.target.value, "")}>
      <option value="">未分類</option>
      {parents.map((row) => <option key={row.id} value={row.id} disabled={!row.available || Boolean(row.deletedAt)}>{row.name}{!row.available || row.deletedAt ? "（無効）" : ""}</option>)}
    </select>
    {children.length ? <select className={bankSelectClass} aria-label={`${label}補助科目`} value={subCategoryId} disabled={disabled} onChange={(e) => onChange(categoryId, e.target.value)}>
      <option value="">補助科目なし</option>
      {children.map((row) => <option key={row.id} value={row.id} disabled={!row.available || Boolean(row.deletedAt)}>{row.name}</option>)}
    </select> : null}
  </div>;
}

export function BankingSettings({ company, accounts, categories, rules, open, onOpenChange }: {
  company: CompanyScope; accounts: BankAccount[]; categories: AccountingCategory[]; rules: BankRule[]; open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"categories" | "rules">("categories");
  const [category, setCategory] = useState<CategoryInput | null>(null);
  const [rule, setRule] = useState<BankRuleInput | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  function run(action: () => Promise<{ success?: boolean; error?: string }>, done?: () => void) {
    setError(""); startTransition(async () => {
      try {
        const result = await action();
        if (!result.success) { setError(result.error || "保存できませんでした"); return; }
        done?.(); router.refresh();
      } catch { setError("通信に失敗しました。入力内容は保持されています"); }
    });
  }
  const parents = categories.filter((row) => !row.parentId && !row.deletedAt);
  return <Dialog open={open} onOpenChange={(value) => { if (!pending) onOpenChange(value); }}>
    <DialogContent aria-describedby={undefined} showCloseButton={!pending} className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl" onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
      <DialogHeader><DialogTitle>勘定科目・自動分類ルール</DialogTitle></DialogHeader>
      <Tabs value={tab} onValueChange={(value) => { setTab(value as typeof tab); setError(""); }}>
      <TabsList aria-label="明細設定" variant="line" className="min-h-11 max-w-full border-b">
        <TabsTrigger value="categories" disabled={pending} className="min-h-11">勘定科目</TabsTrigger>
        <TabsTrigger value="rules" disabled={pending} className="min-h-11">自動分類ルール</TabsTrigger>
      </TabsList>
      {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
      <TabsContent value="categories" className="space-y-4">
        <Button type="button" variant="outline" className="min-h-11" disabled={pending} onClick={() => setCategory({ name: "", group: "EXPENSE" })}><Plus className="size-4" />科目を追加</Button>
        {category ? <form className="grid gap-3 border-y py-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); run(() => saveAccountingCategoryAction(company, category), () => setCategory(null)); }}>
          <label className="grid min-w-0 gap-1">科目名<Input className="h-11" value={category.name} required maxLength={150} disabled={pending} onChange={(e) => setCategory({ ...category, name: e.target.value })} /></label>
          <label className="grid min-w-0 gap-1">区分<select className={bankSelectClass} value={category.group} disabled={pending} onChange={(e) => setCategory({ ...category, group: e.target.value })}>{Object.entries(categoryGroups).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label className="grid min-w-0 gap-1">親科目<select className={bankSelectClass} value={category.parentId || ""} disabled={pending || Boolean(category.id)} onChange={(e) => setCategory({ ...category, parentId: e.target.value || undefined })}><option value="">なし（勘定科目）</option>{parents.filter((row) => row.available).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
          <div className="flex items-end gap-2"><Button className="min-h-11" disabled={pending}><Save className="size-4" />保存</Button><Button type="button" variant="ghost" className="min-h-11" disabled={pending} onClick={() => setCategory(null)}>キャンセル</Button></div>
        </form> : null}
        <ul className="divide-y">
          {categories.filter((row) => !row.deletedAt).map((row) => <li key={row.id} className="flex min-w-0 items-center justify-between gap-2 py-2">
            <div className={`min-w-0 break-words ${row.parentId ? "pl-4" : "font-medium"}`}><span>{row.parentId ? `${parents.find((item) => item.id === row.parentId)?.name || ""} / ` : ""}{row.name}</span><span className="ml-2 text-xs font-normal text-muted-foreground">{row.sourceId ? "MF" : "独自"}{!row.available ? "・無効" : ""}</span></div>
            {!row.sourceId ? <div className="flex shrink-0">
              <Button type="button" variant="ghost" size="icon" className="size-11" title="科目を編集" aria-label={`${row.name}を編集`} disabled={pending} onClick={() => setCategory(row)}><Pencil className="size-4" /></Button>
              <Button type="button" variant="ghost" size="icon" className="size-11" title="科目を削除" aria-label={`${row.name}を削除`} disabled={pending} onClick={() => { if (window.confirm(`「${row.name}」を削除しますか？`)) run(() => deleteBankDefinitionAction(company, "category", row.id, row.updatedAt)); }}><Trash2 className="size-4" /></Button>
            </div> : null}
          </li>)}
        </ul>
        {!categories.length ? <p className="py-6 text-center text-muted-foreground">勘定科目はまだありません</p> : null}
      </TabsContent>
      <TabsContent value="rules" className="space-y-4">
        <Button type="button" variant="outline" className="min-h-11" disabled={pending} onClick={() => setRule({ name: "", keyword: "", match: "CONTAINS", side: "ALL", treatment: "NORMAL", priority: 100, enabled: true })}><Plus className="size-4" />ルールを追加</Button>
        {rule ? <form className="grid gap-3 border-y py-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); run(() => saveBankRuleAction(company, rule), () => setRule(null)); }}>
          <label className="grid min-w-0 gap-1">ルール名<Input className="h-11" required maxLength={150} value={rule.name} disabled={pending} onChange={(e) => setRule({ ...rule, name: e.target.value })} /></label>
          <label className="grid min-w-0 gap-1">摘要キーワード<Input className="h-11" required maxLength={250} value={rule.keyword} disabled={pending} onChange={(e) => setRule({ ...rule, keyword: e.target.value })} /></label>
          <label className="grid min-w-0 gap-1">一致方法<select className={bankSelectClass} value={rule.match} disabled={pending} onChange={(e) => setRule({ ...rule, match: e.target.value as BankRule["match"] })}><option value="CONTAINS">部分一致</option><option value="EXACT">完全一致</option></select></label>
          <label className="grid min-w-0 gap-1">対象口座<select className={bankSelectClass} value={rule.bankAccountId || ""} disabled={pending} onChange={(e) => setRule({ ...rule, bankAccountId: e.target.value || undefined })}><option value="">すべての口座・カード</option>{accounts.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
          <label className="grid min-w-0 gap-1">入出金<select className={bankSelectClass} value={rule.side} disabled={pending} onChange={(e) => setRule({ ...rule, side: e.target.value as BankRule["side"] })}><option value="ALL">すべて</option><option value="INCOME">入金・返金</option><option value="EXPENSE">出金・利用</option></select></label>
          <label className="grid min-w-0 gap-1">扱い<select className={bankSelectClass} value={rule.treatment} disabled={pending} onChange={(e) => setRule({ ...rule, treatment: e.target.value as BankRule["treatment"] })}>{Object.entries(treatmentLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <div className="grid min-w-0 gap-1"><span>勘定科目・補助科目</span><BankCategoryFields label="ルールの" categories={categories} categoryId={rule.categoryId} subCategoryId={rule.subCategoryId} disabled={pending} onChange={(categoryId, subCategoryId) => setRule({ ...rule, categoryId: categoryId || undefined, subCategoryId: subCategoryId || undefined })} /></div>
          <label className="grid min-w-0 gap-1">優先順位（小さい順）<Input className="h-11" type="number" min={1} max={9999} required value={rule.priority} disabled={pending} onChange={(e) => setRule({ ...rule, priority: Number(e.target.value) })} /></label>
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" className="size-5" checked={rule.enabled} disabled={pending} onChange={(e) => setRule({ ...rule, enabled: e.target.checked })} />有効</label>
          <div className="flex items-end gap-2"><Button className="min-h-11" disabled={pending}><Save className="size-4" />保存</Button><Button type="button" className="min-h-11" variant="ghost" disabled={pending} onClick={() => setRule(null)}>キャンセル</Button></div>
        </form> : null}
        <ul className="divide-y">
          {rules.filter((row) => !row.deletedAt).sort((a, b) => a.priority - b.priority).map((row) => <li key={row.id} className="flex min-w-0 items-center justify-between gap-2 py-3">
            <div className="min-w-0 break-words"><div className="font-medium">{row.name}{!row.enabled ? "（停止中）" : ""}</div><div className="text-xs text-muted-foreground">{row.keyword} / {categories.find((cat) => cat.id === row.categoryId)?.name || treatmentLabels[row.treatment]} / 優先 {row.priority}</div></div>
            <div className="flex shrink-0"><Button type="button" variant="ghost" size="icon" className="size-11" title="ルールを編集" aria-label={`${row.name}を編集`} disabled={pending} onClick={() => setRule(row)}><Pencil className="size-4" /></Button><Button type="button" variant="ghost" size="icon" className="size-11" title="ルールを削除" aria-label={`${row.name}を削除`} disabled={pending} onClick={() => { if (window.confirm(`「${row.name}」を削除しますか？`)) run(() => deleteBankDefinitionAction(company, "rule", row.id, row.updatedAt)); }}><Trash2 className="size-4" /></Button></div>
          </li>)}
        </ul>
        {!rules.length ? <p className="py-6 text-center text-muted-foreground">自動分類ルールはまだありません</p> : null}
      </TabsContent>
      </Tabs>
    </DialogContent>
  </Dialog>;
}
