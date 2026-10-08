"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowLeft, ArrowUpRight, ChartNoAxesCombined, CircleAlert, LoaderCircle, TrendingUp } from "lucide-react";
import { bankSelectClass } from "@/components/app/banking-settings";
import { Input } from "@/components/ui/input";
import type { BankAccount } from "@/lib/banking-types";
import type { BankSpendingInsights, SpendingAlert, SpendingSample } from "@/lib/bank-insights";
import type { CompanyScope } from "@/lib/company";

const money = (value: number) => new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 }).format(value);
const change = (value: number | null) => value === null ? "比較不可" : `${value > 0 ? "+" : ""}${money(value)}`;
const names = { DUPLICATE: "同日・同額の重複候補", LARGE: "通常より大きい出金", RECURRING_INCREASE: "定期支払いの増額候補" };
const linkClass = "inline-flex min-h-11 items-center justify-center gap-1 rounded-md border px-3 text-sm hover:bg-muted";
type Props = { company: CompanyScope; account: BankAccount; accounts: BankAccount[]; insights: BankSpendingInsights };

export function BankInsightsWorkspace({ company, account, accounts, insights: report }: Props) {
  const router = useRouter(), [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<"ALL" | SpendingAlert["kind"]>("ALL");
  const url = (values: Record<string, string> = {}) => `/banking?${new URLSearchParams({ company, account: account.id, month: report.month, analysisThrough: report.current.end, ...values })}`;
  function navigate(values: Record<string, string>) {
    startTransition(() => router.push(`/banking/insights?${new URLSearchParams({ company, account: account.id, month: report.month, ...values })}`));
  }
  const alerts = report.alerts.filter((row) => kind === "ALL" || row.kind === kind);
  const max = Math.max(1, ...report.periods.map((row) => row.amount));
  const evidenceRows = (rows: SpendingSample[]) => <ul className="divide-y">{rows.map((row) => <li key={row.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 py-2 text-sm sm:grid-cols-[104px_minmax(0,1fr)_auto_auto]">
    <span className="text-xs text-muted-foreground">{row.date}</span><span className="col-start-1 min-w-0 break-words sm:col-auto">{row.content}</span><span className="font-medium tabular-nums">{money(row.amount)}</span>
    <Link prefetch={false} className="col-start-2 inline-flex min-h-11 items-center gap-1 text-primary underline sm:col-auto" href={`/banking?${new URLSearchParams({ company, transaction: row.id })}`} aria-label={`${row.date} ${row.content} ${money(row.amount)}の明細を編集`}>明細<ArrowUpRight className="size-4 shrink-0" /></Link>
  </li>)}</ul>;

  return <div className="min-w-0 space-y-5" aria-busy={pending}>
    <header className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
      <div className="min-w-0"><Link className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground" href={url()}><ArrowLeft className="size-4 shrink-0" />口座・カード明細</Link><h1 className="text-xl font-semibold">出金の傾向・注意</h1></div>
      <Link className={linkClass} href={`/banking/forecast?${new URLSearchParams({ company, account: account.id })}`}><TrendingUp className="size-4" />口座の予測</Link>
    </header>
    <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_200px]">
      <label className="grid min-w-0 gap-1 text-sm">口座・カード<select className={bankSelectClass} value={account.id} disabled={pending} onChange={(e) => navigate({ account: e.target.value })}>{accounts.map((row) => <option key={row.id} value={row.id}>{row.name}{row.available ? "" : "（連携終了）"}</option>)}</select></label>
      <label className="grid min-w-0 gap-1 text-sm">対象月<Input type="month" className="min-h-11 min-w-0" value={report.month} max={report.asOf.slice(0, 7)} disabled={pending} onChange={(e) => { if (/^\d{4}-\d{2}$/.test(e.target.value) && e.target.value <= report.asOf.slice(0, 7)) navigate({ month: e.target.value }); }} /></label>
    </div>
    {pending ? <p role="status" className="flex items-center gap-2 text-sm"><LoaderCircle className="size-4 animate-spin" />集計中</p> : null}
    <p className="break-words text-xs text-muted-foreground">{report.current.start}〜{report.current.end} / {account.forecastSettings?.accountKind === "CARD" ? "カード利用額（銀行の引落額ではありません）" : "出金・カード利用額"} / 単位は元明細と同じ（通貨換算なし）</p>
    {!report.comparisonConfirmed || report.stale || report.historyFetchedMonths < 6 || account.isManual || !account.available ? <div role="status" className="space-y-1 border-l-2 border-amber-500 bg-amber-500/5 p-3 text-sm">
      {!report.comparisonConfirmed ? <p>取得範囲に未確認の期間があります。増減は取込済み分の参考比較で、明細の欠けによって変わります。</p> : null}
      {report.historyFetchedMonths < 6 ? <p>注意判定に使う過去6か月のうち、全期間の取得記録があるのは{report.historyFetchedMonths}か月です。</p> : null}
      {report.stale ? <p>最終同期が7日以上前、または未確認です。再同期後に確認してください。</p> : null}
      {account.isManual || !account.available ? <p>この口座は{account.isManual ? "手動管理" : "連携終了"}です。取込済みの明細のみを分析しています。</p> : null}
    </div> : null}
    <dl className="grid min-w-0 grid-cols-2 gap-4 border-y py-4 lg:grid-cols-4">
      <div className="min-w-0"><dt className="text-xs text-muted-foreground">対象出金・利用</dt><dd className="break-all text-xl font-semibold tabular-nums">{money(report.current.amount)}</dd><p className="text-xs text-muted-foreground">{report.current.count}件 / 振替・対象外を除く</p></div>
      <div className="min-w-0"><dt className="text-xs text-muted-foreground">前月{report.partial ? "同日まで" : ""}との差{report.comparisonConfirmed ? "" : "（参考）"}</dt><dd className={`break-all text-xl font-semibold tabular-nums ${(report.delta ?? 0) > 0 ? "text-rose-700 dark:text-rose-400" : ""}`}>{change(report.delta)}</dd><p className="text-xs text-muted-foreground">{report.percent === null ? "増減率は算出対象外" : `${report.percent > 0 ? "+" : ""}${report.percent.toFixed(1)}%`}</p></div>
      <div className="min-w-0"><dt className="text-xs text-muted-foreground">注意候補</dt><dd className="text-xl font-semibold tabular-nums">{report.alertCount}件</dd><p className="text-xs text-muted-foreground">不正・二重払いの確定ではありません</p></div>
      <div className="min-w-0"><dt className="text-xs text-muted-foreground">未分類の出金・利用</dt><dd className="break-all text-xl font-semibold tabular-nums">{money(report.unclassified.amount)}</dd><Link prefetch={false} className="inline-flex min-h-11 items-center gap-1 text-sm text-primary underline" href={url({ side: "EXPENSE", status: "unclassified" })}>{report.unclassified.count}件を確認<ArrowUpRight className="size-4" /></Link></div>
    </dl>
    <section className="space-y-3" aria-labelledby="spending-trend">
      <h2 id="spending-trend" className="flex items-center gap-2 text-base font-semibold"><ChartNoAxesCombined className="size-4" />月ごとの出金傾向</h2>
      <p className="text-xs text-muted-foreground">{report.partial ? `各月の1日〜${Number(report.asOf.slice(8))}日で比較（月末が早い月は月末まで）。月合計ではありません。` : "各月の月合計で比較。"} 返金・入金は差し引いていません。</p>
      <div className="space-y-3 sm:hidden" role="img" aria-label={report.periods.map((row) => `${row.month}: ${row.known ? money(row.amount) : "データ不明"}${row.covered ? "" : "、取得範囲未確認"}`).join("。")}>
        {report.periods.map((row) => <div key={row.month} className="grid grid-cols-[60px_minmax(0,1fr)_84px] items-center gap-2 text-xs"><span>{row.month}<span className="block text-[10px] text-muted-foreground">{row.covered ? "取得済み" : "範囲未確認"}</span></span><div className="h-5"><div className={`h-full ${row.month === report.month ? "bg-rose-600" : "bg-cyan-700 dark:bg-cyan-500"} ${row.covered ? "" : "border border-dashed border-foreground/40 opacity-50"}`} style={{ width: `${row.known ? Math.max(row.amount ? 2 : 0, row.amount / max * 100) : 0}%` }} /></div><span className="break-all text-right tabular-nums">{row.known ? money(row.amount) : "不明"}</span></div>)}
      </div>
      <div className="hidden max-w-full overflow-x-auto sm:block" tabIndex={0} role="region" aria-label="月ごとの出金グラフ">
        <div className="grid min-w-[480px] grid-cols-7 gap-3 border-b pb-3" role="img" aria-label={report.periods.map((row) => `${row.start}から${row.end}: ${row.known ? money(row.amount) : "データ不明"}${row.covered ? "" : "、取得範囲未確認"}`).join("。")}>{report.periods.map((row) => <div className="text-center text-xs" key={row.month}>
          <div className="mb-2 break-all font-medium tabular-nums">{row.known ? money(row.amount) : "不明"}</div><div className="flex h-32 items-end justify-center"><div className={`w-full max-w-12 ${row.month === report.month ? "bg-rose-600" : "bg-cyan-700 dark:bg-cyan-500"} ${row.covered ? "" : "border-2 border-dashed border-foreground/40 opacity-50"}`} style={{ height: `${row.known ? Math.max(row.amount ? 2 : 0, row.amount / max * 100) : 0}%` }} /></div>
          <div className="mt-2">{row.month}</div><div className="text-muted-foreground">{row.covered ? "取得済み" : "範囲未確認"}</div>
        </div>)}</div>
      </div>
    </section>
    <section className="space-y-3 border-t pt-4" aria-labelledby="spending-alerts">
      <h2 id="spending-alerts" className="flex items-center gap-2 text-base font-semibold"><CircleAlert className="size-4 text-amber-600 dark:text-amber-400" />見直したい出金</h2>
      <p className="text-xs text-muted-foreground">同じ摘要を手掛かりにした候補です。金額・契約・請求書を照合し、正当な支払いか確認してください。自動削除や支払状態の変更は行いません。</p>
      <div className="flex flex-wrap gap-1 border-b pb-2" role="group" aria-label="注意候補の種類">{(["ALL", "DUPLICATE", "LARGE", "RECURRING_INCREASE"] as const).map((value) => <button key={value} className={`min-h-11 rounded-md px-3 text-sm ${kind === value ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`} aria-pressed={kind === value} onClick={() => setKind(value)}>{value === "ALL" ? "すべて" : names[value]}</button>)}</div>
      {report.alertCount > 50 ? <p className="text-xs text-muted-foreground">{report.alertCount}件中、金額の大きい50件を表示しています。種類の絞り込みもこの50件が対象です。</p> : null}
      {!alerts.length ? <p className="py-4 text-sm text-muted-foreground">{report.historyCount < 5 ? "比較履歴が少ないため、通常額・定期支払いの判定は限定的です。" : ""}取込済みの明細に、この条件の候補はありません。問題がないことを保証するものではありません。</p> : null}
      <div className="divide-y">{alerts.map((alert, index) => <details key={alert.id} className="py-3" open={index === 0}>
        <summary className="min-h-11 cursor-pointer text-sm"><span className="inline-block max-w-full align-top"><span className="block font-medium text-amber-800 dark:text-amber-300">{names[alert.kind]}</span><span className="mt-1 block break-words font-medium">{alert.content}</span><span className="mt-1 block break-words tabular-nums">{money(alert.amount)}{alert.kind === "DUPLICATE" ? ` / 同日に${alert.observations}件、1件 ${money(alert.rows[0].amount)}` : ` / 過去の中央値 ${money(alert.baseline!)}（+${((alert.amount / alert.baseline! - 1) * 100).toFixed(0)}%）`}</span></span></summary>
        <div className="mt-3 space-y-3 border-l-2 border-amber-500/40 pl-3">
          <p className="text-xs text-muted-foreground">{alert.kind === "DUPLICATE" ? "同一口座・同日・同額・同じ摘要で異なる元明細IDが存在します。分割払い・複数購入の可能性もあります。" : alert.kind === "RECURRING_INCREASE" ? "直前3か月に毎月1件、金額が安定した支払いに比べ20%以上増えています。利用量・契約内容の変更も確認してください。" : `過去6か月の${alert.observations}件と比較。中央値の2倍以上で、普段のばらつきを超えています。単発のまとまった支払いの可能性もあります。`}</p>
          <div><h3 className="text-sm font-medium">対象明細{alert.observations > 8 && alert.kind === "DUPLICATE" ? "（先頭8件）" : ""}</h3>{evidenceRows(alert.rows)}</div>
          {alert.previous.length ? <div><h3 className="text-sm font-medium">比較に使った明細{alert.observations > alert.previous.length ? `（直近${alert.previous.length}件を表示）` : ""}</h3>{evidenceRows(alert.previous)}</div> : null}
        </div>
      </details>)}</div>
    </section>
    <section className="space-y-3 border-t pt-4" aria-labelledby="spending-categories">
      <h2 id="spending-categories" className="text-base font-semibold">増減の内訳・勘定科目</h2>
      <p className="text-xs text-muted-foreground">増加額が大きい順。現在の科目設定で過去分も集計しています。対象月の分類未確認は{report.unreviewed}件です。</p>
      <ul className="divide-y md:hidden">{report.categories.map((row) => <li className="py-2" key={row.id}><div className="flex items-center justify-between gap-2"><Link prefetch={false} className="inline-flex min-h-11 min-w-0 items-center gap-1 break-words text-sm text-primary underline" href={url({ side: "EXPENSE", ...(row.id ? { category: row.id } : { status: "unclassified" }) })}>{row.name}<ArrowUpRight className="size-3 shrink-0" /></Link><span className="shrink-0 text-sm font-medium tabular-nums">{money(row.amount)}</span></div><div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground"><span>前月{report.partial ? "同日まで" : ""} {report.previous.known ? money(row.previous) : "不明"}</span><span className={(row.delta ?? 0) > 0 ? "text-rose-700 dark:text-rose-400" : ""}>増減{report.comparisonConfirmed ? "" : "（参考）"} {change(row.delta)}</span><span>構成比 {row.share.toFixed(1)}%</span></div></li>)}</ul>
      {report.categories.length ? <div className="hidden max-w-full overflow-x-auto md:block" tabIndex={0} role="region" aria-label="科目別の出金内訳"><table className="w-full min-w-[640px] text-right text-sm"><thead className="border-b text-xs text-muted-foreground"><tr><th scope="col" className="px-2 py-3 text-left">勘定科目</th><th scope="col" className="px-2">対象月</th><th scope="col" className="px-2">前月{report.partial ? "同日まで" : ""}</th><th scope="col" className="px-2">増減{report.comparisonConfirmed ? "" : "（参考）"}</th><th scope="col" className="px-2">構成比</th></tr></thead><tbody>{report.categories.map((row) => <tr className="border-b" key={row.id}><th scope="row" className="max-w-60 break-words px-2 py-3 text-left font-medium"><Link prefetch={false} className="inline-flex min-h-11 items-center gap-1 text-primary underline" href={url({ side: "EXPENSE", ...(row.id ? { category: row.id } : { status: "unclassified" }) })}>{row.name}<ArrowUpRight className="size-3 shrink-0" /></Link></th><td className="px-2 tabular-nums">{money(row.amount)}</td><td className="px-2 tabular-nums">{report.previous.known ? money(row.previous) : "不明"}</td><td className={`px-2 tabular-nums ${(row.delta ?? 0) > 0 ? "text-rose-700 dark:text-rose-400" : ""}`}>{change(row.delta)}</td><td className="px-2 tabular-nums">{row.share.toFixed(1)}%</td></tr>)}</tbody></table></div> : <p className="text-sm text-muted-foreground">この期間の対象明細はありません。</p>}
    </section>
    <details className="border-t pt-3 text-sm"><summary className="min-h-11 cursor-pointer font-medium">集計対象と判定基準</summary><div className="space-y-2 pb-4 text-xs text-muted-foreground">
      <p>対象口座1つの「通常処理」の出金・カード利用を集計します。元明細なし・未来日・振替・対象外は分析に含めません。別口座・カードとの合算や通貨換算は行いません。利益・税務上の経費額ではありません。</p>
      <p>対象期間から除外: 振替・カード精算 {money(report.excluded.transfer)} / 対象外 {money(report.excluded.excluded)} / 元明細なし {report.excluded.missing}件。未分類のカード引落は通常処理に残ることがあるため、扱いの確認が必要です。</p>
      <p>通常額の判定は、同じ摘要について過去6か月に5件以上・3か月以上の履歴がある場合のみ。中央値の2倍以上かつ中央値＋偏差絶対値の中央値の3倍を超える明細を候補にします。定期支払いは直前3か月に毎月1件・金額が中央値の±10%以内で、対象月に1件かつ20%以上増額した場合です。重複候補との重なりはまとめます。</p>
      <p>摘要は全角半角・大文字小文字・連続空白をそろえた完全一致で比較します。摘要は取引先IDではないため、同じ摘要でも別の支払いの可能性があります。銀行の汎用摘要だけでは注意候補にしません。</p>
      <p>候補は読み取り専用で、科目の「確認済み」とは別の判定です。正当な支払いでも候補に残ることがあります。欠けた月はゼロとして補完しません。最終同期: {report.lastSyncAt ? new Date(report.lastSyncAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) : "未確認"}。</p>
    </div></details>
  </div>;
}
