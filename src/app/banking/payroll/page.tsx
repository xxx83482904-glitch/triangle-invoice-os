import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app/shell";
import { BankPayrollWorkspace } from "@/components/app/bank-payroll-workspace";
import { getCurrentUser } from "@/lib/auth";
import { bankFiscalYear } from "@/lib/bank-account-overview";
import { bankToday } from "@/lib/banking";
import { companyFromParam } from "@/lib/company";
import { payrollSummary } from "@/lib/payroll-summary";
import { can, canAccessCompany, defaultPathForRole } from "@/lib/rbac";
import { readDataForRequest } from "@/lib/store";

export default async function BankPayrollPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user, "view:banking")) redirect(defaultPathForRole(user.role));
  const params = await searchParams, company = companyFromParam(params.company);
  if (!canAccessCompany(user, company)) redirect(defaultPathForRole(user.role));
  const data = await readDataForRequest();
  const current = bankFiscalYear(bankToday());
  const year = /^\d{4}$/.test(params.year || "") ? Number(params.year) : current;
  const years = [...new Set([current, ...data.bankTransactions.filter((row) => row.company === company).map((row) => bankFiscalYear(row.transactionDate))])].sort((a, b) => b - a);
  return <AppShell><BankPayrollWorkspace company={company} summary={payrollSummary(data, company, year)} years={years} />{!years.length ? <Link className="text-sm text-primary underline" href={`/banking?company=${company}`}>口座・カード明細へ</Link> : null}</AppShell>;
}
