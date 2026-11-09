import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app/shell";
import { BankInsightsWorkspace } from "@/components/app/bank-insights-workspace";
import { getCurrentUser } from "@/lib/auth";
import { bankAnalysisAccounts } from "@/lib/bank-analysis";
import { bankSpendingInsights, spendingMonth } from "@/lib/bank-insights";
import { bankToday } from "@/lib/banking";
import { companyFromParam } from "@/lib/company";
import { can } from "@/lib/rbac";
import { defaultPathForUser } from "@/lib/app-navigation";
import { readDataForRequest } from "@/lib/store";

export default async function BankInsightsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user, "view:banking")) redirect(defaultPathForUser(user));
  const params = await searchParams, company = companyFromParam(params.company), data = await readDataForRequest();
  const { accounts, account } = bankAnalysisAccounts(data, company, params.account);
  const today = bankToday(), month = spendingMonth(params.month, today);
  return <AppShell>{account ? <BankInsightsWorkspace key={`${company}:${account.id}:${month}`} company={company} account={account} accounts={accounts} months={Array.from(new Set(data.bankTransactions.filter((row) => row.company === company && row.bankAccountId === account.id).map((row) => row.transactionDate.slice(0, 7))))} insights={bankSpendingInsights(data, company, account.id, month, today)} /> : <section className="space-y-4"><h1 className="text-xl font-semibold">出金の傾向・注意</h1><p className="text-sm text-muted-foreground">{params.account ? "対象の口座が見つかりません。" : "分析対象の口座はまだありません。"}</p><Button asChild variant="soft" size="sm" className="h-auto max-w-full whitespace-normal break-words py-2 text-left lg:h-auto lg:min-h-8 lg:py-1.5"><Link href={`/banking?company=${company}`}>口座・カード明細へ<ArrowUpRight aria-hidden="true" className="size-4 shrink-0" /></Link></Button></section>}</AppShell>;
}
