import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, Landmark, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app/shell";
import { getCurrentUser } from "@/lib/auth";
import { bankToday } from "@/lib/banking";
import { companyFromParam } from "@/lib/company";
import { can, canAccessCompany, defaultPathForRole } from "@/lib/rbac";
import { readDataForRequest } from "@/lib/store";
import { taxObligations } from "@/lib/tax-obligations";

const money = (value: number) => new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 }).format(value);
const linkClass = "inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm hover:bg-muted";

// 未払い税金・社会保険一覧: read-only, built from received invoices and mail whose names point at tax or insurance bodies.
export default async function BankObligationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user, "view:banking")) redirect(defaultPathForRole(user.role));
  const params = await searchParams, company = companyFromParam(params.company);
  if (!canAccessCompany(user, company)) redirect(defaultPathForRole(user.role));
  const data = await readDataForRequest(), today = bankToday();
  const summary = taxObligations(data, company, today);
  return <AppShell><div className="min-w-0 space-y-4 pb-12">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1"><h1 className="text-xl font-semibold">未払いの税金・社会保険</h1><p className="text-xs text-muted-foreground">{company === "JAPAN" ? "日本" : "中国"} / {today} 時点 / 未払い {summary.items.length}件（期限超過 {summary.overdue} / 14日以内 {summary.dueSoon}）/ 金額判明分の合計 {money(summary.outstandingTotal)}</p></div>
      <div className="flex flex-wrap gap-2"><Link className={linkClass} href={`/banking?company=${company}`}><Landmark className="size-4" />口座・カード明細</Link><Link className={linkClass} href={`/banking/integrity?company=${company}`}><ShieldCheck className="size-4" />整合性チェック</Link></div>
    </header>
    <p className="text-sm text-muted-foreground">税務署・自治体・年金事務所・保険団体などの名前を含む受領請求書と郵便物から作っています。名前による判定なので漏れや誤検知があります。支払いは受領請求書の支払記録か銀行照合で記録してください。</p>
    <ul className="divide-y border-y" aria-label="未払いの税金・社会保険">{summary.items.map((row) => <li key={row.id} className="min-w-0 space-y-1 py-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">{row.overdue ? <span className="rounded border border-red-300 bg-red-100 px-1.5 py-0.5 text-red-900 dark:border-red-500/70 dark:bg-red-950 dark:text-red-200">期限超過</span> : row.dueSoon ? <span className="rounded border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-amber-900 dark:border-amber-500/70 dark:bg-amber-950 dark:text-amber-200">14日以内</span> : null}<span className="text-muted-foreground">{row.source === "received" ? "受領請求書" : "郵便物"} / {row.status}</span>{row.dueDate ? <time className="tabular-nums text-muted-foreground">期限 {row.dueDate}</time> : null}</div>
      <h2 className="break-words text-sm font-medium">{row.title} <span className="font-normal text-muted-foreground">/ {row.party}</span></h2>
      <p className="text-sm">{row.amount !== undefined ? <>請求 {money(row.amount)} / 支払済 {money(row.paid)} / <strong>未払い {money(row.outstanding || 0)}</strong></> : "金額未登録"}<span className="ml-2 text-xs text-muted-foreground">{row.note}</span></p>
      <Link className="inline-flex min-h-11 items-center gap-1 text-sm text-primary underline" href={row.href}>{row.source === "received" ? "受領請求書を開く" : "郵便物フォルダーを開く"}<ArrowUpRight className="size-4" /></Link>
    </li>)}</ul>
    {!summary.items.length ? <p className="text-sm text-muted-foreground">未払いとして検出された税金・社会保険はありません。</p> : null}
    {summary.paidRecently.length ? <details className="text-sm"><summary className="min-h-11 cursor-pointer content-center font-medium">支払済みの税金・社会保険 {summary.paidRecently.length}件</summary><ul className="divide-y">{summary.paidRecently.map((row) => <li key={row.id} className="flex flex-wrap justify-between gap-2 py-2"><span className="break-words">{row.title}</span><span className="tabular-nums text-muted-foreground">{row.paidAt} / {money(row.amount)}</span></li>)}</ul></details> : null}
  </div></AppShell>;
}
