import type { BankTransaction } from "@/lib/banking-types";

export const normalizeBankSearch = (text: string) => text.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("ja");

export function matchesBankSearch(row: Pick<BankTransaction, "content" | "memo" | "sourceMemo">, query: string, mode = "contains", excluded = "") {
  const content = normalizeBankSearch(row.content);
  const text = normalizeBankSearch(`${row.content} ${row.memo} ${row.sourceMemo}`);
  const needle = normalizeBankSearch(query);
  const exclusions = excluded.split(/[\n,、]+/).map(normalizeBankSearch).filter(Boolean);
  return (!needle || (mode === "exact" ? content === needle : text.includes(needle)))
    && !exclusions.some((word) => text.includes(word));
}
