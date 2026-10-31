"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Landmark, ShieldCheck } from "lucide-react";
import { bankSelectClass } from "@/components/app/banking-settings";
import type { CompanyScope } from "@/lib/company";
import type { PayrollSummary } from "@/lib/payroll-summary";

const money = (value: number) => new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 }).format(value);
const linkClass = "inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm hover:bg-muted";

// Read-only table of payroll-like bank payments by payee and month for one fiscal year (September to August).
export function BankPayrollWorkspace({ company, summary, years }: { company: CompanyScope; summary: PayrollSummary; years: number[] }) {
  const router = useRouter(), [pending, startTransition] = useTransition();
  return <div className="min-w-0 space-y-4 pb-12">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1"><h1 className="text-xl font-semibold">従業員別の月次支払一覧</h1><p className="text-xs text-muted-foreground">給与・賞与・役員報酬などの科目が付いた口座明細を、摘要から読み取った支払先ごとに月別で集計します（決算年度 {summary.year - 1}.09 - {summary.year}.08）。</p></div>
      <div className="flex flex-wrap items-center gap-2">
        <select className={bankSelectClass} aria-label="決算年度" value={summary.year} disabled={pending} onChange={(e) => startTransition(() => router.push(`/banking/payroll?company=${company}&year=${e.target.value}`))}>{(years.includes(summary.year) ? years : [summary.year, ...years]).map((year) => <option key={year} value={year}>{year - 1}.09 - {year}.08</option>)}</select>
        <Link className={linkClass} href={`/banking?company=${company}`}><Landmark className="size-4" />口座・カード明細</Link>
        <Link className={linkClass} href={`/banking/integrity?company=${company}`}><ShieldCheck className="size-4" />整合性チェック</Link>
      </div>
    </header>
    <p className="text-sm text-muted-foreground">支払先の名前は銀行の摘要そのものです（従業員台帳はありません）。同じ人が別の表記で振り込まれている場合は分かれて表示されます。対象科目は名称に給与・給料・賞与・役員報酬・報酬・退職金・通勤手当・源泉所得税・住民税・社会保険料・法定福利を含む科目で、現在 {summary.categoryIds.length}科目です。</p>
    {summary.rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[960px] text-sm">
      <thead className="border-b text-xs text-muted-foreground"><tr><th scope="col" className="px-2 py-2 text-left">支払先（摘要）</th>{summary.months.map((month) => <th key={month} scope="col" className="px-2 py-2 text-right">{Number(month.slice(5))}月</th>)}<th scope="col" className="px-2 py-2 text-right">合計</th><th scope="col" className="px-2 py-2 text-left">科目</th></tr></thead>
      <tbody>{summary.rows.map((row) => <tr key={row.payee} className="border-b"><th scope="row" className="max-w-[260px] break-words px-2 py-2 text-left font-medium"><Link className="text-primary underline" href={`/banking?${new URLSearchParams({ company, q: row.payee, queryMode: "contains" })}`}>{row.payee}</Link><span className="block text-xs font-normal text-muted-foreground">{row.count}件</span></th>{summary.months.map((month) => <td key={month} className="px-2 py-2 text-right tabular-nums">{row.months[month] ? money(row.months[month]) : <span className="text-muted-foreground">—</span>}</td>)}<td className="px-2 py-2 text-right font-medium tabular-nums">{money(row.total)}</td><td className="px-2 py-2 text-xs text-muted-foreground">{row.categories.join(" / ")}</td></tr>)}</tbody>
      <tfoot className="border-t font-medium"><tr><th scope="row" className="px-2 py-2 text-left">合計</th>{summary.months.map((month) => <td key={month} className="px-2 py-2 text-right tabular-nums">{summary.monthTotals[month] ? money(summary.monthTotals[month]) : "—"}</td>)}<td className="px-2 py-2 text-right tabular-nums">{money(summary.total)}</td><td /></tr></tfoot>
    </table></div> : <p className="text-sm text-muted-foreground">この年度に給与・報酬系の科目が付いた明細はありません。口座・カード明細で科目を付けると表示されます。</p>}
  </div>;
}
