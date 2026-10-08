import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app/shell";
import { BankForecastWorkspace } from "@/components/app/bank-forecast-workspace";
import { getCurrentUser } from "@/lib/auth";
import { bankToday } from "@/lib/banking";
import { bankForecastEvidence } from "@/lib/bank-forecast";
import { companyFromParam } from "@/lib/company";
import { can, defaultPathForRole } from "@/lib/rbac";
import { readDataForRequest } from "@/lib/store";

export default async function BankForecastPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user, "view:banking")) redirect(defaultPathForRole(user.role));
  const params = await searchParams, company = companyFromParam(params.company), data = await readDataForRequest();
  const used = new Set(data.bankTransactions.filter((row) => row.company === company).map((row) => row.bankAccountId));
  const accounts = data.bankAccounts.filter((row) => row.company === company && (row.sourceSubId || used.has(row.id) || !data.bankAccounts.some((child) => child.company === company && child.officeCode === row.officeCode && child.sourceId === row.sourceId && child.sourceSubId)));
  const parent = data.bankAccounts.find((row) => row.id === params.account && row.company === company && !row.sourceSubId);
  const account = params.account ? accounts.find((row) => row.id === params.account) || (parent && accounts.find((row) => row.officeCode === parent.officeCode && row.sourceId === parent.sourceId && row.sourceSubId)) : accounts.find((row) => row.available && used.has(row.id)) || accounts[0];
  const today = bankToday();
  return <AppShell>{account ? <BankForecastWorkspace key={`${company}:${account.id}:${today.slice(0, 7)}`} company={company} account={account} accounts={accounts} evidence={bankForecastEvidence(data, company, account.id, today)} /> : <section className="space-y-4"><h1 className="text-xl font-semibold">口座の予測</h1><p className="text-sm text-muted-foreground">{params.account ? "対象の口座が見つかりません。" : "予測対象の口座はまだありません。"}</p><Link className="inline-flex min-h-11 items-center text-sm text-primary underline" href={`/banking?company=${company}`}>口座・カード明細へ</Link></section>}</AppShell>;
}
