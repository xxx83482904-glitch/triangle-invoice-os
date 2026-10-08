"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { ArrowUpRight, ChevronLeft, ChevronRight } from "lucide-react";
import { BankAiPanel } from "@/components/app/bank-ai-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { bankSelectClass } from "@/components/app/banking-settings";
import type { BankAiPreview } from "@/lib/bank-ai-types";
import type { BankDocumentReview } from "@/lib/bank-review";
import type { CompanyScope } from "@/lib/company";

export function BankReviewPanel({ company, review, preview, configured, model }: {
  company: CompanyScope; review: BankDocumentReview; preview: BankAiPreview; configured: boolean; model: string;
}) {
  const router = useRouter(), [pending, startTransition] = useTransition();
  const month = preview.scope.mode === "month" ? preview.scope.month : "";
  const navigate = (values: Record<string, string>) => startTransition(() => router.push(`/banking/reconcile?${new URLSearchParams({ company, view: "checks", checkMonth: month, checkKind: review.kind, checkPage: "1", ...values })}`));
  return <div className="min-w-0 space-y-4">
    <label className="grid max-w-xs gap-1 text-sm">AI横断チェックの取引月<Input className="min-h-11" type="month" value={month} disabled={pending} onChange={(e) => { if (e.target.value) navigate({ checkMonth: e.target.value }); }} /></label>
    <BankAiPanel key={preview.revision} company={company} preview={preview} configured={configured} model={model} />
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-base font-semibold">不足書類・不整合の確認事項</h2><span className="text-xs text-muted-foreground">会社全体 / ルールチェック {review.total}件</span></div>
    <select className={bankSelectClass} aria-label="確認事項の種類" value={review.kind} disabled={pending} onChange={(e) => navigate({ checkKind: e.target.value })}><option value="all">すべての確認事項</option>{review.categories.map((row) => <option key={row.value} value={row.value}>{row.label}（{row.count}件）</option>)}</select>
    <p className="text-xs text-muted-foreground">以下はAIではなく登録データのルールによる確認事項です。未照合や重複候補は、不足・誤りの確定ではありません。</p>
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{review.filteredTotal}件</span><div className="flex items-center gap-1">
      <Button className="size-11 lg:size-11 lg:min-h-11" size="icon" variant="ghost" title="前のページ" aria-label="確認事項の前のページ" disabled={pending || review.page <= 1} onClick={() => navigate({ checkPage: String(review.page - 1) })}><ChevronLeft className="size-4" /></Button>
      <span>{review.page}/{Math.max(1, Math.ceil(review.filteredTotal / 30))}</span>
      <Button className="size-11 lg:size-11 lg:min-h-11" size="icon" variant="ghost" title="次のページ" aria-label="確認事項の次のページ" disabled={pending || review.page * 30 >= review.filteredTotal} onClick={() => navigate({ checkPage: String(review.page + 1) })}><ChevronRight className="size-4" /></Button>
    </div></div>
    <ul className="divide-y">{review.items.map((row) => <li className="min-w-0 space-y-2 py-4" key={row.id}>
      <p className="text-xs text-amber-800 dark:text-amber-300">{review.categories.find((item) => item.value === row.kind)?.label}</p>
      <h3 className="break-words text-sm font-medium">{row.title}</h3><p className="break-words text-sm text-muted-foreground">{row.detail}</p>
      <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-1">{row.links.map((link, index) => <Link key={`${link.href}:${index}`} className="inline-flex min-h-11 min-w-0 max-w-full items-center gap-1 text-sm text-primary underline" href={link.href}><span className="min-w-0 break-words">{link.label}</span><ArrowUpRight className="size-4 shrink-0" /></Link>)}</div>
    </li>)}</ul>
    {!review.items.length ? <p className="text-sm text-muted-foreground">この分類に該当する確認事項はありません。</p> : null}
  </div>;
}
