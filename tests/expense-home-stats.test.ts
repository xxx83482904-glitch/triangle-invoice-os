import assert from "node:assert/strict";
import test from "node:test";
import { expenseAdmin, expenseDesigner, expensesFixture } from "./expense-claims-fixture";
import { timestamp } from "./document-fixture";
import { assignCompanyCard } from "../src/lib/card-receipts";
import { monthKeys, myExpenseStats } from "../src/lib/expense-home-stats";
import type { BankTransaction } from "../src/lib/banking-types";

test("month keys run back from the current month across a year boundary", () => {
  assert.deepEqual(monthKeys("2026-02-10", 4), ["2025-11", "2025-12", "2026-01", "2026-02"]);
});

test("home stats count only the person's own live claims and add their company card uses", () => {
  const data = expensesFixture(), today = "2026-10-25";
  const before = myExpenseStats(data, expenseDesigner, "JAPAN", today);
  const own = data.expenseClaims!.filter((row) => row.submittedById === "des" && !row.deletedAt && row.status !== "WITHDRAWN");
  const october = own.filter((row) => row.spentOn.startsWith("2026-10")).reduce((sum, row) => sum + row.amount, 0);
  assert.equal(before.thisMonth.total, october); assert.equal(before.thisMonth.card, 0); assert.equal(before.hasCard, false);
  const open = own.filter((row) => row.status === "SUBMITTED" || row.status === "RETURNED");
  assert.equal(before.unapproved.count, open.length);
  assert.equal(before.unapproved.amount, open.reduce((sum, row) => sum + row.amount, 0));
  assert.equal(before.unapproved.returned, own.filter((row) => row.status === "RETURNED").length);
  assert.equal(before.awaitingPayout.count, own.filter((row) => row.status === "APPROVED").length);
  // An old claim still waiting counts too: the figure is not limited to this month.
  const old = own.find((row) => row.status === "SUBMITTED")!, spentOn = old.spentOn; old.spentOn = "2026-03-02";
  assert.equal(myExpenseStats(data, expenseDesigner, "JAPAN", today).unapproved.count, open.length); old.spentOn = spentOn;
  assert.equal(before.monthly.length, 6); assert.equal(before.monthly.at(-1)?.month, "2026-10"); assert.equal(before.monthly.at(-1)?.total, october);

  data.bankAccounts = [{ id: "aplus", company: "JAPAN", officeCode: "o", sourceId: "aplus", name: "佐藤カード", serviceName: "アプラス", isManual: false, available: true, createdAt: timestamp, updatedAt: timestamp }];
  const use = (id: string, amount: number, date: string, patch: Partial<BankTransaction> = {}): BankTransaction => ({ id, company: "JAPAN", officeCode: "o", sourceId: id, bankAccountId: "aplus", side: "EXPENSE", amount, content: id,
    transactionDate: date, sourceMemo: "", sourceStatus: "none", sourceMissing: false, treatment: "NORMAL", classificationSource: "UNASSIGNED", reviewed: false, memo: "", createdAt: timestamp, updatedAt: timestamp, ...patch });
  data.bankTransactions = [use("a", 6820, "2026-10-06"), use("b", 1200, "2026-09-03"), use("refund", 500, "2026-10-07", { side: "INCOME" }), use("future", 999, "2026-10-30")];
  assignCompanyCard(data, expenseAdmin, "JAPAN", { userId: "des", accountId: "aplus" });
  const after = myExpenseStats(data, expenseDesigner, "JAPAN", today);
  assert.equal(after.thisMonth.card, 6820); assert.equal(after.thisMonth.total, october + 6820); assert.equal(after.hasCard, true);
  assert.equal(after.monthly.find((row) => row.month === "2026-09")!.total, before.monthly.find((row) => row.month === "2026-09")!.total + 1200);
});
