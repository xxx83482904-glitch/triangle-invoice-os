import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app/shell";
import { BankForecastWorkspace } from "@/components/app/bank-forecast-workspace";
import { getCurrentUser } from "@/lib/auth";
import { bankToday } from "@/lib/banking";
import { bankForecastEvidence } from "@/lib/bank-forecast";
import { bankAnalysisAccounts } from "@/lib/bank-analysis";
import { companyFromParam } from "@/lib/company";
import { can, defaultPathForRole } from "@/lib/rbac";
import { readDataForRequest } from "@/lib/store";

export default async function BankForecastPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user, "view:banking")) redirect(defaultPathForRole(user.role));
  const params = await searchParams, company = companyFromParam(params.company), data = await readDataForRequest();
  const { accounts, account } = bankAnalysisAccounts(data, company, params.account);
  const today = bankToday();
  return <AppShell>{account ? <BankForecastWorkspace key={`${company}:${account.id}:${today.slice(0, 7)}`} company={company} account={account} accounts={accounts} evidence={bankForecastEvidence(data, company, account.id, today)} /> : <section className="space-y-4"><h1 className="text-xl font-semibold">口座の予測</h1><p className="text-sm text-muted-foreground">{params.account ? "対象の口座が見つかりません。" : "予測対象の口座はまだありません。"}</p><Button asChild variant="soft" size="sm" className="h-auto max-w-full whitespace-normal break-words py-2 text-left lg:h-auto lg:min-h-8 lg:py-1.5"><Link href={`/banking?company=${company}`}>口座・カード明細へ<ArrowUpRight aria-hidden="true" className="size-4 shrink-0" /></Link></Button></section>}</AppShell>;
}
