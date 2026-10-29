"use client";

import { useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { bankCategoryCatalog } from "@/lib/bank-category-catalog";
import type { AccountingCategory, BankTransaction } from "@/lib/banking-types";

type Props = {
  categories: AccountingCategory[];
  targets: BankTransaction[];
  disabled: boolean;
  onApply: (category: AccountingCategory, child?: AccountingCategory) => void;
};

export function BankCategoryPicker({ categories, targets, disabled, onApply }: Props) {
  const [search, setSearch] = useState("");
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [closedChildren, setClosedChildren] = useState<Set<string>>(new Set());
  const list = useRef<HTMLDivElement>(null);
  function searchCategories(value: string) {
    setSearch(value);
    list.current?.scrollTo({ top: 0 });
  }
  const sections = bankCategoryCatalog(categories, targets, search);
  const selected = (categoryId: string, childId?: string) => targets.length > 0 && targets.every((row) => row.categoryId === categoryId && row.subCategoryId === childId);
  const toggle = (values: Set<string>, id: string) => { const next = new Set(values); if (next.has(id)) next.delete(id); else next.add(id); return next; };
  return <div className="bank-category-picker flex h-full min-h-0 min-w-0 flex-col">
    <div className="shrink-0 space-y-3 border-b p-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">勘定科目一覧</h2><span role="status" className="text-xs tabular-nums text-muted-foreground">{targets.length ? `${targets.length}件選択中` : "明細未選択"}</span></div>
      {targets.length === 1 ? <p className="line-clamp-2 break-words text-xs text-muted-foreground">{targets[0].transactionDate} / {targets[0].content || "摘要なし"}</p> : null}
      <div className="relative"><Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground" /><Input className="h-11 pl-9 pr-11" aria-label="科目一覧を検索" placeholder="科目・補助科目を検索" value={search} onChange={(event) => searchCategories(event.target.value)} />{search ? <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0 size-11" title="検索をクリア" aria-label="科目検索をクリア" onClick={() => searchCategories("")}><X className="size-4" /></Button> : null}</div>
    </div>
    <div ref={list} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 [overflow-anchor:none]" aria-label="大分類別の科目">
      {sections.map((section) => <section key={section.id} className="grid w-full min-w-0 grid-cols-1 gap-2 border-b py-4 first:pt-0 last:border-b-0">
        <h3 className="w-full min-w-0"><button type="button" className={`flex min-h-11 w-full items-center gap-2 border-l-2 border-current bg-muted/50 px-2 py-2 text-left text-sm font-semibold ${section.tone}`} aria-expanded={Boolean(search) || !closed.has(section.id)} onClick={() => setClosed(toggle(closed, section.id))}>
          {!search && closed.has(section.id) ? <ChevronRight className="size-4 shrink-0" /> : <ChevronDown className="size-4 shrink-0" />}<span className="min-w-0 flex-1 break-words">{section.label}</span><span className="text-xs font-normal tabular-nums text-muted-foreground">{section.entries.length}</span>
        </button></h3>
        {search || !closed.has(section.id) ? <ul className="flex w-full min-w-0 flex-wrap items-start gap-1.5">{section.entries.map(({ category, children }) => <li key={category.id} className={`min-w-0 max-w-full ${children.length ? "w-full basis-full space-y-2 py-2" : ""}`}>
          <div className={`flex w-fit min-w-0 max-w-full items-stretch overflow-hidden rounded-md border ${selected(category.id) ? "border-primary bg-primary/10 text-foreground" : "bg-background"}`}>
            <button type="button" className="inline-flex min-h-11 min-w-0 items-center gap-1 px-2 py-2 text-left text-sm whitespace-normal hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:opacity-45" aria-label={`${category.name}を適用`} aria-pressed={selected(category.id)} disabled={disabled || !targets.length} onClick={() => onApply(category)}>
              <span className="min-w-0 [overflow-wrap:anywhere]">{category.name}</span><Check aria-hidden="true" className={`size-3.5 shrink-0 ${selected(category.id) ? "opacity-100" : "opacity-0"}`} />
            </button>
            {children.length ? <Button type="button" size="icon" variant="ghost" className="h-auto min-h-11 w-11 shrink-0 rounded-none border-l" title={`${category.name}の補助科目`} aria-label={`${category.name}の補助科目`} aria-expanded={Boolean(search) || !closedChildren.has(category.id)} onClick={() => setClosedChildren(toggle(closedChildren, category.id))}>{search || !closedChildren.has(category.id) ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</Button> : null}
          </div>
          {children.length && (search || !closedChildren.has(category.id)) ? <ul aria-label={`${category.name}の補助科目一覧`} className="flex w-full min-w-0 flex-wrap items-start gap-1.5 border-l-2 pl-2">{children.map((child) => <li key={child.id} className="min-w-0 max-w-full"><button type="button" className={`inline-flex min-h-11 max-w-full items-center gap-1 rounded-md border border-dashed px-2 py-2 text-left text-sm whitespace-normal hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-45 ${selected(category.id, child.id) ? "border-primary bg-primary/10 text-foreground" : "bg-muted/20 text-muted-foreground"}`} aria-label={`${category.name} / ${child.name}を適用`} aria-pressed={selected(category.id, child.id)} disabled={disabled || !targets.length} onClick={() => onApply(category, child)}><span className="min-w-0 [overflow-wrap:anywhere]">{child.name}</span><Check aria-hidden="true" className={`size-3.5 shrink-0 ${selected(category.id, child.id) ? "opacity-100" : "opacity-0"}`} /></button></li>)}</ul> : null}
        </li>)}</ul> : null}
      </section>)}
      {!sections.length ? <p role="status" className="px-3 py-8 text-center text-sm text-muted-foreground">{search ? "一致する科目はありません" : "適用できる科目はありません"}</p> : null}
    </div>
  </div>;
}
