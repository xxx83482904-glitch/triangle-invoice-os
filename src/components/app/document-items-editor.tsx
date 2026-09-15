"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CreatableSelect } from "@/components/app/creatable-select";
import { documentItemTotals, maxDocumentItems, type DocumentItemInput } from "@/lib/document-items";
import type { CompanyScope } from "@/lib/company";
import type { TaxRate } from "@/lib/types";

const defaultTaxOptions = [{ value: "10", label: "10%" }, { value: "8", label: "8%" }, { value: "0", label: "非課税" }, { value: "-1", label: "対象外" }];
const blankItem = (): DocumentItemInput => ({ description: "", details: "", quantity: 1, unitPrice: 0, taxRate: 10 });
const money = (value: number) => `¥${new Intl.NumberFormat("ja-JP").format(value)}`;

export function DocumentItemsEditor({ initialItems, taxOptions = defaultTaxOptions, company, disabled = false }: {
  initialItems?: DocumentItemInput[]; taxOptions?: { value: string; label: string }[]; company?: CompanyScope; disabled?: boolean;
}) {
  const [items, setItems] = useState(() => (initialItems?.length ? initialItems : [blankItem()]).map((item, i) => ({ ...item, rowKey: i })));
  const nextKey = useRef(items.length);
  const root = useRef<HTMLFieldSetElement>(null);
  const { pending } = useFormStatus();
  const totals = documentItemTotals(items);
  function change(key: number, patch: Partial<DocumentItemInput>) {
    setItems((previous) => previous.map((item) => item.rowKey === key ? { ...item, ...patch } : item));
  }
  function focusItem(key: number) {
    requestAnimationFrame(() => root.current?.querySelector<HTMLTextAreaElement>(`[data-item-key="${key}"] textarea`)?.focus());
  }
  function move(index: number, offset: number) {
    const next = [...items];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    setItems(next); focusItem(items[index].rowKey);
  }
  return <fieldset ref={root} disabled={disabled || pending} className="min-w-0 space-y-3" aria-label="項目と明細">
    <legend className="mb-2 text-sm font-medium">項目・明細</legend>
    <div className="min-w-0 divide-y border-y">
      {items.map((item, index) => <div key={item.rowKey} data-item-key={item.rowKey} className="min-w-0 space-y-3 py-3">
        <div className="flex min-w-0 items-center gap-1">
          <span className="mr-auto text-sm font-medium">項目 {index + 1}</span>
          <Button type="button" variant="ghost" size="icon" className="size-11 shrink-0" title="上へ移動" aria-label={`項目${index + 1}を上へ移動`} disabled={!index} onClick={() => move(index, -1)}><ArrowUp className="size-4" /></Button>
          <Button type="button" variant="ghost" size="icon" className="size-11 shrink-0" title="下へ移動" aria-label={`項目${index + 1}を下へ移動`} disabled={index === items.length - 1} onClick={() => move(index, 1)}><ArrowDown className="size-4" /></Button>
          <Button type="button" variant="ghost" size="icon" className="size-11 shrink-0" title="項目を削除" aria-label={`項目${index + 1}を削除`} disabled={items.length === 1} onClick={() => {
            const next = items.filter((i) => i.rowKey !== item.rowKey); setItems(next); focusItem(next[Math.min(index, next.length - 1)].rowKey);
          }}><Trash2 className="size-4" /></Button>
        </div>
        <label className="block min-w-0 space-y-1 text-xs">項目名<Textarea name="itemDescription" aria-label={`項目${index + 1} 名称`} required maxLength={2000} rows={1} className="min-h-11 resize-y lg:min-h-11" value={item.description} onChange={(e) => change(item.rowKey, { description: e.target.value })} /></label>
        <label className="block min-w-0 space-y-1 text-xs">詳細・内訳<Textarea name="itemDetails" aria-label={`項目${index + 1} 詳細・内訳`} maxLength={6000} rows={2} className="min-h-20 resize-y whitespace-pre-wrap lg:min-h-20" value={item.details || ""} onChange={(e) => change(item.rowKey, { details: e.target.value })} /></label>
        <div className="grid min-w-0 grid-cols-2 items-end gap-3 sm:grid-cols-[80px_minmax(100px,1fr)_120px_minmax(90px,1fr)]">
          <label className="min-w-0 space-y-1 text-xs">数量<Input name="itemQuantity" aria-label={`項目${index + 1} 数量`} required type="number" min="0.01" max="1000000" step="0.01" className="h-11 lg:h-11" value={item.quantity} onChange={(e) => change(item.rowKey, { quantity: Number(e.target.value) })} /></label>
          <label className="min-w-0 space-y-1 text-xs">単価<Input name="itemUnitPrice" aria-label={`項目${index + 1} 単価`} required type="number" min="0" max="1000000000" step="0.01" className="h-11 lg:h-11" value={item.unitPrice} onChange={(e) => change(item.rowKey, { unitPrice: Number(e.target.value) })} /></label>
          <div className="min-w-0 space-y-1 text-xs"><span>税区分</span><CreatableSelect name="itemTaxRate" ariaLabel={`項目${index + 1} 税区分`} className="[&>button]:h-11" options={taxOptions} defaultValue={String(item.taxRate)} clearable={false} create={company ? { kind: "select-option", company, group: "TAX_RATE" } : undefined} onValueChange={(value) => change(item.rowKey, { taxRate: Number(value) as TaxRate })} /></div>
          <div className="min-w-0 space-y-1 text-right text-xs"><span>金額</span><output aria-label={`項目${index + 1} 金額`} className="flex min-h-11 items-center justify-end break-all text-sm tabular-nums">{money(Math.round(item.quantity * item.unitPrice))}</output></div>
        </div>
      </div>)}
    </div>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <Button type="button" variant="outline" className="min-h-11" disabled={items.length >= maxDocumentItems} onClick={() => {
        const key = nextKey.current++; setItems([...items, { ...blankItem(), rowKey: key }]); focusItem(key);
      }}><Plus className="size-4" />項目を追加</Button>
      <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1 text-right text-sm tabular-nums"><dt>税抜計</dt><dd className="break-all">{money(totals.subtotal)}</dd><dt>消費税</dt><dd className="break-all">{money(totals.taxTotal)}</dd><dt className="font-semibold">合計</dt><dd className="break-all font-semibold">{money(totals.total)}</dd></dl>
    </div>
  </fieldset>;
}
