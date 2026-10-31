import type { ReconciliationBank, ReconciliationInvoice } from "@/lib/bank-reconciliation";

// 入金照合の合算提案: two or three open invoices whose outstanding amounts add up to the bank receipt.
// Same-party sets rank first; the person still reviews and confirms through the allocation screen.
export type ReconciliationCombination = { keys: string[]; parties: string[]; sameParty: boolean; total: number; titles: string[] };
const cents = (value: number) => Math.round(value * 100);

export function reconciliationCombinations(bank: ReconciliationBank, invoices: ReconciliationInvoice[], limit = 5): ReconciliationCombination[] {
  if (bank.issue || bank.conflict || bank.remaining <= 0) return [];
  const target = cents(bank.remaining);
  const pool = invoices.filter((row) => row.eligible && !row.conflict && row.outstanding > 0 && cents(row.outstanding) < target && (bank.side === "INCOME" ? row.kind === "issued" : row.kind === "received"))
    .sort((a, b) => cents(b.outstanding) - cents(a.outstanding)).slice(0, 60);
  const found: ReconciliationCombination[] = [];
  const push = (rows: ReconciliationInvoice[]) => {
    const parties = [...new Set(rows.map((row) => row.party))];
    found.push({ keys: rows.map((row) => row.key), parties, sameParty: parties.length === 1, total: rows.reduce((sum, row) => sum + row.outstanding, 0), titles: rows.map((row) => `${row.party} / ${row.title}`) });
  };
  for (let i = 0; i < pool.length; i++) {
    const a = cents(pool[i].outstanding);
    for (let j = i + 1; j < pool.length; j++) {
      const ab = a + cents(pool[j].outstanding);
      if (ab === target) push([pool[i], pool[j]]);
      else if (ab < target) for (let k = j + 1; k < pool.length; k++) if (ab + cents(pool[k].outstanding) === target) push([pool[i], pool[j], pool[k]]);
      if (found.length > 200) break;
    }
  }
  return found.sort((x, y) => Number(y.sameParty) - Number(x.sameParty) || x.keys.length - y.keys.length || x.titles.join().localeCompare(y.titles.join(), "ja")).slice(0, limit);
}
