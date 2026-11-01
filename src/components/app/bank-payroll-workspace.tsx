"use client";

import { Button } from "@/components/ui/button";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Landmark, ShieldCheck } from "lucide-react";
import { bankSelectClass } from "@/components/app/banking-settings";
import type { CompanyScope } from "@/lib/company";
import type { PayrollSummary, PayrollYearSource } from "@/lib/payroll-summary";
import type { PayrollSettingsView } from "@/lib/payroll-settings";
import { PayrollTargetSettings } from "@/components/app/payroll-target-settings";
import { rememberPayrollYearAction } from "@/app/banking/payroll/actions";

const money = (value: number) => new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 }).format(value);

// Read-only table of payroll-like bank payments by payee and month for one fiscal year (September to August).
export function BankPayrollWorkspace({ company, summary, years, settings, mayEdit, yearSource }: { company: CompanyScope; summary: PayrollSummary; years: number[]; settings: PayrollSettingsView; mayEdit: boolean; yearSource: PayrollYearSource }) {
  const router = useRouter(), [pending, startTransition] = useTransition();
  const [message, setMessage] = useState(""), [yearError, setYearError] = useState("");
  const selectYear = (year: number) => startTransition(async () => {
    setYearError("");
    try {
      const result = await rememberPayrollYearAction(company, year);
      if (!result.success) setYearError(`次回用の年度を記憶できませんでした: ${result.error}`);
    } catch { setYearError("年度は切り替えますが、次回用の記憶に失敗しました。再度選択すると再試行できます"); }
    router.push(`/banking/payroll?company=${company}&year=${year}`);
  });
  return <div className="min-w-0 space-y-4 pb-12">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1"><h1 className="text-xl font-semibold">従業員別の月次支払一覧</h1><p className="text-xs text-muted-foreground">給与・賞与・役員報酬などの科目が付いた口座明細を、摘要から読み取った支払先ごとに月別で集計します（決算年度 {summary.year - 1}.09 - {summary.year}.08）。</p></div>
      <div className="flex flex-wrap items-center gap-2">
        <select className={bankSelectClass} aria-label="決算年度" value={summary.year} disabled={pending} onChange={(e) => selectYear(Number(e.target.value))}>{(years.includes(summary.year) ? years : [summary.year, ...years]).map((year) => <option key={year} value={year}>{year - 1}.09 - {year}.08</option>)}</select>
        <Button asChild variant="soft" size="sm" className="h-auto max-w-full whitespace-normal break-words py-2 text-left lg:h-auto lg:min-h-8 lg:py-1.5"><Link href={`/banking?company=${company}`}><Landmark className="size-4" />口座・カード明細</Link></Button>
        <Button asChild variant="soft" size="sm" className="h-auto max-w-full whitespace-normal break-words py-2 text-left lg:h-auto lg:min-h-8 lg:py-1.5"><Link href={`/banking/integrity?company=${company}`}><ShieldCheck className="size-4" />整合性チェック</Link></Button>
      </div>
    </header>
    <p className="text-xs text-muted-foreground">年度の選択: {({ URL: "URL指定", REMEMBERED: "前回選んだ年度", LATEST_PAYROLL: "対象明細のある直近年度", LATEST_BANK: "口座明細のある直近年度", CURRENT: "明細なし（現在年度）" })[yearSource]}。年度の選択は、このブラウザで利用者・会社別に記憶します。</p>
    {yearError ? <p role="alert" className="text-sm text-destructive">{yearError}</p> : null}
    {message ? <p role="status" className="rounded-md border p-3 text-sm">{message}</p> : null}
    <p className="text-sm text-muted-foreground">支払先の名前は銀行の摘要そのものです（従業員台帳はありません）。同じ人が別の表記で振り込まれている場合は分かれて表示されます。集計対象は{settings.mode === "CUSTOM" ? "保存済みの設定" : "初期対象"}の {summary.categoryIds.length}科目です。支払報酬・税金・社会保険料・法定福利は初期対象に含めません。</p>
    {mayEdit ? <details className="min-w-0 rounded-md border p-3"><summary className="min-h-11 cursor-pointer content-center text-sm font-medium">対象科目の設定（{summary.categoryIds.length}科目）</summary><PayrollTargetSettings key={settings.updatedAt || "default"} company={company} settings={settings} onSaved={setMessage} /></details> : null}
    {summary.rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[960px] text-sm">
      <thead className="border-b text-xs text-muted-foreground"><tr><th scope="col" className="px-2 py-2 text-left">支払先（摘要）</th>{summary.months.map((month) => <th key={month} scope="col" className="px-2 py-2 text-right">{Number(month.slice(5))}月</th>)}<th scope="col" className="px-2 py-2 text-right">合計</th><th scope="col" className="px-2 py-2 text-left">科目</th></tr></thead>
      <tbody>{summary.rows.map((row) => <tr key={row.payee} className="border-b"><th scope="row" className="max-w-[260px] break-words px-2 py-2 text-left font-medium"><Link className="text-primary hover:underline underline-offset-4 hover:text-primary" href={`/banking?${new URLSearchParams({ company, q: row.payee, queryMode: "contains" })}`}>{row.payee}</Link><span className="block text-xs font-normal text-muted-foreground">{row.count}件</span></th>{summary.months.map((month) => <td key={month} className="px-2 py-2 text-right tabular-nums">{row.months[month] ? money(row.months[month]) : <span className="text-muted-foreground">—</span>}</td>)}<td className="px-2 py-2 text-right font-medium tabular-nums">{money(row.total)}</td><td className="px-2 py-2 text-xs text-muted-foreground">{row.categories.join(" / ")}</td></tr>)}</tbody>
      <tfoot className="border-t font-medium"><tr><th scope="row" className="px-2 py-2 text-left">合計</th>{summary.months.map((month) => <td key={month} className="px-2 py-2 text-right tabular-nums">{summary.monthTotals[month] ? money(summary.monthTotals[month]) : "—"}</td>)}<td className="px-2 py-2 text-right tabular-nums">{money(summary.total)}</td><td /></tr></tfoot>
    </table></div> : <p className="text-sm text-muted-foreground">この年度に対象科目が付いた明細はありません。年度と対象科目の設定を確認してください。</p>}
  </div>;
}
