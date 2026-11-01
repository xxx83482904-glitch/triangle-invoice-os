import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Link2 } from "lucide-react";
import type { CompanyScope } from "@/lib/company";

export function BankReconciliationLink({ company, invoices = false }: { company: CompanyScope; invoices?: boolean }) {
  return <Button asChild variant="soft" size="sm"><Link aria-label="銀行・請求書照合" title="銀行・請求書照合" href={`/banking/reconcile?company=${company}${invoices ? "&view=invoices" : ""}`}><Link2 className="size-4 shrink-0" /><span className="sm:hidden">銀行照合</span><span className="hidden sm:inline">銀行・請求書照合</span></Link></Button>;
}
