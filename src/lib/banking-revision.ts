import "server-only";
import { createHash } from "node:crypto";
import type { AppData } from "@/lib/types";
import type { CompanyScope } from "@/lib/company";

export function bankingDataRevision(data: AppData, company: CompanyScope) {
  const scoped = [data.bankTransactions, data.bankAccounts, data.accountingCategories, data.bankRules]
    .map((rows) => rows.filter((row) => row.company === company));
  return createHash("sha256").update(JSON.stringify(scoped)).digest("hex");
}
