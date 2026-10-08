import Link from "next/link";
import { Link2 } from "lucide-react";
import type { CompanyScope } from "@/lib/company";

export function BankReconciliationLink({ company, invoices = false }: { company: CompanyScope; invoices?: boolean }) {
  return <Link aria-label="銀行・請求書照合" title="銀行・請求書照合" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border px-3 text-sm hover:bg-muted" href={`/banking/reconcile?company=${company}${invoices ? "&view=invoices" : ""}`}><Link2 className="size-4 shrink-0" /><span className="sm:hidden">銀行照合</span><span className="hidden sm:inline">銀行・請求書照合</span></Link>;
}
