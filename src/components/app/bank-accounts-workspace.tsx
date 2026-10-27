"use client";

import Link from "next/link";
import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, CreditCard, Landmark, List, LoaderCircle, Pencil, Save, Search, Wallet, X } from "lucide-react";
import { saveBankOverviewAction } from "@/app/banking/actions";
import { bankSelectClass } from "@/components/app/banking-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import type { AccountOverviewRow, BankFiscalPeriod, BankOverviewInput } from "@/lib/bank-account-overview";
import type { CompanyScope } from "@/lib/company";

const money = (value: number) => new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(value);
const monthName = (value: string) => `${value.slice(0, 4)}年${Number(value.slice(5))}月`;
const incomeColor = "text-emerald-700 dark:text-emerald-400";
const expenseColor = "text-rose-700 dark:text-rose-400";
const linkClass = "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border px-3 text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary";
const kinds = { BANK: "銀行口座", CARD: "クレジットカード", OTHER: "その他", UNKNOWN: "種類未設定" };
type Props = { company: CompanyScope; today: string; month: string; latestMonth: string; period: BankFiscalPeriod; fiscalYears: number[]; through: string; rows: AccountOverviewRow[] };

export function BankAccountsWorkspace({ company, today, month, latestMonth, period, fiscalYears, through, rows }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("name");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<AccountOverviewRow | null>(null);
  const filtered = useMemo(() => {
    const terms = query.normalize("NFKC").toLocaleLowerCase("ja").trim().split(/\s+/);
    return rows.filter((row) => terms.every((term) => row.name.normalize("NFKC").toLocaleLowerCase("ja").includes(term))).sort((a, b) => {
      if (sort === "balance") return (b.balance?.amount ?? -Infinity) - (a.balance?.amount ?? -Infinity) || a.name.localeCompare(b.name, "ja");
      if (sort === "income" || sort === "expense" || sort === "net") return b[sort] - a[sort] || a.name.localeCompare(b.name, "ja");
      if (sort === "latest") return (b.latestDate || "").localeCompare(a.latestDate || "") || a.name.localeCompare(b.name, "ja");
      return a.name.localeCompare(b.name, "ja");
    });
  }, [rows, query, sort]);
  const banks = rows.filter((row) => row.kind === "BANK"), registered = banks.filter((row) => row.balance);
  const bankIncome = banks.reduce((sum, row) => sum + row.income, 0), bankExpense = banks.reduce((sum, row) => sum + row.expense, 0);
  const url = (row?: AccountOverviewRow, extra: Record<string, string> = {}) => `/banking?${new URLSearchParams({ company, month, ...(row ? { account: row.id } : {}), ...extra })}`;
  const currentYear = Number(today.slice(0, 4)) + (Number(today.slice(5, 7)) >= 9 ? 1 : 0);
  const navigateYear = (year?: number) => {
    if (year !== undefined && (!Number.isInteger(year) || year < 1901 || year > currentYear)) return;
    startTransition(() => router.push(`/banking/accounts?${new URLSearchParams({ company, ...(year ? { fiscalYear: String(year) } : {}) })}`, { scroll: false }));
  };
  const toggle = (id: string) => setExpanded((current) => current === id ? null : id);

  return <div className="min-w-0 space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
      <div><h1 className="text-xl font-semibold">口座一覧</h1><p className="mt-1 text-sm text-muted-foreground">{company === "JAPAN" ? "日本本社" : "中国支社"} / {rows.length}口座・カード</p></div>
      <Link href={url()} className={linkClass}><List className="size-4" />明細・同期</Link>
    </header>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" className="size-11" title="前の決算期" aria-label="前の決算期" disabled={pending || period.year <= 1901} onClick={() => navigateYear(period.year - 1)}><ChevronLeft className="size-4" /></Button>
        <div className="w-40 min-w-0"><select aria-label="口座一覧の決算期" className={bankSelectClass} value={period.year} disabled={pending} onChange={(event) => navigateYear(Number(event.target.value))}>
          {fiscalYears.map((year) => <option key={year} value={year}>{year}年8月期</option>)}
        </select></div>
        <Button variant="ghost" size="icon" className="size-11" title="次の決算期" aria-label="次の決算期" disabled={pending || period.year >= currentYear} onClick={() => navigateYear(period.year + 1)}><ChevronRight className="size-4" /></Button>
        </div>
        <Button variant="outline" className="min-h-11" disabled={pending} onClick={() => navigateYear()} title={latestMonth ? `最新取引月: ${monthName(latestMonth)}` : "最新の決算期"}><CalendarDays className="size-4" />最新</Button>
        {pending ? <LoaderCircle aria-label="読み込み中" className="size-4 animate-spin" /> : null}
      </div>
      <div className="text-xs leading-relaxed text-muted-foreground"><p>決算期間: {period.start} 〜 {period.end}</p><p>集計: {through}まで / 最新取引月: {latestMonth ? monthName(latestMonth) : "未取得"}</p></div>
    </div>
    <dl className="grid grid-cols-2 gap-x-5 gap-y-4 border-b pb-5 lg:grid-cols-4">
      <div className="min-w-0"><dt className="text-xs text-muted-foreground">登録残高の合計 / 銀行</dt><dd className="mt-1 break-all text-2xl font-semibold tabular-nums">{registered.length ? money(registered.reduce((sum, row) => sum + row.balance!.amount, 0)) : "未登録"}</dd><dd className="mt-1 text-xs text-muted-foreground">{registered.length} / {banks.length}口座・各確認日時点</dd></div>
      <div className="hidden min-w-0 md:block"><dt className="text-xs text-muted-foreground">期内の銀行入金</dt><dd className={`mt-1 break-all text-2xl font-semibold tabular-nums ${incomeColor}`}>{money(bankIncome)}</dd><dd className="mt-1 text-xs text-muted-foreground">振替・返金を含む</dd></div>
      <div className="hidden min-w-0 md:block"><dt className="text-xs text-muted-foreground">期内の銀行出金</dt><dd className={`mt-1 break-all text-2xl font-semibold tabular-nums ${expenseColor}`}>{money(bankExpense)}</dd><dd className="mt-1 text-xs text-muted-foreground">カード引落・振替を含む</dd></div>
      <div className="min-w-0"><dt className="text-xs text-muted-foreground">期内の銀行入出金差額</dt><dd className="mt-1 break-all text-2xl font-semibold tabular-nums">{money(bankIncome - bankExpense)}</dd><dd className="mt-1 text-xs text-muted-foreground">取得済み明細 / 残高とは別</dd></div>
    </dl>
    <div className="flex flex-wrap items-end gap-3">
      <label className="relative min-w-0 flex-1 basis-56"><Search aria-hidden className="absolute left-3 top-3.5 size-4 text-muted-foreground" /><Input aria-label="銀行名・口座番号を検索" placeholder="銀行名・口座番号" className="h-11 pl-9 lg:h-11 lg:pl-9" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <div className="flex w-full items-center gap-3 sm:w-auto"><select aria-label="口座の並び順" className={`${bankSelectClass} min-w-0 flex-1 sm:w-48`} value={sort} onChange={(event) => setSort(event.target.value)}>
        <option value="name">銀行・口座名順</option><option value="balance">登録残高が多い順</option><option value="income">入金が多い順</option><option value="expense">出金が多い順</option><option value="net">差額が大きい順</option><option value="latest">最新取引順</option>
      </select>
      <span role="status" className="shrink-0 py-3 text-xs text-muted-foreground">{filtered.length} / {rows.length}口座</span></div>
    </div>
    {(["BANK", "CARD", "OTHER", "UNKNOWN"] as const).map((kind) => {
      const group = filtered.filter((row) => row.kind === kind);
      if (!group.length) return null;
      const Icon = kind === "BANK" ? Landmark : kind === "CARD" ? CreditCard : Wallet;
      return <section key={kind} aria-labelledby={`account-kind-${kind}`}>
        <h2 id={`account-kind-${kind}`} className="flex items-center gap-2 border-b bg-muted/40 px-3 py-3 text-sm font-semibold"><Icon className="size-4" />{kinds[kind]}<span className="font-normal text-muted-foreground">{group.length}</span></h2>
        <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_repeat(3,minmax(0,1fr))_44px] gap-4 border-b px-3 py-2 text-right text-xs text-muted-foreground xl:grid" aria-hidden>
          <span className="text-left">口座 / 取引件数</span><span className="text-left">{kind === "BANK" ? "登録残高 / 確認日" : "口座情報"}</span><span>{kind === "CARD" ? "返金・精算" : "入金"}</span><span>{kind === "CARD" ? "利用・出金" : "出金"}</span><span>差額</span><span />
        </div>
        {group.map((row) => <Fragment key={row.id}>
          <article className={`grid min-w-0 grid-cols-2 items-start gap-x-4 gap-y-3 border-b px-3 py-3 md:grid-cols-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_repeat(3,minmax(0,1fr))_44px] ${expanded === row.id ? "bg-primary/5" : "hover:bg-muted/20"}`}>
            <div className="col-span-2 min-w-0 md:col-span-1"><button className="min-h-11 w-full break-words text-left text-sm font-semibold underline-offset-4 hover:underline" aria-label={`${row.name}の動きを表示`} aria-expanded={expanded === row.id} aria-controls={`activity-${row.id}`} onClick={() => toggle(row.id)}>{row.name}</button>
              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground"><span>{row.count}件</span>{row.latestDate ? <span>最終取引 {row.latestDate.slice(5)}</span> : null}{row.unreviewed ? <span className="text-amber-700 dark:text-amber-400">未確認 {row.unreviewed}</span> : null}{!row.available ? <span>連携終了</span> : null}{!row.covered ? <span>取得範囲未確認</span> : null}{row.missing ? <span className="text-destructive">元明細なし {row.missing}</span> : null}</div>
            </div>
            <div className="col-span-2 min-w-0 md:col-span-2 xl:col-span-1">
              <button className="flex min-h-11 w-full items-start gap-2 rounded-md text-left hover:bg-muted disabled:opacity-60" disabled={row.unspecified} title="口座情報・残高を編集" aria-label={`${row.name}の口座情報・残高を編集`} onClick={() => setEditing(row)}>
                <span className="min-w-0 flex-1"><span className="block break-all text-lg font-semibold tabular-nums">{kind === "BANK" ? row.balance ? money(row.balance.amount) : "残高未登録" : row.unspecified ? "口座未特定" : "預金残高の対象外"}</span><span className="block text-xs text-muted-foreground">{row.balance ? `${row.balance.asOf} 終日 / 手動登録` : kind === "BANK" ? "確認日付きで登録" : kinds[kind]}</span></span>
                {!row.unspecified ? <Pencil className="mt-1 size-3.5 shrink-0 text-muted-foreground" /> : null}
              </button>
              {row.estimatedBalance !== undefined ? <p className="mt-1 break-words text-xs text-muted-foreground">参考 {money(row.estimatedBalance)} / {row.balanceThrough}</p> : null}
            </div>
            {[{ label: kind === "CARD" ? "返金・精算" : "入金", value: row.income, color: incomeColor }, { label: kind === "CARD" ? "利用・出金" : "出金", value: row.expense, color: expenseColor }, { label: "差額", value: row.net, color: "" }].map((item) => <dl key={item.label} className="min-w-0 xl:pt-2 xl:text-right"><dt className="text-xs text-muted-foreground xl:sr-only">{item.label}</dt><dd className={`break-all text-sm font-semibold tabular-nums ${item.color}`}>{money(item.value)}</dd></dl>)}
            <Button variant="ghost" size="icon" className="size-11 justify-self-end" title={expanded === row.id ? "動きを閉じる" : "動きを表示"} aria-label={`${row.name}の動きを${expanded === row.id ? "閉じる" : "開く"}`} aria-expanded={expanded === row.id} aria-controls={`activity-${row.id}`} onClick={() => toggle(row.id)}><ChevronDown className={`size-4 transition-transform ${expanded === row.id ? "rotate-180" : ""}`} /></Button>
          </article>
          {expanded === row.id ? <AccountActivity key={`${row.id}:${period.year}`} row={row} period={period} company={company} /> : null}
        </Fragment>)}
      </section>;
    })}
    {!filtered.length ? <div className="border-y py-12 text-center text-sm text-muted-foreground">{rows.length ? "該当する口座はありません" : "連携口座はまだありません"}{!rows.length ? <div className="mt-3"><Link href={url()} className={linkClass}>明細・同期へ<ArrowUpRight className="size-4" /></Link></div> : null}</div> : null}
    <p className="border-t pt-3 text-xs leading-relaxed text-muted-foreground">残高は銀行で確認した日付時点の登録額です（自動取得ではありません）。参考残高は、確認日の翌日から取得範囲を確認できた明細のみで計算します。入出金は振替・対象外を含み、元明細なし・未来日は除外。カード利用額は銀行残高に合算しません。</p>
    {editing ? <AccountBalanceDialog key={`${editing.id}:${editing.updatedAt}`} row={editing} company={company} today={today} onClose={() => setEditing(null)} /> : null}
  </div>;
}

function AccountActivity({ row, period, company }: { row: AccountOverviewRow; period: BankFiscalPeriod; company: CompanyScope }) {
  const scale = Math.max(1, ...row.history.flatMap((point) => [point.income, point.expense]));
  const transactionsByMonth = useMemo(() => {
    const groups = new Map<string, AccountOverviewRow["transactions"]>();
    for (const transaction of row.transactions) {
      const month = transaction.transactionDate.slice(0, 7), group = groups.get(month);
      if (group) group.push(transaction); else groups.set(month, [transaction]);
    }
    return groups;
  }, [row.transactions]);
  const elapsedMonths = row.history.filter((point) => !point.future).toReversed();
  const futureMonths = row.history.filter((point) => point.future);
  const monthUrl = (month: string) => `/banking?${new URLSearchParams({ company, account: row.id, month })}`;
  return <div id={`activity-${row.id}`} className="grid min-w-0 gap-5 border-b bg-muted/20 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
    <section className="min-w-0"><h3 className="text-sm font-semibold">{period.year}年8月期の動き</h3><p className="mt-1 text-xs text-muted-foreground">{period.start} 〜 {period.end}</p><div className="mt-2 flex flex-wrap gap-3 text-xs"><span className={incomeColor}>入金・返金</span><span className={expenseColor}>出金・利用</span></div>
      <div className="mt-3 grid h-36 grid-cols-12 gap-1" role="img" aria-label="9月から翌8月までの入金・出金">
        {row.history.map((point) => <div key={point.month} className={`flex min-w-0 flex-col ${point.future ? "opacity-40" : ""}`}><div className="flex min-h-0 flex-1 items-end justify-center gap-0.5 border-b"><span className="w-3 max-w-[40%] bg-emerald-500" style={{ height: `${point.income / scale * 100}%` }} /><span className="w-3 max-w-[40%] bg-rose-500" style={{ height: `${point.expense / scale * 100}%` }} /></div><span className="pt-1 text-center text-xs text-muted-foreground">{Number(point.month.slice(5))}</span></div>)}
      </div>
      <details className="mt-2 text-xs"><summary className="min-h-11 cursor-pointer py-3">月別の集計</summary><dl className="divide-y">{elapsedMonths.map((point) => <div key={point.month} className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 py-2"><dt><Link prefetch={false} href={monthUrl(point.month)} className="inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline">{point.month}</Link></dt><dd className={`break-all text-right tabular-nums ${incomeColor}`}>{money(point.income)}</dd><dd className={`break-all text-right tabular-nums ${expenseColor}`}>{money(point.expense)}{!point.covered ? <span className="block text-muted-foreground">取得範囲未確認</span> : null}</dd></div>)}</dl></details>
      {futureMonths.length ? <p className="mt-3 text-xs text-muted-foreground">{monthName(futureMonths[0].month)}〜{monthName(futureMonths.at(-1)!.month)}: 未到来</p> : null}
    </section>
    <section className="min-w-0"><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">期内の取引</h3><span className="text-xs text-muted-foreground">新しい順 / {row.count}件</span></div>
      <div role="region" aria-label={`${row.name}の年度別取引履歴`} tabIndex={0} className="h-[34rem] max-h-[70dvh] min-h-72 overflow-y-auto overscroll-contain rounded-md border bg-background px-3 focus-visible:outline-2 focus-visible:outline-primary [scrollbar-gutter:stable]">
        {elapsedMonths.map((point) => <section key={point.month} aria-label={monthName(point.month)} className="border-b last:border-b-0">
          <header className="sticky top-0 z-10 flex min-h-14 flex-wrap items-center justify-between gap-x-2 border-b bg-background py-2"><h4 className="text-sm font-semibold">{monthName(point.month)}<span className="ml-2 text-xs font-normal text-muted-foreground">{point.count}件</span></h4><Link prefetch={false} href={monthUrl(point.month)} className="inline-flex min-h-11 items-center gap-1 text-xs text-primary">{row.unspecified ? "連携元明細" : "月の明細"}<ArrowUpRight className="size-3.5" /></Link></header>
          {point.count ? <ul className="divide-y">{(transactionsByMonth.get(point.month) || []).map((transaction) => <li key={transaction.id}><Link prefetch={false} className="grid min-h-14 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2 gap-y-1 py-3 text-sm hover:bg-muted sm:grid-cols-[auto_minmax(0,1fr)_auto]" href={`/banking?${new URLSearchParams({ company, transaction: transaction.id })}`}>
            {transaction.side === "INCOME" ? <ArrowDownLeft className={`mt-0.5 size-4 ${incomeColor}`} /> : <ArrowUpRight className={`mt-0.5 size-4 ${expenseColor}`} />}
            <span className="min-w-0"><span className="block break-words">{transaction.content}</span><span className="block text-xs text-muted-foreground">{transaction.transactionDate}{!transaction.reviewed ? " / 未確認" : ""}</span></span>
            <span className={`col-start-2 max-w-full break-all text-right font-medium tabular-nums sm:col-start-auto sm:max-w-32 ${transaction.side === "INCOME" ? incomeColor : expenseColor}`}>{transaction.side === "INCOME" ? "+" : "−"}{money(transaction.amount)}</span>
          </Link></li>)}</ul> : <p className="py-4 text-xs text-muted-foreground">{point.covered ? "取引なし" : "取得済み明細なし / 取得範囲未確認"}</p>}
        </section>)}
      </div>
      <p className="mt-3 break-words text-xs text-muted-foreground">{row.lastSyncAt ? `最終同期 ${new Date(row.lastSyncAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}` : "同期日時未記録"}{row.memberCount > 1 ? ` / 再連携を含む${row.memberCount}件の履歴` : ""}</p>
    </section>
  </div>;
}

function AccountBalanceDialog({ row, company, today, onClose }: { row: AccountOverviewRow; company: CompanyScope; today: string; onClose: () => void }) {
  const router = useRouter();
  const [kind, setKind] = useState<BankOverviewInput["kind"]>(row.kind);
  const [amount, setAmount] = useState(row.balance ? String(row.balance.amount) : "");
  const [date, setDate] = useState(row.balance?.asOf || today);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  function save() {
    setError("");
    if (kind === "BANK" && amount.trim() && (!Number.isSafeInteger(Number(amount)) || !date || date > today)) { setError("残高と確認日を確認してください"); return; }
    startTransition(async () => {
      try {
        const result = await saveBankOverviewAction(company, row.id, row.updatedAt, { kind, ...(kind === "BANK" && amount.trim() ? { balance: { amount: Number(amount), asOf: date, currency: "JPY" as const } } : {}) });
        if (!result.success) { setError(result.error); return; }
        toast({ title: "口座情報を保存しました", variant: "success" }); onClose(); router.refresh();
      } catch { setError("保存できませんでした。入力内容は保持されています"); }
    });
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose(); }}><DialogContent showCloseButton={false} className="max-h-[90dvh] overflow-y-auto sm:max-w-md" onPointerDownOutside={(event) => event.preventDefault()} onEscapeKeyDown={(event) => event.preventDefault()}>
    <DialogHeader className="pr-10"><DialogTitle>口座情報・残高</DialogTitle><DialogDescription className="break-words">{row.name}</DialogDescription></DialogHeader>
    <Button variant="ghost" size="icon" className="absolute right-2 top-2 size-11" aria-label="口座情報を閉じる" title="閉じる" disabled={pending} onClick={onClose}><X className="size-4" /></Button>
    <form className="min-w-0 space-y-4" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <label className="grid gap-1 text-sm">口座の種類<select className={bankSelectClass} value={kind} disabled={pending} onChange={(event) => setKind(event.target.value as typeof kind)}>{Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {kind === "BANK" ? <>
        <label className="grid gap-1 text-sm">銀行で確認した残高（円）<Input type="number" inputMode="numeric" step="1" min="-1000000000000" max="1000000000000" className="h-11 lg:h-11" value={amount} placeholder="未登録" disabled={pending} onChange={(event) => setAmount(event.target.value)} /></label>
        <label className="grid gap-1 text-sm">残高確認日（その日の終日時点）<Input type="date" className="h-11 lg:h-11" required={Boolean(amount.trim())} value={date} max={today} disabled={pending} onChange={(event) => setDate(event.target.value)} /></label>
        <p className="text-xs text-muted-foreground">銀行残高の自動取得は未対応です。登録後の参考残高には確認日の翌日以降の明細を使います。</p>
      </> : <p className="text-xs text-muted-foreground">銀行以外は預金残高の集計対象に含まれません。</p>}
      {row.balance && (kind !== "BANK" || !amount.trim()) ? <p className="text-sm text-amber-700 dark:text-amber-400">保存すると登録済み残高を解除します。</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" className="min-h-11" disabled={pending} onClick={onClose}>キャンセル</Button><Button type="submit" className="min-h-11" disabled={pending}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}保存</Button></div>
    </form>
  </DialogContent></Dialog>;
}
