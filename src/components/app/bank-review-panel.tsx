"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { ArrowUpRight, ChevronLeft, ChevronRight } from "lucide-react";
import { BankAiPanel } from "@/components/app/bank-ai-panel";
import { Button } from "@/components/ui/button";
import { MonthTabs } from "@/components/app/month-tabs";
import { OptionTabs } from "@/components/app/option-tabs";
import type { BankAiPreview } from "@/lib/bank-ai-types";
import type { BankDocumentReview } from "@/lib/bank-review";
import type { CompanyScope } from "@/lib/company";

export function BankReviewPanel({ company, today, months, review, preview, configured, model }: {
  company: CompanyScope; today: string; months: string[]; review: BankDocumentReview; preview: BankAiPreview; configured: boolean; model: string;
}) {
  const router = useRouter(), [pending, startTransition] = useTransition();
  const month = preview.scope.mode === "month" ? preview.scope.month : "";
  const navigate = (values: Record<string, string>) => startTransition(() => router.push(`/banking/reconcile?${new URLSearchParams({ company, view: "checks", checkMonth: month, checkKind: review.kind, checkPage: "1", ...values })}`));
  return <div className="min-w-0 space-y-4">
    <MonthTabs label="AI横断チェックの取引月" value={month} months={months} today={today} showAll={false} disabled={pending} isMonthDisabled={(value) => value > today.slice(0, 7)} onChange={(checkMonth) => navigate({ checkMonth })} />
    <BankAiPanel key={preview.revision} company={company} preview={preview} configured={configured} model={model} />
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-base font-semibold">不足書類・不整合の確認事項</h2><span className="text-xs text-muted-foreground">会社全体 / ルールチェック {review.total}件</span></div>
    <OptionTabs label="確認事項の種類" caption="種類" value={review.kind} disabled={pending} options={[["all", "すべて"], ...review.categories.map((row) => [row.value, `${row.label}（${row.count}件）`] as const)]} onChange={(checkKind) => navigate({ checkKind })} />
    <p className="text-xs text-muted-foreground">以下はAIではなく登録データのルールによる確認事項です。未照合や重複候補は、不足・誤りの確定ではありません。</p>
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{review.filteredTotal}件</span><div className="flex items-center gap-1">
      <Button className="size-11 lg:size-11 lg:min-h-11" size="icon" variant="outline" title="前のページ" aria-label="確認事項の前のページ" disabled={pending || review.page <= 1} onClick={() => navigate({ checkPage: String(review.page - 1) })}><ChevronLeft className="size-4" /></Button>
      <span>{review.page}/{Math.max(1, Math.ceil(review.filteredTotal / 30))}</span>
      <Button className="size-11 lg:size-11 lg:min-h-11" size="icon" variant="outline" title="次のページ" aria-label="確認事項の次のページ" disabled={pending || review.page * 30 >= review.filteredTotal} onClick={() => navigate({ checkPage: String(review.page + 1) })}><ChevronRight className="size-4" /></Button>
    </div></div>
    <ul className="space-y-2">{review.items.map((row) => <li className="record-card min-w-0 space-y-2 p-4" key={row.id}>
      <p className="text-xs text-amber-800 dark:text-amber-300">{review.categories.find((item) => item.value === row.kind)?.label}</p>
      <h3 className="break-words text-sm font-medium">{row.title}</h3><p className="break-words text-sm text-muted-foreground">{row.detail}</p>
      <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-1">{row.links.map((link, index) => <Button asChild variant="soft" size="sm" key={`${link.href}:${index}`} className="h-auto max-w-full whitespace-normal break-words py-2 text-left lg:h-auto lg:min-h-8 lg:py-1.5"><Link href={link.href}><span className="min-w-0 break-words">{link.label}</span><ArrowUpRight className="size-4 shrink-0" /></Link></Button>)}</div>
    </li>)}</ul>
    {!review.items.length ? <p className="text-sm text-muted-foreground">この分類に該当する確認事項はありません。</p> : null}
  </div>;
}
