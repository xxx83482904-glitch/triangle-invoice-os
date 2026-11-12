import { isCardUse, userCardAccounts } from "@/lib/card-receipts";
import type { CompanyScope } from "@/lib/company";
import type { AppData, User } from "@/lib/types";

// The numbers on top of the phone expense app, for one person: what they spent this month (reimbursed claims plus
// their company card), every claim not yet approved (whatever month), approved claims not yet paid, and the last few
// months' totals.
const cents = (value: number) => Math.round(value * 100);

export function monthKeys(today: string, count: number) {
  const [year, month] = today.split("-").map(Number);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 - (count - 1 - index), 1));
    return date.toISOString().slice(0, 7);
  });
}

export function myExpenseStats(data: AppData, user: Pick<User, "id">, company: CompanyScope, today: string, months = 6) {
  const keys = monthKeys(today, months), current = today.slice(0, 7);
  const claims = (data.expenseClaims || []).filter((row) => !row.deletedAt && row.company === company && row.submittedById === user.id && row.status !== "WITHDRAWN");
  const cards = userCardAccounts(data, user, company);
  const uses = data.bankTransactions.filter((row) => row.transactionDate <= today && cards.some((card) => isCardUse(data, card.id, row)));
  const expenseBy = new Map<string, number>(), cardBy = new Map<string, number>();
  for (const row of claims) expenseBy.set(row.spentOn.slice(0, 7), (expenseBy.get(row.spentOn.slice(0, 7)) || 0) + cents(row.amount));
  for (const row of uses) cardBy.set(row.transactionDate.slice(0, 7), (cardBy.get(row.transactionDate.slice(0, 7)) || 0) + cents(row.amount));
  const sum = (rows: typeof claims) => ({ count: rows.length, amount: rows.reduce((total, row) => total + cents(row.amount), 0) / 100 });
  return {
    month: current,
    thisMonth: { expense: (expenseBy.get(current) || 0) / 100, card: (cardBy.get(current) || 0) / 100, total: ((expenseBy.get(current) || 0) + (cardBy.get(current) || 0)) / 100 },
    // Everything not approved yet, from any month: waiting for the approver, or sent back to be fixed.
    unapproved: { ...sum(claims.filter((row) => row.status === "SUBMITTED" || row.status === "RETURNED")), returned: claims.filter((row) => row.status === "RETURNED").length },
    awaitingPayout: sum(claims.filter((row) => row.status === "APPROVED")),
    monthly: keys.map((month) => ({ month, total: ((expenseBy.get(month) || 0) + (cardBy.get(month) || 0)) / 100 })),
    hasCard: cards.length > 0,
  };
}
export type ExpenseStats = ReturnType<typeof myExpenseStats>;
