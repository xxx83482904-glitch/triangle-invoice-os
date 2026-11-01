import Link from "next/link";
import { redirect } from "next/navigation";
import { Landmark, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app/shell";
import { getCurrentUser } from "@/lib/auth";
import { bankToday } from "@/lib/banking";
import { companyFromParam } from "@/lib/company";
import { can, canAccessCompany, defaultPathForRole } from "@/lib/rbac";
import { readDataForRequest } from "@/lib/store";
import { ObligationsWorkspace } from "@/components/app/obligations-workspace";
import { taxObligations } from "@/lib/tax-obligations";

const linkClass = "inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm hover:bg-muted";

// Source documents remain separate from exclusion decisions and the manual supplemental register.
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
      <div className="min-w-0 space-y-1"><h1 className="text-xl font-semibold">未払いの税金・社会保険</h1><p className="text-xs text-muted-foreground">{company === "JAPAN" ? "日本" : "中国"} / {today} 時点</p></div>
      <div className="flex flex-wrap gap-2"><Link className={linkClass} href={`/banking?company=${company}`}><Landmark className="size-4" />口座・カード明細</Link><Link className={linkClass} href={`/banking/integrity?company=${company}`}><ShieldCheck className="size-4" />整合性チェック</Link></div>
    </header>
    <ObligationsWorkspace company={company} today={today} summary={summary} mayEdit={can(user, "manage:banking")} actors={Object.fromEntries(data.users.map((row) => [row.id, row.name]))} />
  </div></AppShell>;
}
