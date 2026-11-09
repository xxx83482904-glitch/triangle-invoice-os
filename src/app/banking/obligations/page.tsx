import { Button } from "@/components/ui/button";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Landmark, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app/shell";
import { getCurrentUser } from "@/lib/auth";
import { bankToday } from "@/lib/banking";
import { companyFromParam } from "@/lib/company";
import { can, canAccessCompany } from "@/lib/rbac";
import { defaultPathForUser } from "@/lib/app-navigation";
import { readDataForRequest } from "@/lib/store";
import { ObligationsWorkspace } from "@/components/app/obligations-workspace";
import { taxObligations } from "@/lib/tax-obligations";


// Source documents remain separate from exclusion decisions and the manual supplemental register.
export default async function BankObligationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user, "view:banking")) redirect(defaultPathForUser(user));
  const params = await searchParams, company = companyFromParam(params.company);
  if (!canAccessCompany(user, company)) redirect(defaultPathForUser(user));
  const data = await readDataForRequest(), today = bankToday();
  const summary = taxObligations(data, company, today);
  return <AppShell><div className="min-w-0 space-y-4 pb-12">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1"><h1 className="text-xl font-semibold">未払いの税金・社会保険</h1><p className="text-xs text-muted-foreground">{company === "JAPAN" ? "日本" : "中国"} / {today} 時点</p></div>
      <div className="flex flex-wrap gap-2"><Button asChild variant="soft" size="sm" className="h-auto max-w-full whitespace-normal break-words py-2 text-left lg:h-auto lg:min-h-8 lg:py-1.5"><Link href={`/banking?company=${company}`}><Landmark className="size-4" />口座・カード明細</Link></Button><Button asChild variant="soft" size="sm" className="h-auto max-w-full whitespace-normal break-words py-2 text-left lg:h-auto lg:min-h-8 lg:py-1.5"><Link href={`/banking/integrity?company=${company}`}><ShieldCheck className="size-4" />整合性チェック</Link></Button></div>
    </header>
    <ObligationsWorkspace company={company} today={today} summary={summary} mayEdit={can(user, "manage:banking")} actors={Object.fromEntries(data.users.map((row) => [row.id, row.name]))} />
  </div></AppShell>;
}
