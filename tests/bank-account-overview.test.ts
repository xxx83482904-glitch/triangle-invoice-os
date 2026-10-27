import assert from "node:assert/strict";
import test from "node:test";
import { accountKind, bankAccountOverview, bankFiscalYear, saveBankOverview } from "../src/lib/bank-account-overview";
import { shiftForecastMonth } from "../src/lib/bank-forecast";
import { mergeBankMasters, mergeBankTransactions, sourceKey } from "../src/lib/banking";
import { recordBankCoverage } from "../src/lib/bank-forecast";
import { restoreUndoState } from "../src/lib/store";
import { fixture, admin, timestamp } from "./document-fixture";

const office = "0000-0001", today = "2026-10-26";
const id = (source = "bank", sub = "branch") => sourceKey("JAPAN", office, "account", source, sub);
function setup() {
  const data = fixture();
  mergeBankMasters(data, "JAPAN", office, [
    { id: "old", name: "PayPay銀行", serviceName: "PayPay銀行", isManual: false },
    { id: "old", subId: "branch", name: "PayPay銀行 / 本店 普通 1237691", serviceName: "PayPay銀行", isManual: false },
    { id: "bank", name: "PayPay銀行", serviceName: "PayPay銀行", isManual: false },
    { id: "bank", subId: "branch", name: "PayPay銀行 / 本店 普通 1237691", serviceName: "PayPay銀行", isManual: false },
    { id: "bank", subId: "other", name: "PayPay銀行 / 本店 普通 7654321", serviceName: "PayPay銀行", isManual: false },
    { id: "card", name: "UPSIDER", serviceName: "UPSIDER", isManual: false },
  ], []);
  data.bankAccounts.filter((row) => row.sourceId === "old").forEach((row) => { row.available = false; });
  mergeBankTransactions(data, "JAPAN", office, [
    { id: "before", connected_account_id: "bank", connected_sub_account_id: "branch", date: "2026-10-01", value: 5000, side: "INCOME", content: "Before snapshot", journalizing_status: "none" },
    { id: "older", connected_account_id: "old", connected_sub_account_id: "branch", date: "2026-10-02", value: 300, side: "INCOME", content: "Old connection", journalizing_status: "none" },
    { id: "expense", connected_account_id: "bank", connected_sub_account_id: "branch", date: "2026-10-03", value: 200, side: "EXPENSE", content: "Transfer", journalizing_status: "excluded" },
    { id: "card", connected_account_id: "card", date: "2026-10-04", value: 700, side: "EXPENSE", content: "Card purchase", journalizing_status: "none" },
    { id: "parent", connected_account_id: "bank", date: "2026-10-05", value: 50, side: "INCOME", content: "Unspecified", journalizing_status: "none" },
    { id: "other", connected_account_id: "bank", connected_sub_account_id: "other", date: "2026-10-06", value: 600, side: "INCOME", content: "Other account", journalizing_status: "none" },
    { id: "missing", connected_account_id: "bank", connected_sub_account_id: "branch", date: "2026-09-01", value: 9999, side: "INCOME", content: "Missing source", journalizing_status: "none" },
    { id: "future", connected_account_id: "bank", connected_sub_account_id: "branch", date: "2026-10-30", value: 9999, side: "INCOME", content: "Future", journalizing_status: "none" },
  ], { start: "2026-09-01", end: "2026-10-31" });
  data.bankTransactions.find((row) => row.sourceId === "missing")!.sourceMissing = true;
  data.bankSyncStates.push({ id: "sync", company: "JAPAN", officeCode: office, officeName: "Test", autoSync: false, status: "SUCCESS", imported: 8, updated: 0, createdAt: timestamp, updatedAt: timestamp, lastSuccessAt: "2026-10-26T01:00:00Z" });
  recordBankCoverage(data.bankSyncStates[0], "2026-09-01", today, data.bankAccounts.map((row) => row.id));
  return data;
}

test("overview deduplicates reconnects and never double counts children under connection headers", () => {
  const data = setup(), before = structuredClone(data), report = bankAccountOverview(data, "JAPAN", "2026-10", today);
  assert.equal(report.rows.length, 4);
  const bank = report.rows.find((row) => row.id === id())!;
  assert.equal(bank.memberCount, 2); assert.equal(bank.income, 5300); assert.equal(bank.expense, 200); assert.equal(bank.count, 3);
  assert.equal(bank.balance, undefined); assert.equal(bank.estimatedBalance, undefined);
  assert.equal(report.rows.reduce((sum, row) => sum + row.income, 0), 5950);
  assert.equal(report.rows.reduce((sum, row) => sum + row.expense, 0), 900);
  const parent = report.rows.find((row) => row.unspecified)!;
  assert.equal(parent.kind, "UNKNOWN"); assert.equal(parent.income, 50);
  assert.equal(report.rows.find((row) => row.id === id("card", ""))!.kind, "CARD");
  assert.equal(report.rows.find((row) => row.id === id("card", ""))!.balance, undefined);
  assert.equal(bank.latestDate, "2026-10-03"); assert.equal(bank.transactions.length, 3);
  assert.equal(bank.history.find((point) => point.month === "2026-09")!.income, 0);
  assert.deepEqual(data, before);
});

test("confirmed balance is never replaced by movement or a forecast; estimate only uses later covered movement", () => {
  const data = setup(), account = data.bankAccounts.find((row) => row.id === id())!;
  saveBankOverview(data, admin, "JAPAN", account.id, account.updatedAt, { kind: "BANK", balance: { amount: 10000, asOf: "2026-10-01", currency: "JPY" } }, today);
  const report = bankAccountOverview(data, "JAPAN", "2026-10", today).rows.find((row) => row.id === id())!;
  assert.equal(report.balance?.amount, 10000); assert.equal(report.estimatedBalance, 10100);
  assert.equal(report.balanceThrough, today);
  data.bankSyncStates[0].coverage = [];
  assert.equal(bankAccountOverview(data, "JAPAN", "2026-10", today).rows.find((row) => row.id === id())!.estimatedBalance, undefined);
  recordBankCoverage(data.bankSyncStates[0], "2026-10-01", today, data.bankAccounts.map((row) => row.id));
  data.bankTransactions.find((row) => row.sourceId === "older")!.sourceMissing = true;
  assert.equal(bankAccountOverview(data, "JAPAN", "2026-10", today).rows.find((row) => row.id === id())!.estimatedBalance, undefined);
});

test("historical month, zero, negative balances and separate companies remain explicit", () => {
  const data = setup(), account = data.bankAccounts.find((row) => row.id === id())!;
  for (const amount of [0, -200]) {
    saveBankOverview(data, admin, "JAPAN", account.id, account.updatedAt, { kind: "BANK", balance: { amount, asOf: "2026-10-01", currency: "JPY" } }, today);
    const report = bankAccountOverview(data, "JAPAN", "2026-08", today).rows.find((row) => row.id === id())!;
    assert.equal(report.balance?.amount, amount); assert.equal(report.estimatedBalance, undefined); assert.equal(report.count, 0); assert.equal(report.missing, 0);
    assert.equal(report.balanceThrough, "2026-08-31");
  }
  assert.equal(bankAccountOverview(data, "JAPAN", "2026-99", today).month, "2026-10");
  assert.equal(bankAccountOverview(data, "JAPAN", "2026-11", today).month, "2026-10");
  assert.equal(bankAccountOverview(data, "CHINA", "2026-10", today).rows.length, 0);
});

test("default period follows the latest valid available transaction and excludes other companies, orphans, missing and future data", () => {
  const data = setup(), sample = data.bankTransactions[0];
  data.bankTransactions = [
    { ...sample, id: "june", transactionDate: "2026-06-30" },
    { ...sample, id: "august", transactionDate: "2026-08-31" },
    { ...sample, id: "china", company: "CHINA", transactionDate: "2026-10-01" },
    { ...sample, id: "missing", sourceMissing: true, transactionDate: "2026-10-02" },
    { ...sample, id: "future", transactionDate: "2026-10-27" },
    { ...sample, id: "orphan", bankAccountId: "absent", transactionDate: "2026-10-03" },
    { ...sample, id: "wrong-office", officeCode: "other", transactionDate: "2026-10-04" },
    { ...sample, id: "invalid", transactionDate: "2026-09-31" },
  ];
  const report = bankAccountOverview(data, "JAPAN", undefined, today);
  assert.equal(report.latestMonth, "2026-08"); assert.equal(report.month, "2026-08");
  assert.deepEqual(report.period, { year: 2026, start: "2025-09-01", end: "2026-08-31" });
  assert.equal(report.through, "2026-08-31");
  assert.deepEqual(report.rows.find((row) => row.id === id())!.transactions.map((row) => row.id), ["august", "june"]);
  data.bankTransactions.push({ ...sample, id: "latest", transactionDate: "2026-10-20" });
  const latest = bankAccountOverview(data, "JAPAN", undefined, today);
  assert.equal(latest.period.year, 2027); assert.equal(latest.latestMonth, "2026-10");
  assert.equal(bankAccountOverview(data, "JAPAN", "2026-06", today).period.year, 2026);
  assert.equal(bankAccountOverview(data, "JAPAN", "2026-06", today, "2027").period.year, 2027);
});

test("August fiscal close covers exactly twelve months and all transactions in descending date order", () => {
  const data = setup(), sample = data.bankTransactions[0];
  data.bankTransactions = Array.from({ length: 12 }, (_, index) => {
    const month = shiftForecastMonth("2025-09", index);
    return Array.from({ length: 8 }, (_, day) => ({ ...sample, id: `${month}-${day}`, transactionDate: `${month}-${String(day + 1).padStart(2, "0")}`, amount: 100, side: day % 2 ? "EXPENSE" as const : "INCOME" as const }));
  }).flat();
  data.bankTransactions.push(
    { ...sample, id: "before-period", transactionDate: "2025-08-31" },
    { ...sample, id: "last-day", transactionDate: "2026-08-31", amount: 200 },
    { ...sample, id: "next-period", transactionDate: "2026-09-01" },
  );
  const report = bankAccountOverview(data, "JAPAN", undefined, today, "2026"), bank = report.rows.find((row) => row.id === id())!;
  assert.equal(bankFiscalYear("2026-08-31"), 2026); assert.equal(bankFiscalYear("2026-09-01"), 2027);
  assert.equal(bank.history.length, 12); assert.equal(bank.history[0].month, "2025-09"); assert.equal(bank.history.at(-1)!.month, "2026-08");
  assert.equal(bank.count, 97); assert.equal(bank.transactions.length, 97);
  assert.equal(bank.transactions[0].id, "last-day"); assert.equal(bank.transactions.at(-1)!.transactionDate, "2025-09-01");
  assert.equal(bank.income, 5000); assert.equal(bank.expense, 4800); assert.equal(bank.net, 200);
  assert.equal(bank.history.reduce((sum, point) => sum + point.count, 0), bank.count);
  assert.deepEqual(bank.transactions.map((row) => row.transactionDate), bank.transactions.map((row) => row.transactionDate).sort().reverse());
  assert.ok(bank.history.every((point) => !point.future));
});

test("current fiscal period marks future months and empty or invalid inputs fall back safely", () => {
  const report = bankAccountOverview(setup(), "JAPAN", undefined, today);
  assert.equal(report.period.year, 2027); assert.equal(report.through, today);
  assert.equal(report.rows[0].history.filter((point) => point.future).length, 10);
  assert.ok(report.rows[0].history.filter((point) => point.future).every((point) => !point.count && !point.covered));
  assert.deepEqual(report.fiscalYears, [2027, 2026]);
  const data = setup(); data.bankTransactions = [];
  for (const [month, year] of [[undefined, undefined], ["0000-01", "0000"], ["2026-99", "invalid"], ["2027-01", "9999"]]) {
    const empty = bankAccountOverview(data, "JAPAN", month, today, year);
    assert.equal(empty.period.year, 2027); assert.equal(empty.latestMonth, ""); assert.equal(empty.rows[0].count, 0);
  }
});

test("account edits enforce role, company, valid balances, day-end dates and optimistic concurrency", () => {
  const data = setup(), account = data.bankAccounts.find((row) => row.id === id())!, before = structuredClone(data);
  const input = { kind: "BANK" as const, balance: { amount: 100, asOf: today, currency: "JPY" as const } };
  assert.throws(() => saveBankOverview(data, { id: "billing", role: "BILLING_EDITOR" }, "JAPAN", id(), account.updatedAt, input, today));
  assert.throws(() => saveBankOverview(data, admin, "CHINA", id(), account.updatedAt, input, today));
  assert.throws(() => saveBankOverview(data, admin, "JAPAN", id(), "stale", input, today));
  for (const balance of [{ ...input.balance, amount: NaN }, { ...input.balance, amount: 0.5 }, { ...input.balance, asOf: "2026-02-30" }, { ...input.balance, asOf: "2026-10-27" }]) assert.throws(() => saveBankOverview(data, admin, "JAPAN", id(), account.updatedAt, { ...input, balance }, today));
  assert.throws(() => saveBankOverview(data, admin, "JAPAN", id(), account.updatedAt, { ...input, kind: "CARD" }, today));
  const parent = data.bankAccounts.find((row) => row.id === id("bank", ""))!;
  assert.throws(() => saveBankOverview(data, admin, "JAPAN", parent.id, parent.updatedAt, input, today));
  assert.deepEqual(data, before);
  saveBankOverview(data, { id: "accounting", role: "ACCOUNTING" }, "JAPAN", id(), account.updatedAt, input, today);
  assert.equal(account.overviewSettings?.balance?.amount, 100);
  assert.deepEqual(data.bankTransactions, before.bankTransactions); assert.deepEqual(data.issuedInvoices, before.issuedInvoices);
  saveBankOverview(data, admin, "JAPAN", id(), account.updatedAt, { kind: "UNKNOWN" }, today);
  assert.equal(accountKind(account), "UNKNOWN"); assert.equal(account.overviewSettings?.balance, undefined);
});

test("sync preserves registered balances and undo restores them without rolling back source metadata", () => {
  const data = setup(), account = data.bankAccounts.find((row) => row.id === id())!, before = structuredClone(account);
  saveBankOverview(data, admin, "JAPAN", id(), account.updatedAt, { kind: "BANK", balance: { amount: 3000, asOf: today, currency: "JPY" } }, today);
  mergeBankMasters(data, "JAPAN", office, [{ id: "bank", subId: "branch", name: "Renamed bank", serviceName: "PayPay銀行", isManual: false }], []);
  assert.equal(account.overviewSettings?.balance?.amount, 3000);
  restoreUndoState(data, { format: "triangle-undo-patch-v1", changes: [{ collection: "bankAccounts", id: id(), index: 3, before }] });
  const restored = data.bankAccounts.find((row) => row.id === id())!;
  assert.equal(restored.overviewSettings, undefined); assert.equal(restored.name, "Renamed bank");
});
