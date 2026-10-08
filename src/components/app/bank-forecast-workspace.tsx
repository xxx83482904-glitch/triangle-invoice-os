"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CircleAlert, LoaderCircle, RotateCcw, Save, TrendingUp } from "lucide-react";
import { saveBankForecastAction } from "@/app/banking/actions";
import { bankSelectClass } from "@/components/app/banking-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { forecastDefaults, forecastSettingsSchema, projectBankForecast, type BankForecastEvidence } from "@/lib/bank-forecast";
import type { BankAccount, BankForecastSettings } from "@/lib/banking-types";
import type { CompanyScope } from "@/lib/company";
import { toast } from "@/hooks/use-toast";

const money = (value: number | undefined) => value === undefined ? "未設定" : new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 }).format(value);
const monthName = (month: string) => `${month.slice(0, 4)}年${Number(month.slice(5, 7))}月`;
const coverageName = { FETCHED: "API取得完了", OBSERVED: "取得範囲未確認", UNKNOWN: "データ不明" };
type Props = { company: CompanyScope; account: BankAccount; accounts: BankAccount[]; evidence: BankForecastEvidence };

export function BankForecastWorkspace({ company, account, accounts, evidence }: Props) {
  const router = useRouter(), month = evidence.asOf.slice(0, 7);
  const [saved, setSaved] = useState(() => forecastDefaults(account, month));
  const [draft, setDraft] = useState(saved);
  const [version, setVersion] = useState(account.updatedAt);
  const [sourceVersion, setSourceVersion] = useState(account.updatedAt);
  const [horizon, setHorizon] = useState<3 | 6>(3);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [leaveUrl, setLeaveUrl] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  // Refresh clean conditions after Undo; retain unsaved input on concurrent updates.
  if (sourceVersion !== account.updatedAt) {
    setSourceVersion(account.updatedAt);
    if (!dirty && !pending) {
      const current = forecastDefaults(account, month);
      setSaved(current); setDraft(current); setVersion(account.updatedAt);
    }
  }
  const valid = forecastSettingsSchema.safeParse(draft);
  const projection = valid.success ? projectBankForecast(evidence, valid.data, horizon) : [];
  const bank = draft.accountKind === "BANK", card = draft.accountKind === "CARD";
  const firstLow = projection.find((row) => row.belowMinimum), cautiousLow = projection.find((row) => row.cautiousBelowMinimum);
  const maxFlow = Math.max(1, ...projection.flatMap((row) => [row.income, row.expense]));
  const last = projection.at(-1);
  const update = (patch: Partial<BankForecastSettings>) => setDraft((old) => ({ ...old, ...patch }));

  useEffect(() => {
    if (!dirty) return;
    const leave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const follow = (event: MouseEvent) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      const url = new URL(link.href);
      if (url.origin !== window.location.origin || url.href === window.location.href) return;
      event.preventDefault(); event.stopPropagation();
      if (!pending) setLeaveUrl(url.pathname + url.search + url.hash);
    };
    window.addEventListener("beforeunload", leave); document.addEventListener("click", follow, true);
    return () => { window.removeEventListener("beforeunload", leave); document.removeEventListener("click", follow, true); };
  }, [dirty, pending]);

  function navigate(url: string) { if (pending) return; if (dirty) setLeaveUrl(url); else router.push(url); }
  function save(destination?: string) {
    setError("");
    startTransition(async () => {
      try {
        const result = await saveBankForecastAction(company, account.id, version, draft);
        if (!result.success) { setError(result.error); return; }
        setSaved(result.settings); setDraft(result.settings); setVersion(result.updatedAt); setLeaveUrl(null);
        if (destination) router.push(destination); else router.refresh();
        toast({ title: "予測条件を保存しました", variant: "success" });
      } catch { setError("保存できませんでした。入力内容は保持されています。"); }
    });
  }

  return <div className="min-w-0 space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
      <div className="min-w-0"><Link className="inline-flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground" href={`/banking?company=${company}&account=${encodeURIComponent(account.id)}`}><ArrowLeft className="size-4" />口座・カード明細</Link><h1 className="text-xl font-semibold">口座の予測</h1></div>
      <Button className="min-h-[44px]" disabled={!dirty || pending || !valid.success} onClick={() => save()}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}条件を保存{dirty ? "（未保存）" : ""}</Button>
    </header>
    <div className="flex min-w-0 flex-wrap items-end gap-3">
      <label className="grid min-w-0 flex-1 gap-1 text-sm">予測する口座・カード<select className={bankSelectClass} value={account.id} disabled={pending} onChange={(event) => navigate(`/banking/forecast?company=${company}&account=${encodeURIComponent(event.target.value)}`)}>{accounts.map((row) => <option key={row.id} value={row.id}>{row.name}{row.available ? "" : "（連携終了）"}</option>)}</select></label>
      <fieldset className="shrink-0"><legend className="mb-1 text-sm">予測期間</legend><div className="flex rounded-md border p-1">{([3, 6] as const).map((value) => <button key={value} className={`min-h-[44px] px-4 text-sm ${value === horizon ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`} aria-pressed={value === horizon} onClick={() => setHorizon(value)}>{value}か月</button>)}</div></fieldset>
    </div>
    <p className="break-words text-xs text-muted-foreground">基準日 {evidence.asOf} / 実績 {monthName(evidence.history[0].month)}〜{monthName(evidence.history.at(-1)!.month)} / 単位は元明細と同じ（通貨換算なし）</p>
    <div className="space-y-2 border-l-2 border-amber-500 bg-amber-500/5 p-3 text-sm" role="status">
      <p className="flex items-start gap-2"><CircleAlert className="mt-0.5 size-4 shrink-0" /><span>{evidence.baseline ? "過去の月平均による参考予測です。確定した入出金予定ではありません。" : "予測に使える履歴が不足しています。前月を含む3か月以上の実績が必要です。"}</span></p>
      {evidence.fetchedMonths < 6 ? <p>6か月中{evidence.sampleMonths}か月を使用。API取得完了の記録は{evidence.fetchedMonths}か月です。未取得の月はゼロとして補完していません。</p> : null}
      {evidence.stale ? <p>同期情報が古いか未確認です。再同期後に予測を確認してください。</p> : null}
      {!evidence.currentFetched ? <p>今月の取得範囲は未確認です。今月の見込みと残高は、未取得の取引によって変わります。</p> : null}
      {evidence.manualAccount || !account.available ? <p>この口座は{evidence.manualAccount ? "手動管理" : "連携終了"}のため、取込済みの明細だけを参照しています。</p> : null}
    </div>
    <section className="space-y-3 border-y py-4" aria-labelledby="forecast-settings">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="forecast-settings" className="text-base font-semibold">予測条件</h2><Button variant="ghost" size="icon" className="size-[44px]" title="保存済みの条件に戻す" aria-label="保存済みの条件に戻す" disabled={!dirty || pending} onClick={() => { setDraft(saved); setError(""); }}><RotateCcw className="size-4" /></Button></div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <label className="grid min-w-0 gap-1 text-sm">口座の種類<select className={bankSelectClass} value={draft.accountKind} disabled={pending} onChange={(e) => update({ accountKind: e.target.value as BankForecastSettings["accountKind"], openingBalance: e.target.value === "BANK" ? draft.openingBalance : undefined })}><option value="UNKNOWN">未設定</option><option value="BANK">銀行口座</option><option value="CARD">クレジットカード</option><option value="OTHER">その他</option></select></label>
        <label className="grid min-w-0 gap-1 text-sm">{monthName(month)}1日の残高<Input className="h-[44px]" type="number" step={1} min={-1e12} max={1e12} disabled={pending || !bank} value={draft.openingBalance ?? ""} placeholder={bank ? "未設定" : "銀行口座のみ"} onChange={(e) => update({ openingBalance: e.target.value === "" ? undefined : Number(e.target.value) })} /></label>
        <label className="grid min-w-0 gap-1 text-sm">残高の警戒ライン<Input className="h-[44px]" type="number" min={0} max={1e12} step={1} disabled={pending || !bank} value={draft.minimumBalance} onChange={(e) => update({ minimumBalance: Number(e.target.value) })} /></label>
        <label className="grid min-w-0 gap-1 text-sm">入金・返金の増減（%）<Input className="h-[44px]" type="number" min={-100} max={200} step={1} disabled={pending} value={draft.incomePercent} onChange={(e) => update({ incomePercent: Number(e.target.value) })} /></label>
        <label className="grid min-w-0 gap-1 text-sm">出金・利用の増減（%）<Input className="h-[44px]" type="number" min={-100} max={200} step={1} disabled={pending} value={draft.expensePercent} onChange={(e) => update({ expensePercent: Number(e.target.value) })} /></label>
      </div>
      {bank && draft.openingBalance === undefined ? <p className="text-sm text-muted-foreground">月初残高が未設定のため、入出金のみ予測しています。</p> : null}
      {card ? <p className="text-sm text-muted-foreground">カードの利用・返金予測です。銀行からの引落日や預金残高は推定していません。</p> : null}
      {!valid.success || error ? <p role="alert" className="break-words text-sm text-destructive">{error || "予測条件の入力範囲を確認してください。"}</p> : null}
    </section>
    {projection.length ? <>
      <dl className="grid gap-3 border-b pb-4 sm:grid-cols-3">
        <div><dt className="text-xs text-muted-foreground">今月末までの追加{card ? "利用" : "出金"}予測</dt><dd className="break-all text-xl font-semibold tabular-nums">{money(projection[0].predictedExpense)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">{monthName(last!.month)}末の{bank ? "残高予測" : "月次差額予測"}</dt><dd className="break-all text-xl font-semibold tabular-nums">{money(bank ? last!.balance : last!.net)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">月次収支の過去検証誤差（平均絶対誤差）</dt><dd className="break-all text-xl font-semibold tabular-nums">{evidence.backtest ? money(evidence.backtest.meanAbsoluteError) : "検証履歴不足"}</dd><div className="text-xs text-muted-foreground">{evidence.backtest ? `${evidence.backtest.count}回の過去検証 / 将来の誤差保証ではありません` : "予測前の実績3か月と検証月が必要"}</div></div>
      </dl>
      {firstLow || cautiousLow ? <p role="status" className="border-l-2 border-destructive bg-destructive/5 p-3 text-sm text-destructive">{firstLow ? `標準ケースでは${monthName(firstLow.month)}末に警戒ラインを下回る予測です。` : ""}{cautiousLow ? ` 慎重ケースでは${monthName(cautiousLow.month)}末に警戒ラインを下回ります。` : ""} 月中の資金不足は別途確認が必要です。</p> : null}
      <section className="space-y-3" aria-labelledby="forecast-chart">
        <h2 id="forecast-chart" className="flex items-center gap-2 text-base font-semibold"><TrendingUp className="size-4" />{card ? "カード利用・返金の見込み" : "月別の入出金見込み"}</h2>
        <div className="flex flex-wrap gap-3 text-xs"><span className="flex items-center gap-1"><span className="size-3 bg-emerald-600" />入金・返金</span><span className="flex items-center gap-1"><span className="size-3 bg-rose-600" />出金・利用</span><span>塗り: 実績 / 破線: 予測</span></div>
        <div className="max-w-full overflow-x-auto border-b pb-3"><div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${projection.length}, minmax(88px, 1fr))` }}>
          {projection.map((row) => <div key={row.month} className="min-w-0 text-center text-xs"><div className="flex h-36 items-end justify-center gap-3 border-b" aria-label={`${monthName(row.month)} 入金 ${money(row.income)} 出金 ${money(row.expense)}`} role="img">
            {(["Income", "Expense"] as const).map((side) => { const total = side === "Income" ? row.income : row.expense, actual = side === "Income" ? row.actualIncome : row.actualExpense; return <div key={side} className="flex w-6 flex-col justify-end" style={{ height: `${total / maxFlow * 100}%` }} title={`${side === "Income" ? "入金" : "出金"}: ${money(total)}（実績 ${money(actual)}）`}><div className={`min-h-0 border border-dashed ${side === "Income" ? "border-emerald-600 bg-emerald-600/10" : "border-rose-600 bg-rose-600/10"}`} style={{ height: `${total ? (total - actual) / total * 100 : 0}%`, borderWidth: total === actual ? 0 : 1 }} /><div className={side === "Income" ? "bg-emerald-600" : "bg-rose-600"} style={{ height: `${total ? actual / total * 100 : 0}%` }} /></div>; })}
          </div><div className="mt-2">{monthName(row.month)}</div><div className="text-muted-foreground">{row.month === month ? "実績＋残期間の予測" : "予測"}</div></div>)}
        </div></div>
        <p id="forecast-scenario" className="text-xs text-muted-foreground">慎重ケース: 設定後の予測入金を20%減、出金を20%増。確率区間ではありません。</p>
        <div className="max-w-full overflow-x-auto">
          <table aria-label="月別の予測金額" aria-describedby="forecast-scenario" className="w-full min-w-[740px] text-right text-sm">
            <thead className="border-b"><tr>{["月", "入金・返金", "出金・利用", "差額", ...(bank ? ["月末残高", "慎重ケース残高"] : ["慎重ケース差額"])].map((label) => <th key={label} className="px-2 py-3 font-medium">{label}</th>)}</tr></thead>
            <tbody>{projection.map((row) => <tr key={row.month} className="border-b">
              <th className="px-2 py-3 font-normal">{row.month}</th>
              <td className="px-2 tabular-nums">{money(row.income)}</td>
              <td className="px-2 tabular-nums">{money(row.expense)}</td>
              <td className="px-2 tabular-nums">{money(row.net)}</td>
              {bank ? <td className={`px-2 tabular-nums ${row.belowMinimum ? "font-semibold text-destructive" : ""}`}>{money(row.balance)}</td> : null}
              <td className={`px-2 tabular-nums ${row.cautiousBelowMinimum ? "text-destructive" : ""}`}>{money(bank ? row.cautiousBalance : row.cautiousNet)}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>
    </> : null}
    <section className="space-y-3 border-t pt-4" aria-labelledby="forecast-recurring"><h2 id="forecast-recurring" className="text-base font-semibold">定期入出金の候補</h2><p className="text-xs text-muted-foreground">直近3か月の同じ摘要・入出金から推定。月次予測の内訳候補で、別途加算していません。</p>
      {!evidence.recurring.length ? <p className="py-3 text-sm text-muted-foreground">条件に合う定期取引はありません。</p> : <ul className="divide-y">{evidence.recurring.map((row) => <li key={row.key} className="grid min-w-0 gap-2 py-3 sm:grid-cols-[112px_minmax(0,1fr)_140px]"><time className="text-sm tabular-nums">{row.nextDate}頃</time><span className="min-w-0 break-words text-sm">{row.content}<span className="block text-xs text-muted-foreground">3か月連続・月1回 / 金額の中央値</span></span><span className={`text-sm tabular-nums sm:text-right ${row.side === "INCOME" ? "text-emerald-700 dark:text-emerald-400" : ""}`}>{row.side === "INCOME" ? "+" : "-"}{money(row.amount)}</span></li>)}</ul>}
    </section>
    <details className="border-y py-3"><summary className="flex min-h-[44px] cursor-pointer items-center text-sm font-medium">実績と計算の根拠</summary><div className="space-y-3 pt-3 text-sm">
      <p>対象は選択した口座だけです。振替・カード精算・会計上の対象外も口座の動きとして含みます。他口座やカードの利用額、未決済の請求書は合算していません。</p>
      <p>予測の基準は過去6か月のうちデータがある月の入金・出金平均です。今月はその額から取込済み実績を引き、残りを0以上として予測します。季節性や日ごとの資金繰りは推定していません。</p>
      <p>月末残高 = 入力した今月初日の残高 + 今月以降の累計入金 - 累計出金。月が変わると月初残高の再入力が必要です。</p>
      <p>最終同期: {evidence.lastSyncAt ? new Date(evidence.lastSyncAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) : "未確認"} / 元明細なし {evidence.missingRows}件 / 将来日付 {evidence.futureRows}件は除外。取得完了はAPIの応答範囲で、金融機関の未提供履歴は含みません。</p>
      <div className="max-w-full overflow-x-auto"><table className="w-full min-w-[470px] text-right text-sm"><thead><tr>{["実績月", "入金", "出金", "取込件数", "取得範囲"].map((label) => <th key={label} className="border-b px-2 py-2 font-medium">{label}</th>)}</tr></thead><tbody>{[...evidence.history, evidence.current].map((row) => <tr key={row.month}><th className="border-b px-2 py-2 font-normal">{row.month}{row.month === month ? "（途中）" : ""}</th><td className="border-b px-2">{row.coverage === "UNKNOWN" ? "不明" : money(row.income)}</td><td className="border-b px-2">{row.coverage === "UNKNOWN" ? "不明" : money(row.expense)}</td><td className="border-b px-2">{row.count}</td><td className="border-b px-2 text-xs">{coverageName[row.coverage]}</td></tr>)}</tbody></table></div>
    </div></details>
    <Dialog open={Boolean(leaveUrl)} onOpenChange={(open) => { if (!open && !pending) setLeaveUrl(null); }}><DialogContent showCloseButton={!pending} onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}><DialogHeader><DialogTitle>予測条件が未保存です</DialogTitle><DialogDescription>変更を保存してから移動しますか？</DialogDescription></DialogHeader>{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}<div className="flex flex-wrap gap-2"><Button className="min-h-[44px]" variant="outline" disabled={pending} onClick={() => setLeaveUrl(null)}>キャンセル</Button><Button className="min-h-[44px]" variant="ghost" disabled={pending} onClick={() => { const url = leaveUrl; setDraft(saved); setLeaveUrl(null); if (url) router.push(url); }}>破棄して移動</Button><Button className="min-h-[44px]" disabled={pending || !valid.success} onClick={() => save(leaveUrl || undefined)}><Save className="size-4" />保存して移動</Button></div></DialogContent></Dialog>
  </div>;
}
